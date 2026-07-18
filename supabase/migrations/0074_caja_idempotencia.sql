-- ─────────────────────────────────────────────────────────────────────────
--  0074 · IDEMPOTENCIA de movimientos_caja (anti doble-egreso).
--
--  `agregarMovimientoCaja` (egresos/desembolsos/retiros/aportes) es hoy la ÚNICA
--  escritura de plata SIN candado atómico: un retiro cuya respuesta se pierde por
--  timeout y se reintenta, o dos gestores en paralelo, podían registrar el MISMO
--  movimiento DOS veces (doble salida de caja). Los pagos ya tienen `op_id` unique
--  (0006) y las comisiones/gastos su candado; esto le da a la caja el mismo blindaje.
--
--  Se agrega `op_id uuid` + índice único PARCIAL (solo cuando op_id no es null, para
--  no romper las filas históricas). La acción manda un op_id determinista por
--  (tipo+monto+categoría+descripción+cobrador+cuenta+minuto): un reintento del mismo
--  movimiento colisiona → 23505 → se trata como éxito idempotente, sin duplicar.
--
--  Re-ejecutable. Correr en el SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

alter table movimientos_caja add column if not exists op_id uuid;

comment on column movimientos_caja.op_id is
  'Idempotencia (0074): dos escrituras del MISMO movimiento colisionan en el índice único → sin doble-egreso. null en filas históricas.';

-- Índice único PARCIAL: solo aplica a filas con op_id (las viejas quedan libres).
create unique index if not exists uniq_mov_caja_op
  on movimientos_caja (op_id)
  where op_id is not null;
