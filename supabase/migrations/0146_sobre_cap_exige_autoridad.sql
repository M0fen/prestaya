-- ─────────────────────────────────────────────────────────────────────────
--  0146 · El flag `p_permitir_sobre_cap` exige AUTORIDAD, no solo saber que existe.
--
--  HALLAZGO (sesión de caos, 15-08 — categoría "datos heredados", refutador):
--  la 0135 agregó el flag para que la aprobación del admin pudiera renovar los
--  heredados sobre-tope ($120.000…$1.750.000), y su comentario prometía "solo
--  lo pone en TRUE el camino de aprobación del admin" — pero eso era un
--  COMENTARIO, no un guard. La función es SECURITY INVOKER con EXECUTE a
--  authenticated: un SUPERVISOR logueado, por API directa (la anon key + su JWT
--  viven en el navegador), podía llamarla con p_permitir_sobre_cap=true y un
--  monto ARBITRARIO sobre cualquier crédito saldado de su zona — capital
--  sobre-CAP sin decisión de admin y sin que ningún test lo vigilara.
--
--  LA REGLA: el flag solo se honra desde una vía de CONFIANZA:
--    · service_role — las Server Actions escriben con él DESPUÉS de sus gates
--      de rol/techo/auditoría. ⚠️ Corrección (auditoría 16-08): la CALLE
--      (renovarDesdeCalle) siempre lo hizo; el PANEL (renovarCredito /
--      aprobarSolicitud) escribía con la sesión del gestor → un SUPERVISOR
--      legítimo moría en P0414. Desde e491d7f+ el panel usa service_role para
--      el sobre-CAP cuando el actor NO es admin (bajo el CAP: sesión, cinturón).
--    · un ADMIN logueado (app_rol()='admin') — puede lo mismo por API que por
--      pantalla; era la promesa original de 0135.
--  Cualquier otro caller autenticado con el flag → P0414 con mensaje claro.
--  Sin el flag, nada cambia: el tope sigue P0411 para todo el mundo.
--
--  Misma firma que 0135 → CREATE OR REPLACE (la función nunca queda ausente).
--  Re-ejecutable. Verificación al pie. Sellada por PG en
--  test/pg/renovar_credito_seguro.pg.test.ts (continuidad con flag crea;
--  supervisor por API con flag rebota P0414).
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.renovar_credito_seguro(
  p_prestamo_anterior_id uuid,
  p_cliente_id           uuid,
  p_monto                numeric,
  p_cuota                numeric,
  p_total_dias           integer,
  p_frecuencia           text,
  p_fecha_inicio         date,
  p_creado_por           uuid,
  p_permitir_sobre_cap   boolean default false
)
returns prestamos
language plpgsql
as $function$
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

  -- ⭐ 0146: el flag exige autoridad. Vías de confianza: service_role (las
  --    Server Actions, después de sus gates) o un admin logueado. Un supervisor
  --    o cobrador por API directa no autoriza sobre-tope por su cuenta.
  if coalesce(p_permitir_sobre_cap, false)
     and current_user in ('authenticated', 'anon')
     and not app_es_admin() then
    raise exception 'autorizar por encima del tope es del ADMIN (o del camino de aprobación de la app)'
      using errcode = 'P0414';
  end if;

  -- CAP total: duro para todos, SALVO autorización (ya validada arriba).
  if p_monto > 100000 and not coalesce(p_permitir_sobre_cap, false) then
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
$function$;

-- ── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- select proname, pronargs from pg_proc where proname='renovar_credito_seguro';
--   → 1 fila, pronargs = 9 (la firma no cambió)
-- select prosrc like '%P0414%' from pg_proc where proname='renovar_credito_seguro';
--   → true (el guard está en la base viva)
