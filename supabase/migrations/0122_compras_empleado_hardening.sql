-- ─────────────────────────────────────────────────────────────────────────
-- 0122 — Endurecimiento de COMPRAS DEL EQUIPO (hallazgos de la auditoría money 08-02).
--
--  (D4) revertir_descuento_compras_empleado RESUCITABA una compra CANCELADA: al
--       deshacer el descuento de un período ponía estado='activa' incondicional. Si
--       una compra cancelada tenía un descuento de un período que luego se revierte
--       (egreso de comisión fallido), volvía a 'activa' y se re-descontaba. Ahora la
--       reversión restaura el SALDO (contabilidad) pero CONSERVA el estado 'cancelada'.
--
--  (D1) compras_empleado tenía RLS con SOLO policy de SELECT: un UPDATE directo desde
--       la sesión (cancelar) afectaba 0 filas SIN error → cancelación fantasma que
--       seguía descontando comisión. La app ya lo cerró usando el cliente service_role
--       para cancelar; acá agregamos además la policy de UPDATE admin-only como
--       defensa en profundidad (belt-and-suspenders: que un UPDATE directo del admin
--       NO sea un no-op silencioso a futuro). Las demás escrituras siguen por RPC.
-- ─────────────────────────────────────────────────────────────────────────

-- (D4) Reversión que NO resucita una compra cancelada.
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
       set saldo = saldo + r.monto,
           -- Restaura el saldo, pero NO reactiva una compra cancelada (seguiría
           -- 'cancelada'); una 'saldada' que recupera saldo vuelve a 'activa'.
           estado = case when estado = 'cancelada' then 'cancelada' else 'activa' end,
           actualizada_en = now()
     where id = r.compra_id;
    delete from descuentos_compra_empleado where id = r.id;
  end loop;
end;
$$;

grant execute on function revertir_descuento_compras_empleado(uuid, text) to authenticated, service_role;

-- (D1) Policy de UPDATE admin-only (defensa en profundidad; la app cancela vía
-- service_role, pero esto evita que un UPDATE directo del admin sea un no-op mudo).
drop policy if exists compras_empleado_upd on compras_empleado;
create policy compras_empleado_upd on compras_empleado for update to authenticated
  using ( app_es_admin() ) with check ( app_es_admin() );
