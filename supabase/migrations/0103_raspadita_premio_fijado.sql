-- ─────────────────────────────────────────────────────────────────────────
-- 0103 — RASPADITA: PREMIO FIJADO por persona.
--
-- El admin puede, al REGALAR una raspadita a alguien (0097 raspaditas_otorgadas),
-- FIJAR qué premio le va a tocar cuando la juegue (en vez del azar por scoring).
-- Es promocional (beneficio simbólico, nunca dinero) y lo decide el SERVIDOR: el
-- cliente sigue sin poder elegir; solo cambia que, si hay un premio fijado
-- pendiente, la próxima jugada lo entrega SÍ o SÍ (garantiza el gesto del dueño).
--
-- Piezas:
--  · raspaditas_otorgadas.premio_id → el premio fijado (null = azar, como hoy).
--  · raspaditas_jugadas.otorgada_id → qué "regalo fijado" consumió esa jugada
--    (para no entregar dos veces el mismo pin, contando FIFO).
--  · registrar_jugada_raspa_pin → RPC ATÓMICO (mismo advisory lock + re-cheque de
--    cupo que 0097) que, ANTES del azar, busca el premio fijado pendiente más
--    viejo (FIFO) y lo entrega; si no hay, usa el premio ALEATORIO que calculó la
--    app. Todo bajo el lock → sin doble-consumo por jugadas concurrentes.
--
-- El RPC viejo (registrar_jugada_raspa_seguro, 0097) sigue existiendo: la app usa
-- el nuevo y cae al viejo si esta migración aún no corrió (degradación elegante).
-- Idempotente / re-ejecutable. Correr en el SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

alter table raspaditas_otorgadas add column if not exists premio_id uuid references raspadita_premios(id) on delete set null;
alter table raspaditas_jugadas   add column if not exists otorgada_id uuid references raspaditas_otorgadas(id) on delete set null;
create index if not exists idx_raspa_jugadas_otorgada on raspaditas_jugadas (otorgada_id) where otorgada_id is not null;

create or replace function registrar_jugada_raspa_pin(
  p_cliente   uuid,
  p_premio_id uuid,   -- premio ALEATORIO calculado por la app (fallback si no hay pin)
  p_label     text,
  p_tipo      text,
  p_ganadas   int
) returns table(id uuid, folio bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_jugadas    int;
  v_folio      bigint := null;
  v_id         uuid;
  v_ot_id      uuid := null;   -- otorgada fijada que se consume (si hay)
  v_pin_premio uuid := null;
  v_premio_id  uuid := p_premio_id;
  v_label      text := p_label;
  v_tipo       text := p_tipo;
begin
  -- Serializa las jugadas del MISMO cliente (igual que 0097): sin farmeo ni
  -- doble-consumo del premio fijado por requests paralelos.
  perform pg_advisory_xact_lock(hashtext('raspa:' || p_cliente::text));

  -- Re-cheque del cupo dentro de la transacción (jugadas < ganadas).
  select count(*) into v_jugadas from raspaditas_jugadas where cliente_id = p_cliente;
  if v_jugadas >= greatest(0, coalesce(p_ganadas, 0)) then
    raise exception 'sin_disponibles' using errcode = 'P0001';
  end if;

  -- ¿Hay un PREMIO FIJADO pendiente? (otorgada con premio_id cuya cantidad aún no
  -- fue consumida del todo por jugadas ligadas a ella). El más viejo primero (FIFO).
  select o.id, o.premio_id into v_ot_id, v_pin_premio
    from raspaditas_otorgadas o
   where o.cliente_id = p_cliente
     and o.premio_id is not null
     and o.cantidad > (select count(*) from raspaditas_jugadas j where j.otorgada_id = o.id)
   order by o.otorgado_en asc, o.id asc
   limit 1;

  if v_ot_id is not null then
    -- Premio fijado por el admin: resolver su label/tipo del catálogo.
    select pr.label, pr.tipo into v_label, v_tipo from raspadita_premios pr where pr.id = v_pin_premio;
    if v_label is null then
      -- El premio fijado ya no existe → caer al aleatorio (no romper la jugada).
      v_ot_id := null;
      v_premio_id := p_premio_id; v_label := p_label; v_tipo := p_tipo;
    else
      v_premio_id := v_pin_premio;
    end if;
  end if;

  -- Folio (comprobante) solo para beneficios (los "nada" no llevan).
  if v_tipo = 'beneficio' then
    v_folio := nextval('raspadita_folio_seq');
  end if;

  insert into raspaditas_jugadas (cliente_id, premio_id, premio_label, premio_tipo, folio, otorgada_id)
  values (p_cliente, v_premio_id, v_label, v_tipo, v_folio, v_ot_id)
  returning raspaditas_jugadas.id into v_id;

  return query select v_id, v_folio;
end;
$$;

grant execute on function registrar_jugada_raspa_pin(uuid, uuid, text, text, int) to authenticated, service_role;
