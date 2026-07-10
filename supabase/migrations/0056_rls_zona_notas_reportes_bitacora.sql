-- ─────────────────────────────────────────────────────────────────────────
--  0056 · RLS POR ZONA en notas / reportes / bitácora / chat-cobrador
--
--  Cierra la fuga de defensa-en-profundidad: hoy estas tablas usan
--  `app_es_gestor()` → CUALQUIER supervisor podía leer (y en notas, BORRAR) datos
--  de OTRAS zonas con la anon key + su JWT (crudo por PostgREST, no por la UI).
--  El DELETE de notas ajenas era el más grave (destructivo). Ahora se acota con
--  los helpers de 0031 (`app_gestor_ve_cliente` / `app_gestor_ve_cobrador`, que
--  YA incluyen admin). Se PRESERVA el acceso del cobrador a SUS clientes y el de
--  cada quien a lo propio.
--
--  Solo cambia RLS (aplica al instante, sin reload de schema). Re-ejecutable.
--  Correr en el SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

-- ── notas_cliente: gestor solo ve/edita/borra clientes de SU zona (o el cobrador
--    los suyos; o el autor lo propio). Cierra el DELETE cross-zona destructivo. ──
drop policy if exists notas_cliente_select on notas_cliente;
create policy notas_cliente_select on notas_cliente for select to authenticated
  using ( app_gestor_ve_cliente(cliente_id) or app_cobrador_tiene_cliente(cliente_id) );

drop policy if exists notas_cliente_insert on notas_cliente;
create policy notas_cliente_insert on notas_cliente for insert to authenticated
  with check (
    autor_id = app_usuario_id()
    and ( app_gestor_ve_cliente(cliente_id) or app_cobrador_tiene_cliente(cliente_id) )
  );

drop policy if exists notas_cliente_delete on notas_cliente;
create policy notas_cliente_delete on notas_cliente for delete to authenticated
  using ( app_gestor_ve_cliente(cliente_id) or autor_id = app_usuario_id() );

-- ── reportes: el gestor solo ve/atiende los de clientes de su zona. (El insert
--    del cliente sigue entrando por service_role desde el Server Action.) ──
drop policy if exists reportes_select on reportes;
create policy reportes_select on reportes for select to authenticated
  using ( app_gestor_ve_cliente(cliente_id) );

drop policy if exists reportes_update on reportes;
create policy reportes_update on reportes for update to authenticated
  using ( app_gestor_ve_cliente(cliente_id) ) with check ( app_gestor_ve_cliente(cliente_id) );

-- ── bitácora: el gestor solo lee las acciones de cobradores de su zona. El insert
--    ya era self (actor_id = uno mismo) y la tabla es inmutable (sin update/delete). ──
drop policy if exists bitacora_select on bitacora;
create policy bitacora_select on bitacora for select to authenticated
  using ( app_gestor_ve_cobrador(actor_id) );

-- ── mensajes (hilo por cobrador): el supervisor solo ve/escribe los hilos de SUS
--    cobradores. El canal 'general' sigue abierto a todo interno; el cobrador ve el
--    suyo. (El delete sigue solo-admin, sin cambios.) ──
drop policy if exists mensajes_select on mensajes;
create policy mensajes_select on mensajes for select to authenticated
  using (
    ambito = 'general'
    or cobrador_id = app_usuario_id()
    or app_gestor_ve_cobrador(cobrador_id)
  );

drop policy if exists mensajes_insert on mensajes;
create policy mensajes_insert on mensajes for insert to authenticated
  with check (
    autor_id = app_usuario_id()
    and (
      ambito = 'general'
      or cobrador_id = app_usuario_id()
      or app_gestor_ve_cobrador(cobrador_id)
    )
  );
