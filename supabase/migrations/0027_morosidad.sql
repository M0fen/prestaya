-- ─────────────────────────────────────────────────────────────────────────
--  0027 · MOROSIDAD (lista negra interna + notas de mora). Uso admin/supervisor.
--  · Marca PERSISTENTE de moroso por cliente (queda entre créditos): sirve para
--    avisar antes de dar/renovar un crédito (anti-fraude/anti-fuga).
--  · Bitácora de MOTIVOS y ACUERDOS de pago por cliente (por qué se atrasó, qué
--    se acordó), con historial.
--  Todo interno (no se le muestra al cliente). Ejecutar en el SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────

-- Marca de moroso en el cliente (persiste entre créditos).
alter table clientes add column if not exists moroso        boolean not null default false;
alter table clientes add column if not exists moroso_motivo text;
alter table clientes add column if not exists moroso_desde  timestamptz;
alter table clientes add column if not exists moroso_por    uuid references usuarios(id);

-- Bitácora de motivos/acuerdos de mora (historial por cliente).
create table if not exists mora_notas (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references clientes(id) on delete cascade,
  tipo         text not null default 'nota' check (tipo in ('motivo','acuerdo','nota')),
  texto        text not null,
  autor_id     uuid references usuarios(id),
  autor_nombre text,
  creado_en    timestamptz not null default now()
);

create index if not exists mora_notas_cliente on mora_notas(cliente_id, creado_en desc);

alter table mora_notas enable row level security;

drop policy if exists mora_notas_select on mora_notas;
drop policy if exists mora_notas_write on mora_notas;

-- Solo gestores ven y escriben las notas de mora.
create policy mora_notas_select on mora_notas for select to authenticated
  using ( app_es_gestor() );
create policy mora_notas_write on mora_notas for all to authenticated
  using ( app_es_gestor() ) with check ( app_es_gestor() );
