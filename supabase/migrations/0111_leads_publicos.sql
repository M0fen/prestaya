-- ─────────────────────────────────────────────────────────────────────────
-- 0111 — LEADS de la TIENDA PÚBLICA (/tienda). La tienda es visible para
-- CUALQUIERA (clientes, empleados, prospectos que aún no son clientes). Un
-- visitante que toca "Me interesa" no tiene token ni crédito, así que deja su
-- CONTACTO (nombre + teléfono) → prospecto a contactar/onboardear. Es distinto de
-- `solicitudes_producto` (que ata a un cliente EXISTENTE y convierte en crédito).
--
-- Escritura SOLO por service_role (la Server Action valida + rate-limita); lectura
-- para gestores (la bandeja del admin). No es dinero (es lead de marketing).
-- Re-ejecutable. La corre Carlos en el SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists leads_publicos (
  id              uuid primary key default gen_random_uuid(),
  producto_id     uuid references productos(id) on delete set null,
  producto_nombre text,                                  -- snapshot (por si se borra el producto)
  nombre          text not null,
  telefono        text not null,
  mensaje         text,
  estado          text not null default 'nuevo'
                  check (estado in ('nuevo', 'contactado', 'cerrado', 'descartado')),
  origen          text not null default 'tienda_publica',
  creado_en       timestamptz not null default now(),
  resuelto_por    uuid references usuarios(id),
  resuelto_en     timestamptz
);

create index if not exists idx_leads_publicos_estado on leads_publicos (estado, creado_en desc);

alter table leads_publicos enable row level security;

-- Los gestores LEEN la bandeja de prospectos. Nadie escribe/actualiza por REST: la
-- creación va por service_role (Server Action pública con validación + rate-limit) y
-- la resolución (contactado/cerrado) por una acción admin con service_role.
drop policy if exists leads_pub_select on leads_publicos;
create policy leads_pub_select on leads_publicos for select to authenticated
  using ( app_es_gestor() );
