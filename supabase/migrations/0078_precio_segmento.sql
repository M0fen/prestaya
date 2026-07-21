-- ─────────────────────────────────────────────────────────────────────────
-- 0078 — TIENDA: precio especial por SEGMENTO de clientes.
--
-- Ya existía el precio POR CLIENTE (0076, producto_precio_cliente). Esto agrega
-- el precio por SEGMENTO: el admin le fija a un producto otro precio/interés/
-- cuotas para todo un grupo:
--   · tipo='calificacion' → valor = la calificación (nuevo/excelente/bueno/…)
--   · tipo='zona'         → valor = el id de la zona (uuid como texto)
--
-- Resolución en la vista del cliente (más específico gana):
--   individual (producto_precio_cliente) > zona > calificación > precio base.
-- Un cliente nuevo que entra a la zona/calificación hereda el precio solo
-- (dinámico), a diferencia del individual que es puntual.
--
-- Money: precio/interés son numeric (NUNCA float). La tienda solo publica; el
-- crédito lo arma el admin aparte. Migraciones las corre Carlos. Idempotente.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists producto_precio_segmento (
  id           uuid primary key default gen_random_uuid(),
  producto_id  uuid not null references productos(id) on delete cascade,
  -- Qué agrupa al segmento y su valor (calificación literal o zona_id::text).
  tipo         text not null check (tipo in ('calificacion','zona')),
  valor        text not null,
  precio       numeric(12,2) not null,
  interes_pct  numeric(5,2)  not null default 0,
  cuotas       int not null default 0,
  nota         text,
  creado_por   uuid references usuarios(id),
  creado_en    timestamptz not null default now(),
  -- Una sola regla por (producto, tipo, valor): el upsert la pisa.
  unique (producto_id, tipo, valor)
);
create index if not exists idx_precio_seg_prod on producto_precio_segmento (producto_id);

-- RLS: sensible (precios) → SOLO el admin, igual que producto_precio_cliente.
alter table producto_precio_segmento enable row level security;
do $$
begin
  drop policy if exists precio_seg_all on producto_precio_segmento;
  create policy precio_seg_all on producto_precio_segmento
    for all to authenticated using ( app_es_admin() ) with check ( app_es_admin() );
end $$;

-- ── Higiene de índices de producto_precio_cliente (deuda #28) ───────────────
-- El catálogo del cliente consulta producto_precio_cliente POR cliente_id, y no
-- había índice para esa columna (solo el compuesto que arranca por producto_id).
create index if not exists idx_precio_cli_cliente on producto_precio_cliente (cliente_id);
-- idx_precio_cliente_prod (producto_id, cliente_id) duplicaba el índice del UNIQUE
-- (producto_id, cliente_id) → redundante, se elimina.
drop index if exists idx_precio_cliente_prod;
