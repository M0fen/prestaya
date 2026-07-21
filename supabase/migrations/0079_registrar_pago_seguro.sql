-- ─────────────────────────────────────────────────────────────────────────
-- 0079 — registrar_pago_seguro: anti sobre-pago ATÓMICO (cierra la carrera TOCTOU).
--
-- El anti-sobre-pago vivía SOLO en el server action (lee r.falta → clampa → inserta),
-- un read-then-write SIN candado: dos cobros concurrentes al MISMO crédito (dos
-- gestores en el panel, o panel + cobrador en la calle), cada uno con su op_id, leían
-- ambos falta=1000, clampaban ambos a 1000 e insertaban → pagado_acum=2000, sobre-cobro.
--
-- Este RPC serializa por crédito con un advisory lock de transacción y RE-CHEQUEA el
-- sobre-pago con el pagado_acum FRESCO (el 2º escritor espera al commit del 1º). Si el
-- pago excediera el total, RECHAZA (P0409) — nunca altera ni descarta plata en silencio;
-- el llamador lo surfacea para reconciliar (una doble-cobranza física es real y debe verse).
--
-- security INVOKER (default): corre con los privilegios del que llama → la RLS del cobrador
-- sobre `pagos` sigue vigente (solo cobra a sus asignados). El pagado_acum lo mantiene el
-- trigger 0063. Idempotente. La corre Carlos en el SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function registrar_pago_seguro(
  p_prestamo_id   uuid,
  p_dia_credito   int,
  p_monto         numeric,
  p_registrado_por uuid,
  p_gps_lat       numeric,
  p_gps_lng       numeric,
  p_registrado_en timestamptz,
  p_op_id         uuid
) returns pagos
language plpgsql
as $$
declare
  v_total numeric;
  v_acum  numeric;
  v_monto numeric := round(p_monto);
  v_row   pagos;
begin
  -- Serializa por crédito: dos cobros concurrentes al mismo crédito ya no se pisan.
  -- El lock se libera al terminar la transacción (commit/rollback).
  perform pg_advisory_xact_lock(hashtext(p_prestamo_id::text));

  select coalesce(cuota_diaria, 0) * coalesce(total_dias, 0), coalesce(pagado_acum, 0)
    into v_total, v_acum
    from prestamos
   where id = p_prestamo_id;
  if not found then
    raise exception 'prestamo % inexistente', p_prestamo_id using errcode = 'P0002';
  end if;

  -- Anti sobre-pago ATÓMICO. Tolerancia de 1 peso: la cuota importada puede ser
  -- fraccionaria (351,04) y el último pago la redondea → el acumulado puede quedar
  -- < 1 peso por encima del total de forma legítima. Una CARRERA agrega una cuota
  -- entera (cientos de pesos) → cae muy por encima de la tolerancia y se rechaza.
  if v_acum + v_monto > v_total + 1 then
    raise exception 'sobre-pago: acum % + monto % supera total %', v_acum, v_monto, v_total
      using errcode = 'P0409';
  end if;

  insert into pagos (prestamo_id, dia_credito, monto, registrado_por, gps_lat, gps_lng, registrado_en, op_id)
  values (p_prestamo_id, p_dia_credito, v_monto, p_registrado_por, p_gps_lat, p_gps_lng,
          coalesce(p_registrado_en, now()), p_op_id)
  returning * into v_row;   -- un op_id repetido rebota acá con 23505 (idempotente en el llamador)

  return v_row;
end;
$$;

grant execute on function registrar_pago_seguro(uuid, int, numeric, uuid, numeric, numeric, timestamptz, uuid) to authenticated, service_role;
