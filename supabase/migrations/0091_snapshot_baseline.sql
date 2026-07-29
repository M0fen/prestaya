-- ─────────────────────────────────────────────────────────────────────────
-- 0091 — PUNTO DE REFERENCIA (baseline T0) de la transición Disapp → Presta Ya.
--
-- Congela una FOTO INMUTABLE del estado por crédito en el instante en que una zona
-- arranca el parallel run (T0). Contra ella se mide TODO drift futuro y es el estado
-- al que se vuelve en un rollback. Hoy NO existía: el shadow compara contra el export
-- de CADA día (blanco móvil), no contra un ancla fija del corte. Ver docs/RUNBOOK-
-- TRANSICION-DISAPP.md §2.
--
-- Dos tablas append-only e INMUTABLES (sin update/delete, como reconciliacion_log 0073):
--  · snapshot_credito: una fila por crédito, congelando AMBAS fuentes (app + Disapp).
--  · snapshot_totales: totales de control por zona/cobrador (record counts, Σ cartera,
--    Σ pagado) — los mismos que usa la reconciliación financiera para cuadrar.
-- Versionadas por `label` (t0-centro-2026-08-01, t0-sur-…) → permite varios cortes.
--
-- Las FK a prestamos/clientes/usuarios/zonas se OMITEN a propósito: es un registro
-- HISTÓRICO que debe sobrevivir independiente de las tablas vivas (foto congelada).
-- RLS: lectura para gestores; escritura SOLO service_role (los scripts corren con
-- service_role, que bypassa RLS). La corre Carlos en el SQL Editor. Idempotente.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Foto por crédito ───────────────────────────────────────────────────────
create table if not exists snapshot_credito (
  id              uuid primary key default gen_random_uuid(),
  label           text not null,               -- versión del corte (t0-centro-YYYY-MM-DD)
  corrida_en      timestamptz not null default now(),
  -- Identidad del crédito (uuid sin FK: foto histórica).
  prestamo_id     uuid not null,
  disapp_credit_id  text,
  disapp_credit_ref text,
  cliente_id      uuid,
  cobrador_id     uuid,
  zona_id         uuid,
  -- Estado del crédito en T0 (lado APP).
  estado          text,
  cuota_diaria    numeric(12,2),
  total_dias      int,
  total_a_pagar   numeric(14,2),
  pagado_acum     numeric(14,2),               -- ⭐ el dato duro comparable (dinero)
  saldo           numeric(14,2),               -- cuota×días − pagado (modelo app)
  ultimo_pago_en  timestamptz,
  n_pagos         int,
  -- Lado DISAPP en T0 (del export del día; nullable si no se cargó export).
  disapp_pagos    numeric(14,2),               -- columna "Pagos" de Disapp (comparable)
  disapp_saldo    numeric(14,2),               -- "Saldo Pendiente" (con intereses; INFORMATIVO)
  -- Procedencia del snapshot (auditable).
  export_file     text,
  export_ts       timestamptz,
  -- Una foto por crédito por label (idempotencia del script).
  constraint uq_snapshot_credito_label_prestamo unique (label, prestamo_id)
);

create index if not exists idx_snapshot_credito_label on snapshot_credito (label);
create index if not exists idx_snapshot_credito_zona  on snapshot_credito (label, zona_id);

-- ── Totales de control por zona/cobrador ───────────────────────────────────
create table if not exists snapshot_totales (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,
  corrida_en    timestamptz not null default now(),
  zona_id       uuid,                          -- null = total general
  cobrador_id   uuid,                          -- null = todos
  n_creditos    int,
  n_clientes    int,
  cartera       numeric(16,2),                 -- Σ saldo (modelo app)
  pagado        numeric(16,2),                 -- Σ pagado_acum (dinero, comparable)
  disapp_pagos  numeric(16,2),                 -- Σ Pagos de Disapp en T0 (si hay export)
  source        text                           -- 'app' | 'disapp' (de dónde salió)
);

create index if not exists idx_snapshot_totales_label on snapshot_totales (label);

-- ── RLS: lectura gestor, escritura solo service_role ───────────────────────
alter table snapshot_credito enable row level security;
alter table snapshot_totales enable row level security;

drop policy if exists snapshot_credito_leer on snapshot_credito;
create policy snapshot_credito_leer on snapshot_credito
  for select to authenticated using (app_es_gestor());

drop policy if exists snapshot_totales_leer on snapshot_totales;
create policy snapshot_totales_leer on snapshot_totales
  for select to authenticated using (app_es_gestor());
-- Sin políticas de INSERT/UPDATE/DELETE: solo el service_role (que bypassa RLS)
-- escribe, y nadie edita/borra → la foto es INMUTABLE (append-only por diseño).
