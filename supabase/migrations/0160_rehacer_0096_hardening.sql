-- ─────────────────────────────────────────────────────────────────────────
--  0160 · LA 0096 NUNCA CORRIÓ. Esto la reaplica, corregida.
--
--  QUÉ PASÓ (descubierto el 09-09, 25 días después): la 0096 endurecía la RLS de
--  nueve tablas, pero su PRIMERA sentencia es
--      drop policy if exists recibos_select on recibos;
--  y la tabla `recibos` no existe en esta base. El `if exists` protege la POLICY,
--  no la TABLA: la sentencia falla con 42P01, y como el SQL Editor corre el
--  archivo entero en una transacción, se revirtió TODO. Nadie se enteró porque el
--  vigilante de policies compara contra un snapshot regenerado DESDE LA BASE VIVA
--  (scripts/policies-esperadas.json): bendijo el estado sin 0096.
--
--  LO QUE ESTUVO ABIERTO TODO ESE TIEMPO (probado con sesión real de supervisor):
--    · `auditoria`         → los 3 supervisores leían las 1.510 filas del log
--      completo, de todas las zonas: comisiones liquidadas con nombre y monto,
--      bases de caja, gastos aprobados, retiros del dueño.
--    · `config_scoring/mora/operacion` → un supervisor PODÍA ESCRIBIRLAS por REST
--      (probado: 1 fila afectada) — el tope de usura y los pesos del score —,
--      salteando el gate de admin de la app.
--    · `mora_notas`        → `for all` a gestor: insertar, editar y BORRAR notas
--      de clientes de cualquier zona (PII: motivos de atraso, acuerdos).
--    · `reconciliacion_log`→ `using (true)`: lo leía cualquiera de los 52 cobradores.
--    · estrellas_redenciones · solicitudes_producto · snapshot_* → lectura ancha.
--
--  QUÉ CAMBIA RESPECTO DE LA 0096 ORIGINAL:
--   1. El bloque de `recibos` ya no puede abortar la migración: primero se CREA la
--      tabla (la 0046 la define y nunca corrió) y recién después se le pone policy.
--      Además /admin/recibos está en el menú del admin y ofrece el botón de emitir
--      sobre esa tabla: hoy la lectura degrada en silencio y la escritura explota.
--   2. Ninguna policy llama a una función SECURITY DEFINER QUE RECIBA LA FILA
--      (`app_gestor_ve_cliente(cliente_id)`, `app_gestor_ve_cobrador(actor_id)`…).
--      Ese es exactamente el anti-patrón que la 0159 tuvo que deshacer: Postgres no
--      puede inline-arlas, las llama UNA VEZ POR FILA y el planner nunca ve un
--      índice. Acá el predicado va escrito en SQL plano y lo que no depende de la
--      fila se calcula una sola vez, envuelto en (select ...).
--   3. `audit_select` suma la rama que la 0096 se olvidó: **el propio actor**. Sin
--      ella el supervisor perdía su bitácora del día en "Mi jornada"
--      (getBitacoraGestorDia filtra por actor_id), porque los supervisores tienen
--      usuarios.zona_id = NULL y su zona vive en supervisor_zonas.
--
--  Solo toca RLS y crea una tabla vacía → aplica al instante, sin deploy.
--  Se aplica con scripts/aplicar-0160-hardening.py, que mide qué ve cada usuario
--  ANTES y DESPUÉS y hace ROLLBACK si alguien pierde algo que no debía perder.
-- ─────────────────────────────────────────────────────────────────────────

set local lock_timeout = '5s';

-- ══ 0 · La tabla que faltaba (definición de la 0046, que nunca corrió) ════
create table if not exists recibos (
  id                 uuid primary key default gen_random_uuid(),
  numero             bigint generated always as identity,   -- correlativo legible
  trabajador_id      uuid references usuarios(id) on delete set null,
  trabajador_nombre  text not null,
  concepto           text not null,                          -- "Comisión", "Sueldo", "Adelanto"…
  monto              numeric(14,2) not null check (monto >= 0),
  periodo            text,
  nota               text,
  emitido_por        uuid references usuarios(id) on delete set null,
  emitido_por_nombre text,
  emitido_en         timestamptz not null default now()
);
create index if not exists idx_recibos_trabajador on recibos (trabajador_id, emitido_en desc);
alter table recibos enable row level security;

