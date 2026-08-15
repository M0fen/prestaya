-- ─────────────────────────────────────────────────────────────────────────
--  0149 · TIENDA: el pedido guarda LO QUE EL CLIENTE ELIGIÓ, y no se duplica.
--
--  Barrida de la tienda (15-08, 3 lentes + refutadores). Cierra cuatro
--  hallazgos de una vez:
--
--  (a) El FOLIO PY-XXXXXX del comprobante era puro teatro: se generaba en el
--      navegador y jamás viajaba — la oficina no podía encontrar el pedido
--      por el código que el propio comprobante decía "guardá esta referencia".
--  (b) El PLAZO que el cliente elegía en la ficha (6×/12×/18×) se evaporaba:
--      el lead llegaba sin él y el admin ni podía honrarlo queriendo.
--  (c) La CANTIDAD del flujo con token no viajaba (el público sí la mandaba,
--      escondida en el texto del mensaje).
--  (d) SIN idempotencia: doble tap / dos pestañas / reintento tras fallo
--      parcial del carrito → leads duplicados que el admin podía convertir en
--      DOS créditos (check-then-insert sin constraint; el patrón exacto del
--      caso JORGE). Ahora: op_id único por fila (el reintento rebota 23505 y
--      la acción lo trata como éxito) + como mucho UN lead ABIERTO por
--      (cliente, producto) — la última línea la pone la base, no la app.
--
--  Idempotente. El panel de admin muestra folio/cantidad/plazo en la fase
--  siguiente (el dato ya queda guardado desde hoy).
-- ─────────────────────────────────────────────────────────────────────────

-- ── solicitudes_producto (leads del cliente con token) ─────────────────────
alter table solicitudes_producto
  add column if not exists folio text,
  add column if not exists cantidad int not null default 1,
  add column if not exists cuotas_preferidas int,
  add column if not exists op_id uuid;

-- Saneo de rangos (la acción también clampa; la base fija el límite duro).
alter table solicitudes_producto drop constraint if exists chk_solprod_cantidad;
alter table solicitudes_producto add constraint chk_solprod_cantidad
  check (cantidad between 1 and 50);
alter table solicitudes_producto drop constraint if exists chk_solprod_cuotas_pref;
alter table solicitudes_producto add constraint chk_solprod_cuotas_pref
  check (cuotas_preferidas is null or cuotas_preferidas between 1 and 1000);

-- Reintento idempotente: el MISMO op_id no crea dos leads.
create unique index if not exists uniq_solprod_op
  on solicitudes_producto (op_id) where (op_id is not null);

-- DEDUPE previo al candado: si ya hay dos leads ABIERTOS del mismo
-- (cliente, producto), sobrevive el más nuevo y el resto queda descartado con
-- nota (medido 15-08: exactamente 1 par duplicado, de los 3 leads vivos).
update solicitudes_producto s
   set estado = 'descartada',
       nota = coalesce(nota || ' · ', '') || 'Duplicado del mismo pedido (dedupe 0149).'
 where s.estado in ('nueva', 'contactado')
   and s.producto_id is not null
   and exists (
     select 1 from solicitudes_producto s2
     where s2.cliente_id = s.cliente_id
       and s2.producto_id = s.producto_id
       and s2.estado in ('nueva', 'contactado')
       and s2.creado_en > s.creado_en
   );

-- Como mucho UN lead abierto por (cliente, producto).
create unique index if not exists uniq_solprod_abierta
  on solicitudes_producto (cliente_id, producto_id)
  where (estado in ('nueva', 'contactado') and producto_id is not null);

-- ── leads_publicos (visitantes de /tienda) ─────────────────────────────────
alter table leads_publicos
  add column if not exists folio text,
  add column if not exists cantidad int not null default 1,
  add column if not exists cuotas_preferidas int,
  add column if not exists op_id uuid;

alter table leads_publicos drop constraint if exists chk_leadpub_cantidad;
alter table leads_publicos add constraint chk_leadpub_cantidad
  check (cantidad between 1 and 50);

-- El lote del carrito viaja con op_id determinista POR ÍTEM (nonce + índice):
-- el reintento del mismo lote rebota entero en 23505 → exactamente una vez.
create unique index if not exists uniq_leadpub_op
  on leads_publicos (op_id) where (op_id is not null);

-- ── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- select indexname from pg_indexes where tablename in ('solicitudes_producto','leads_publicos') and indexname like 'uniq%';
--   → uniq_solprod_op, uniq_solprod_abierta, uniq_leadpub_op
-- select count(*) from (select cliente_id, producto_id from solicitudes_producto
--   where estado in ('nueva','contactado') and producto_id is not null
--   group by 1,2 having count(*)>1) t;  → 0
