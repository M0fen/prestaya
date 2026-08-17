-- ─────────────────────────────────────────────────────────────────────────
--  0150 · Un pago SOLO entra a un crédito ACTIVO — bajo el mismo advisory lock.
--
--  Auditoría de los arreglos del 16-08: con "Cancelar esta venta" en el panel,
--  apareció una carrera nueva: la acción re-cuenta pagos vigentes y cancela,
--  pero la cola offline de un cobrador puede subir un pago EN EL MEDIO. La
--  RPC registrar_pago_seguro no miraba el estado del crédito (solo el tope de
--  sobre-pago), así que ese pago quedaba huérfano sobre una venta cancelada —
--  plata registrada contra un crédito que ya no existe para nadie.
--
--  Cierre en la FUENTE (misma filosofía que 0147: la verdad vive bajo el lock):
--  la RPC lee el estado DENTRO del advisory lock del crédito y rechaza con
--  P0402 si no está 'activo'. La app ya mapea "no está activo" con salida para
--  el cobrador ("no entregues esa plata: dejá nota y avisale al supervisor").
--  Y cancelarVentaPanel toma el MISMO lock antes de cancelar → serializados.
--
--  Firma intacta (9 params): CREATE OR REPLACE. Permisos se conservan.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.registrar_pago_seguro(
  p_prestamo_id     uuid,
  p_dia_credito     integer,
  p_monto           numeric,
  p_registrado_por  uuid,
  p_gps_lat         numeric,
  p_gps_lng         numeric,
  p_registrado_en   timestamptz,
  p_op_id           uuid,
  p_permitir_gemelo boolean default false
)
returns pagos
language plpgsql
as $function$
declare
  v_total  numeric;
  v_acum   numeric;
  v_estado text;
  v_monto  numeric := round(p_monto);
  v_reg    timestamptz := coalesce(p_registrado_en, now());
  v_row    pagos;
begin
  if (v_reg at time zone 'America/Montevideo')::date
       is distinct from (now() at time zone 'America/Montevideo')::date
     or v_reg > now() + interval '5 minutes' then
    v_reg := now();
  end if;

  perform pg_advisory_xact_lock(hashtext(p_prestamo_id::text));

  select coalesce(cuota_diaria, 0) * coalesce(total_dias, 0), coalesce(pagado_acum, 0), estado
    into v_total, v_acum, v_estado
    from prestamos
   where id = p_prestamo_id;
  if not found then
    raise exception 'prestamo % inexistente', p_prestamo_id using errcode = 'P0002';
  end if;

  -- ⭐ 0150 · Solo sobre un crédito ACTIVO. Cancelado/finalizado/incobrable no
  --   recibe plata nueva: el cobrador tiene salida ("no está activo") y la
  --   oficina no hereda pagos huérfanos.
  if v_estado is distinct from 'activo' then
    raise exception 'el crédito no está activo (%)', v_estado using errcode = 'P0402';
  end if;

  if not coalesce(p_permitir_gemelo, false) then
    if exists (
      select 1 from pagos g
      where g.prestamo_id = p_prestamo_id
        and g.anulado = false
        and g.origen is null
        and (p_op_id is null or g.op_id is distinct from p_op_id)
        and abs(g.monto - v_monto) < 0.5
        and g.registrado_en is not null
        and abs(extract(epoch from (g.registrado_en - v_reg))) <= 600
    ) then
      raise exception 'gemelo: el mismo monto ya entró a este crédito hace minutos'
        using errcode = 'P0413';
    end if;
  end if;

  if v_acum + v_monto > v_total + 1 then
    raise exception 'sobre-pago: acum % + monto % supera total %', v_acum, v_monto, v_total
      using errcode = 'P0409';
  end if;

  insert into pagos (prestamo_id, dia_credito, monto, registrado_por, gps_lat, gps_lng, registrado_en, op_id)
  values (p_prestamo_id, p_dia_credito, v_monto, p_registrado_por, p_gps_lat, p_gps_lng,
          v_reg, p_op_id)
  returning * into v_row;

  return v_row;
end;
$function$;

-- Serializar la CANCELACIÓN contra los pagos: el mismo lock, desde la app.
create or replace function public.cancelar_prestamo_seguro(p_prestamo_id uuid)
returns prestamos
language plpgsql
security invoker
as $function$
declare
  v_row prestamos;
  v_pagos int;
begin
  perform pg_advisory_xact_lock(hashtext(p_prestamo_id::text));
  select count(*) into v_pagos from pagos where prestamo_id = p_prestamo_id and anulado = false;
  if v_pagos > 0 then
    raise exception 'el crédito tiene % pagos vigentes: anulalos primero', v_pagos using errcode = 'P0415';
  end if;
  update prestamos set estado = 'cancelado'
   where id = p_prestamo_id and estado = 'activo'
   returning * into v_row;
  if not found then
    raise exception 'el crédito no está activo' using errcode = 'P0402';
  end if;
  return v_row;
end;
$function$;

revoke execute on function public.cancelar_prestamo_seguro(uuid) from public, anon;
grant execute on function public.cancelar_prestamo_seguro(uuid) to authenticated, service_role;

-- ── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- select prosrc like '%P0402%' from pg_proc where proname='registrar_pago_seguro';  → true
-- select proname from pg_proc where proname='cancelar_prestamo_seguro';           → 1 fila
