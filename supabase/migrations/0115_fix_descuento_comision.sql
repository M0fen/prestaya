-- ─────────────────────────────────────────────────────────────────────────
-- 0115 — FIX money-critical del descuento de compras del equipo sobre la comisión
-- (bug detectado en auditoría adversarial de la tanda 0113).
--
-- BUG: `descontar_compras_empleado` devolvía SOLO lo aplicado en ESA llamada. Como
-- el descuento (RPC) y el egreso (insert en caja) son transacciones separadas, si el
-- descuento COMMITEA pero el egreso falla (blip/timeout) el catch borra el candado
-- `comisiones_liquidadas` SIN revertir el descuento. En el reintento, el loop salta
-- las cuotas ya descontadas por idempotencia (op_id) y devolvía 0 → montoNeto =
-- comisión COMPLETA → egreso por el bruto Y el saldo ya bajado = SOBREPAGO (la casa
-- pierde el repago).
--
-- FIX: devolver el descuento ACUMULADO del período (Σ de descuentos_compra_empleado
-- para empleado+período), no solo lo recién aplicado. Así el reintento computa
-- montoNeto = comisión − descuentoAcumulado correcto, sin importar cuántas veces se
-- reintente. Idempotente y robusto ante fallos parciales.
--
-- También: `crear_compra_empleado_seguro` ahora EXIGE op_id (rechaza null) para que
-- la idempotencia esté siempre activa (una llamada cruda por PostgREST con op_id=null
-- podía crear dos compras secuenciales).
-- ─────────────────────────────────────────────────────────────────────────

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

    v_rest := v_rest - d;
  end loop;

  -- Devolver el descuento ACUMULADO del período (no solo lo recién aplicado): un
  -- reintento tras un egreso fallido computa el neto correcto y no sobrepaga.
  return (
    select coalesce(sum(monto), 0)
      from descuentos_compra_empleado
     where empleado_id = p_empleado_id and periodo_key = p_periodo_key
  );
end;
$$;

grant execute on function descontar_compras_empleado(uuid, text, numeric, uuid) to authenticated, service_role;

-- ── crear_compra_empleado_seguro: exigir op_id (idempotencia siempre activa) ────
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
  if p_empleado_id <> app_usuario_id() and not app_es_admin() then
    raise exception 'solo podés comprar para vos mismo' using errcode = 'P0401';
  end if;

  -- Idempotencia SIEMPRE activa: sin op_id no hay candado → se rechaza.
  if p_op_id is null or length(trim(p_op_id)) = 0 then
    raise exception 'falta op_id (idempotencia)' using errcode = 'P0001';
  end if;

  select * into v_emp from usuarios where id = p_empleado_id;
  if not found or not v_emp.activo then
    raise exception 'empleado inválido o inactivo' using errcode = 'P0001';
  end if;

  -- Idempotencia: mismo op_id → devolver la compra existente (no duplicar).
  select * into v_new from compras_empleado where op_id = p_op_id;
  if found then return v_new; end if;

  perform pg_advisory_xact_lock(hashtext(p_op_id));

  -- Re-chequear tras el lock (otra tx pudo insertarla).
  select * into v_new from compras_empleado where op_id = p_op_id;
  if found then return v_new; end if;

  select * into v_prod from productos where id = p_producto_id;
  if not found then raise exception 'producto inexistente' using errcode = 'P0002'; end if;
  if not v_prod.activo then raise exception 'producto inactivo' using errcode = 'P0410'; end if;

  v_precio := round(v_prod.precio);
  if v_precio <= 0 then raise exception 'precio inválido' using errcode = 'P0411'; end if;
  if v_precio > 30000 then
    raise exception 'la compra supera el tope de autoservicio ($30.000)' using errcode = 'P0403';
  end if;

  v_cuotas := greatest(1, least(24, coalesce(p_cuotas, 1)));
  v_cuota  := ceil(v_precio / v_cuotas);
  v_total  := v_cuota * v_cuotas;

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
