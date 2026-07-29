-- ─────────────────────────────────────────────────────────────────────────
--  0093 · Restaura el acotado POR ZONA de la lectura de solicitudes_gasto.
--
--  REGRESIÓN: 0060(B) endureció `solgasto_gestor_select` a
--    using ( app_es_admin() or app_gestor_ve_cobrador(cobrador_id) )
--  para cerrar la fuga cross-zona de LECTURA por PostgREST crudo (anon key + JWT
--  del supervisor). Pero 0070 —más nueva— recreó la MISMA policy con el predicado
--  ANCHO `app_es_gestor()` ("las ve todas"), reabriendo la fuga: un supervisor de
--  otra zona vuelve a leer monto, descripción (texto libre del cobrador),
--  comprobante_url y nombres de cobradores de TODAS las zonas. La UI ya filtra por
--  zona (gastos/page.tsx con .in(cobrador_id, ...)), así que esto NO afecta la
--  pantalla; cierra el bypass por REST directo (defensa en profundidad).
--
--  Aprobar/rechazar NO se ven afectados: son acción admin-only por service_role y
--  no hay policy de UPDATE por RLS sobre solicitudes_gasto.
--
--  Solo cambia RLS → aplica al instante, sin reload de schema. Re-ejecutable.
--  Correr en el SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

drop policy if exists solgasto_gestor_select on solicitudes_gasto;
create policy solgasto_gestor_select on solicitudes_gasto for select to authenticated
  using ( app_es_admin() or app_gestor_ve_cobrador(cobrador_id) );
