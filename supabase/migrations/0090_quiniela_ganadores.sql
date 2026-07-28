-- ─────────────────────────────────────────────────────────────────────────
-- 0090 — Quiniela MIXTA: el admin puede FORZAR ganadores por persona.
--
-- Hoy el ganador de la quiniela se define SOLO por número (numero_ganador 000–999)
-- y ganan TODOS los participantes cuyo número de la suerte coincida (~13 personas
-- comparten cada número). El dueño quiere poder elegir a UNA persona puntual.
--
-- Decisión (mixto): se CONSERVA el sorteo por número (lindo para comunicar "salió
-- el 042") y se agrega `ganadores_forzados` = cliente_ids que GANAN aparte, elija el
-- admin. Al cerrar, ganadores = (participantes con ese número) ∪ (los forzados). Así
-- el admin garantiza que gane quien quiera, sin dejar de tener el sorteo por número.
--
-- `ganadores_forzados` es un uuid[] (cliente_ids). Se llena SOLO desde una acción de
-- gestor (server) sobre participantes reales. null/{} = solo gana el número (conducta
-- previa intacta → backward-compat). La corre Carlos en el SQL Editor. Idempotente.
-- ─────────────────────────────────────────────────────────────────────────

alter table quinielas add column if not exists ganadores_forzados uuid[] not null default '{}';

comment on column quinielas.ganadores_forzados is
  'cliente_ids que ganan la quiniela ADEMÁS de los del numero_ganador (el admin fuerza a una persona). {} = solo gana el número.';
