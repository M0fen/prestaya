-- ─────────────────────────────────────────────────────────────────────────
-- 0087 — renovar_credito_seguro: renovación ATÓMICA (cierra la ventana de
--        "cliente sin crédito activo" y la de compensación fallida).
--
-- crearRenovacion hacía DOS requests separados: (1) finalizar el crédito anterior
-- y (2) insertar el nuevo. NO era una transacción: si la función serverless moría
-- entre medio (timeout / 504 / corte), el cliente quedaba con el anterior finalizado
-- y SIN el nuevo → sin crédito activo. La compensación (reactivar el anterior) podía
-- a su vez fallar → pérdida de estado. Recuperable y de baja frecuencia, pero real.
--
-- Este RPC finaliza + inserta en UNA sola transacción (un bloque plpgsql es atómico):
-- o commitean los dos o no commitea ninguno. Ya no hay ventana intermedia ni
-- compensación. El gate `estado = 'activo'` del UPDATE + un advisory lock por crédito
-- serializan dos renovaciones concurrentes del MISMO crédito: la 2ª ve 0 filas y
-- rebota con P0410 (la surfacea el llamador como "ya fue renovado por otra persona").
--
-- El advisory lock usa el MISMO espacio de clave que registrar_pago_seguro (0079)
-- —hashtext(prestamo_id)— así una renovación y un cobro al MISMO crédito también se
-- serializan entre sí (no se interleaven finalize y cobro).
--
-- security INVOKER (default): corre con los privilegios del gestor que llama → la RLS
-- de `prestamos` sigue vigente (solo renueva lo que puede ver/escribir). NADA de dinero
-- se decide acá: monto y cuota llegan ya calculados y validados por el server (TS). El
-- pagado_acum del nuevo crédito lo arranca en 0 el default de la tabla. La corre Carlos
-- en el SQL Editor. Re-ejecutable (create or replace).
-- ─────────────────────────────────────────────────────────────────────────

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
  -- Serializa por crédito anterior (mismo espacio de lock que el cobro): dos
  -- renovaciones —o una renovación y un cobro— al mismo crédito no se pisan.
  perform pg_advisory_xact_lock(hashtext(p_prestamo_anterior_id::text));

  -- Re-leer el anterior FRESCO bajo el lock (el TS ya validó antes de pedir el lock).
  select * into v_ant from prestamos where id = p_prestamo_anterior_id;
  if not found then
    raise exception 'prestamo anterior % inexistente', p_prestamo_anterior_id using errcode = 'P0002';
  end if;
  -- Nunca cruzar plata entre clientes (defensa en profundidad; el TS ya lo chequea).
  if v_ant.cliente_id <> p_cliente_id then
    raise exception 'el crédito anterior no pertenece al cliente' using errcode = 'P0001';
  end if;

  -- Finalizar el anterior SOLO si sigue activo. El gate es lo que evita la doble
  -- renovación del MISMO crédito (0037 permite varios activos por cliente, así que
  -- no hay constraint de "un activo por cliente" que nos cubra: el gate es la defensa).
  update prestamos
     set estado = 'finalizado', finalizado_en = now()
   where id = p_prestamo_anterior_id
     and estado = 'activo';
  get diagnostics v_upd = row_count;
  if v_upd = 0 then
    -- Otra transacción ya lo finalizó/renovó → abortar (el rollback deshace todo).
    raise exception 'el crédito anterior ya no está activo' using errcode = 'P0410';
  end if;

  -- Insertar el nuevo crédito activo, EN LA MISMA TRANSACCIÓN que el finalize.
  -- monto/cuota llegan tal cual los calculó el server (numeric(12,2) en la tabla):
  -- NO se re-redondean acá para no alterar la conducta previa del insert de TS.
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
