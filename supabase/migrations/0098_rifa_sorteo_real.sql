-- ─────────────────────────────────────────────────────────────────────────
--  0098 · RIFA — de banner a SORTEO REAL: participación del cliente + ganador +
--         comprobante verificable.
--
--  (A) rifas: ciclo de sorteo (estado abierta/cerrada, ganador, nº ganador,
--      fecha de sorteo, folio del comprobante del ganador).
--  (B) rifa_participaciones: cada cliente participa UNA vez por rifa y recibe un
--      NÚMERO de ticket correlativo. unique(rifa,cliente) + unique(rifa,numero).
--  (C) participar_rifa_seguro: asigna el ticket de forma ATÓMICA (advisory lock)
--      → sin colisión de números ni doble-participación por requests paralelos.
--
--  La rifa "activa" es la más reciente (getRifa ya toma la última); al crear una
--  nueva rifa arranca una ronda nueva, y las viejas quedan como historial con su
--  ganador y sus participantes. Idempotente / re-ejecutable. Correr en SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

-- ── (A) Ciclo de sorteo en la rifa ─────────────────────────────────────────
alter table rifas add column if not exists estado text not null default 'abierta';
alter table rifas drop constraint if exists rifas_estado_check;
alter table rifas add constraint rifas_estado_check check (estado in ('abierta','cerrada'));
alter table rifas add column if not exists ganador_cliente_id uuid references clientes(id);
alter table rifas add column if not exists ganador_numero int;
alter table rifas add column if not exists sorteo_en timestamptz;
alter table rifas add column if not exists folio bigint;

-- ── (B) Participaciones (ticket por cliente) ───────────────────────────────
create table if not exists rifa_participaciones (
  id             uuid primary key default gen_random_uuid(),
  rifa_id        uuid not null references rifas(id) on delete cascade,
  cliente_id     uuid not null references clientes(id) on delete cascade,
  numero         int  not null,
  participado_en timestamptz not null default now(),
  unique (rifa_id, cliente_id),
  unique (rifa_id, numero)
);
create index if not exists idx_rifa_part_rifa on rifa_participaciones (rifa_id);
alter table rifa_participaciones enable row level security;
-- Lectura: el dueño ve todo; el supervisor, las de clientes de su zona. La ESCRITURA
-- la hace el cliente por Server Action con service_role (bypassa RLS) vía el RPC.
drop policy if exists rifa_part_select on rifa_participaciones;
create policy rifa_part_select on rifa_participaciones for select to authenticated
  using ( app_es_admin() or app_gestor_ve_cliente(cliente_id) );

create sequence if not exists rifa_folio_seq;

-- ── (C) Participar ATÓMICO (ticket correlativo, sin colisión) ──────────────
--  Idempotente: si el cliente ya participa, devuelve SU número. Si no, le asigna
--  el siguiente correlativo bajo advisory lock por rifa.
create or replace function participar_rifa_seguro(p_rifa uuid, p_cliente uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_num int;
begin
  perform pg_advisory_xact_lock(hashtext('rifa:' || p_rifa::text));
  select numero into v_num from rifa_participaciones where rifa_id = p_rifa and cliente_id = p_cliente;
  if found then return v_num; end if;
  select coalesce(max(numero), 0) + 1 into v_num from rifa_participaciones where rifa_id = p_rifa;
  insert into rifa_participaciones (rifa_id, cliente_id, numero) values (p_rifa, p_cliente, v_num);
  return v_num;
end;
$$;
grant execute on function participar_rifa_seguro(uuid, uuid) to authenticated, service_role;

-- ── (D) Cerrar la rifa con el ganador + folio del comprobante (atómico) ────
--  Idempotente: si la rifa ya está cerrada, devuelve el folio existente (no re-sortea).
create or replace function cerrar_rifa_seguro(p_rifa uuid, p_ganador uuid, p_numero int)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_folio bigint;
begin
  perform pg_advisory_xact_lock(hashtext('rifa:' || p_rifa::text));
  select folio into v_folio from rifas where id = p_rifa and estado = 'cerrada';
  if found then return v_folio; end if;
  v_folio := nextval('rifa_folio_seq');
  update rifas
     set estado = 'cerrada', ganador_cliente_id = p_ganador, ganador_numero = p_numero,
         sorteo_en = now(), folio = v_folio
   where id = p_rifa;
  return v_folio;
end;
$$;
grant execute on function cerrar_rifa_seguro(uuid, uuid, int) to authenticated, service_role;
