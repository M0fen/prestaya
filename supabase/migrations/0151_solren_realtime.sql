-- ─────────────────────────────────────────────────────────────────────────
--  0151 · Pedidos de la calle EN VIVO en el panel (quejas repetidas 19-08).
--
--  El supervisor tiene que enterarse de un pedido de renovación/venta sobre el
--  +20% SIN activar nada: ni push, ni recargar. El panel ya escucha `mensajes`
--  por Supabase Realtime (0008); acá se publica `solicitudes_renovacion` para
--  que la franja "🔔 N pedidos esperan tu aprobación" y el toast "Nuevo pedido
--  de Víctor…" aparezcan en el momento en que el cobrador toca "Pedir".
--
--  La RLS 0140 sigue mandando sobre lo que cada suscriptor RECIBE: el admin
--  todo, el supervisor solo los pedidos de clientes de su zona. El cliente del
--  panel NO muestra el payload crudo: al recibir el evento vuelve a leer la
--  cola por la Server Action (misma RLS), así no hay camino nuevo a los datos.
--  Idempotente (mismo patrón que 0008).
-- ─────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'solicitudes_renovacion'
  ) then
    execute 'alter publication supabase_realtime add table solicitudes_renovacion';
  end if;
end $$;
