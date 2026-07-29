-- ─────────────────────────────────────────────────────────────────────────
-- 0102 — AUDIENCIA de la raspadita: a QUIÉNES les aparece.
--
-- Hasta hoy la raspadita NO tenía selector de audiencia (0089 unificó segmentos
-- en anuncios/quiniela/rifa/tienda pero SALTÓ la raspadita) → "Todos" no estaba
-- habilitada para ella. Sus "tramos" son la PROBABILIDAD de ganar por puntaje,
-- otro eje, NO audiencia. Esta columna agrega la audiencia real (misma
-- DefinicionSegmento que el resto): NULL = TODOS; si está, solo la ven los
-- clientes que matchean (clienteEnSegmento), igual que la quiniela.
--
-- Es solo VISIBILIDAD promocional: no toca dinero, pagos ni el cartón. La corre
-- Carlos en el SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────

alter table ajustes_juego add column if not exists raspa_segmento_def jsonb;
