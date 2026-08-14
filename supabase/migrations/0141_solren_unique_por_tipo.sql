-- ─────────────────────────────────────────────────────────────────────────
--  0141 · El "una solicitud pendiente por crédito" distingue el TIPO (0139).
--
--  Hallazgo de la auditoría del 08-14: el índice de 0029 era único por
--  prestamo_anterior_id a secas, y los DOS tipos pueden referenciar el MISMO
--  crédito (la renovación elige el activo saldado X; la venta usa el último =
--  ese mismo X). Con el índice ciego al tipo, pedir una VENTA con una
--  RENOVACIÓN pendiente (o al revés) chocaba 23505 y la app respondía "Ya
--  estaba pedido a la oficina. Sigue esperando el OK." — confirmando un pedido
--  QUE NUNCA ENTRÓ, por otro monto y con otra semántica (aprobar una venta no
--  finaliza X; aprobar una renovación sí). El cobrador le prometía al cliente
--  un capital que ningún gestor iba a ver.
--
--  Ahora: como mucho UNA pendiente por (crédito anterior, tipo) — una venta y
--  una renovación del mismo crédito conviven en la cola, cada una con su botón.
-- ─────────────────────────────────────────────────────────────────────────
drop index if exists solren_pendiente_unica;
create unique index if not exists solren_pendiente_unica
  on solicitudes_renovacion(prestamo_anterior_id, tipo) where (estado = 'pendiente');
