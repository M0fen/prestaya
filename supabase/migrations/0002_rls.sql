-- ─────────────────────────────────────────────────────────────────────────
--  Presta Ya — políticas de seguridad (Row Level Security).
--  Ejecutar en el editor SQL de Supabase, DESPUÉS de 0001_inicial.sql.
--
--  Define el acceso de los USUARIOS INTERNOS (rol `authenticated`):
--    · admin (Mauricio): ve y gestiona todo.
--    · supervisor (esposa): ve todo; gestiona casi todo (no toca usuarios).
--    · cobrador: ve y opera SOLO sus clientes asignados.
--  Reglas confirmadas: crear clientes/préstamos = solo gestores;
--                      anular pagos = solo gestores.
--
--  La vista de CLIENTE (link con token) NO pasa por aquí: la sirve el servidor
--  con la SERVICE_ROLE_KEY, que IGNORA el RLS. Su seguridad depende de filtrar
--  por el token en el servidor (ver app/c/[token]). El rol anónimo queda
--  bloqueado (no tiene ninguna policy).
--
--  Las líneas "✦" son arreglos/mejoras sobre el borrador del documento.
--  Este archivo es RE-EJECUTABLE: cada policy se elimina antes de recrearse.
-- ─────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
--  FUNCIONES AYUDANTES
--  SECURITY DEFINER a propósito: corren como dueño y saltan el RLS, lo que
--  evita recursión infinita cuando una política sobre `usuarios` necesita
--  consultar `usuarios`.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function app_usuario_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from usuarios where auth_user_id = auth.uid() and activo = true limit 1;
$$;

create or replace function app_rol()
returns text language sql stable security definer set search_path = public as $$
  select rol from usuarios where auth_user_id = auth.uid() and activo = true limit 1;
$$;

create or replace function app_es_gestor()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app_rol() in ('admin','supervisor'), false);
$$;

create or replace function app_cobrador_tiene_cliente(p_cliente uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from asignaciones
    where cliente_id = p_cliente
      and cobrador_id = app_usuario_id()
      and activo = true
  );
$$;

