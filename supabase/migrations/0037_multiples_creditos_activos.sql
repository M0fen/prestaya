-- ─────────────────────────────────────────────────────────────────────────
--  0037 · Permitir MÚLTIPLES créditos activos por cliente (decisión de negocio).
--  Ejecutar en el SQL Editor. Re-ejecutable.
--
--  Hasta ahora Presta Ya imponía "un solo crédito activo por cliente" (índice
--  único de 0001). El negocio real (Disapp) SÍ da varios préstamos simultáneos
--  al mismo cliente (391 clientes con 2–5 activos). Se levanta la restricción a
--  criterio del admin. Se reemplaza el índice ÚNICO por uno NO único, para que
--  las consultas por (cliente + activo) sigan siendo rápidas.
--
--  NADA de dinero cambia: cada préstamo mantiene su propio cartón (el estado se
--  calcula por préstamo, no por cliente). La app pasa a listar los créditos
--  activos de un cliente en vez de asumir uno solo.
-- ─────────────────────────────────────────────────────────────────────────

drop index if exists un_prestamo_activo_por_cliente;

create index if not exists idx_prestamos_cliente_activo
  on prestamos (cliente_id) where (estado = 'activo');
