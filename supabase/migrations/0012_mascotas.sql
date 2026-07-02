-- ─────────────────────────────────────────────────────────────────────────
--  0012 · Mascota (tamagotchi) de la vista de cliente.
--  Guarda la elección de mascota y el "cariño" (vínculo afectivo del cuidado).
--  El CRECIMIENTO (nivel/etapa) NO se guarda: se deriva de los pagos reales.
--  Lecturas/escrituras van por service_role (vista por token + server action),
--  así que RLS queda cerrado salvo lectura para gestores.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.mascotas (
  cliente_id         uuid primary key references public.clientes(id) on delete cascade,
  especie            text        not null default 'kiwi',
  nombre             text        not null default '',
  accesorio          text        not null default 'ninguno',
  carino             int         not null default 60 check (carino between 0 and 100),
  ultima_interaccion timestamptz,
  actualizado_en     timestamptz not null default now()
);

alter table public.mascotas enable row level security;

-- Gestores (admin/supervisor) pueden ver las mascotas (curiosidad/soporte).
-- El resto del acceso es por service_role, que ignora RLS.
drop policy if exists "mascotas_select_gestor" on public.mascotas;
create policy "mascotas_select_gestor" on public.mascotas
  for select using (app_es_gestor());