-- ✦ MEJORA: permiso explícito de ejecución para usuarios logueados.
grant execute on function app_usuario_id()                 to authenticated;
grant execute on function app_rol()                        to authenticated;
grant execute on function app_es_gestor()                  to authenticated;
grant execute on function app_cobrador_tiene_cliente(uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════
--  USUARIOS: gestores ven a todos; el cobrador solo se ve a sí mismo.
--  Solo admin crea/edita/borra usuarios.
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists usuarios_select on usuarios;
drop policy if exists usuarios_insert on usuarios;
drop policy if exists usuarios_update on usuarios;
drop policy if exists usuarios_delete on usuarios;

create policy usuarios_select on usuarios for select to authenticated
  using ( app_es_gestor() or id = app_usuario_id() );
create policy usuarios_insert on usuarios for insert to authenticated
  with check ( app_rol() = 'admin' );
create policy usuarios_update on usuarios for update to authenticated
  using ( app_rol() = 'admin' ) with check ( app_rol() = 'admin' );
create policy usuarios_delete on usuarios for delete to authenticated
  using ( app_rol() = 'admin' );

-- ═════════════════════════════════════════════════════════════════════════
--  CLIENTES: gestores ven todos; cobrador solo sus asignados.
--  Solo gestores crean/editan; solo admin borra.
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists clientes_select on clientes;
drop policy if exists clientes_insert on clientes;
drop policy if exists clientes_update on clientes;
drop policy if exists clientes_delete on clientes;

create policy clientes_select on clientes for select to authenticated
  using ( app_es_gestor() or app_cobrador_tiene_cliente(id) );
create policy clientes_insert on clientes for insert to authenticated
  with check ( app_es_gestor() );
create policy clientes_update on clientes for update to authenticated
  using ( app_es_gestor() ) with check ( app_es_gestor() );
create policy clientes_delete on clientes for delete to authenticated
  using ( app_rol() = 'admin' );

-- ═════════════════════════════════════════════════════════════════════════
--  PRÉSTAMOS: gestores todo; cobrador solo los de sus clientes asignados.
--  Solo gestores crean/editan; solo admin borra.
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists prestamos_select on prestamos;
drop policy if exists prestamos_insert on prestamos;
drop policy if exists prestamos_update on prestamos;
drop policy if exists prestamos_delete on prestamos;

create policy prestamos_select on prestamos for select to authenticated
  using ( app_es_gestor() or app_cobrador_tiene_cliente(cliente_id) );
create policy prestamos_insert on prestamos for insert to authenticated
  with check ( app_es_gestor() );
create policy prestamos_update on prestamos for update to authenticated
  using ( app_es_gestor() ) with check ( app_es_gestor() );
create policy prestamos_delete on prestamos for delete to authenticated
  using ( app_rol() = 'admin' );

-- ═════════════════════════════════════════════════════════════════════════
--  PAGOS: el libro contable. El cobrador inserta y ve los de sus clientes.
--  La anulación (update) solo gestores. NADIE borra (sin policy de delete).
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists pagos_select on pagos;
drop policy if exists pagos_insert on pagos;
drop policy if exists pagos_update on pagos;

create policy pagos_select on pagos for select to authenticated
  using (
    app_es_gestor()
    or exists (
      select 1 from prestamos p
      where p.id = pagos.prestamo_id and app_cobrador_tiene_cliente(p.cliente_id)
    )
  );
create policy pagos_insert on pagos for insert to authenticated
  with check (
    app_es_gestor()
    or exists (
      select 1 from prestamos p
      where p.id = prestamo_id and app_cobrador_tiene_cliente(p.cliente_id)
    )
  );
create policy pagos_update on pagos for update to authenticated
  using ( app_es_gestor() ) with check ( app_es_gestor() );
-- (sin policy de delete = borrar pagos queda prohibido para todos)

-- ═════════════════════════════════════════════════════════════════════════
--  INMUTABILIDAD DE PAGOS (trigger, no RLS).
--  El RLS controla QUIÉN; este trigger controla QUÉ se puede cambiar:
--  solo los campos de anulación, nunca los financieros ni de auditoría.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function pagos_no_editar_financiero()
returns trigger language plpgsql as $$
begin
  -- ✦ ARREGLO: el borrador chequeaba `monto` dos veces y dejaba sin proteger
  -- `registrado_por`. Aquí se protegen todos los campos financieros y de
  -- auditoría del registro original.
  if NEW.monto          is distinct from OLD.monto
     or NEW.prestamo_id    is distinct from OLD.prestamo_id
     or NEW.dia_credito    is distinct from OLD.dia_credito
     or NEW.registrado_por is distinct from OLD.registrado_por
     or NEW.registrado_en  is distinct from OLD.registrado_en then
    raise exception 'Los datos financieros de un pago no se modifican. Use anulación.';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_pagos_inmutables on pagos;
create trigger trg_pagos_inmutables
  before update on pagos
  for each row execute function pagos_no_editar_financiero();

-- ═════════════════════════════════════════════════════════════════════════
--  VISITAS: misma lógica que pagos para lectura/inserción. No se borran.
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists visitas_select on visitas;
drop policy if exists visitas_insert on visitas;

create policy visitas_select on visitas for select to authenticated
  using (
    app_es_gestor()
    or exists (
      select 1 from prestamos p
      where p.id = visitas.prestamo_id and app_cobrador_tiene_cliente(p.cliente_id)
    )
  );
create policy visitas_insert on visitas for insert to authenticated
  with check (
    app_es_gestor()
    or exists (
      select 1 from prestamos p
      where p.id = prestamo_id and app_cobrador_tiene_cliente(p.cliente_id)
    )
  );

-- ═════════════════════════════════════════════════════════════════════════
--  ASIGNACIONES: gestores administran; el cobrador ve solo las suyas.
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists asignaciones_select on asignaciones;
drop policy if exists asignaciones_insert on asignaciones;
drop policy if exists asignaciones_update on asignaciones;
drop policy if exists asignaciones_delete on asignaciones;

create policy asignaciones_select on asignaciones for select to authenticated
  using ( app_es_gestor() or cobrador_id = app_usuario_id() );
create policy asignaciones_insert on asignaciones for insert to authenticated
  with check ( app_es_gestor() );
create policy asignaciones_update on asignaciones for update to authenticated
  using ( app_es_gestor() ) with check ( app_es_gestor() );
create policy asignaciones_delete on asignaciones for delete to authenticated
  using ( app_es_gestor() );
