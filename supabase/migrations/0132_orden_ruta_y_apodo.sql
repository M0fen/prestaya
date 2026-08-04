-- ─────────────────────────────────────────────────────────────────────────
--  0132 — ORDEN DE RUTA del cobrador + APODO (sobrenombre).
--
--  · asignaciones.orden: la posición del cliente en el recorrido que el
--    cobrador se armó (su "ruta" preestablecida). NULL = sin ordenar (cae al
--    final, por nombre). Lo escribe SOLO una Server Action que valida que la
--    asignación sea del propio cobrador; la RLS de UPDATE no se abre.
--  · usuarios.apodo: sobrenombre elegido por el propio trabajador. Reemplaza
--    al nombre real donde lo ven TERCEROS (comprobante que se comparte por
--    WhatsApp); el panel del admin sigue mostrando el nombre real.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.asignaciones
  add column if not exists orden integer;

comment on column public.asignaciones.orden is
  'Posición del cliente en el recorrido preestablecido del cobrador (NULL = sin ordenar). Se escribe vía Server Action.';

alter table public.usuarios
  add column if not exists apodo text
  check (apodo is null or char_length(apodo) between 1 and 24);

comment on column public.usuarios.apodo is
  'Sobrenombre elegido por el trabajador. Se muestra a terceros (comprobante) en lugar del nombre real.';
