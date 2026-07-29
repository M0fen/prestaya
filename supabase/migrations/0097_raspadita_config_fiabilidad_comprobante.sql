-- ─────────────────────────────────────────────────────────────────────────
--  0097 · RASPADITA — Fase 1: gatillo configurable + tope + fiabilidad
--         (anti-farmeo concurrente) + comprobante verificable/compartible.
--
--  (A) CONFIG (ajustes_juego, fila única 0009): el admin elige CÓMO se gana una
--      raspadita y el TOPE de acumuladas.
--        · raspa_gatillo: 'pago' (una por cuota pagada, actual) | 'renovacion'
--          (una por crédito completado/renovado) | 'manual' (solo las que otorga
--          el admin).
--        · raspa_tope: máximo de raspaditas SIN jugar que se acumulan.
--
--  (B) OTORGADAS a mano (gatillo 'manual' o bono extra): el admin regala N
--      raspaditas a un cliente. Suma a las "ganadas". Inmutable + auditable.
--
--  (C) FIABILIDAD: `registrar_jugada_raspa_seguro` serializa la jugada con un
--      advisory lock por cliente y RE-CHEQUEA el cupo dentro de la transacción →
--      N jugadas concurrentes ya NO pueden farmear cupones no ganados (antes el
--      chequeo de "disponibles" y el insert eran TOCTOU, sin candado).
--
--  (D) COMPROBANTE: cada premio BENEFICIO recibe un FOLIO único (nº de serie) y
--      campos de canje (quién/cuándo) → el cliente muestra/comparte una prueba
--      verificable y el admin la valida y marca usada. (Los "nada" no llevan folio.)
--
--  Idempotente / re-ejecutable. Correr en el SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

-- ── (A) Config del gatillo + tope ──────────────────────────────────────────
alter table ajustes_juego add column if not exists raspa_gatillo text not null default 'pago';
alter table ajustes_juego drop constraint if exists ajustes_juego_raspa_gatillo_check;
alter table ajustes_juego add constraint ajustes_juego_raspa_gatillo_check
  check (raspa_gatillo in ('pago','renovacion','manual'));
alter table ajustes_juego add column if not exists raspa_tope int not null default 3;
alter table ajustes_juego drop constraint if exists ajustes_juego_raspa_tope_check;
alter table ajustes_juego add constraint ajustes_juego_raspa_tope_check
  check (raspa_tope between 0 and 50);

-- ── (B) Raspaditas OTORGADAS a mano (suman a las ganadas) ──────────────────
create table if not exists raspaditas_otorgadas (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references clientes(id) on delete cascade,
  cantidad     int  not null check (cantidad > 0 and cantidad <= 50),
  motivo       text,
  otorgado_por uuid references usuarios(id),
  otorgado_en  timestamptz not null default now()
);
create index if not exists idx_raspa_otorgadas_cliente on raspaditas_otorgadas (cliente_id);
alter table raspaditas_otorgadas enable row level security;
drop policy if exists raspa_otorgadas_select on raspaditas_otorgadas;
create policy raspa_otorgadas_select on raspaditas_otorgadas for select to authenticated
  using ( app_es_admin() or app_gestor_ve_cliente(cliente_id) );
drop policy if exists raspa_otorgadas_insert on raspaditas_otorgadas;
create policy raspa_otorgadas_insert on raspaditas_otorgadas for insert to authenticated
  with check ( app_es_gestor() );

-- ── (D) Comprobante: folio + canje en las jugadas ──────────────────────────
create sequence if not exists raspadita_folio_seq;
alter table raspaditas_jugadas add column if not exists folio       bigint;
alter table raspaditas_jugadas add column if not exists canjeado_en timestamptz;
alter table raspaditas_jugadas add column if not exists canjeado_por uuid references usuarios(id);
-- Un folio no se repite (los null no cuentan en un índice único).
create unique index if not exists uniq_raspa_folio on raspaditas_jugadas (folio) where folio is not null;

-- ── (C) Jugada ATÓMICA (advisory lock + re-cheque del cupo) ────────────────
--  p_ganadas = total de raspaditas GANADAS por el cliente hasta ahora (pagos /
--  renovaciones / otorgadas, según el gatillo — lo calcula la app). La jugada
--  entra solo si el cliente aún tiene cupo (jugadas < ganadas). El advisory lock
--  serializa las jugadas del MISMO cliente → sin farmeo por requests paralelos.
create or replace function registrar_jugada_raspa_seguro(
  p_cliente   uuid,
  p_premio_id uuid,
  p_label     text,
  p_tipo      text,
  p_ganadas   int
) returns table(id uuid, folio bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_jugadas int;
  v_folio   bigint := null;
  v_id      uuid;
begin
  perform pg_advisory_xact_lock(hashtext('raspa:' || p_cliente::text));
  select count(*) into v_jugadas from raspaditas_jugadas where cliente_id = p_cliente;
  if v_jugadas >= greatest(0, coalesce(p_ganadas, 0)) then
    raise exception 'sin_disponibles' using errcode = 'P0001';
  end if;
  if p_tipo = 'beneficio' then
    v_folio := nextval('raspadita_folio_seq');
  end if;
  insert into raspaditas_jugadas (cliente_id, premio_id, premio_label, premio_tipo, folio)
  values (p_cliente, p_premio_id, p_label, p_tipo, v_folio)
  returning raspaditas_jugadas.id into v_id;
  return query select v_id, v_folio;
end;
$$;
grant execute on function registrar_jugada_raspa_seguro(uuid, uuid, text, text, int) to authenticated, service_role;
