-- ─────────────────────────────────────────────────────────────────────────
--  0067 — Conteo de no-leídos del chat en SQL (badge del nav) + índice de uso.
--  Auditoría Senior 2026-07-11: getTotalNoLeidos/getCanales traían hasta 1000
--  filas de `mensajes` y bucketizaban en JS, en CADA navegación de AMBOS layouts.
--  Esta RPC agregada devuelve O(#canales) filas (un conteo por canal) usando los
--  índices parciales por ámbito. SECURITY INVOKER → respeta el RLS del usuario
--  (solo cuenta los canales que ve). El código cae al scan JS si esta función no
--  existe (funcionFaltante), así que es 100% reversible: drop function y listo.
--  Idempotente. Correr por el SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function app_no_leidos()
returns table (canal text, n bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with k as (
    select
      case
        when m.ambito = 'cobrador' and m.cobrador_id is not null then 'cob:'  || m.cobrador_id::text
        when m.ambito = 'zona'     and m.zona_id     is not null then 'zona:' || m.zona_id::text
        when m.ambito = 'supervisores'                            then 'supervisores'
        else 'general'
      end as canal,
      m.creado_en
    from mensajes m
    where m.autor_id <> app_usuario_id()   -- los míos no cuentan (RLS ya acota a mis canales)
  )
  select
    k.canal,
    count(*)::bigint as n
  from k
  left join chat_lecturas l
    on l.usuario_id = app_usuario_id() and l.canal = k.canal
  where k.creado_en > coalesce(l.ultima_lectura, 'epoch'::timestamptz)
  group by k.canal;
$$;

grant execute on function app_no_leidos() to authenticated;

-- Telemetría de uso (0064): la lectura de /admin/uso filtra por creado_en; índice
-- para que no sea un scan a medida que la tabla crece.
create index if not exists idx_eventos_uso_creado on eventos_uso (creado_en desc);
analyze eventos_uso;
