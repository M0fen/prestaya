-- ─────────────────────────────────────────────────────────────────────────
-- 0112 — INTEGRACIÓN CURBE. Modelo (confirmado por Carlos): vendemos el catálogo
-- de Curbe (perfumes/joyería) FINANCIADO en nuestra tienda; al vender, le pasamos
-- el PEDIDO a Curbe para que despache (manual/WhatsApp por ahora — no tienen API).
--
--  (1) productos.proveedor → quién DESPACHA el producto. null = propio (stock
--      nuestro, lo lleva el cobrador); 'curbe' = lo despacha Curbe. Permite
--      distinguir el catálogo y disparar la cola de despacho.
--  (2) pedidos_curbe → COLA DE DESPACHO: cada venta de un producto Curbe genera un
--      pedido que el admin le notifica a Curbe (WhatsApp/mail) y trackea hasta que
--      Curbe lo despacha. Es logística (no dinero: el crédito/venta ya vive en
--      prestamos). Solo admin (la tienda es del dueño). Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────

-- (1) Proveedor del producto (defensivo: null = propio, no rompe filas viejas).
alter table productos add column if not exists proveedor text;
comment on column productos.proveedor is
  'Quién despacha: null = propio (lo lleva el cobrador); ''curbe'' = lo despacha Curbe (0112).';

-- (2) Cola de despacho de pedidos a Curbe.
create table if not exists pedidos_curbe (
  id                uuid primary key default gen_random_uuid(),
  prestamo_id       uuid references prestamos(id) on delete set null, -- la venta financiada
  producto_id       uuid references productos(id) on delete set null,
  producto_nombre   text not null,                                    -- snapshot
  cliente_nombre    text,
  cliente_telefono  text,
  cliente_direccion text,
  monto             numeric(12,2),                                    -- lo que paga el cliente (referencia)
  estado            text not null default 'pendiente'
                    check (estado in ('pendiente', 'pedido', 'despachado', 'cancelado')),
  nota              text,
  creado_en         timestamptz not null default now(),
  notificado_en     timestamptz,                                      -- cuándo se le avisó a Curbe
  resuelto_por      uuid references usuarios(id),
  actualizado_en    timestamptz not null default now()
);

create index if not exists idx_pedidos_curbe_estado on pedidos_curbe (estado, creado_en desc);

drop trigger if exists trg_pedidos_curbe_actualizado on pedidos_curbe;
create trigger trg_pedidos_curbe_actualizado
  before update on pedidos_curbe
  for each row execute function set_actualizado_en();

-- RLS: solo el ADMIN (la tienda es del dueño). Escritura por service_role (acciones).
alter table pedidos_curbe enable row level security;
drop policy if exists pedidos_curbe_select on pedidos_curbe;
create policy pedidos_curbe_select on pedidos_curbe for select to authenticated
  using ( app_es_admin() );
