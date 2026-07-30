-- ─────────────────────────────────────────────────────────────────────────
-- 0113 — COMPRA DEL EQUIPO A CRÉDITO. Un cobrador/supervisor logueado compra un
-- producto de la tienda en cuotas, y la cuota se DESCUENTA de su comisión al
-- liquidarla. Money-critical.
--
-- Modelado: tabla PROPIA (no cuelga de clientes/prestamos) → no ensucia el núcleo
-- de cobro diario ni las estadísticas de clientes. El repago vive como SALDO que
-- baja con cada descuento de comisión.
--
--  · compras_empleado           = la compra + su saldo pendiente.
--  · descuentos_compra_empleado = cada cuota descontada (traza + idempotencia).
--  · crear_compra_empleado_seguro = alta atómica, precio RE-DERIVADO server-side
--    (un empleado no puede forjar el precio por PostgREST), CAP, stock, op_id.
--  · descontar_compras_empleado  = al liquidar comisión, baja el saldo hasta el
--    tope disponible (la comisión del período), atómico e idempotente por período.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Tablas ──────────────────────────────────────────────────────────────────
create table if not exists compras_empleado (
  id              uuid primary key default gen_random_uuid(),
  empleado_id     uuid not null references usuarios(id),
  producto_id     uuid references productos(id) on delete set null,
  producto_nombre text not null,
  precio          numeric(12,2) not null check (precio > 0),     -- contado (server-side)
  cuotas          int not null check (cuotas between 1 and 24),
  cuota_monto     numeric(12,2) not null check (cuota_monto > 0),-- se descuenta por período
  total           numeric(12,2) not null check (total > 0),      -- cuota_monto * cuotas
  saldo           numeric(12,2) not null check (saldo >= 0),     -- lo que falta descontar
  estado          text not null default 'activa' check (estado in ('activa','saldada','cancelada')),
  op_id           text,
  creada_por      uuid references usuarios(id),
  creada_en       timestamptz not null default now(),
  actualizada_en  timestamptz not null default now()
);
create unique index if not exists compras_empleado_op_id_uk on compras_empleado (op_id) where op_id is not null;
create index if not exists compras_empleado_empleado_idx on compras_empleado (empleado_id, estado);

create table if not exists descuentos_compra_empleado (
  id           uuid primary key default gen_random_uuid(),
  compra_id    uuid not null references compras_empleado(id) on delete cascade,
  empleado_id  uuid not null references usuarios(id),
  periodo_key  text not null,                 -- 'mes:2026-07'
  monto        numeric(12,2) not null check (monto > 0),
  op_id        text not null,                 -- 'descuento:{compra}:{periodo}' → idempotente
  creado_por   uuid references usuarios(id),
  creado_en    timestamptz not null default now()
);
create unique index if not exists descuentos_compra_op_id_uk on descuentos_compra_empleado (op_id);
create index if not exists descuentos_compra_empleado_idx on descuentos_compra_empleado (empleado_id, periodo_key);

-- ── RLS: el empleado ve LO SUYO; el admin ve todo. Escritura solo por los RPC. ──
alter table compras_empleado enable row level security;
drop policy if exists compras_empleado_select on compras_empleado;
create policy compras_empleado_select on compras_empleado for select to authenticated
  using ( app_es_admin() or empleado_id = app_usuario_id() );

alter table descuentos_compra_empleado enable row level security;
drop policy if exists descuentos_compra_select on descuentos_compra_empleado;
create policy descuentos_compra_select on descuentos_compra_empleado for select to authenticated
  using ( app_es_admin() or empleado_id = app_usuario_id() );

-- ── RPC: alta de la compra (autoservicio del empleado o admin) ─────────────────
-- SECURITY DEFINER: el empleado (no-admin) necesita escribir; el gate lo limita a
-- comprar PARA SÍ MISMO. El precio se RE-DERIVA del producto (nunca del cliente).
create or replace function crear_compra_empleado_seguro(
  p_empleado_id uuid,
  p_producto_id uuid,
  p_cuotas      int,
  p_op_id       text,
  p_creado_por  uuid
) returns compras_empleado
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod     productos;
  v_emp      usuarios;
  v_cuotas   int;
  v_precio   numeric(12,2);
  v_cuota    numeric(12,2);
  v_total    numeric(12,2);
  v_new      compras_empleado;
  v_upd      int;
