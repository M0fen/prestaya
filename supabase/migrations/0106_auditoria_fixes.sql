-- ─────────────────────────────────────────────────────────────────────────
-- 0106 — Arreglos de la auditoría money (sesión 07-29). Dos RPC:
--
--  (1) crear_credito_venta_seguro: CIERRA la SOBREVENTA de stock por concurrencia.
--      El advisory lock es por-LEAD (no serializa dos leads del MISMO producto), así
--      que dos conversiones casi simultáneas de un producto con stock=1 creaban DOS
--      créditos. Ahora, si el producto controla stock, se descuenta ANTES de insertar
--      el crédito (bajo el row-lock del producto) y se ABORTA si ya está agotado →
--      la 2ª venta falla limpio (P0409) en vez de sobrevender. + defensa en profundidad:
--      re-chequea el CAP $100.000 dentro de la RPC (P0403).
--
--  (2) registrar_jugada_raspa_pin: ahora DEVUELVE el label/tipo REALMENTE entregado
--      (el del premio FIJADO cuando aplica), no solo (id, folio). Antes el cliente veía
--      el resultado del AZAR aunque la BD guardaba el premio fijado → comprobante/folio
--      desincronizados. Cambia el tipo de retorno → drop + create.
--
-- Idempotente / re-ejecutable. Correr en el SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

-- ── (1) Venta de tienda: gate de stock + CAP en la RPC ─────────────────────
create or replace function crear_credito_venta_seguro(
  p_solicitud_id     uuid,
  p_cliente_id       uuid,
  p_cobrador_id      uuid,
  p_monto            numeric,
  p_cuota            numeric,
  p_total_dias       int,
  p_frecuencia       text,
  p_fecha_inicio     date,
  p_producto_id      uuid,
  p_producto_nombre  text,
  p_op_id            uuid,
  p_creado_por       uuid
) returns prestamos
language plpgsql
as $$
declare
  v_sol   solicitudes_producto;
  v_new   prestamos;
  v_stock int;
  v_upd   int;
begin
  perform pg_advisory_xact_lock(hashtext(p_solicitud_id::text));

  select * into v_sol from solicitudes_producto where id = p_solicitud_id;
  if not found then
    raise exception 'lead % inexistente', p_solicitud_id using errcode = 'P0002';
  end if;
  if v_sol.cliente_id <> p_cliente_id then
    raise exception 'el lead no pertenece al cliente' using errcode = 'P0001';
  end if;

  -- Idempotente: si ya se convirtió, devolver el crédito existente (no crear otro).
  if v_sol.estado = 'convertida' and v_sol.prestamo_id is not null then
    select * into v_new from prestamos where id = v_sol.prestamo_id;
    return v_new;
  end if;
  if v_sol.estado not in ('nueva', 'contactado') then
    raise exception 'el lead no está abierto (estado %)', v_sol.estado using errcode = 'P0410';
  end if;

  -- Defensa en profundidad: CAP total (el TS ya lo valida; la RPC es la última puerta).
  if p_monto > 100000 then
    raise exception 'el crédito supera el tope de 100000' using errcode = 'P0403';
  end if;

  -- STOCK bajo el row-lock del producto: si el producto controla stock, descontar
  -- ANTES de insertar el crédito y ABORTAR si ya está agotado. Dos conversiones
  -- concurrentes de leads distintos del MISMO producto se serializan por el row-lock
  -- del UPDATE: la 2ª ve stock=0, no descuenta ninguna fila y aborta (no sobrevende).
  if p_producto_id is not null then
    select stock into v_stock from productos where id = p_producto_id;
    if v_stock is not null then
      update productos set stock = stock - 1 where id = p_producto_id and stock > 0;
      get diagnostics v_upd = row_count;
      if v_upd = 0 then
        raise exception 'producto sin stock' using errcode = 'P0409';
      end if;
    end if;
  end if;

  insert into prestamos (
    cliente_id, cobrador_id, monto_prestado, cuota_diaria,
    total_dias, frecuencia, fecha_inicio, estado, creado_por,
    origen, producto_id, producto_nombre, op_id
  ) values (
    p_cliente_id, p_cobrador_id, p_monto, p_cuota,
    p_total_dias, p_frecuencia, p_fecha_inicio, 'activo', p_creado_por,
    'tienda', p_producto_id, p_producto_nombre, p_op_id
  )
  returning * into v_new;

  update solicitudes_producto
     set estado = 'convertida', prestamo_id = v_new.id,
         resuelto_por = p_creado_por, resuelto_en = now()
   where id = p_solicitud_id;

  return v_new;
end;
$$;

grant execute on function crear_credito_venta_seguro(
  uuid, uuid, uuid, numeric, numeric, int, text, date, uuid, text, uuid, uuid
) to authenticated, service_role;

-- ── (2) Raspadita: la RPC del pin devuelve el premio realmente entregado ───
drop function if exists registrar_jugada_raspa_pin(uuid, uuid, text, text, int);
create function registrar_jugada_raspa_pin(
  p_cliente   uuid,
  p_premio_id uuid,
  p_label     text,
  p_tipo      text,
  p_ganadas   int
) returns table(id uuid, folio bigint, premio_label text, premio_tipo text)
language plpgsql security definer set search_path = public as $$
declare
  v_jugadas    int;
  v_folio      bigint := null;
  v_id         uuid;
  v_ot_id      uuid := null;
  v_pin_premio uuid := null;
  v_premio_id  uuid := p_premio_id;
  v_label      text := p_label;
  v_tipo       text := p_tipo;
begin
  perform pg_advisory_xact_lock(hashtext('raspa:' || p_cliente::text));

  select count(*) into v_jugadas from raspaditas_jugadas where cliente_id = p_cliente;
  if v_jugadas >= greatest(0, coalesce(p_ganadas, 0)) then
    raise exception 'sin_disponibles' using errcode = 'P0001';
  end if;

  select o.id, o.premio_id into v_ot_id, v_pin_premio
    from raspaditas_otorgadas o
   where o.cliente_id = p_cliente
     and o.premio_id is not null
     and o.cantidad > (select count(*) from raspaditas_jugadas j where j.otorgada_id = o.id)
   order by o.otorgado_en asc, o.id asc
   limit 1;

  if v_ot_id is not null then
    select pr.label, pr.tipo into v_label, v_tipo from raspadita_premios pr where pr.id = v_pin_premio;
    if v_label is null then
      v_ot_id := null;
      v_premio_id := p_premio_id; v_label := p_label; v_tipo := p_tipo;
    else
      v_premio_id := v_pin_premio;
    end if;
  end if;

  if v_tipo = 'beneficio' then
    v_folio := nextval('raspadita_folio_seq');
  end if;

  insert into raspaditas_jugadas (cliente_id, premio_id, premio_label, premio_tipo, folio, otorgada_id)
  values (p_cliente, v_premio_id, v_label, v_tipo, v_folio, v_ot_id)
  returning raspaditas_jugadas.id into v_id;

  -- Devuelve el premio EFECTIVAMENTE entregado (label/tipo del pin cuando aplica) para
  -- que la vista del cliente y el comprobante coincidan con lo guardado.
  return query select v_id, v_folio, v_label, v_tipo;
end;
$$;

grant execute on function registrar_jugada_raspa_pin(uuid, uuid, text, text, int) to authenticated, service_role;
