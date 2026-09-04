-- ─────────────────────────────────────────────────────────────────────────
--  0153 · REASIGNAR UN CLIENTE, ATÓMICO
--
--  EL PROBLEMA. `reasignarCliente` hace TRES escrituras sueltas por PostgREST y
--  no hay forma de envolverlas en una transacción desde el cliente: cada request
--  es su propia transacción. De esas tres depende la coherencia entre las tres
--  verdades del sistema —la RUTA (`asignaciones`), la PLATA
--  (`prestamos.cobrador_id`) y la CUSTODIA (`pagos.registrado_por`)— y hoy están
--  de acuerdo sin ninguna FK ni trigger que lo garantice: lo sostiene el orden en
--  que ese código escribe.
--
--  El fallo parcial más caro es que se mueva la asignación y NO el dueño del
--  crédito: el crédito queda invisible en LAS DOS rutas (al nuevo se lo saca el
--  filtro de "crédito ajeno", y el viejo ya no tiene asignación). Es plata viva
--  que nadie sale a cobrar — el "cliente fantasma" que ya costó 46 créditos y
--  $634.666 en la auditoría del 08-02.
--
--  LA REGLA DE NEGOCIO, ahora en el motor y no en la pantalla: nunca se le sacan
--  a un tercero créditos que está cobrando. Antes el UPDATE barría TODOS los
--  créditos activos del cliente sin mirar de quién eran (bug de los $5,6M del
--  10-08; hoy: 60 clientes, 187 créditos, $7.925.265) y el paso 2 le bajaba la
--  asignación, dejándolo con plata en la calle y sin el cliente en su ruta.
--
--  SECURITY INVOKER (el default) A PROPÓSITO: corre con los permisos de quien
--  llama, así que la RLS sigue decidiendo quién puede mover a quién. Esta función
--  da atomicidad, no autoridad.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function reasignar_cliente_seguro(
  p_cliente_id          uuid,
  p_nuevo_cobrador_id   uuid,
  p_solo_prestamo_id    uuid default null,
  p_cobrador_origen_id  uuid default null
) returns void
language plpgsql
as $$
declare
  v_ajenos      uuid[];
  v_origen      uuid;
  v_intocables  uuid[];
  v_movidos     int;
  v_activos     int;
begin
  -- Serializa por CLIENTE: dos reasignaciones simultáneas del mismo cliente no
  -- se pisan (y con el lock, lo que se lee abajo no cambia bajo los pies).
  perform pg_advisory_xact_lock(hashtext(p_cliente_id::text));

  -- Dueños de créditos VIVOS que no son el destino.
  select array_agg(distinct cobrador_id)
    into v_ajenos
    from prestamos
   where cliente_id = p_cliente_id
     and estado = 'activo'
     and cobrador_id is not null
     and cobrador_id <> p_nuevo_cobrador_id;

  -- Con un solo dueño no hay nada que adivinar: ese es el origen.
  v_origen := coalesce(
    p_cobrador_origen_id,
    case when coalesce(array_length(v_ajenos, 1), 0) = 1 then v_ajenos[1] end
  );

  -- AMBIGÜEDAD = SE FRENA. Si hay créditos vivos de varios cobradores y nadie
  -- dijo a cuál se le saca, cualquier elección le quita plata a alguien.
  if p_solo_prestamo_id is null
     and v_origen is null
     and coalesce(array_length(v_ajenos, 1), 0) > 1 then
    raise exception 'el cliente tiene créditos vivos de varios cobradores: hay que decir a cuál se le reasigna'
      using errcode = 'P0417';
  end if;

  -- 1) SUBE la nueva asignación. Antes que nada: el peor caso tolerable es que el
  --    cliente quede un instante en dos rutas, nunca en ninguna.
  insert into asignaciones (cobrador_id, cliente_id, activo)
  values (p_nuevo_cobrador_id, p_cliente_id, true)
  on conflict (cobrador_id, cliente_id) do update set activo = true;

  -- 2) Los INTOCABLES: cobradores con un crédito vivo de este cliente a los que
  --    no se les está sacando nada. Su asignación no se toca.
  select array_agg(distinct cobrador_id)
    into v_intocables
    from prestamos
   where cliente_id = p_cliente_id
     and estado = 'activo'
     and cobrador_id is not null
     and cobrador_id <> p_nuevo_cobrador_id
     and case
           when p_solo_prestamo_id is not null then id <> p_solo_prestamo_id
           else cobrador_id is distinct from v_origen
         end;

  update asignaciones
     set activo = false
   where cliente_id = p_cliente_id
     and activo
     and cobrador_id <> p_nuevo_cobrador_id
     and not (cobrador_id = any(coalesce(v_intocables, '{}'::uuid[])));

  -- 3) El DUEÑO de los créditos activos — la fuente de verdad de la comisión.
  update prestamos
     set cobrador_id = p_nuevo_cobrador_id
   where cliente_id = p_cliente_id
     and estado = 'activo'
     and (p_solo_prestamo_id is null or id = p_solo_prestamo_id)
     and (p_solo_prestamo_id is not null or v_origen is null or cobrador_id = v_origen);
  get diagnostics v_movidos = row_count;

  -- Un UPDATE que no matchea filas bajo RLS no es un error: vuelve vacío y en
  -- silencio. Si el cliente tiene créditos activos y ninguno se movió, la ruta
  -- cambiaría con la comisión apuntando al cobrador viejo. Se aborta TODO — que
  -- es la diferencia con el camino de tres requests, donde eso quedaba a medias.
  select count(*) into v_activos
    from prestamos where cliente_id = p_cliente_id and estado = 'activo';
  if v_movidos = 0 and v_activos > 0 then
    raise exception 'la ruta se cambió pero no se pudo mover el dueño de los créditos activos'
      using errcode = 'P0418';
  end if;
end;
$$;

comment on function reasignar_cliente_seguro(uuid, uuid, uuid, uuid) is
  'Reasigna un cliente en UNA transacción: sube la asignación nueva, baja las que '
  'corresponde (nunca la de un cobrador con crédito vivo al que no se le saca nada) '
  'y mueve el dueño de los créditos del cobrador de origen. Si algo falla, no queda '
  'nada a medias. SECURITY INVOKER: la RLS sigue decidiendo quién puede.';
