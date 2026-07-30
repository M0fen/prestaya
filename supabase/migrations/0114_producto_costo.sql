-- ─────────────────────────────────────────────────────────────────────────
-- 0114 — COSTO del producto. Lo que le CUESTA a Presta Ya cada producto (lo que
-- paga a Curbe / al proveedor / de fábrica). Permite calcular la GANANCIA real:
--   ganancia por venta = total a cobrar − costo.
-- Defensivo: null = costo sin definir (la ganancia de ese producto queda "a definir",
-- no se asume 0 para no inflar las ganancias). No money-critical (es informativo).
-- ─────────────────────────────────────────────────────────────────────────
alter table productos add column if not exists costo numeric(12,2) check (costo is null or costo >= 0);
comment on column productos.costo is
  'Lo que le cuesta a Presta Ya (proveedor/Curbe/fábrica). null = sin definir. Ganancia = total cobrado − costo (0114).';