-- La nómina es del dueño. Cada trabajador ve SOLO su propio recibo.
drop policy if exists recibos_gestor_all on recibos;
drop policy if exists recibos_select on recibos;
drop policy if exists recibos_insert on recibos;
create policy recibos_select on recibos for select to authenticated
  using ( (select app_es_admin()) or trabajador_id = (select app_usuario_id()) );
-- Emitir queda en admin: la acción de la app ya lo exige.
create policy recibos_insert on recibos for insert to authenticated
  with check ( (select app_es_admin()) );

-- ══ 1 · auditoria — el rastro de la plata ════════════════════════════════
--  El dueño ve todo; el supervisor, lo que hicieron SUS cobradores y lo suyo propio.
--  ⚠️ La rama "lo mío" va ACOTADA A GESTOR. Sin el `app_es_gestor()`, un cobrador
--  pasaba a ver sus propias filas de auditoría —que hoy no ve— y eso es AMPLIAR
--  acceso, no cerrarlo (lo cazó la verificación del script: Anyela Quiñonez ganaba
--  63 filas, Angelika 2, Alejandro 1). La auditoría es el rastro de las acciones de
--  GESTIÓN; el cobrador tiene su propia bitácora.
drop policy if exists audit_select on auditoria;
create policy audit_select on auditoria for select to authenticated
  using (
    (select app_es_admin())
    or ((select app_es_gestor()) and actor_id = (select app_usuario_id()))
    or actor_id in (
      select u2.id from usuarios u2
       where u2.zona_id in (select sz.zona_id from supervisor_zonas sz
                             where sz.supervisor_id = (select app_usuario_id())))
  );

-- ══ 2 · mora_notas — PII, y append-only (sin DELETE por RLS) ═════════════
drop policy if exists mora_notas_select on mora_notas;
drop policy if exists mora_notas_write on mora_notas;
drop policy if exists mora_notas_insert on mora_notas;
drop policy if exists mora_notas_update on mora_notas;
create policy mora_notas_select on mora_notas for select to authenticated
  using (
    (select app_es_admin())
    or mora_notas.cliente_id in (
      select a2.cliente_id from asignaciones a2
       where a2.activo = true and a2.cobrador_id in (
             select u2.id from usuarios u2
              where u2.zona_id in (select sz.zona_id from supervisor_zonas sz
                                    where sz.supervisor_id = (select app_usuario_id()))))
  );
create policy mora_notas_insert on mora_notas for insert to authenticated
  with check (
    (select app_es_admin())
    or mora_notas.cliente_id in (
      select a2.cliente_id from asignaciones a2
       where a2.activo = true and a2.cobrador_id in (
             select u2.id from usuarios u2
              where u2.zona_id in (select sz.zona_id from supervisor_zonas sz
                                    where sz.supervisor_id = (select app_usuario_id()))))
  );
create policy mora_notas_update on mora_notas for update to authenticated
  using (
    (select app_es_admin())
    or mora_notas.cliente_id in (
      select a2.cliente_id from asignaciones a2
       where a2.activo = true and a2.cobrador_id in (
             select u2.id from usuarios u2
              where u2.zona_id in (select sz.zona_id from supervisor_zonas sz
                                    where sz.supervisor_id = (select app_usuario_id()))))
  )
  with check (
    (select app_es_admin())
    or mora_notas.cliente_id in (
      select a2.cliente_id from asignaciones a2
       where a2.activo = true and a2.cobrador_id in (
             select u2.id from usuarios u2
              where u2.zona_id in (select sz.zona_id from supervisor_zonas sz
                                    where sz.supervisor_id = (select app_usuario_id()))))
  );

-- ══ 3 · config_* — la política de dinero la fija el dueño ════════════════
--  La LECTURA sigue siendo de gestor (el supervisor ve las reglas con las que
--  trabaja); lo que se cierra es la ESCRITURA por REST crudo.
drop policy if exists config_scoring_write on config_scoring;
create policy config_scoring_write on config_scoring for all to authenticated
  using ( (select app_es_admin()) ) with check ( (select app_es_admin()) );

drop policy if exists config_mora_write on config_mora;
create policy config_mora_write on config_mora for all to authenticated
  using ( (select app_es_admin()) ) with check ( (select app_es_admin()) );

drop policy if exists config_operacion_write on config_operacion;
create policy config_operacion_write on config_operacion for all to authenticated
  using ( (select app_es_admin()) ) with check ( (select app_es_admin()) );

