-- ─────────────────────────────────────────────────────────────────────────
-- 0077 — TIENDA: feeling de tienda de electrodomésticos.
--   · productos.marca (para filtrar/mostrar por marca: Samsung, LG, Whirlpool…).
--   · productos.precio_anterior (precio "antes" tachado → framing de oferta).
--   · SEED de un buen set de categorías de electro (idempotente por nombre).
-- Idempotente. Carlos la corre en el SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

alter table productos add column if not exists marca text;
alter table productos add column if not exists precio_anterior numeric(12,2);

-- Categorías de electro (buen número, para que la tienda se sienta completa).
-- Solo se insertan las que falten (por nombre). El admin puede editar/ocultar/sumar.
insert into categorias_producto (nombre, orden, activo)
select v.nombre, v.orden, true
from (values
  ('Heladeras y Freezers', 10),
  ('Lavarropas y Secarropas', 20),
  ('Cocinas y Hornos', 30),
  ('Televisores', 40),
  ('Aire acondicionado', 50),
  ('Calefacción', 60),
  ('Microondas', 70),
  ('Lavavajillas', 80),
  ('Termotanques y Calefones', 90),
  ('Pequeños electrodomésticos', 100),
  ('Celulares y Tablets', 110),
  ('Notebooks y PC', 120),
  ('Audio y Parlantes', 130),
  ('Ventiladores', 140),
  ('Colchones y Sommiers', 150),
  ('Muebles', 160),
  ('Herramientas', 170),
  ('Bicicletas y Motos', 180)
) as v(nombre, orden)
where not exists (
  select 1 from categorias_producto c where lower(c.nombre) = lower(v.nombre)
);
