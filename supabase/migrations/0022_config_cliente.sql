-- ─────────────────────────────────────────────────────────────────────────
--  0022 · Config del cliente definible por el admin (sobre ajustes_juego, 0009).
--   · estrellas_ciclo: cómo se cuenta el tope de canje de estrellas
--       'mes'     = por mes calendario (default)
--       'credito' = por crédito (se reinicia con cada crédito nuevo)
--   · umbral_caritas: días de atraso para que la carita pase de naranja a roja
--       (default 3; el que veníamos usando).
--  Ejecutar en el SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────
alter table ajustes_juego
  add column if not exists estrellas_ciclo text not null default 'mes'
    check (estrellas_ciclo in ('mes','credito'));

alter table ajustes_juego
  add column if not exists umbral_caritas int not null default 3
    check (umbral_caritas between 1 and 60);
