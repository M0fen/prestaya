-- ─────────────────────────────────────────────────────────────────────────
--  Presta Ya — CHAT en vivo (Realtime) + cuerpo cifrado.
--  Ejecutar en el SQL Editor DESPUÉS de 0007. Re-ejecutable.
--
--  1) El cuerpo de `mensajes` ahora se guarda CIFRADO (AES-256-GCM, ver
--     lib/cripto.ts). El texto cifrado (base64) es más largo que el plano, así
--     que se relaja el límite de longitud de la columna. El tope real de 2000
--     caracteres del texto lo valida la Server Action antes de cifrar.
--  2) Se publica `mensajes` para las suscripciones en vivo (Supabase Realtime).
--     El RLS de 0007 sigue aplicando: cada quien recibe solo lo que puede ver.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Longitud: dar lugar al texto cifrado.
alter table mensajes drop constraint if exists mensajes_cuerpo_check;
alter table mensajes add constraint mensajes_cuerpo_len
  check (length(btrim(cuerpo)) between 1 and 16000);

-- 2) Realtime: publicar la tabla (idempotente).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mensajes'
  ) then
    execute 'alter publication supabase_realtime add table mensajes';
  end if;
end $$;
