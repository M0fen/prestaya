-- ─────────────────────────────────────────────────────────────────────────
--  0133 — RPC atómica para guardar el ORDEN de la ruta (fix del upsert 0132).
--
--  El primer intento usaba un UPSERT con {id, cobrador_id, cliente_id, activo}:
--  si la oficina DESACTIVABA o BORRABA la asignación entre el fetch y el
--  guardado, el upsert la RE-ACTIVABA / RE-CREABA — un cobrador podía
--  "recuperar" en silencio un cliente que le acababan de sacar. Esta función
--  solo hace UPDATE de `orden` sobre asignaciones ACTIVAS del PROPIO cobrador:
--  no crea, no reactiva, no toca otras columnas. Atómica (un statement).
--
--  La llama SOLO el servidor (service_role) pasando el cobrador de la SESIÓN;
--  se revoca EXECUTE a anon/authenticated para que no sea invocable por REST
--  con otro p_cobrador.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.app_guardar_orden_ruta(
  p_cobrador uuid,
  p_clientes uuid[]
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update asignaciones a
     set orden = c.ord
    from (
      select t.cliente_id, t.ord::int as ord
      from unnest(p_clientes) with ordinality as t(cliente_id, ord)
    ) c
   where a.cliente_id = c.cliente_id
     and a.cobrador_id = p_cobrador
     and a.activo;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.app_guardar_orden_ruta(uuid, uuid[]) from public;
revoke all on function public.app_guardar_orden_ruta(uuid, uuid[]) from anon;
revoke all on function public.app_guardar_orden_ruta(uuid, uuid[]) from authenticated;
