-- ─────────────────────────────────────────────────────────────────────────
--  0042 · RASPADITA POR TRAMO DE SCORING.
--
--  El dueño quiere controlar el premio según el score del cliente: p. ej. los de
--  scoring ≥90% ganan seguro un premio "regalado" (aunque igual raspan), y los
--  demás tienen la chance que él decida (ej. 40%). Se modela con TRAMOS:
--   · cada tramo = rango de score (0–100 %) + "% de probabilidad de ganar".
--   · cada premio se asigna a un tramo; si gana, se sortea CUÁL premio por peso.
--   · un tramo "Los demás" (es_default) cubre a quien no cae en ningún tramo.
--
--  Sigue siendo PROMOCIONAL: los premios son beneficios simbólicos, NUNCA dinero
--  (ver 0021). El resultado lo decide el SERVIDOR. Ejecutar en SQL Editor.
--  Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────

-- Tramos de scoring de la raspadita.
create table if not exists raspadita_segmentos (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  -- Rango de score en PORCENTAJE (el score interno 0..1000 se mapea a 0..100).
  score_min  int  not null default 0   check (score_min  between 0 and 100),
  score_max  int  not null default 100 check (score_max  between 0 and 100),
  -- Probabilidad de GANAR un premio en este tramo (0 = nunca, 100 = siempre).
  prob_ganar int  not null default 30  check (prob_ganar between 0 and 100),
  -- "Los demás": tramo catch-all para quien no cae en ningún tramo específico.
  es_default boolean not null default false,
  activo     boolean not null default true,
  orden      int not null default 0,
  creado_en  timestamptz not null default now()
);

-- Cada premio pertenece a un tramo. null = sin asignar (se trata como del default).
alter table raspadita_premios
  add column if not exists segmento_id uuid references raspadita_segmentos(id) on delete set null;

-- Seed: un tramo "Los demás" (catch-all) si todavía no hay tramos. Chance 40%
-- (parecido al comportamiento previo, donde 'nada' pesaba ~60 vs beneficios ~40).
insert into raspadita_segmentos (nombre, score_min, score_max, prob_ganar, es_default, orden)
select 'Los demás', 0, 100, 40, true, 100
where not exists (select 1 from raspadita_segmentos);

-- Los premios existentes sin tramo pasan al default (no rompe lo ya configurado).
update raspadita_premios p
set segmento_id = (select id from raspadita_segmentos where es_default order by creado_en limit 1)
where p.segmento_id is null;

-- ── SEGURIDAD (RLS): gestores administran; el cliente juega por service_role ──
alter table raspadita_segmentos enable row level security;

drop policy if exists raspadita_segmentos_gestor_all on raspadita_segmentos;
create policy raspadita_segmentos_gestor_all on raspadita_segmentos
  for all to authenticated using (app_es_gestor()) with check (app_es_gestor());

-- Legible por usuarios logueados (para la UI); el cliente real lee por service_role.
drop policy if exists raspadita_segmentos_select on raspadita_segmentos;
create policy raspadita_segmentos_select on raspadita_segmentos
  for select to authenticated using (true);
