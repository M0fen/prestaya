-- ─────────────────────────────────────────────────────────────────────────
--  0043 · RPC de VIGILANCIA — recaudo por cobrador y día (para el score de
--  confianza + cuenta corriente del /admin/alertas).
--
--  Sin esto, calcular la confianza obligaba a traer TODOS los pagos de la ventana
--  a memoria (decenas de miles) y agregarlos en JS → la página colgaba. Esta RPC
--  agrupa en Postgres (índice por fecha) y devuelve como MÁXIMO cobradores×días
--  filas (cientos), no decenas de miles. SECURITY DEFINER: chequea gestor UNA vez
--  y salta el RLS por-fila (que sobre pagos daba statement timeout). Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function app_vigilancia_pagos(desde timestamptz)
returns table (cobrador_id uuid, dia date, monto numeric, cobros bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Solo gestores (admin/supervisor). El recorte por zona lo hace la app en JS.
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
      and p.registrado_por is not null
      and p.registrado_en >= desde
    group by p.registrado_por, (p.registrado_en at time zone 'America/Montevideo')::date;
end;
$$;

revoke all on function app_vigilancia_pagos(timestamptz) from public;
grant execute on function app_vigilancia_pagos(timestamptz) to authenticated;
