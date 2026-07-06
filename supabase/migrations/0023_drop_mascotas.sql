-- ─────────────────────────────────────────────────────────────────────────
--  0023 · Limpieza del esquema — eliminar la tabla `mascotas` (obsoleta).
--  La mascota se retiró en 0019; la tabla quedó marcada obsoleta porque tenía
--  datos (estados de tamagotchi DEMO, no financieros). El código ya no la usa.
--  Ahora se elimina definitivamente. Ejecutar en el SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────
drop table if exists mascotas cascade;
