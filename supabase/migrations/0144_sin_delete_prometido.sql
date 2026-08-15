-- ─────────────────────────────────────────────────────────────────────────
--  0144 · Higiene del perímetro (inventario del dinero, 08-14/15): quitar las
--  policies de DELETE que PROMETEN lo que el trigger NIEGA.
--
--  `prestamos_delete` (admin) y `rend_delete` (admin) existían junto a los
--  triggers BEFORE DELETE `trg_prestamos_no_borrar` (P0403) y
--  `trg_rendiciones_no_borrar` (0138) — el trigger siempre gana, así que nadie
--  borraba nada, pero una policy que dice "el admin puede borrar" confunde al
--  próximo que la lea (y a un auditor). Sin policy de DELETE, la RLS niega el
--  DELETE por defecto: el mensaje pasa a ser coherente en las dos capas.
--
--  Las ESCOTILLAS de 0138 (set local app.permitir_borrado_*) siguen existiendo
--  para el service_role (BYPASSRLS): la operación excepcional no cambia.
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists prestamos_delete on prestamos;
drop policy if exists rend_delete on rendiciones;
