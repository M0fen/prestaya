-- ─────────────────────────────────────────────────────────────────────────
--  0100 · TIENDA — STOCK con CANTIDAD ("cuántos quedan").
--
--  `stock` = unidades disponibles. NULL = no se controla el stock (siempre
--  disponible, sin cartel de cantidad). >0 = quedan N (la vitrina muestra escasez
--  cuando son pocas: "¡Últimas N unidades!"). 0 = sin stock (no se puede pedir).
--
--  Convive con `agotado` (0099): un producto NO está disponible si `agotado = true`
--  O `stock = 0`. Así el admin puede pausar a mano (agotado) o dejar que el número
--  lo agote solo. Default NULL → los productos actuales quedan "sin control de stock"
--  (disponibles), sin cambiar nada.
--
--  Solo agrega una columna → aplica al instante. Re-ejecutable. Correr en SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

alter table productos add column if not exists stock int;
alter table productos drop constraint if exists productos_stock_check;
alter table productos add constraint productos_stock_check check (stock is null or stock >= 0);
