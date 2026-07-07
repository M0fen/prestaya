-- ─────────────────────────────────────────────────────────────────────────
--  0034 · Rol DESARROLLADOR = admin + marca `es_dev`.
--  Ejecutar en el SQL Editor DESPUÉS de 0033.
--
--  Modelado seguro: NO se agrega un rol nuevo al enum (que obligaría a tocar
--  todas las políticas RLS de dinero). El desarrollador es un ADMIN (poder
--  total, ya cubierto por la RLS existente) con esta marca, que además le
--  habilita en la app herramientas extra de diagnóstico (pantalla /admin/dev).
-- ─────────────────────────────────────────────────────────────────────────
alter table usuarios add column if not exists es_dev boolean not null default false;