begin
  -- GATE: comprar solo PARA UNO MISMO (o el admin para otro). Cierra el abuso por
  -- PostgREST (un empleado no puede endeudar a un compañero).
  if p_empleado_id <> app_usuario_id() and not app_es_admin() then
    raise exception 'solo podés comprar para vos mismo' using errcode = 'P0401';
  end if;

  select * into v_emp from usuarios where id = p_empleado_id;
  if not found or not v_emp.activo then
    raise exception 'empleado inválido o inactivo' using errcode = 'P0001';
  end if;

  -- Idempotencia: mismo op_id → devolver la compra existente (no duplicar).
  if p_op_id is not null then
    select * into v_new from compras_empleado where op_id = p_op_id;
    if found then return v_new; end if;
  end if;

  perform pg_advisory_xact_lock(hashtext(coalesce(p_op_id, p_empleado_id::text || p_producto_id::text)));

  select * into v_prod from productos where id = p_producto_id;
  if not found then raise exception 'producto inexistente' using errcode = 'P0002'; end if;
  if not v_prod.activo then raise exception 'producto inactivo' using errcode = 'P0410'; end if;

  -- Precio SERVER-SIDE (contado). CAP de autoservicio $30.000.
  v_precio := round(v_prod.precio);
  if v_precio <= 0 then raise exception 'precio inválido' using errcode = 'P0411'; end if;
  if v_precio > 30000 then
    raise exception 'la compra supera el tope de autoservicio ($30.000)' using errcode = 'P0403';
  end if;

  v_cuotas := greatest(1, least(24, coalesce(p_cuotas, 1)));
  -- Interés 0 (perk del equipo): cuota = techo(precio / cuotas). Nunca sub-cobra.
  v_cuota  := ceil(v_precio / v_cuotas);
  v_total  := v_cuota * v_cuotas;

  -- Stock bajo row-lock (no sobrevender), igual que la venta de tienda.
  if v_prod.stock is not null then
    update productos set stock = stock - 1 where id = p_producto_id and stock > 0;
    get diagnostics v_upd = row_count;
    if v_upd = 0 then raise exception 'producto sin stock' using errcode = 'P0409'; end if;
  end if;

  insert into compras_empleado (
    empleado_id, producto_id, producto_nombre, precio, cuotas, cuota_monto, total, saldo, estado, op_id, creada_por
  ) values (
    p_empleado_id, p_producto_id, v_prod.nombre, v_precio, v_cuotas, v_cuota, v_total, v_total, 'activa', p_op_id, p_creado_por
  ) returning * into v_new;

  return v_new;
end;
$$;

grant execute on function crear_compra_empleado_seguro(uuid, uuid, int, text, uuid) to authenticated, service_role;

-- ── RPC: descontar las cuotas del período (llamado desde la liquidación) ───────
-- Baja el saldo de las compras activas del empleado hasta el TOPE disponible (la
-- comisión del período). Atómico e idempotente por (compra, período). Solo admin.
create or replace function descontar_compras_empleado(
  p_empleado_id uuid,
  p_periodo_key text,
  p_tope        numeric,
  p_creado_por  uuid
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rest  numeric := greatest(0, coalesce(p_tope, 0));
  v_total numeric := 0;
  c       compras_empleado;
  d       numeric;
  v_opid  text;
begin
  if not app_es_admin() then
    raise exception 'solo un administrador liquida comisiones' using errcode = 'P0401';
  end if;

  for c in
    select * from compras_empleado
     where empleado_id = p_empleado_id and estado = 'activa' and saldo > 0
     order by creada_en asc
     for update
  loop
    exit when v_rest <= 0;
    v_opid := 'descuento:' || c.id::text || ':' || p_periodo_key;
    -- Idempotente: si ya se descontó esta compra en este período, no repetir.
    if exists (select 1 from descuentos_compra_empleado where op_id = v_opid) then
      continue;
    end if;
    d := least(c.cuota_monto, c.saldo, v_rest);
    if d <= 0 then continue; end if;

    insert into descuentos_compra_empleado (compra_id, empleado_id, periodo_key, monto, op_id, creado_por)
      values (c.id, p_empleado_id, p_periodo_key, d, v_opid, p_creado_por);

    update compras_empleado
       set saldo = saldo - d,
           estado = case when saldo - d <= 0 then 'saldada' else 'activa' end,
           actualizada_en = now()
     where id = c.id;

    v_rest  := v_rest - d;
    v_total := v_total + d;
  end loop;

  return v_total;
end;
$$;

grant execute on function descontar_compras_empleado(uuid, text, numeric, uuid) to authenticated, service_role;
