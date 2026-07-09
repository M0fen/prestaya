-- ─────────────────────────────────────────────────────────────────────────
--  0045 · RIFA para los mejores clientes. El admin arma una rifa: un banner con
--  mensaje configurable + una FOTO del premio con un botón "Ver premio". Se le
--  muestra al cliente en su vista (por token). Puede dirigirse SOLO a los mejores
--  clientes (calificación excelente/bueno). Ejecutar en SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists rifas (
  id            uuid primary key default gen_random_uuid(),
  titulo        text not null default 'Gran rifa',
  mensaje       text not null default '',
  premio_texto  text,
  boton_texto   text not null default 'Ver premio',
  -- Ruta de la foto del premio en el bucket PÚBLICO 'rifas'.
  foto_path     text,
  -- Si true, solo la ven los mejores clientes (calificación excelente/bueno).
  solo_mejores  boolean not null default true,
  activo        boolean not null default false,
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- Bucket PÚBLICO: la foto del premio es marketing (no es dato sensible) y la
-- carga el navegador del cliente sin login → URL pública directa.
insert into storage.buckets (id, name, public)
values ('rifas', 'rifas', true)
on conflict (id) do nothing;

-- La fila de la rifa la administran los GESTORES (la vista de cliente la lee por
-- service_role, así que no necesita policy anónima).
alter table rifas enable row level security;
drop policy if exists rifas_gestor_all on rifas;
create policy rifas_gestor_all on rifas
  for all to authenticated using (app_es_gestor()) with check (app_es_gestor());

-- Subir la foto del premio: por service_role (Server Action). Lectura pública del
-- bucket (para mostrar la imagen en la vista de cliente).
drop policy if exists rifas_foto_lectura_publica on storage.objects;
create policy rifas_foto_lectura_publica on storage.objects
  for select to public using (bucket_id = 'rifas');
