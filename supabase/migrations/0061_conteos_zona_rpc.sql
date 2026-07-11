-- ─────────────────────────────────────────────────────────────────────────
--  0061 · RPC de conteos AGREGADOS por zona (perf del dashboard del supervisor).
--
--  El dashboard del supervisor contaba finalizados/incobrables/reportes en lotes
--  SECUENCIALES de cliente_id (N round-trips proporcionales al tamaño de zona).
--  Esta RPC los agrega EN SQL y devuelve los 3 conteos en UNA sola llamada.
--
--  SECURITY DEFINER: bypassa el RLS por-fila sobre `prestamos`/`reportes` (que
--  era el costo: un count evaluando RLS por-fila sobre miles de clientes daba
--  statement timeout). El scope es EXPLÍCITO: los cliente_ids los pasa el server
--  desde el alcance del actor (alcanceDelActor), no la RPC. Guardada por
--  app_es_gestor() → service_role devuelve ceros (mismo patrón que las demás RPC).
--
--  Solo función → aplica al instante, sin reload de schema. Re-ejecutable.
--  Correr en el SQL Editor. lib/data/metricas.ts la usa con fallback (conteos por
--  lotes en paralelo) si aún no corrió: degrada, no rompe.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function app_conteos_zona(cliente_ids uuid[])
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_fin int; v_inc int; v_rep int;
begin
  if not app_es_gestor() then
    return jsonb_build_object('finalizados', 0, 'incobrables', 0, 'reportes', 0);
  end if;
  select count(*) into v_fin from prestamos where estado = 'finalizado' and cliente_id = any(cliente_ids);
  select count(*) into v_inc from prestamos where estado = 'incobrable' and cliente_id = any(cliente_ids);
  select count(*) into v_rep from reportes  where estado = 'nuevo'      and cliente_id = any(cliente_ids);
  return jsonb_build_object('finalizados', v_fin, 'incobrables', v_inc, 'reportes', v_rep);
end;
$$;
grant execute on function app_conteos_zona(uuid[]) to authenticated;
