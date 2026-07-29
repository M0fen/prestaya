-- ─────────────────────────────────────────────────────────────────────────
-- 0101 — VENTA de tienda: convertir un LEAD (solicitudes_producto) en un
--        CRÉDITO real (prestamos). Es la PRIMERA alta de crédito "desde cero"
--        de la app (hasta hoy el único insert a prestamos era la renovación,
--        que encadena sobre un crédito anterior). Money-critical.
--
-- Piezas:
--  1) prestamos.op_id            → idempotencia (índice único parcial), igual que
--     caja/comisiones/gastos (0074). Sin esto, un doble-submit / ACK perdido crearía
--     DOS créditos (deuda duplicada) porque una venta NO tiene el "finalize-gate" de
--     la renovación que la dedupe.
--  2) prestamos.origen           → distingue el dinero: 'credito' (préstamo normal)
--     vs 'tienda' (compra financiada). Se muestra en el cartón de cliente/cobrador/
--     admin para que NO se confunda qué paga el cliente de qué.
--  3) prestamos.producto_id/_nombre → a qué producto corresponde la venta (snapshot
--     del nombre para el cartón, aunque luego se borre el producto).
--  4) solicitudes_producto.prestamo_id + estado 'convertida' → traza lead→crédito.
--  5) RPC crear_credito_venta_seguro → inserta el crédito + marca el lead 'convertida'
--     EN UNA sola transacción (atómico como 0087), serializado por advisory lock del
--     lead, idempotente (si el lead ya se convirtió, devuelve el crédito existente) y
--     con descuento de stock bajo el lock (no sobrevende). security INVOKER → la RLS
--     de prestamos sigue vigente (un gestor no coloca crédito fuera de su alcance).
--
-- La corre Carlos en el SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Columnas nuevas en prestamos (defensivas: default no rompe filas viejas).
alter table prestamos add column if not exists op_id uuid;
alter table prestamos add column if not exists origen text not null default 'credito';
alter table prestamos add column if not exists producto_id uuid references productos(id) on delete set null;
alter table prestamos add column if not exists producto_nombre text;

-- origen acotado a los valores conocidos (idempotente: solo crea el check si falta).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'prestamos_origen_check'
  ) then
    alter table prestamos add constraint prestamos_origen_check
      check (origen in ('credito', 'tienda'));
  end if;
end $$;

-- Idempotencia: un op_id (cuando está presente) identifica UNA colocación única.
create unique index if not exists prestamos_op_id_uk
  on prestamos (op_id) where op_id is not null;

-- 2) Traza lead → crédito en la solicitud (la columna estado ya es text libre;
--    el código usa 'convertida' sin necesidad de check constraint).
alter table solicitudes_producto add column if not exists prestamo_id uuid references prestamos(id) on delete set null;

-- 3) RPC atómico de la venta.
create or replace function crear_credito_venta_seguro(
  p_solicitud_id     uuid,
  p_cliente_id       uuid,
  p_cobrador_id      uuid,
  p_monto            numeric,
  p_cuota            numeric,
  p_total_dias       int,
  p_frecuencia       text,
  p_fecha_inicio     date,
  p_producto_id      uuid,
  p_producto_nombre  text,
  p_op_id            uuid,
  p_creado_por       uuid
) returns prestamos
language plpgsql
as $$
declare
  v_sol  solicitudes_producto;
  v_new  prestamos;
begin
  -- Serializa por LEAD: dos conversiones concurrentes del mismo lead no se pisan.
  perform pg_advisory_xact_lock(hashtext(p_solicitud_id::text));

  select * into v_sol from solicitudes_producto where id = p_solicitud_id;
  if not found then
    raise exception 'lead % inexistente', p_solicitud_id using errcode = 'P0002';
  end if;
  -- Nunca cruzar plata entre clientes (defensa en profundidad; el TS ya lo chequea).
  if v_sol.cliente_id <> p_cliente_id then
    raise exception 'el lead no pertenece al cliente' using errcode = 'P0001';
  end if;

  -- IDEMPOTENTE: si el lead YA se convirtió, devolver el crédito existente (no crear
  -- otro). Cierra el doble-submit / ACK perdido a nivel de datos, no solo por op_id.
  if v_sol.estado = 'convertida' and v_sol.prestamo_id is not null then
    select * into v_new from prestamos where id = v_sol.prestamo_id;
    return v_new;
  end if;
  -- Solo se convierte un lead ABIERTO (nueva/contactado); uno cerrado/descartado no.
  if v_sol.estado not in ('nueva', 'contactado') then
    raise exception 'el lead no está abierto (estado %)', v_sol.estado using errcode = 'P0410';
  end if;

  -- Insertar el crédito de VENTA (origen='tienda'), con op_id para la idempotencia.
  -- monto/cuota llegan ya calculados y validados por el server (numeric(12,2)).
  insert into prestamos (
    cliente_id, cobrador_id, monto_prestado, cuota_diaria,
    total_dias, frecuencia, fecha_inicio, estado, creado_por,
    origen, producto_id, producto_nombre, op_id
  ) values (
    p_cliente_id, p_cobrador_id, p_monto, p_cuota,
    p_total_dias, p_frecuencia, p_fecha_inicio, 'activo', p_creado_por,
    'tienda', p_producto_id, p_producto_nombre, p_op_id
  )
  returning * into v_new;

  -- Marcar el lead como convertido, en la MISMA transacción (traza lead→crédito).
  update solicitudes_producto
     set estado = 'convertida', prestamo_id = v_new.id,
         resuelto_por = p_creado_por, resuelto_en = now()
   where id = p_solicitud_id;

  -- Descontar 1 del stock si el producto lo controla (bajo el lock → no sobrevende).
  -- null = sin control; solo baja si queda > 0 (nunca deja stock negativo).
  if p_producto_id is not null then
    update productos
       set stock = stock - 1
     where id = p_producto_id and stock is not null and stock > 0;
  end if;

  return v_new;
end;
$$;

grant execute on function crear_credito_venta_seguro(
  uuid, uuid, uuid, numeric, numeric, int, text, date, uuid, text, uuid, uuid
) to authenticated, service_role;
