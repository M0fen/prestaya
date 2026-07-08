-- ─────────────────────────────────────────────────────────────────────────
--  0040 · RPCs de ESCALA para el panel (dashboard/cartera/mora/series/sumas).
--  Ejecutar en el SQL Editor. Re-ejecutable. (Reemplaza también las de 0039.)
--
--  Problema 1: el panel traía ~20k pagos de a 1000 por request → ~90s.
--  Problema 2: al agregar en RPC, el RLS evaluaba `app_es_gestor()` FILA POR
--     FILA sobre decenas de miles de filas → statement timeout.
--
--  Solución (patrón estándar): las RPCs son SECURITY DEFINER (saltan el RLS
--  por-fila, así el scan es directo y rápido) pero verifican el ROL UNA sola vez
--  con `app_es_gestor()`. Un no-gestor recibe vacío/0. Corren en `public`.
--
--  ⚠️ NOTA DE ZONA: hoy devuelven la operación COMPLETA a cualquier gestor. Es
--  idéntico al comportamiento actual (la única supervisora no tiene zonas → ve
--  todo). CUANDO se configuren zonas, hay que filtrar aquí por la zona del
--  supervisor (TODO marcado). Las páginas de detalle siguen con RLS por fila.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Sumas de recaudo (reemplazan las de 0039, ahora security definer) ────────
create or replace function app_suma_pagos_desde(desde timestamptz)
returns numeric language sql stable security definer set search_path = public as $$
  select case when app_es_gestor() then
    (select coalesce(sum(monto), 0)::numeric from pagos
      where anulado = false and registrado_en >= desde)
  else 0::numeric end;
$$;

create or replace function app_suma_pagos_entre(desde timestamptz, hasta timestamptz)
returns numeric language sql stable security definer set search_path = public as $$
  select case when app_es_gestor() then
    (select coalesce(sum(monto), 0)::numeric from pagos
      where anulado = false and registrado_en >= desde and registrado_en < hasta)
  else 0::numeric end;
$$;

create or replace function app_cuenta_pagos_entre(desde timestamptz, hasta timestamptz)
returns bigint language sql stable security definer set search_path = public as $$
  select case when app_es_gestor() then
    (select count(*)::bigint from pagos
      where anulado = false and registrado_en >= desde and registrado_en < hasta)
  else 0::bigint end;
$$;

-- ── Serie de recaudo por día (día calendario de Uruguay) ─────────────────────
create or replace function app_serie_recaudo(dias int)
returns table(dia date, recaudado numeric, cobros bigint)
language sql stable security definer set search_path = public as $$
  select ((registrado_en at time zone 'America/Montevideo')::date) as dia,
         coalesce(sum(monto), 0)::numeric as recaudado,
         count(*)::bigint as cobros
  from pagos
  where app_es_gestor()
    and anulado = false
    and registrado_en >= (
      ((now() at time zone 'America/Montevideo')::date) - ((dias - 1) * interval '1 day')
    )
  group by 1
  order by 1;
$$;

-- ── Créditos activos con sus pagos AGRUPADOS por préstamo (un jsonb) ──────────
create or replace function app_cartera_activa()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when app_es_gestor() then (
    with pg as (
      select p.prestamo_id,
             jsonb_agg(jsonb_build_object('d', p.dia_credito, 'm', p.monto)) as pagos
      from pagos p
      join prestamos pp on pp.id = p.prestamo_id and pp.estado = 'activo'
      where p.anulado = false
      group by p.prestamo_id
    )
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'cliente_id', p.cliente_id,
        'cobrador_id', p.cobrador_id,
        'monto_prestado', p.monto_prestado,
        'cuota_diaria', p.cuota_diaria,
        'total_dias', p.total_dias,
        'frecuencia', p.frecuencia,
        'fecha_inicio', p.fecha_inicio,
        'cliente_nombre', c.nombre,
        'cliente_documento', c.documento,
        'cliente_telefono', c.telefono,
        'cliente_direccion', c.direccion,
        'cliente_calificacion', c.calificacion,
        'cliente_gps_lat', c.gps_lat,
        'cliente_gps_lng', c.gps_lng,
        'cobrador_nombre', u.nombre,
        'pagos', coalesce(pg.pagos, '[]'::jsonb)
      )
    ), '[]'::jsonb)
    from prestamos p
    join clientes c on c.id = p.cliente_id
    left join usuarios u on u.id = p.cobrador_id
    left join pg on pg.prestamo_id = p.id
    where p.estado = 'activo'
  ) else '[]'::jsonb end;
$$;

grant execute on function app_suma_pagos_desde(timestamptz)               to authenticated;
grant execute on function app_suma_pagos_entre(timestamptz, timestamptz)  to authenticated;
grant execute on function app_cuenta_pagos_entre(timestamptz, timestamptz) to authenticated;
grant execute on function app_serie_recaudo(int)                          to authenticated;
grant execute on function app_cartera_activa()                            to authenticated;
