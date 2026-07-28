-- ─────────────────────────────────────────────────────────────────────────
-- 0088 — app_no_leidos acotado por fecha (badge del chat a prueba de escala).
--
-- app_no_leidos (0067) corre en CADA navegación de los dos layouts (admin y
-- cobrador). Su CTE materializaba TODOS los mensajes que no escribí yo (el WHERE
-- filtraba por autor, no por fecha) y recién el join externo descartaba los ya
-- leídos → a medida que el historial de chat crece para siempre, es un scan cada
-- vez más grande en cada carga de página.
--
-- Un mensaje sin leer de hace MESES es irrelevante para un badge de "nuevos": se
-- agrega una cota dura de 90 días al CTE. El scan pasa a tocar solo lo reciente
-- (los índices parciales por ámbito y idx_mensajes_creado ya cubren creado_en).
-- Único cambio de conducta: un no-leído de > 90 días deja de sumar al badge
-- (deseable). El resto es idéntico. security invoker: respeta el RLS del usuario.
--
-- El código cae al scan JS si la función no existe (funcionFaltante) → reversible:
-- volver a correr 0067 restaura la versión sin cota. Idempotente. Correr en SQL Editor.
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
    where m.autor_id <> app_usuario_id()          -- los míos no cuentan (RLS ya acota a mis canales)
      and m.creado_en > now() - interval '90 days' -- COTA: el badge solo mira lo reciente (evita el scan del historial)
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
