-- ─────────────────────────────────────────────────────────────────────────
--  0086 · ESTADÍSTICAS más livianas — acotar app_stats_mensual por fecha
--
--  QUÉ HACE: la función que arma los gráficos de /admin/estadisticas sumaba los
--  pagos de TODA la historia en cada carga (aunque solo se muestran los últimos
--  N meses). Con el volumen creciendo, eso es un escaneo de la tabla `pagos`
--  entera cada vez que se abre Estadísticas. Este cambio le pone un filtro de
--  fecha al sub-total de recaudo (`recaud`): solo mira los meses que se van a
--  mostrar. Mismos NÚMEROS en pantalla, mucho menos trabajo para la base.
--  NO toca datos ni plata — solo reemplaza la definición de la función (reportería).
--
--  Es un `create or replace function`: se puede pegar entero y correr. Re-ejecutable.
--  (Este archivo SÍ puede correrse junto con otras sentencias / sin cuidados de
--   transacción — no lleva CONCURRENTLY.)
-- ─────────────────────────────────────────────────────────────────────────

create or replace function app_stats_mensual(meses int)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when app_es_gestor() then (
    with spine as (
      select to_char(d, 'YYYY-MM') as mes
      from generate_series(
        date_trunc('month', (now() at time zone 'America/Montevideo')) - ((greatest(1, least(36, meses)) - 1) || ' months')::interval,
        date_trunc('month', (now() at time zone 'America/Montevideo')),
        interval '1 month'
      ) d
    ),
    coloc as (
      select to_char(fecha_inicio, 'YYYY-MM') as mes, sum(monto_prestado) as colocado, count(*) as creditos_nuevos
      from prestamos where fecha_inicio is not null group by 1
    ),
    recaud as (
      select to_char((registrado_en at time zone 'America/Montevideo'), 'YYYY-MM') as mes,
             sum(monto) as recaudado, count(*) as cobros
      from pagos
      where anulado = false
        -- Solo los meses que la serie va a mostrar (evita escanear toda la historia).
        and (registrado_en at time zone 'America/Montevideo')
            >= date_trunc('month', (now() at time zone 'America/Montevideo'))
               - ((greatest(1, least(36, meses)) - 1) || ' months')::interval
      group by 1
    ),
    cli as (
      select to_char((creado_en at time zone 'America/Montevideo'), 'YYYY-MM') as mes, count(*) as clientes_nuevos
      from clientes group by 1
    ),
    cob as (
      select to_char((creado_en at time zone 'America/Montevideo'), 'YYYY-MM') as mes, count(*) as cobradores_nuevos
      from usuarios where rol = 'cobrador' group by 1
    ),
    fin as (
      select to_char((finalizado_en at time zone 'America/Montevideo'), 'YYYY-MM') as mes, count(*) as creditos_finalizados
      from prestamos where estado = 'finalizado' and finalizado_en is not null group by 1
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'mes', s.mes,
      'colocado', coalesce(c.colocado, 0),
      'creditosNuevos', coalesce(c.creditos_nuevos, 0),
      'recaudado', coalesce(r.recaudado, 0),
      'cobros', coalesce(r.cobros, 0),
      'clientesNuevos', coalesce(cl.clientes_nuevos, 0),
      'cobradoresNuevos', coalesce(cb.cobradores_nuevos, 0),
      'creditosFinalizados', coalesce(f.creditos_finalizados, 0)
    ) order by s.mes), '[]'::jsonb)
    from spine s
    left join coloc c on c.mes = s.mes
    left join recaud r on r.mes = s.mes
    left join cli cl on cl.mes = s.mes
    left join cob cb on cb.mes = s.mes
    left join fin f on f.mes = s.mes
  ) else '[]'::jsonb end;
$$;
