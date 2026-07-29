-- ─────────────────────────────────────────────────────────────────────────
--  0096 · Endurecimiento de RLS (defensa en profundidad) en tablas que quedaron
--  con policies ANCHAS (`app_es_gestor()` / `for all` sin acotar) — el mismo
--  patrón que 0056/0060/0066/0093/0094 corrigieron en sus hermanas, pero que a
--  estas nunca se les aplicó. Reachables por un SUPERVISOR con su anon key + JWT
--  vía PostgREST crudo (sin pasar por la UI). Todos los SELECT mantienen la rama
--  `app_es_admin()` → la UI del dueño NO cambia; solo se cierra el REST crudo.
--
--  Impacto por-zona recién con 2+ zonas, PERO recibos y auditoria filtran datos
--  del DUEÑO a cualquier supervisor incluso con UNA sola zona → prioridad.
--
--  Solo cambia RLS → aplica al instante. Re-ejecutable. Correr en el SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

-- ── recibos: nómina del dueño (comisión/sueldo/adelanto/viáticos). Antes
--    app_es_gestor() → cualquier supervisor leía TODA la nómina. Ahora: el dueño
--    ve todo; cada trabajador ve SOLO su propio recibo. (Insert queda gestor: la
--    acción ya exige admin para liquidar.) ─────────────────────────────────────
drop policy if exists recibos_select on recibos;
create policy recibos_select on recibos for select to authenticated
  using ( app_es_admin() or trabajador_id = app_usuario_id() );

-- ── auditoria: rastro inmutable de acciones de plata (renovaciones, caja, cierres,
--    retiros del dueño). Antes app_es_gestor() → supervisor leía el log COMPLETO.
--    Ahora: dueño ve todo; supervisor ve solo las acciones de SUS cobradores. ─────
drop policy if exists audit_select on auditoria;
create policy audit_select on auditoria for select to authenticated
  using ( app_es_admin() or app_gestor_ve_cobrador(actor_id) );

-- ── mora_notas: motivos de atraso + acuerdos de pago (PII). Antes `for all`
--    app_es_gestor() → un supervisor LEÍA, INYECTABA y BORRABA notas de clientes
--    de otra zona (destructivo). Ahora acotado al cliente que el gestor ve;
--    append-only (sin DELETE por RLS). ─────────────────────────────────────────
drop policy if exists mora_notas_select on mora_notas;
drop policy if exists mora_notas_write on mora_notas;
create policy mora_notas_select on mora_notas for select to authenticated
  using ( app_gestor_ve_cliente(cliente_id) );
create policy mora_notas_insert on mora_notas for insert to authenticated
  with check ( app_gestor_ve_cliente(cliente_id) );
create policy mora_notas_update on mora_notas for update to authenticated
  using ( app_gestor_ve_cliente(cliente_id) ) with check ( app_gestor_ve_cliente(cliente_id) );

-- ── config_scoring / config_mora / config_operacion: política de dinero GLOBAL
--    (pesos del score, tope de usura, meta de operación). La lectura por gestor
--    está OK (ven las reglas), pero el WRITE era app_es_gestor() → un supervisor
--    podía PATCHear la config por REST crudo, saltando el gate admin de la app.
--    Ahora la escritura es solo admin (igual a lo que la app ya exige). ──────────
drop policy if exists config_scoring_write on config_scoring;
create policy config_scoring_write on config_scoring for all to authenticated
  using ( app_es_admin() ) with check ( app_es_admin() );

drop policy if exists config_mora_write on config_mora;
create policy config_mora_write on config_mora for all to authenticated
  using ( app_es_admin() ) with check ( app_es_admin() );

drop policy if exists config_operacion_write on config_operacion;
create policy config_operacion_write on config_operacion for all to authenticated
  using ( app_es_admin() ) with check ( app_es_admin() );

-- ── solicitudes_renovacion: flujo de renovación (términos del nuevo crédito).
--    Antes `for all` app_es_gestor() → lectura + inyección/borrado cross-zona.
--    Ahora acotado al cliente del gestor (el dueño, todo). ─────────────────────
drop policy if exists solren_select on solicitudes_renovacion;
drop policy if exists solren_write on solicitudes_renovacion;
create policy solren_select on solicitudes_renovacion for select to authenticated
  using ( app_es_admin() or app_gestor_ve_cliente(cliente_id) );
create policy solren_write on solicitudes_renovacion for all to authenticated
  using ( app_es_admin() or app_gestor_ve_cliente(cliente_id) )
  with check ( app_es_admin() or app_gestor_ve_cliente(cliente_id) );

-- ── reconciliacion_log: salud/violaciones de reconciliación de plata. Antes
--    `using (true) to authenticated` → un COBRADOR lo leía por REST. Ahora gestor. ─
drop policy if exists recon_log_select on reconciliacion_log;
create policy recon_log_select on reconciliacion_log for select to authenticated
  using ( app_es_gestor() );

-- ── estrellas_redenciones · solicitudes_producto (leads): datos ligados a
--    cliente_id de otras zonas. Se acota la LECTURA al cliente que el gestor ve
--    (el dueño, todo). El write de leads (aprobar/gestionar) queda igual acotado. ─
drop policy if exists redenciones_select_gestor on estrellas_redenciones;
create policy redenciones_select_gestor on estrellas_redenciones for select to authenticated
  using ( app_es_admin() or app_gestor_ve_cliente(cliente_id) );

drop policy if exists solic_prod_select on solicitudes_producto;
create policy solic_prod_select on solicitudes_producto for select to authenticated
  using ( app_es_admin() or app_gestor_ve_cliente(cliente_id) );
drop policy if exists solic_prod_update on solicitudes_producto;
create policy solic_prod_update on solicitudes_producto for update to authenticated
  using ( app_es_admin() or app_gestor_ve_cliente(cliente_id) )
  with check ( app_es_admin() or app_gestor_ve_cliente(cliente_id) );

-- ── snapshot_credito / snapshot_totales: baseline financiero de la transición
--    (herramienta del dueño). La escritura ya es service_role. La lectura se
--    restringe al dueño (o al supervisor de esa zona en snapshot_credito). ──────
drop policy if exists snapshot_credito_leer on snapshot_credito;
create policy snapshot_credito_leer on snapshot_credito for select to authenticated
  using ( app_es_admin() or app_supervisa_zona(zona_id) );

drop policy if exists snapshot_totales_leer on snapshot_totales;
create policy snapshot_totales_leer on snapshot_totales for select to authenticated
  using ( app_es_admin() );
