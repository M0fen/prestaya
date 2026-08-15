-- ─────────────────────────────────────────────────────────────────────────
--  0145 · app_reparar_pagado_acum vuelve a ser invocable por un ADMIN logueado.
--
--  Lo encontró el harness PG (Fase 2, 15-08) al correr contra las migraciones
--  reales: la 0142 revocó EXECUTE a authenticated en esta función, pero su
--  guard interno exige `app_rol() = 'admin'` — que solo se cumple con el JWT de
--  un admin. Con las dos cosas juntas NADIE podía llamarla: el admin logueado
--  no tenía el grant, y el service_role (sin JWT) rebotaba en el guard. La
--  herramienta de reparación de INV1 quedó inutilizable sin que nada avisara.
--
--  Regla correcta: el guard interno ES la defensa (verifica el rol de verdad),
--  así que authenticated puede tener EXECUTE — el que no es admin rebota
--  adentro. `anon` sigue revocado (0142). Es la diferencia entre esta función y
--  las de 0142 que NO tenían guard: ahí el grant era el único candado.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'app_reparar_pagado_acum'
  loop
    execute format('grant execute on function %s to authenticated', r.firma);
    execute format('revoke execute on function %s from anon', r.firma);
    execute format('revoke execute on function %s from public', r.firma);
  end loop;
end $$;
