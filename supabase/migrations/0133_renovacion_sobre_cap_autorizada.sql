-- ─────────────────────────────────────────────────────────────────────────
--  0133 · La renovación por encima del tope la puede AUTORIZAR el admin.
--  Ejecutar en el SQL Editor de Supabase. Re-ejecutable. Un solo cambio.
--
--  POR QUÉ (auditoría de la madrugada del 06-08, confirmada contra la base):
--  Decisión de Carlos: "cuando no se puedan renovar así directamente, se envía
--  a admin para que apruebe". La app ya lo hace — el cobrador manda la solicitud
--  y el admin la resuelve — PERO esta función tenía su propio tope duro
--  (`if p_monto > 100000 → P0411`) que no sabe nada de esa aprobación. El admin
--  tocaba "Aprobar" y le salía un rojo genérico. Para siempre.
--
--  Son los créditos heredados de Disapp que YA vienen por encima del tope (135
--  activos, hasta $1.750.000). Para ellos la única alternativa era renovar por
--  $100.000, o sea RECORTARLE EL CAPITAL al cliente en silencio.
--
--  Qué cambia: un parámetro nuevo, `p_permitir_sobre_cap`, que por defecto es
--  FALSE. Es decir: para todo el mundo el tope sigue siendo tan duro como antes.
--  Solo lo pone en TRUE el camino de aprobación del admin
--  (app/admin/(panel)/renovaciones/actions.ts → aprobarSolicitud), que ya exige
--  rol admin, y la decisión queda en auditoría con el monto a la vista.
--
--  Al aplicarla, el rodeo de TypeScript que hoy cubre esto (lib/data/renovaciones.ts,
--  "capAutorizado": ante P0411 con permiso cae al camino de 2 requests) queda
--  inerte por sí solo — la RPC ya no tira P0411 cuando hay autorización. No hay
--  que tocar código para desplegarla.
--
--  Se DROPEA y recrea porque agregar un parámetro cambia la firma y
--  CREATE OR REPLACE no puede hacerlo. Va en una transacción: o entra todo o
--  nada, y la función nunca queda ausente para la app.
--  Permisos: se replican EXACTAMENTE los que tiene hoy (verificados en pg_proc:
--  anon/authenticated/service_role con EXECUTE; owner postgres; SECURITY INVOKER).
-- ─────────────────────────────────────────────────────────────────────────

begin;

drop function if exists public.renovar_credito_seguro(
  uuid, uuid, numeric, numeric, integer, text, date, uuid
);

create function public.renovar_credito_seguro(
  p_prestamo_anterior_id uuid,
  p_cliente_id           uuid,
  p_monto                numeric,
  p_cuota                numeric,
  p_total_dias           integer,
  p_frecuencia           text,
  p_fecha_inicio         date,
  p_creado_por           uuid,
  -- ⚠️ Solo el camino de APROBACIÓN DEL ADMIN lo manda en true. Default false:
  --    sin él, el tope se comporta igual que siempre.
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

  -- CAP total: duro para todos, SALVO que un admin lo haya autorizado a mano.
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

grant execute on function public.renovar_credito_seguro(
  uuid, uuid, numeric, numeric, integer, text, date, uuid, boolean
) to anon, authenticated, service_role;

commit;

-- ── VERIFICACIÓN (pegar después y mirar el resultado) ──────────────────────
-- 1) Existe UNA sola función y ya tiene el parámetro nuevo:
--    select proname, pronargs, pg_get_function_identity_arguments(oid)
--      from pg_proc where proname = 'renovar_credito_seguro';
--    → esperado: 1 fila, pronargs = 9, terminando en "..., boolean"
--
-- 2) Los permisos quedaron como estaban:
--    select proacl::text from pg_proc where proname = 'renovar_credito_seguro';
--    → esperado: anon=X, authenticated=X, service_role=X
--
-- 3) El tope SIGUE duro sin autorización (tiene que dar error P0411):
--    select renovar_credito_seguro(
--      '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
--      200000, 1000, 40, 'diario', current_date, null);
--    → esperado: falla. Si dice "prestamo anterior ... inexistente" (P0002) está
--      MAL: significa que el chequeo del tope no se ejecutó. Si dice "no puede
--      superar 100000", perfecto.
