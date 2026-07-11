-- ─────────────────────────────────────────────────────────────────────────
--  0066 — Separación por ZONA en tablas de dinero secundarias.
--  Auditoría Senior 2026-07-11: varias tablas quedaron en `app_es_gestor()` /
--  `for all` sin acotar por zona (mientras 0031/0035/0056/0060 sí acotaron
--  clientes/pagos/visitas/usuarios/notas/solgasto). Un supervisor con su JWT +
--  la anon key podía, por PostgREST crudo, leer/escribir fuera de su zona o ver
--  datos del dueño. Ninguno permitía robo directo (el flip de `pagos` sigue
--  admin-only), pero elevaban a un insider por encima de su zona.
--  Idempotente. Correr por el SQL Editor. Helpers de 0031: app_es_admin(),
--  app_gestor_ve_cobrador(uuid), app_supervisa_zona(uuid), app_usuario_id().
--
--  NOTA: `solicitudes_anulacion` NO se toca acá a propósito — su UPDATE de
--  confirmación lo hace la SESIÓN de OTRO supervisor (doble-registro), así que
--  restringir su RLS de escritura rompería el flujo; y como el flip real de
--  `pagos.anulado` es admin-only, no mueve plata. Queda para un pase dedicado.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1) movimientos_caja: no exponer capital del dueño ni otras zonas ────────
-- SELECT: admin ve todo; un gestor ve los movimientos de SUS cobradores + los
-- que registró él mismo. Los de CAPITAL (cobrador_id null, registrados por el
-- admin) quedan fuera del alcance del supervisor.
drop policy if exists mov_caja_select on movimientos_caja;
create policy mov_caja_select on movimientos_caja for select to authenticated
  using (
    app_es_admin()
    or (cobrador_id is not null and app_gestor_ve_cobrador(cobrador_id))
    or registrado_por = app_usuario_id()
  );

-- INSERT: además de gestor + autor = uno mismo, un supervisor solo atribuye a un
-- cobrador de SU zona (o sin cobrador). Cierra el "framear" a otra zona.
drop policy if exists mov_caja_insert on movimientos_caja;
create policy mov_caja_insert on movimientos_caja for insert to authenticated
  with check (
    app_es_gestor()
    and registrado_por = app_usuario_id()
    and (app_es_admin() or cobrador_id is null or app_gestor_ve_cobrador(cobrador_id))
  );
-- (mov_caja_delete queda admin-only, sin cambios.)

-- ── 2) rendiciones: SELECT acotado por zona ─────────────────────────────────
-- Antes cualquier gestor leía rendiciones/faltantes de TODAS las zonas.
drop policy if exists rend_select on rendiciones;
create policy rend_select on rendiciones for select to authenticated
  using (
    app_es_admin()
    or app_gestor_ve_cobrador(cobrador_id)
    or cobrador_id = app_usuario_id()
  );
-- (rend_insert self-only y rend_delete admin-only quedan sin cambios.)

-- ── 3) comisiones_liquidadas: lectura por zona, ESCRITURA admin-only ────────
-- El candado (cobrador, periodo) que da idempotencia era borrable por cualquier
-- supervisor → habilitaba re-liquidar (pagar comisión 2×). El write vive en un
-- action admin-only; espejamos eso en RLS.
drop policy if exists comisiones_liq_gestor_all on comisiones_liquidadas;
drop policy if exists comisiones_liq_select on comisiones_liquidadas;
drop policy if exists comisiones_liq_ins on comisiones_liquidadas;
drop policy if exists comisiones_liq_upd on comisiones_liquidadas;
drop policy if exists comisiones_liq_del on comisiones_liquidadas;
create policy comisiones_liq_select on comisiones_liquidadas for select to authenticated
  using ( app_es_admin() or app_gestor_ve_cobrador(cobrador_id) );
create policy comisiones_liq_ins on comisiones_liquidadas for insert to authenticated
  with check ( app_es_admin() );
create policy comisiones_liq_upd on comisiones_liquidadas for update to authenticated
  using ( app_es_admin() ) with check ( app_es_admin() );
create policy comisiones_liq_del on comisiones_liquidadas for delete to authenticated
  using ( app_es_admin() );

-- ── 4) cierres_zona: solo el admin o el supervisor de ESA zona ──────────────
-- Antes cualquier gestor leía/escribía cierres de cualquier zona.
drop policy if exists cierres_zona_gestor_all on cierres_zona;
create policy cierres_zona_gestor_all on cierres_zona for all to authenticated
  using ( app_es_admin() or app_supervisa_zona(zona_id) )
  with check ( app_es_admin() or app_supervisa_zona(zona_id) );
