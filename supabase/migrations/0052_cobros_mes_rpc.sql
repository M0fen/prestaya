-- ─────────────────────────────────────────────────────────────────────────
--  0052 · RPC de CONTEO de cobros del mes (para /admin/valor). El tablero Valor
--  contaba pagos del mes con PostgREST bajo RLS → la policy de `pagos` se evalúa
--  por fila y el count tardaba ~6s (borde del statement timeout). Igual que el
--  resto de agregados del panel: SECURITY DEFINER (salta el RLS por-fila) pero
--  verifica el rol UNA vez con app_es_gestor(). Devuelve total + los que tienen
--  GPS (cobros auditables), en una sola llamada. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function app_cobros_mes(desde timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when app_es_gestor() then jsonb_build_object(
    'total', (select count(*) from pagos where anulado = false and registrado_en >= desde),
    'gps',   (select count(*) from pagos where anulado = false and registrado_en >= desde and gps_lat is not null)
  ) else jsonb_build_object('total', 0, 'gps', 0) end;
$$;

grant execute on function app_cobros_mes(timestamptz) to authenticated;
