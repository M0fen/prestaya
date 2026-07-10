-- ─────────────────────────────────────────────────────────────────────────
--  0048 · RPCs de ESTADÍSTICAS (panel de negocio + Dev). Agregan en SQL para no
--  colgar la base trayendo 158k pagos / 13k clientes al servidor de Next.
--  Patrón idéntico a 0040: SECURITY DEFINER (saltan el RLS por-fila para escanear
--  directo) pero verifican el ROL una sola vez con app_es_gestor(); un no-gestor
--  recibe vacío. Ejecutar en el SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Serie MENSUAL del negocio (últimos `meses`): colocación, recaudo, altas ──
--  Un mes-spine con generate_series y left-joins a cada agregado. Fechas en el
--  día calendario de Uruguay (UTC−3). Es la base de los gráficos de crecimiento.
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
      from pagos where anulado = false group by 1
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

-- ── Distribución de la cartera ACTIVA: por frecuencia y por calificación ─────
create or replace function app_stats_distribucion()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when app_es_gestor() then jsonb_build_object(
    'frecuencia', coalesce((
      select jsonb_agg(jsonb_build_object('k', frecuencia, 'n', n, 'capital', capital) order by capital desc)
      from (select coalesce(frecuencia, 'diario') as frecuencia, count(*) n, sum(monto_prestado) capital
            from prestamos where estado = 'activo' group by 1) x), '[]'::jsonb),
    'calificacion', coalesce((
      select jsonb_agg(jsonb_build_object('k', calif, 'n', n) order by n desc)
      from (select coalesce(c.calificacion::text, 'nuevo') as calif, count(*) n
            from prestamos p join clientes c on c.id = p.cliente_id
            where p.estado = 'activo' group by 1) y), '[]'::jsonb)
  ) else '{}'::jsonb end;
$$;

-- ── Estadística POR COBRADOR (comportamiento por persona; para Dev y panel) ───
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
               and registrado_en >= (now() - (greatest(1, least(365, dias)) || ' days')::interval)
             group by 1) rc on rc.registrado_por = u.id
  where app_es_gestor() and u.rol = 'cobrador' and u.activo = true
  order by coalesce(rc.recaudo, 0) desc;
$$;

-- ── Top clientes por recompra (nº de créditos) y capital histórico ───────────
create or replace function app_stats_top_clientes(limite int)
returns table(cliente_id uuid, nombre text, creditos bigint, activos bigint, capital_hist numeric)
language sql stable security definer set search_path = public as $$
  select c.id, c.nombre, count(p.id),
         count(p.id) filter (where p.estado = 'activo'),
         coalesce(sum(p.monto_prestado), 0)
  from clientes c join prestamos p on p.cliente_id = c.id
  where app_es_gestor()
  group by c.id, c.nombre
  order by count(p.id) desc, coalesce(sum(p.monto_prestado), 0) desc
  limit greatest(1, least(50, limite));
$$;

grant execute on function app_stats_mensual(int)         to authenticated;
grant execute on function app_stats_distribucion()       to authenticated;
grant execute on function app_stats_por_cobrador(int)    to authenticated;
grant execute on function app_stats_top_clientes(int)    to authenticated;
