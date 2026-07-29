-- ─────────────────────────────────────────────────────────────────────────
-- 0108 — HARDENING de la superficie de DINERO (auditoría de lanzamiento 07-29).
--
-- Tema raíz: varias escrituras de plata NUEVAS son alcanzables por PostgREST
-- CRUDO por un INSIDER (cobrador/supervisor con su JWT + la anon key pública), y
-- las garantías (rol, precio server-side, CAP, gate saldado, montos honestos)
-- viven SOLO en el Server Action (TS). Esta migración las baja a la BD para que
-- el camino directo por API no las saltee. Todo money-crítico, cero regresión
-- para el camino honesto (que ya manda valores validados). Re-ejecutable.
--
-- (1) rendiciones: cerrar el INSERT crudo (un cobrador forjaba recaudado honesto
--     + gastos fantasma → "cuadra ✓" y se embolsaba el faltante COMPLETO sin
--     rastro). La única vía pasa a ser la action, que inserta con service_role.
-- (2) raspadita: revocar el EXECUTE a `authenticated` (la RPC es security definer
--     y confiaba en `p_ganadas` del llamador → cualquier logueado acuñaba folios
--     de "beneficio" ilimitados para cualquier cliente). Único caller legítimo:
--     service_role (la vista del cliente por token).
-- (3) venta de tienda: gate ADMIN dentro del RPC (era security invoker + grant a
--     authenticated → un supervisor colocaba capital con precio/cuota a mano,
--     salteando soloAdmin + kill-switch + precio server-side).
-- (4) renovación: re-chequear CAP $100.000 y "saldado" DENTRO del RPC (vivían solo
--     en TS → un gestor por API renovaba un crédito NO saldado = write-off
--     silencioso del saldo impago, o superaba el CAP, o fijaba cuota arbitraria).
-- (5) aperturas_caja: atar `entregada_por` al principal (integridad de atribución).
-- ─────────────────────────────────────────────────────────────────────────

-- ══ (1) rendiciones: el INSERT solo por service_role (la action) ═══════════════
-- Los montos (recaudado autoritativo de `pagos`, gastos capados a lo respaldado,
-- diferencia) los computa `cerrarJornada` server-side e inserta con service_role
-- (ver lib/data/rendicion.ts::crearRendicionDb). Un `authenticated` ya NO puede
-- insertar su rendición por REST con montos forjados. (El SELECT/DELETE no cambian.)
drop policy if exists rend_insert on rendiciones;
create policy rend_insert on rendiciones for insert to authenticated
  with check ( false );

-- ══ (2) raspadita: quitar el EXECUTE a authenticated (dejar solo service_role) ══
revoke execute on function registrar_jugada_raspa_seguro(uuid, uuid, text, text, int) from authenticated;
revoke execute on function registrar_jugada_raspa_pin(uuid, uuid, text, text, int)   from authenticated;

-- ══ (3) venta de tienda: gate ADMIN dentro del RPC ═════════════════════════════
-- CREATE OR REPLACE del cuerpo vigente (0106) + un gate `app_es_admin()` al inicio.
-- El resto del cuerpo es IDÉNTICO a 0106 (gate de stock antes del insert + CAP).
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
  -- GATE: colocar una venta de tienda es decisión EXCLUSIVA del admin (igual que
  -- la Server Action soloAdmin). Cierra el bypass por PostgREST de un supervisor.
  if not app_es_admin() then
    raise exception 'solo un administrador puede colocar una venta de tienda' using errcode = 'P0401';
  end if;

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

  -- STOCK bajo el row-lock del producto: descontar ANTES de insertar y ABORTAR si
  -- ya está agotado (dos conversiones concurrentes del mismo producto se serializan
  -- por el row-lock del UPDATE; la 2ª ve stock=0 y aborta → no sobrevende).
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

-- ══ (4) renovación: CAP + saldado DENTRO del RPC ═══════════════════════════════
-- CREATE OR REPLACE del cuerpo vigente (0087) + dos guardas de dinero. El camino
-- honesto (crearRenovacion) ya valida CAP y saldado, así que NUNCA las dispara;
-- solo cierran el bypass por API directa. Espeja las reglas de lib/renovacion.ts.
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

  -- CAP total DURO para TODOS (también por API directa). Espeja RENOVACION_CAP_TOTAL.
  if p_monto > 100000 then
    raise exception 'el crédito no puede superar 100000' using errcode = 'P0411';
  end if;
  -- SALDADO re-chequeado BAJO el lock: solo se renueva un crédito sin saldo cobrable
  -- (falta = cuota×días − pagado_acum < 1). Cierra el write-off silencioso por API
  -- (renovar un crédito con saldo impago lo finalizaría perdiendo ese cobro) y la
  -- carrera con una anulación concurrente. Espeja el gate `r.falta >= 1` de TS.
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
    total_dias, frecuencia, fecha_inicio, estado, creado_por
  ) values (
    p_cliente_id, v_ant.cobrador_id, p_monto, p_cuota,
    p_total_dias, p_frecuencia, p_fecha_inicio, 'activo', p_creado_por
  )
  returning * into v_new;

  return v_new;
end;
$$;

grant execute on function renovar_credito_seguro(uuid, uuid, numeric, numeric, int, text, date, uuid)
  to authenticated, service_role;

-- ══ (5) aperturas_caja: atar entregada_por al principal (atribución) ═══════════
-- Espeja movimientos_caja.registrado_por / solicitudes_gasto.solicitado_por: el
-- gestor no puede fijar `entregada_por` al id de OTRO (falsear quién dio la base).
drop policy if exists aperturas_insert on aperturas_caja;
create policy aperturas_insert on aperturas_caja for insert to authenticated
  with check ( app_gestor_ve_cobrador(cobrador_id) and entregada_por = app_usuario_id() );

drop policy if exists aperturas_update on aperturas_caja;
create policy aperturas_update on aperturas_caja for update to authenticated
  using ( app_gestor_ve_cobrador(cobrador_id) )
  with check ( app_gestor_ve_cobrador(cobrador_id) and entregada_por = app_usuario_id() );
