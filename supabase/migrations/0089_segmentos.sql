-- ─────────────────────────────────────────────────────────────────────────
-- 0089 — AUDIENCIAS / SEGMENTOS unificados (modelo transversal).
--
-- Hoy cada feature reinventa "a quién": anuncios.segmento (enum), rifas.solo_mejores
-- (bool), raspadita_segmentos (score), producto_precio_segmento (calificacion|zona).
-- Este modelo unifica: un SEGMENTO es una DefinicionSegmento (lib/segmentos.ts) —
-- calificaciones + zonas + cobradores + estado del crédito + incluir/excluir por
-- cliente. La MISMA definición la consumen anuncios, quiniela, rifa, tienda y push.
--
-- Dos piezas:
--  (1) `segmentos`: presets NOMBRADOS y reusables (el admin arma "Excelentes de Centro"
--      una vez y lo aplica a varios eventos).
--  (2) columna `segmento_def jsonb` en cada feature: la definición APLICADA a ESE evento
--      (copiada de un preset o armada inline). null = "todos" (conducta previa intacta →
--      backward-compat total: sin esta columna las features siguen como hoy).
--
-- El filtrado es en el SERVIDOR con clienteEnSegmento(cliente, def) (puro, testeado).
-- security: RLS deja a los GESTORES (admin/supervisor) administrar presets; el service_role
-- (que sirve el cartón del cliente) lee la columna sin restricción. La corre Carlos en el
-- SQL Editor. Idempotente.
-- ─────────────────────────────────────────────────────────────────────────

-- (1) Presets nombrados y reusables.
create table if not exists segmentos (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,
  definicion     jsonb not null default '{}'::jsonb,
  creado_por     uuid references usuarios(id),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

alter table segmentos enable row level security;

-- Los gestores (admin/supervisor) ven y administran los presets. app_es_gestor() ya
-- existe (usada por otras políticas). El service_role bypassa RLS (sirve al cliente).
drop policy if exists segmentos_gestor_todo on segmentos;
create policy segmentos_gestor_todo on segmentos
  for all to authenticated
  using (app_es_gestor())
  with check (app_es_gestor());

-- (2) Definición APLICADA por feature (inline). null = a todos (sin cambio de conducta).
alter table anuncios       add column if not exists segmento_def jsonb;
alter table quinielas      add column if not exists segmento_def jsonb;
alter table rifas          add column if not exists segmento_def jsonb;
alter table productos      add column if not exists segmento_def jsonb;

comment on column anuncios.segmento_def is
  'Audiencia (DefinicionSegmento de lib/segmentos.ts). null = a todos. Si está, MANDA sobre la col segmento (enum) vieja.';
comment on column quinielas.segmento_def is
  'Audiencia de la quiniela: solo estos clientes participan/ven. null = todos los al día (conducta previa).';
comment on column rifas.segmento_def is
  'Audiencia de la rifa. null = usa solo_mejores (conducta previa). Si está, MANDA sobre solo_mejores.';
comment on column productos.segmento_def is
  'Visibilidad del producto por audiencia. null = visible para todos (conducta previa).';
