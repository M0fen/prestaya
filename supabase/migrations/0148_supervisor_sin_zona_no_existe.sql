-- ─────────────────────────────────────────────────────────────────────────
--  0148 · Se CIERRA la escotilla de transición "supervisor sin zonas ve todo".
--
--  REGLA DE CARLOS (15-08): "No puede existir supervisor sin zona." La rama
--  `app_supervisor_sin_zonas()` de la 0031 era el fallback de la transición
--  (cuando las zonas recién nacían y ningún supervisor tenía la suya): un
--  supervisor sin filas en supervisor_zonas veía y tocaba TODO — clientes,
--  préstamos, pagos, solicitudes — sin frontera alguna.
--
--  MEDIDO antes de aplicar (tablero-qa, 15-08): 0 de 3 supervisores activos
--  están sin zona — la asignación ya está completa y NADIE pierde acceso hoy.
--  Desde ahora, un supervisor nuevo NO VE NADA hasta que el admin le asigne
--  su zona (que es exactamente la regla: la zona es parte del alta). El
--  tablero vigila el contador "Supervisores sin zona" por si alguno queda a
--  medio dar de alta.
--
--  Cómo: se redefine la FUNCIÓN a `false` (un solo punto — todas las policies
--  que la referencian quedan cerradas a la vez, sin tocar ninguna policy).
--  Revertir = restaurar el cuerpo de la 0031. Sellada por PG en caos.pg.test.ts.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function app_supervisor_sin_zonas()
returns boolean language sql stable security definer set search_path = public as $$
  -- 0148: la transición terminó. Un supervisor sin zonas no ve nada hasta que
  -- el admin se la asigne — "no puede existir supervisor sin zona" (Carlos).
  select false;
$$;

-- ── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- select prosrc from pg_proc where proname='app_supervisor_sin_zonas';
--   → contiene 'select false'
-- select count(*) from usuarios u where u.rol='supervisor' and u.activo
--   and not exists (select 1 from supervisor_zonas sz where sz.supervisor_id=u.id);
--   → 0 (nadie pierde acceso al aplicarla)
