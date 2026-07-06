-- ─────────────────────────────────────────────────────────────────────────
--  0021 · JUEGOS PROMOCIONALES (raspaditas + quiniela).
--
--  ⚠️ RESTRICCIÓN LEGAL: en Uruguay el juego de azar por DINERO lo regula el
--  Estado (Dir. de Loterías y Quinielas). ESTO ES ESTRICTAMENTE PROMOCIONAL:
--  NO se juega con dinero, NO se paga premio en efectivo. Los premios son
--  BENEFICIOS simbólicos del préstamo. El resultado lo decide el SERVIDOR.
--
--  Ejecutar en el SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Raspaditas ─────────────────────────────────────────────────────────────
-- Catálogo de premios con PESO (probabilidad relativa), editable por el admin.
create table if not exists raspadita_premios (
  id     uuid primary key default gen_random_uuid(),
  label  text not null,
  tipo   text not null default 'beneficio' check (tipo in ('beneficio','nada')),
  peso   int  not null default 1 check (peso >= 0),  -- mayor peso = más chance
  activo boolean not null default true,
  orden  int not null default 0
);

-- Jugadas: registro inmutable de cada raspadita (server decide el premio).
create table if not exists raspaditas_jugadas (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references clientes(id) on delete cascade,
  premio_id    uuid references raspadita_premios(id),
  premio_label text not null,
  premio_tipo  text not null,
  jugado_en    timestamptz not null default now()
);
create index if not exists idx_raspaditas_cliente on raspaditas_jugadas (cliente_id);

-- ── Quiniela ───────────────────────────────────────────────────────────────
create table if not exists quinielas (
  id             uuid primary key default gen_random_uuid(),
  titulo         text not null,
  rango_min      int  not null default 0,
  rango_max      int  not null default 99,
  premio_texto   text not null,
  estado         text not null default 'abierta' check (estado in ('abierta','cerrada')),
  numero_ganador int,
  sorteo_en      timestamptz,
  creado_en      timestamptz not null default now()
);

create table if not exists quiniela_participaciones (
  id           uuid primary key default gen_random_uuid(),
  quiniela_id  uuid not null references quinielas(id) on delete cascade,
  cliente_id   uuid not null references clientes(id) on delete cascade,
  numero       int  not null,
  creado_en    timestamptz not null default now(),
  unique (quiniela_id, cliente_id)   -- una participación por cliente por quiniela
);
create index if not exists idx_quiniela_part on quiniela_participaciones (quiniela_id);

-- ── Seed de premios de raspadita (solo si está vacía) ──────────────────────
insert into raspadita_premios (label, tipo, peso, orden)
select * from (values
  ('¡Seguí participando!',      'nada',      60, 0),
  ('5% en tu próxima cuota',    'beneficio', 25, 1),
  ('1 día de gracia',           'beneficio', 12, 2),
  ('10% en tu próxima cuota',   'beneficio',  3, 3)
) as v(label, tipo, peso, orden)
where not exists (select 1 from raspadita_premios);

-- ── SEGURIDAD (RLS): gestores administran; el cliente juega por service_role ─
-- (Server Action que valida el token). Sin acceso anónimo.
alter table raspadita_premios       enable row level security;
alter table raspaditas_jugadas      enable row level security;
alter table quinielas               enable row level security;
alter table quiniela_participaciones enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'raspadita_premios','raspaditas_jugadas','quinielas','quiniela_participaciones'
  ] loop
    execute format('drop policy if exists %I_gestor_all on %I', t, t);
    -- Gestores: acceso total (leer + administrar/registrar sorteos).
    execute format(
      'create policy %I_gestor_all on %I for all to authenticated using (app_es_gestor()) with check (app_es_gestor())',
      t, t);
  end loop;
end $$;

-- El catálogo de premios lo pueden LEER los usuarios logueados (para la UI del
-- cliente si algún día usa RLS); el cliente real lo lee por service_role.
drop policy if exists raspadita_premios_select on raspadita_premios;
create policy raspadita_premios_select on raspadita_premios
  for select to authenticated using (true);
