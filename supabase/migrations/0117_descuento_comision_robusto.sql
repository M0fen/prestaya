-- ─────────────────────────────────────────────────────────────────────────
-- 0117 — Robustez del descuento de compras del equipo (bugs de la caza adversarial).
--
--  (a) descontar_compras_empleado ahora es IDEMPOTENTE A NIVEL PERÍODO: si ya hay
--      algún descuento para (empleado, período), NO aplica más — devuelve el
--      acumulado. Antes era idempotente por-compra, así que un reintento tras un
--      ACK perdido podía aplicar un descuento NUEVO a una compra creada entre
--      intentos (el egreso colisionaba por op_id → sobrepago silencioso).
--  (b) revertir_descuento_compras_empleado: deshace el descuento de un período
--      (restaura saldo + borra las filas). Se llama desde liquidarComision cuando el
--      egreso a caja falla de verdad, para no dejar el saldo bajado sin egreso
--      (descuento huérfano). Así un reintento recomputa desde cero.
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

  -- IDEMPOTENCIA A NIVEL PERÍODO: si ya se descontó algo en este período, no aplicar
  -- más (un reintento no debe agregar descuentos nuevos). Devolver el acumulado.
  if exists (select 1 from descuentos_compra_empleado where empleado_id = p_empleado_id and periodo_key = p_periodo_key) then
    return (select coalesce(sum(monto), 0) from descuentos_compra_empleado where empleado_id = p_empleado_id and periodo_key = p_periodo_key);
  end if;

  for c in
    select * from compras_empleado
     where empleado_id = p_empleado_id and estado = 'activa' and saldo > 0
     order by creada_en asc
     for update
  loop
    exit when v_rest <= 0;
    v_opid := 'descuento:' || c.id::text || ':' || p_periodo_key;
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

  return (
    select coalesce(sum(monto), 0)
      from descuentos_compra_empleado
     where empleado_id = p_empleado_id and periodo_key = p_periodo_key
  );
end;
$$;

grant execute on function descontar_compras_empleado(uuid, text, numeric, uuid) to authenticated, service_role;

-- Reversión de un período (para el catch de liquidarComision ante egreso fallido).
create or replace function revertir_descuento_compras_empleado(
  p_empleado_id uuid,
  p_periodo_key text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  if not app_es_admin() then
    raise exception 'solo un administrador' using errcode = 'P0401';
  end if;
  for r in select * from descuentos_compra_empleado where empleado_id = p_empleado_id and periodo_key = p_periodo_key loop
    update compras_empleado
       set saldo = saldo + r.monto, estado = 'activa', actualizada_en = now()
     where id = r.compra_id;
    delete from descuentos_compra_empleado where id = r.id;
  end loop;
end;
$$;

grant execute on function revertir_descuento_compras_empleado(uuid, text) to authenticated, service_role;
