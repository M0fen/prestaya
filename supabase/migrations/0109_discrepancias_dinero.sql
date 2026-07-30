-- ─────────────────────────────────────────────────────────────────────────
-- 0109 — RESOLVER DISCREPANCIA (break-management de la reconciliación).
--
-- Hasta hoy el panel /admin/empalme DETECTA divergencias de dinero (sobre-cobro
-- material, saldo≠libro) pero es SOLO-LECTURA: el admin puede mirar, no CERRAR.
-- Un hallazgo material (ej. crédito con +$6.900) quedaba ahí para siempre sin
-- workflow ni traza de "esto ya lo revisé / lo acepté como baseline / lo resolví".
--
-- Esta tabla es el TRIAGE por crédito: NO es la verdad del dinero (esa vive en
-- `pagos`, inmutable) — es la anotación humana del estado de cada divergencia
-- detectada. Una fila por crédito (se actualiza). Money-adyacente: solo ADMIN
-- (el panel ya es admin-only). La corre Carlos en el SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists discrepancias_dinero (
  id               uuid primary key default gen_random_uuid(),
  credito_id       uuid not null references prestamos(id),
  -- Snapshot del hallazgo al abrir el triage (para trazar QUÉ se vio, aunque el
  -- número cambie después). No es autoritativo: la verdad se recalcula del libro.
  tipo             text,                         -- 'drift' | 'sobrecobro'
  monto_diferencia numeric(14,2),
  estado           text not null default 'abierto'
                   check (estado in ('abierto','en_progreso','resuelto','aceptado')),
  nota             text,
  abierto_por      uuid references usuarios(id),
  abierto_en       timestamptz not null default now(),
  resuelto_por     uuid references usuarios(id),
  resuelto_en      timestamptz,
  actualizado_en   timestamptz not null default now(),
  -- Un solo triage por crédito (se actualiza el estado/nota; el historial fino
  -- queda en la auditoría, que registra cada cambio con quién/cuándo).
  unique (credito_id)
);

create index if not exists idx_discrepancias_estado on discrepancias_dinero (estado, actualizado_en desc);

drop trigger if exists trg_discrepancias_actualizado on discrepancias_dinero;
create trigger trg_discrepancias_actualizado
  before update on discrepancias_dinero
  for each row execute function set_actualizado_en();

-- ── RLS: solo ADMIN (el panel de empalme ya es admin-only) ─────────────────
alter table discrepancias_dinero enable row level security;

drop policy if exists discrepancias_select on discrepancias_dinero;
create policy discrepancias_select on discrepancias_dinero for select to authenticated
  using ( app_es_admin() );

drop policy if exists discrepancias_insert on discrepancias_dinero;
create policy discrepancias_insert on discrepancias_dinero for insert to authenticated
  with check ( app_es_admin() and abierto_por = app_usuario_id() );

drop policy if exists discrepancias_update on discrepancias_dinero;
create policy discrepancias_update on discrepancias_dinero for update to authenticated
  using ( app_es_admin() ) with check ( app_es_admin() );
