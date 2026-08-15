-- ─────────────────────────────────────────────────────────────────────────
--  0147 · El candado anti doble-cobro se vuelve ATÓMICO: vive DENTRO del RPC,
--  bajo el advisory lock que ya serializa por crédito.
--
--  LA CARRERA QUE CIERRA (análisis de escala, 15-08): el candado de gemelos
--  corría SOLO en la Server Action — SELECT de pagos, chequeo, y recién después
--  el RPC. Dos dispositivos con la misma cuenta tocando "cobrar" EN EL MISMO
--  SEGUNDO pasaban los dos el SELECT (ninguno veía el pago del otro, que aún no
--  existía), generaban op_ids distintos y el advisory lock solo SERIALIZABA los
--  dos INSERT: el mismo peso entraba dos veces. Con saldo amplio, el P0409 ni
--  se enteraba. Adentro del lock el segundo SIEMPRE ve al primero.
--
--  LA MISMA regla que lib/candadoCobro (el predicado que pantalla y tests
--  comparten): mismo monto ±$0,5 · |Δ| ≤ 10 min A DOS LADOS de la hora sellada ·
--  solo pagos vigentes (no anulados) y nativos (origen null).
--
--  `p_permitir_gemelo` (default false): el bypass EXPLÍCITO — el cobrador que
--  confirma "el cliente pagó dos veces de verdad" (adelanto), y la cola offline
--  cuando SABE por las horas del dispositivo que dos cobros del mismo monto
--  fueron tomados con más de 10 min de distancia (pares legítimos que el clamp
--  de día colapsaría al drenar al día siguiente — ver esParteDeParSeparado).
--
--  SECURITY INVOKER se mantiene: el SELECT de gemelos corre bajo la RLS del
--  caller (el cobrador ve los pagos de sus clientes: 0031). Firma nueva →
--  DROP + CREATE en transacción, permisos replicados EXACTO del proacl vivo
--  (authenticated + service_role; anon quedó fuera en 0142).
-- ─────────────────────────────────────────────────────────────────────────

begin;

drop function if exists public.registrar_pago_seguro(
  uuid, integer, numeric, uuid, numeric, numeric, timestamptz, uuid
);

create function public.registrar_pago_seguro(
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
  v_total numeric;
  v_acum  numeric;
  v_monto numeric := round(p_monto);
  v_reg   timestamptz := coalesce(p_registrado_en, now());
  v_row   pagos;
begin
  -- SELLADO DEL DÍA CONTABLE (espejo de lib/fecha.ts::sellarRegistroEn): el pago
  -- pertenece al día de Uruguay del SERVIDOR. Un timestamp de otro día (pasado o
  -- futuro) se descarta y se usa now(). Cierra la evasión de la rendición por REST.
  if (v_reg at time zone 'America/Montevideo')::date
       is distinct from (now() at time zone 'America/Montevideo')::date
     or v_reg > now() + interval '5 minutes' then
    v_reg := now();
  end if;

  -- Serializa por crédito: dos cobros concurrentes al mismo crédito ya no se pisan.
  perform pg_advisory_xact_lock(hashtext(p_prestamo_id::text));

  select coalesce(cuota_diaria, 0) * coalesce(total_dias, 0), coalesce(pagado_acum, 0)
    into v_total, v_acum
    from prestamos
   where id = p_prestamo_id;
  if not found then
    raise exception 'prestamo % inexistente', p_prestamo_id using errcode = 'P0002';
  end if;

  -- ⭐ 0147 · GEMELO bajo el lock: el chequeo de la Server Action tiene una
  --   ventana (dos SELECT simultáneos no se ven); acá el segundo SIEMPRE ve al
  --   primero. Misma regla que lib/candadoCobro: |Δ| ≤ 10 min a dos lados de la
  --   hora SELLADA, mismo monto ±0,5, vigente y nativo.
  if not coalesce(p_permitir_gemelo, false) then
    if exists (
      select 1 from pagos g
      where g.prestamo_id = p_prestamo_id
        and g.anulado = false
        and g.origen is null
        -- El REINTENTO del mismo op_id no es un gemelo: tiene que llegar al
        -- índice único y rebotar 23505 (idempotencia inequívoca, la semántica
        -- que la cola ya entiende). El gemelo es OTRO toque con OTRO op_id.
        and (p_op_id is null or g.op_id is distinct from p_op_id)
        and abs(g.monto - v_monto) < 0.5
        and g.registrado_en is not null
        and abs(extract(epoch from (g.registrado_en - v_reg))) <= 600
    ) then
      raise exception 'gemelo: el mismo monto ya entró a este crédito hace minutos'
        using errcode = 'P0413';
    end if;
  end if;

  -- Anti sobre-pago ATÓMICO (tolerancia 1 peso por cuota fraccionaria importada).
  if v_acum + v_monto > v_total + 1 then
    raise exception 'sobre-pago: acum % + monto % supera total %', v_acum, v_monto, v_total
      using errcode = 'P0409';
  end if;

  insert into pagos (prestamo_id, dia_credito, monto, registrado_por, gps_lat, gps_lng, registrado_en, op_id)
  values (p_prestamo_id, p_dia_credito, v_monto, p_registrado_por, p_gps_lat, p_gps_lng,
          v_reg, p_op_id)
  returning * into v_row;   -- op_id repetido rebota con 23505 (idempotente arriba)

  return v_row;
end;
$function$;

-- Permisos EXACTOS del proacl vivo (anon fuera desde 0142).
revoke execute on function public.registrar_pago_seguro(
  uuid, integer, numeric, uuid, numeric, numeric, timestamptz, uuid, boolean
) from public, anon;
grant execute on function public.registrar_pago_seguro(
  uuid, integer, numeric, uuid, numeric, numeric, timestamptz, uuid, boolean
) to authenticated, service_role;

commit;

-- ── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- select pronargs, prosrc like '%P0413%' from pg_proc where proname='registrar_pago_seguro';
--   → 9 · true
-- select proacl::text from pg_proc where proname='registrar_pago_seguro';
--   → authenticated=X + service_role=X (sin anon)
