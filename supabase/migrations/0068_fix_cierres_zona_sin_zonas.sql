-- ─────────────────────────────────────────────────────────────────────────
--  0068 — Fix de 0066: cierres_zona debe permitir al supervisor SIN zonas.
--  El estado "supervisor sin zonas asignadas ve/actúa sobre todo" es soportado a
--  propósito (lib/permisos.ts puedeVerZona → SUPERVISOR_SIN_ZONAS_VE_TODO). La
--  policy de 0066 usó `app_supervisa_zona(zona_id)` que —a diferencia de
--  `app_gestor_ve_cobrador`— NO incluye el fallback `app_supervisor_sin_zonas()`,
--  así que ese supervisor pasaba la guarda de la acción pero el RLS le rechazaba
--  el cierre (regresión vs 0047, que usaba `app_es_gestor()`). Se agrega explícito.
--  Idempotente. Correr por el SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists cierres_zona_gestor_all on cierres_zona;
create policy cierres_zona_gestor_all on cierres_zona for all to authenticated
  using ( app_es_admin() or app_supervisor_sin_zonas() or app_supervisa_zona(zona_id) )
  with check ( app_es_admin() or app_supervisor_sin_zonas() or app_supervisa_zona(zona_id) );
