-- ─────────────────────────────────────────────────────────────────────────
--  0080 · PUBLICIDAD en los banners (cliente + cobrador).
--
--  Convierte los dos banners que ya existen en un espacio de publicidad de
--  verdad, reutilizable (curbe.uy como primer anunciante, pero sirve para
--  cualquiera). NO toca plata: solo texto/imagen/enlaces gestionados por el
--  admin. Todas las columnas son opcionales → los avisos actuales siguen
--  funcionando igual (retrocompatible).
--
--  Ejecutar en el SQL Editor. Re-ejecutable (todo con IF [NOT] EXISTS).
-- ─────────────────────────────────────────────────────────────────────────

-- ── Cliente: carrusel de anuncios ──────────────────────────────────────────
-- Etiqueta del "eyebrow" (por defecto "Novedad"). Para publicidad externa se
-- pone "Publicidad" / "Auspiciado" y así el aviso es honesto, no parece del
-- sistema.
alter table anuncios add column if not exists etiqueta text;

-- Nuevo tema "dorado" (negro + oro, look premium). Se reescribe el CHECK del
-- tema para incluirlo sin perder los anteriores.
alter table anuncios drop constraint if exists anuncios_tema_check;
alter table anuncios
  add constraint anuncios_tema_check
  check (tema in ('azul', 'verde', 'ambar', 'oscuro', 'dorado'));

-- ── Cobrador: banner al equipo ─────────────────────────────────────────────
-- De solo-texto a una tarjeta que el cobrador puede ACCIONAR (ofrecer curbe a
-- su cliente). Todo opcional: si están vacíos, el banner se ve como hoy.
alter table banner_cobrador add column if not exists titulo     text;  -- titular corto
alter table banner_cobrador add column if not exists imagen_url text;  -- foto del producto
alter table banner_cobrador add column if not exists cta_texto  text;  -- rótulo del botón
alter table banner_cobrador add column if not exists cta_url    text;  -- link a compartir/abrir
