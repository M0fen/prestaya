-- ─────────────────────────────────────────────────────────────────────────
--  0140 · RLS de solicitudes_renovacion POR ZONA (el candado que 0096 escribió
--  y la base viva no tenía).
--
--  Medido el 08-14 contra pg_policies: la base viva seguía con las policies de
--  0029 (`app_es_gestor()` a secas) — la 0096 las reescribía zonales y ese
--  bloque nunca llegó a producción. Hasta ayer el agujero era de LECTURA (un
--  supervisor veía los pedidos de otras zonas). Desde hoy es peor: el
--  supervisor APRUEBA y RECHAZA solicitudes (regla de Carlos, 08-13), así que
--  sin esto podía RESOLVER pedidos de una zona ajena — aprobar le fallaría al
--  crear el crédito (prestamos_insert sí es zonal), pero RECHAZAR un pedido
--  ajeno le salía, y el cobrador de la otra zona veía morir su pedido sin que
--  su supervisor lo hubiera mirado.
--
--  Regla: el admin todo; el gestor, los pedidos de clientes que VE (su zona).
--  El COBRADOR no aparece acá: pide y lee por service_role (pedirAprobacion /
--  misPedidos), la autorización la dan los gates de la Server Action.
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists solren_select on solicitudes_renovacion;
drop policy if exists solren_write on solicitudes_renovacion;

create policy solren_select on solicitudes_renovacion for select to authenticated
  using ( app_es_admin() or app_gestor_ve_cliente(cliente_id) );
create policy solren_write on solicitudes_renovacion for all to authenticated
  using ( app_es_admin() or app_gestor_ve_cliente(cliente_id) )
  with check ( app_es_admin() or app_gestor_ve_cliente(cliente_id) );
