-- ─────────────────────────────────────────────────────────────────────────
--  0014 · COMISIONES por cobrador. Tasa (%) sobre lo recaudado, por cobrador.
--  La comisión de un período = recaudado × comision_pct/100 (se calcula al
--  vuelo). Liquidar una comisión registra un EGRESO en `movimientos_caja`
--  (categoría "Comisión"), así impacta la caja. Ejecutar en el SQL Editor.
--  Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────
alter table usuarios
  add column if not exists comision_pct numeric(5,2) not null default 0
  check (comision_pct >= 0 and comision_pct <= 100);
