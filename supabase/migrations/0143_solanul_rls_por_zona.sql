-- ─────────────────────────────────────────────────────────────────────────
--  0143 · RLS de solicitudes_anulacion POR ZONA (backlog P2 del inventario
--  del dinero, 08-14 — el "solanul forjable" anotado desde la auditoría 08-02).
--
--  Medido contra pg_policies: la escritura era `app_es_gestor()` a secas — un
--  supervisor podía, por REST directo, marcar "confirmada" o "rechazada" una
--  solicitud de anulación de OTRA zona. No mueve plata (el flip del pago va por
--  la Server Action con sus gates + service_role), pero deja un estado forjado
--  en el circuito de doble registro.
--
--  Regla (espejo de la 0140 para solicitudes_renovacion): el admin todo; el
--  gestor, las solicitudes cuyos PAGOS puede ver (su zona) — con
--  `app_gestor_ve_pago` (0094), que ya existe para esto. El COBRADOR no aparece:
--  pide por service_role tras los gates de la action (pago propio + origen app).
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists solanul_write on solicitudes_anulacion;

create policy solanul_write on solicitudes_anulacion for all to authenticated
  using ( app_es_admin() or app_gestor_ve_pago(pago_id) )
  with check ( app_es_admin() or app_gestor_ve_pago(pago_id) );
