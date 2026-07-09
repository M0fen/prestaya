-- ─────────────────────────────────────────────────────────────────────────
--  0047 · CIERRE DE CAJA POR ZONA. El SUPERVISOR cierra la jornada de SU zona:
--  recibe el efectivo de sus cobradores y confirma la entrega a la caja central
--  (admin). Es el eslabón del medio en la cadena de custodia del efectivo
--  (cobrador → supervisor → caja central). Los totales se guardan como snapshot
--  AUTORITATIVO del servidor (no se confía en el cliente). Un solo cierre por
--  zona y día (unique). Ejecutar en SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists cierres_zona (
  id                   uuid primary key default gen_random_uuid(),
  zona_id              uuid references zonas(id) on delete cascade,
  -- Día de Uruguay (UTC−3). La pone la BD para evitar líos de huso.
  fecha                date not null default (now() at time zone 'America/Montevideo')::date,
  supervisor_id        uuid references usuarios(id) on delete set null,
  supervisor_nombre    text,
  -- Snapshot de dinero al momento del cierre (numeric, nunca float).
  total_esperado       numeric(14,2) not null default 0,
  total_entregado      numeric(14,2) not null default 0,
  diferencia           numeric(14,2) not null default 0,
  cobradores_rendidos  int not null default 0,
  cobradores_pendientes int not null default 0,
  notas                text,
  creado_en            timestamptz not null default now(),
  -- Un único cierre por zona y día (idempotente ante doble confirmación).
  unique (zona_id, fecha)
);

create index if not exists idx_cierres_zona_fecha on cierres_zona (fecha desc);

-- Solo GESTORES leen/gestionan. La escritura fina (supervisor de ESA zona, o
-- admin) la limita la Server Action; la RLS abre a cualquier gestor autenticado.
alter table cierres_zona enable row level security;
drop policy if exists cierres_zona_gestor_all on cierres_zona;
create policy cierres_zona_gestor_all on cierres_zona
  for all to authenticated using (app_es_gestor()) with check (app_es_gestor());
