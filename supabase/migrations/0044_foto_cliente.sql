-- ─────────────────────────────────────────────────────────────────────────
--  0044 · FOTO del cliente. El alta en calle (censo) debe llevar foto, y a los
--  clientes existentes se les puede agregar. Anti cliente-fantasma: una cara real
--  atada al alta. La imagen vive en Supabase Storage (bucket privado); en la
--  tabla guardamos solo la RUTA. Se lee con URL firmada de corta duración desde
--  el servidor (service_role). Ejecutar en SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────

-- Ruta de la foto en el bucket (null = sin foto). No guardamos la imagen en la BD.
alter table clientes add column if not exists foto_path text;

-- Bucket PRIVADO para las fotos (se leen con URL firmada del servidor).
insert into storage.buckets (id, name, public)
values ('clientes-fotos', 'clientes-fotos', false)
on conflict (id) do nothing;

-- Acceso: subida y lectura se hacen por SERVICE_ROLE (Server Actions), que salta
-- el RLS. Igual dejamos LECTURA a gestores autenticados por si se accede directo.
drop policy if exists clientes_fotos_lectura_gestor on storage.objects;
create policy clientes_fotos_lectura_gestor on storage.objects
  for select to authenticated
  using (bucket_id = 'clientes-fotos' and app_es_gestor());
