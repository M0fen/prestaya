-- ─────────────────────────────────────────────────────────────────────────
--  Presta Ya — REPORTES de discrepancia del cliente.
--  Ejecutar en el SQL Editor DESPUÉS de 0001–0003.
--
--  El cliente (vía link con token, sin login) puede avisar "pagué y no figura".
--  El insert lo hace el servidor con service_role (Server Action que valida el
--  token); por eso NO hay política de insert para `authenticated`. Los gestores
--  ven y gestionan los reportes.
--  Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists reportes (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references clientes(id),
  prestamo_id     uuid references prestamos(id),
  tipo            text not null default 'falta_pago'
                  check (tipo in ('falta_pago','otro')),
  -- Datos opcionales que el cliente puede aportar.
  dia_credito     int check (dia_credito is null or dia_credito >= 1),
  monto_reclamado numeric(12,2) check (monto_reclamado is null or monto_reclamado > 0),
  comentario      text,
  -- Flujo de atención por la oficina.
  estado          text not null default 'nuevo'
                  check (estado in ('nuevo','en_revision','resuelto','descartado')),
  creado_en       timestamptz not null default now(),
  atendido_por    uuid references usuarios(id),
  atendido_en     timestamptz
);

create index if not exists idx_reportes_estado  on reportes (estado, creado_en desc);
create index if not exists idx_reportes_cliente on reportes (cliente_id, creado_en desc);

alter table reportes enable row level security;

-- Gestores ven y atienden los reportes. (Sin insert/delete para authenticated:
-- los inserts entran por service_role desde el Server Action.)
drop policy if exists reportes_select on reportes;
drop policy if exists reportes_update on reportes;

create policy reportes_select on reportes for select to authenticated
  using ( app_es_gestor() );
create policy reportes_update on reportes for update to authenticated
  using ( app_es_gestor() ) with check ( app_es_gestor() );
