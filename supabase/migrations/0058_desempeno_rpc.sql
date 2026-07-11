-- ─────────────────────────────────────────────────────────────────────────
--  0058 — RPC de AGREGACIÓN de desempeño por cobrador (para "Cobradores hoy"
--  con mes/año y para la vista Desempeño a cualquier escala).
--  Agrega los pagos EN SQL (GROUP BY), no trayendo 26k–320k filas a JS: un mes
--  o un año se resuelven en milisegundos. SECURITY DEFINER (bypassa el RLS
--  por-fila de `pagos`, que hacía timeouts); guardado por rol (solo gestor).
--  El SCOPE por zona lo aplica el caller pasando `p_cobradores` (mismo modelo
--  que el resto del panel: los ids salen del alcance resuelto en el servidor).
-- ─────────────────────────────────────────────────────────────────────────

-- Índice para que el filtro por rango sea rápido a escala de año.
create index if not exists idx_pagos_registrado_en on pagos (registrado_en);

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
  -- Solo un gestor (admin/supervisor) obtiene datos. Un cobrador → vacío.
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