-- ══ 4 · reconciliacion_log — salud de la plata, no es del cobrador ═══════
drop policy if exists recon_log_select on reconciliacion_log;
create policy recon_log_select on reconciliacion_log for select to authenticated
  using ( (select app_es_gestor()) );

-- ══ 5 · solicitudes_renovacion — ya tenía la forma correcta (0140), pero
--       con función por fila. Mismo predicado, sin la caja negra. ══════════
drop policy if exists solren_select on solicitudes_renovacion;
drop policy if exists solren_write on solicitudes_renovacion;
create policy solren_select on solicitudes_renovacion for select to authenticated
  using (
    (select app_es_admin())
    or solicitudes_renovacion.cliente_id in (
      select a2.cliente_id from asignaciones a2
       where a2.activo = true and a2.cobrador_id in (
             select u2.id from usuarios u2
              where u2.zona_id in (select sz.zona_id from supervisor_zonas sz
                                    where sz.supervisor_id = (select app_usuario_id()))))
  );
create policy solren_write on solicitudes_renovacion for all to authenticated
  using (
    (select app_es_admin())
    or solicitudes_renovacion.cliente_id in (
      select a2.cliente_id from asignaciones a2
       where a2.activo = true and a2.cobrador_id in (
             select u2.id from usuarios u2
              where u2.zona_id in (select sz.zona_id from supervisor_zonas sz
                                    where sz.supervisor_id = (select app_usuario_id()))))
  )
  with check (
    (select app_es_admin())
    or solicitudes_renovacion.cliente_id in (
      select a2.cliente_id from asignaciones a2
       where a2.activo = true and a2.cobrador_id in (
             select u2.id from usuarios u2
              where u2.zona_id in (select sz.zona_id from supervisor_zonas sz
                                    where sz.supervisor_id = (select app_usuario_id()))))
  );

-- ══ 6 · estrellas_redenciones · solicitudes_producto — atadas al cliente ═
drop policy if exists redenciones_select_gestor on estrellas_redenciones;
create policy redenciones_select_gestor on estrellas_redenciones for select to authenticated
  using (
    (select app_es_admin())
    or estrellas_redenciones.cliente_id in (
      select a2.cliente_id from asignaciones a2
       where a2.activo = true and a2.cobrador_id in (
             select u2.id from usuarios u2
              where u2.zona_id in (select sz.zona_id from supervisor_zonas sz
                                    where sz.supervisor_id = (select app_usuario_id()))))
  );

drop policy if exists solic_prod_select on solicitudes_producto;
create policy solic_prod_select on solicitudes_producto for select to authenticated
  using (
    (select app_es_admin())
    or solicitudes_producto.cliente_id in (
      select a2.cliente_id from asignaciones a2
       where a2.activo = true and a2.cobrador_id in (
             select u2.id from usuarios u2
              where u2.zona_id in (select sz.zona_id from supervisor_zonas sz
                                    where sz.supervisor_id = (select app_usuario_id()))))
  );
drop policy if exists solic_prod_update on solicitudes_producto;
create policy solic_prod_update on solicitudes_producto for update to authenticated
  using (
    (select app_es_admin())
    or solicitudes_producto.cliente_id in (
      select a2.cliente_id from asignaciones a2
       where a2.activo = true and a2.cobrador_id in (
             select u2.id from usuarios u2
              where u2.zona_id in (select sz.zona_id from supervisor_zonas sz
                                    where sz.supervisor_id = (select app_usuario_id()))))
  )
  with check (
    (select app_es_admin())
    or solicitudes_producto.cliente_id in (
      select a2.cliente_id from asignaciones a2
       where a2.activo = true and a2.cobrador_id in (
             select u2.id from usuarios u2
              where u2.zona_id in (select sz.zona_id from supervisor_zonas sz
                                    where sz.supervisor_id = (select app_usuario_id()))))
  );

-- ══ 7 · snapshot_* — el baseline financiero de la transición ═════════════
drop policy if exists snapshot_credito_leer on snapshot_credito;
create policy snapshot_credito_leer on snapshot_credito for select to authenticated
  using (
    (select app_es_admin())
    or snapshot_credito.zona_id in (select sz.zona_id from supervisor_zonas sz
                                     where sz.supervisor_id = (select app_usuario_id()))
  );

drop policy if exists snapshot_totales_leer on snapshot_totales;
create policy snapshot_totales_leer on snapshot_totales for select to authenticated
  using ( (select app_es_admin()) );
