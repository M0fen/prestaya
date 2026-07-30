-- ─────────────────────────────────────────────────────────────────────────
-- 0110 — Sellar la "Caja del día" de los cobradores SIN zona (interior / no
-- asignados a un supervisor). Hasta hoy toda la cadena de sellado exigía zona:
-- el efectivo de un cobrador sin zona quedaba en el bucket "Sin zona" del cierre
-- consolidado SIN poder confirmarse nunca → 25% del efectivo sin sello de custodia.
--
-- Ahora el ADMIN puede cerrar ese bucket (zona_id = null) igual que una zona. El
-- unique(zona_id, fecha) de 0047 NO deduplica NULLs (en SQL null ≠ null), así que
-- un doble-click insertaría dos cierres del bucket sin zona. Este índice único
-- PARCIAL lo hace idempotente (un solo cierre "sin zona" por día). Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────

create unique index if not exists cierres_zona_sin_zona_uk
  on cierres_zona (fecha)
  where zona_id is null;
