-- ─────────────────────────────────────────────────────────────────────────
-- 0116 — LINAJE de renovaciones (Tanda 6). Hoy el crédito nuevo NO apunta al que
-- renovó: un crédito 'finalizado' por renovación es indistinguible de uno pagado.
-- Se agrega `prestamos.renovado_de` → id del crédito anterior, para rastrear la
-- CADENA de renovaciones de un cliente. No cambia el dinero (solo trazabilidad).
--
-- Decisión de Carlos: el SALDO VIEJO sigue BLOQUEADO (se renueva solo si el
-- anterior está saldado) — no se toca esa regla.
-- ─────────────────────────────────────────────────────────────────────────

alter table prestamos add column if not exists renovado_de uuid references prestamos(id);
comment on column prestamos.renovado_de is 'Crédito anterior que este renovó (linaje de renovación, 0116). null = no vino de renovación.';
create index if not exists idx_prestamos_renovado_de on prestamos (renovado_de) where renovado_de is not null;

-- El RPC atómico ahora setea `renovado_de` (ya recibe el id del anterior; no cambia la firma).
create or replace function renovar_credito_seguro(
  p_prestamo_anterior_id uuid,
  p_cliente_id           uuid,
  p_monto                numeric,
  p_cuota                numeric,
  p_total_dias           int,
  p_frecuencia           text,
  p_fecha_inicio         date,
  p_creado_por           uuid
) returns prestamos
language plpgsql
as $$
declare
  v_ant  prestamos;
  v_new  prestamos;
  v_upd  int;
begin
  perform pg_advisory_xact_lock(hashtext(p_prestamo_anterior_id::text));

  select * into v_ant from prestamos where id = p_prestamo_anterior_id;
  if not found then
    raise exception 'prestamo anterior % inexistente', p_prestamo_anterior_id using errcode = 'P0002';
  end if;
  if v_ant.cliente_id <> p_cliente_id then
    raise exception 'el crédito anterior no pertenece al cliente' using errcode = 'P0001';
  end if;

  if p_monto > 100000 then
    raise exception 'el crédito no puede superar 100000' using errcode = 'P0411';
  end if;
  -- SALDADO re-chequeado bajo el lock (regla de saldo viejo intacta).
  if coalesce(v_ant.cuota_diaria, 0) * coalesce(v_ant.total_dias, 0)
     - coalesce(v_ant.pagado_acum, 0) >= 1 then
    raise exception 'el crédito anterior todavía no está saldado' using errcode = 'P0412';
  end if;

  update prestamos
     set estado = 'finalizado', finalizado_en = now()
   where id = p_prestamo_anterior_id
     and estado = 'activo';
  get diagnostics v_upd = row_count;
  if v_upd = 0 then
    raise exception 'el crédito anterior ya no está activo' using errcode = 'P0410';
  end if;

  insert into prestamos (
    cliente_id, cobrador_id, monto_prestado, cuota_diaria,
    total_dias, frecuencia, fecha_inicio, estado, creado_por, renovado_de
  ) values (
    p_cliente_id, v_ant.cobrador_id, p_monto, p_cuota,
    p_total_dias, p_frecuencia, p_fecha_inicio, 'activo', p_creado_por, p_prestamo_anterior_id
  )
  returning * into v_new;

  return v_new;
end;
$$;

grant execute on function renovar_credito_seguro(uuid, uuid, numeric, numeric, int, text, date, uuid)
  to authenticated, service_role;

-- Backfill del linaje histórico desde las solicitudes que dejaron el vínculo.
update prestamos p
   set renovado_de = s.prestamo_anterior_id
  from solicitudes_renovacion s
 where s.prestamo_nuevo_id = p.id
   and s.prestamo_anterior_id is not null
   and p.renovado_de is null;
