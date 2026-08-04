-- ─────────────────────────────────────────────────────────────────────────
--  0128 · VIGILANCIA y DESEMPEÑO conscientes del ORIGEN del pago.
--  Ejecutar en el SQL Editor. Re-ejecutable. Tres funciones re-creadas.
--
--  Continuación de 0127 (auditoría post-empalme 08-04). La base convive con
--  pagos NATIVOS (origen NULL = registrados en la app) e IMPORTADOS/AJUSTES
--  (origen no nulo). La regla por SUPERFICIE:
--
--  · VIGILANCIA (score de confianza, "recaudó y no rindió") = CUSTODIA de
--    efectivo en mano → SOLO nativos. Sin el filtro, los 12-14 días importados
--    del hueco (07-21→08-03) le daban a TODOS los cobradores el techo de
--    penalización (−40) con "float sin declarar" de cientos de miles: el
--    Centro de alertas quedaba saturado y el ladrón real del piloto sería
--    indistinguible del ruido durante 30 días.
--
--  · DESEMPEÑO / ESTADÍSTICAS por cobrador = cobranza REAL de la persona →
--    nativos + disapp_import (el cobrador SÍ cobró esa plata en la calle,
--    solo que registrada en el mundo viejo; excluirla dejaría a las zonas
--    no-piloto en $0 y el panel inútil durante la coexistencia). Se excluyen
--    SOLO los asientos sintéticos de reconciliación (reconciliacion_zc,
--    reconciliacion_0804, ajuste_migracion): $644.806 fechados en un solo día
--    —$475.000 de créditos de supervisores— reventaban el ranking con plata
--    que nadie cobró ese día.
--
--  ⚠️ Los predicados usan `origen is null OR ...` explícito: en SQL trivalente
--  `origen <> 'x'` / `not in (...)` son NULL para los nativos y los EXCLUIRÍA
--  (la trampa que ya nos mordió dos veces).
-- ─────────────────────────────────────────────────────────────────────────

-- 1) VIGILANCIA: solo trabajo en la app (custodia).
create or replace function app_vigilancia_pagos(desde timestamptz)
returns table (cobrador_id uuid, dia date, monto numeric, cobros bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not app_es_gestor() then
    raise exception 'no autorizado';
  end if;
  return query
    select
      p.registrado_por as cobrador_id,
      (p.registrado_en at time zone 'America/Montevideo')::date as dia,
      sum(p.monto)::numeric as monto,
      count(*)::bigint as cobros
    from pagos p
    where p.anulado = false
      and p.origen is null  -- custodia: solo pagos hechos EN la app
      and p.registrado_por is not null
      and p.registrado_en >= desde
    group by p.registrado_por, (p.registrado_en at time zone 'America/Montevideo')::date;
end;
$$;

revoke all on function app_vigilancia_pagos(timestamptz) from public;
grant execute on function app_vigilancia_pagos(timestamptz) to authenticated;

-- 2) DESEMPEÑO por rango: cobranza real (nativos + imports), sin sintéticos.
create or replace function app_desempeno_rango(
  desde timestamptz,
  hasta timestamptz,
  p_cobradores uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not app_es_gestor() then
    return jsonb_build_object('por_cobrador', '[]'::jsonb, 'por_dia', '[]'::jsonb);
  end if;

  return (
    with pg as (
      select
        registrado_por,
        monto,
        (registrado_en at time zone 'America/Montevideo')::date as dia
      from pagos
      where anulado = false
        -- cobranza real: nativos + disapp_import; los ajustes de reconciliación
        -- llevan fecha de asiento, no de cobro → fuera de toda vista por día.
        and (origen is null or origen = 'disapp_import')
        and registrado_en >= desde
        and registrado_en <  hasta
        and (p_cobradores is null or registrado_por = any (p_cobradores))
    )
    select jsonb_build_object(
      'por_cobrador', coalesce((
        select jsonb_agg(jsonb_build_object(
          'cobrador_id', registrado_por,
          'recaudado', recaudado,
          'cobros', cobros,
          'dias_activos', dias_activos
        ))
        from (
          select
            registrado_por,
            sum(monto)::numeric      as recaudado,
            count(*)::int            as cobros,
            count(distinct dia)::int as dias_activos
          from pg
          where registrado_por is not null
          group by registrado_por
        ) c
      ), '[]'::jsonb),
      'por_dia', coalesce((
        select jsonb_agg(
          jsonb_build_object('fecha', dia, 'recaudado', recaudado, 'cobros', cobros)
          order by dia
        )
        from (
          select dia, sum(monto)::numeric as recaudado, count(*)::int as cobros
          from pg
          group by dia
        ) d
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- 3) ESTADÍSTICA por cobrador (0048): misma regla que desempeño.
create or replace function app_stats_por_cobrador(dias int)
returns table(cobrador_id uuid, nombre text, creditos_activos bigint, capital numeric,
              recaudo numeric, cobros bigint, ultimo_cobro timestamptz)
language sql stable security definer set search_path = public as $$
  select u.id, u.nombre,
    coalesce(ca.creditos, 0), coalesce(ca.capital, 0),
    coalesce(rc.recaudo, 0), coalesce(rc.cobros, 0), rc.ultimo
  from usuarios u
  left join (select cobrador_id, count(*) creditos, sum(monto_prestado) capital
             from prestamos where estado = 'activo' group by 1) ca on ca.cobrador_id = u.id
  left join (select registrado_por, sum(monto) recaudo, count(*) cobros, max(registrado_en) ultimo
             from pagos
             where anulado = false
               and (origen is null or origen = 'disapp_import')  -- sin asientos sintéticos
               and registrado_en >= (now() - (greatest(1, least(365, dias)) || ' days')::interval)
             group by 1) rc on rc.registrado_por = u.id
  where app_es_gestor() and u.rol = 'cobrador' and u.activo = true
  order by coalesce(rc.recaudo, 0) desc;
$$;

-- Verificación rápida (como gestor, en la app): /admin/alertas debe dejar de
-- mostrar "recaudó y no rindió" por días del hueco; Desempeño chip "Hoy" del
-- 08-04 ya no muestra los $644.806 de top-ups.
