-- ─────────────────────────────────────────────────────────────────────────
--  0028 · CONFIG del SCORING (modelo administrable por el admin).
--  Una sola fila (id=1). Pesos de los 5 factores (se normalizan a que sumen 1)
--  + umbrales de banda. Cambiarlos re-puntúa a TODOS (el score se calcula, no se
--  guarda). Solo el admin edita (se valida en el servidor). Ejecutar en SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists config_scoring (
  id                 int primary key default 1 check (id = 1),
  peso_cumplimiento  numeric(4,3) not null default 0.350 check (peso_cumplimiento >= 0),
  peso_mora          numeric(4,3) not null default 0.250 check (peso_mora >= 0),
  peso_experiencia   numeric(4,3) not null default 0.150 check (peso_experiencia >= 0),
  peso_consistencia  numeric(4,3) not null default 0.150 check (peso_consistencia >= 0),
  peso_antiguedad    numeric(4,3) not null default 0.100 check (peso_antiguedad >= 0),
  umbral_excelente   int not null default 800 check (umbral_excelente between 0 and 1000),
  umbral_bueno       int not null default 650 check (umbral_bueno between 0 and 1000),
  umbral_regular     int not null default 450 check (umbral_regular between 0 and 1000),
  actualizado_por    uuid references usuarios(id),
  actualizado_en     timestamptz not null default now()
);

alter table config_scoring enable row level security;

drop policy if exists config_scoring_select on config_scoring;
drop policy if exists config_scoring_write on config_scoring;

-- Los gestores lo leen (para puntuar en la ficha); la escritura se restringe al
-- admin en la Server Action (guardarConfigScoring).
create policy config_scoring_select on config_scoring for select to authenticated
  using ( app_es_gestor() );
create policy config_scoring_write on config_scoring for all to authenticated
  using ( app_es_gestor() ) with check ( app_es_gestor() );

insert into config_scoring (id) values (1) on conflict (id) do nothing;
