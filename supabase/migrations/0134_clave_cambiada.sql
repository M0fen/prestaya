-- ─────────────────────────────────────────────────────────────────────────
--  0134 — Onboarding día 1: sello de "cambió su contraseña inicial".
--  Todo el equipo del piloto entra con la clave provisoria compartida; la
--  tarjeta de arranque (cobrador y panel) insiste hasta que cada uno ponga
--  la suya. Lo escribe SOLO la Server Action cambiarMiClave (service_role).
-- ─────────────────────────────────────────────────────────────────────────

alter table public.usuarios
  add column if not exists clave_cambiada_en timestamptz;

comment on column public.usuarios.clave_cambiada_en is
  'Cuándo el usuario reemplazó la clave inicial por una propia (onboarding día 1). NULL = todavía usa la provisoria.';
