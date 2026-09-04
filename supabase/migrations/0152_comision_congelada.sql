-- ─────────────────────────────────────────────────────────────────────────
--  0152 · CONGELAR LA ATRIBUCIÓN DE COMISIÓN AL MOMENTO DEL COBRO
--
--  EL PROBLEMA. `app_comision_por_ruta` agrupa por `prestamos.cobrador_id`, que
--  es el dueño de HOY. No existe ninguna foto de quién era el dueño cuando el
--  cobro ocurrió, así que reasignar un cliente REESCRIBE HACIA ATRÁS la base de
--  comisión de todos los pagos de ese crédito, de cualquier período ya cerrado.
--  Medido el 04-09: $6.810.156 re-imputables en 818 clientes (máximo $486.052 en
--  uno solo). Al 3%, mover un cliente medio mueve ~$96 y el peor caso ~$14.582
--  con un solo clic.
--
--  POR QUÉ AHORA. `comisiones_liquidadas` tiene 0 filas: nunca se liquidó una
--  comisión por la app. No hay historial que migrar ni pagos ya hechos que
--  explicarle a nadie. Cada mes que pase lo encarece.
--
--  LA FORMA: una columna en `pagos`, no una tabla aparte.
--   · La atribución es 1:1 con el pago y nace con él: es un atributo, no una
--     relación. Una tabla aparte agregaría un join a TODAS las consultas de
--     comisión y un punto de fallo nuevo (la fila que falta y nadie nota).
--   · `pagos` ya tiene exactamente este patrón para las otras dos preguntas de
--     custodia: `registrado_por` (quién tocó el billete) y `anulado_por`.
--   · Es ADITIVA y NULLABLE: los pagos viejos quedan en NULL y el cálculo cae al
--     dueño actual, que es la conducta de hoy. O sea que esta migración NO MUEVE
--     UN PESO por sí sola — solo empieza a guardar la verdad de ahora en más.
--
--  Lo que NO hace esta migración: el backfill de los pagos existentes. Sin foto
--  histórica hay que elegir un criterio, y esa es una decisión de Carlos.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) La columna. Nullable a propósito: NULL = "pago viejo, sin foto".
alter table pagos
  add column if not exists comision_cobrador_id uuid references usuarios(id);

comment on column pagos.comision_cobrador_id is
  'A quién le corresponde la comisión de ESTE cobro, congelado en el momento en '
  'que se registró. NULL = pago anterior a 0152 (el cálculo cae al dueño actual '
  'del crédito, que es la conducta previa). Reasignar un cliente NO lo cambia: '
  'ese es todo el punto.';

-- Para el group by de la comisión sobre los pagos del período.
create index if not exists idx_pagos_comision_cobrador
  on pagos (comision_cobrador_id, registrado_en)
  where anulado = false and origen is null;

-- 2) El pago nace con su atribución. `registrar_pago_seguro` es el ÚNICO camino
--    por el que entra un pago nativo (los importados van por otra vía y no son
--    base de comisión), y corre bajo advisory lock del crédito: acá el dueño es
--    inequívoco y no puede cambiar entre que se lee y que se escribe.
create or replace function registrar_pago_seguro(
  p_prestamo_id uuid, p_dia_credito integer, p_monto numeric, p_registrado_por uuid,
  p_gps_lat numeric, p_gps_lng numeric, p_registrado_en timestamptz, p_op_id uuid,
  p_permitir_gemelo boolean default false
) returns pagos language plpgsql as $$
declare
  v_total  numeric;
  v_acum   numeric;
  v_estado text;
  v_dueno  uuid;
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

  -- ⭐ 0152: se lee tambien el DUEÑO del crédito, bajo el mismo lock.
  select coalesce(cuota_diaria, 0) * coalesce(total_dias, 0), coalesce(pagado_acum, 0),
         estado, cobrador_id
    into v_total, v_acum, v_estado, v_dueno
    from prestamos
   where id = p_prestamo_id;
  if not found then
    raise exception 'prestamo % inexistente', p_prestamo_id using errcode = 'P0002';
  end if;

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

  insert into pagos (prestamo_id, dia_credito, monto, registrado_por, gps_lat, gps_lng,
                     registrado_en, op_id, comision_cobrador_id)
  values (p_prestamo_id, p_dia_credito, v_monto, p_registrado_por, p_gps_lat, p_gps_lng,
          v_reg, p_op_id, v_dueno)
  returning * into v_row;

  return v_row;
end;
$$;

-- 3) El cálculo usa la foto; cae al dueño actual solo si no hay foto.
--    `coalesce` es lo que hace que esta migración sea invisible hasta que haya
--    pagos nuevos: para los viejos (NULL) el resultado es idéntico al de hoy.
create or replace function app_comision_por_ruta(desde timestamptz, hasta timestamptz)
returns table(cobrador_id uuid, recaudado numeric, cobros bigint)
language sql stable security definer set search_path to 'public' as $$
  select coalesce(p.comision_cobrador_id, pp.cobrador_id) as cobrador_id,
         coalesce(sum(p.monto), 0)::numeric as recaudado,
         count(*)::bigint as cobros
  from pagos p
  join prestamos pp on pp.id = p.prestamo_id
  where app_es_gestor()
    and p.anulado = false
    -- SOLO trabajo hecho en la app: los pagos importados de Disapp y los ajustes
    -- de reconciliación (origen no nulo) ya fueron comisionados o son asientos
    -- contables, nunca base de comisión.
    and p.origen is null
    and p.registrado_en >= desde
    and p.registrado_en < hasta
    and coalesce(p.comision_cobrador_id, pp.cobrador_id) is not null
  group by 1;
$$;
