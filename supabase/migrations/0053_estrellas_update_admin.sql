-- ─────────────────────────────────────────────────────────────────────────
--  0053 · ESTRELLAS: el UPDATE (aprobar/rechazar/redimir un canje) pasa a SOLO
--  ADMIN. La pantalla /admin/estrellas y las Server Actions ya son admin-only
--  (esAdmin); esto cierra el ÚNICO path que quedaba: un supervisor haciendo un
--  UPDATE crudo por PostgREST para resolver un canje (dinero-adyacente).
--
--  El SELECT se MANTIENE para gestores a propósito: la ficha del cliente
--  (/admin/clientes/[id], visible a supervisores) muestra el saldo de estrellas y
--  necesita leer las redenciones para descontarlas (si no, el saldo saldría
--  inflado). El INSERT sigue sin policy → solo service_role (acción admin gateada).
--  Reusa app_es_admin() de 0031. Ejecutar en el SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists redenciones_update_gestor on estrellas_redenciones;
drop policy if exists redenciones_update_admin  on estrellas_redenciones;

create policy redenciones_update_admin on estrellas_redenciones
  for update to authenticated using ( app_es_admin() ) with check ( app_es_admin() );
