-- ─────────────────────────────────────────────────────────────────────────
--  0031 · RLS POR ZONA (Fase B — seguridad).
--  Ejecutar en el editor SQL de Supabase, DESPUÉS de 0030.
--
--  Restringe al SUPERVISOR a ver/editar SOLO los datos de SUS zonas, sin tocar
--  al admin (ve todo) ni al cobrador (ve solo sus asignados). La zona de un
--  cliente se DERIVA del cobrador con asignación activa.
--
--  ⚠️ Esta migración REESCRIBE políticas de las tablas de dinero
--  (clientes/prestamos/pagos/visitas). Es re-ejecutable (drop antes de create).
--
--  Regla de transición (igual que el núcleo lib/permisos.ts): un supervisor
--  SIN zonas asignadas ve TODO. Antes de configurar zonas todo tiene zona=null;
--  así no se queda ciego. Al asignarle su primera zona, la restricción se activa.
-- ─────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
--  HELPERS (SECURITY DEFINER → saltan RLS, sin recursión)
-- ═════════════════════════════════════════════════════════════════════════

-- ¿El actor es el admin (dueño)?
create or replace function app_es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app_rol() = 'admin', false);
$$;

-- ¿El actor (supervisor) supervisa la zona z?
create or replace function app_supervisa_zona(z uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select z is not null and exists (
    select 1 from supervisor_zonas sz
    where sz.supervisor_id = app_usuario_id() and sz.zona_id = z
  );
$$;

-- ¿El actor es un supervisor SIN zonas asignadas? (fallback "ve todo")
create or replace function app_supervisor_sin_zonas()
returns boolean language sql stable security definer set search_path = public as $$
  select app_rol() = 'supervisor'
     and not exists (
       select 1 from supervisor_zonas sz where sz.supervisor_id = app_usuario_id()
     );
$$;

-- Zona DERIVADA de un cliente = zona del cobrador con asignación activa.
-- null si el cliente no tiene cobrador asignado o el cobrador no tiene zona.
create or replace function app_zona_de_cliente(p_cliente uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select u.zona_id
    from asignaciones a
    join usuarios u on u.id = a.cobrador_id
   where a.cliente_id = p_cliente and a.activo = true
   limit 1;
$$;

-- ¿Un GESTOR (admin o supervisor con alcance) puede ver a este cliente?
--  · admin: siempre.
--  · supervisor sin zonas: todo (transición).
--  · supervisor con zonas: solo si la zona derivada del cliente es suya.
--  · cobrador: false (su acceso va por asignación, no por acá).
create or replace function app_gestor_ve_cliente(p_cliente uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select app_es_admin()
      or app_supervisor_sin_zonas()
      or (app_rol() = 'supervisor' and app_supervisa_zona(app_zona_de_cliente(p_cliente)));
$$;

grant execute on function app_es_admin()                to authenticated;
grant execute on function app_supervisa_zona(uuid)      to authenticated;
grant execute on function app_supervisor_sin_zonas()    to authenticated;
grant execute on function app_zona_de_cliente(uuid)     to authenticated;
grant execute on function app_gestor_ve_cliente(uuid)   to authenticated;

-- ═════════════════════════════════════════════════════════════════════════
--  CLIENTES — ver/editar acotado por zona al supervisor.
--  Insert queda como gestor (un cliente nuevo aún no tiene zona; se vuelve
--  "de su zona" al asignarlo a un cobrador suyo). Borrar sigue siendo admin.
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists clientes_select on clientes;
drop policy if exists clientes_update on clientes;

create policy clientes_select on clientes for select to authenticated
  using ( app_gestor_ve_cliente(id) or app_cobrador_tiene_cliente(id) );
create policy clientes_update on clientes for update to authenticated
  using ( app_gestor_ve_cliente(id) ) with check ( app_gestor_ve_cliente(id) );

-- ═════════════════════════════════════════════════════════════════════════
--  PRÉSTAMOS — mismo alcance por zona (vía cliente).
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists prestamos_select on prestamos;
drop policy if exists prestamos_update on prestamos;

create policy prestamos_select on prestamos for select to authenticated
  using ( app_gestor_ve_cliente(cliente_id) or app_cobrador_tiene_cliente(cliente_id) );
create policy prestamos_update on prestamos for update to authenticated
  using ( app_gestor_ve_cliente(cliente_id) ) with check ( app_gestor_ve_cliente(cliente_id) );

-- ═════════════════════════════════════════════════════════════════════════
--  PAGOS — el libro. Ver acotado por zona; la anulación (update) SOLO admin
--  a nivel BD. El supervisor con doble registro anula por Server Action
--  (service_role) tras la confirmación de una segunda persona (Fase C).
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists pagos_select on pagos;
drop policy if exists pagos_update on pagos;

create policy pagos_select on pagos for select to authenticated
  using (
    exists (
      select 1 from prestamos p
      where p.id = pagos.prestamo_id
        and ( app_gestor_ve_cliente(p.cliente_id) or app_cobrador_tiene_cliente(p.cliente_id) )
    )
  );
-- Anulación directa por RLS: solo el admin. (El pago se inserta normal por el
-- cobrador; ver policy pagos_insert de 0002, que no cambia.)
create policy pagos_update on pagos for update to authenticated
  using ( app_es_admin() ) with check ( app_es_admin() );

-- ═════════════════════════════════════════════════════════════════════════
--  VISITAS — ver acotado por zona (misma lógica que pagos).
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists visitas_select on visitas;

create policy visitas_select on visitas for select to authenticated
  using (
    exists (
      select 1 from prestamos p
      where p.id = visitas.prestamo_id
        and ( app_gestor_ve_cliente(p.cliente_id) or app_cobrador_tiene_cliente(p.cliente_id) )
    )
  );

-- ═════════════════════════════════════════════════════════════════════════
--  ASIGNACIONES — el supervisor solo ve/gestiona las de SUS cobradores.
--  (Sus cobradores son los usuarios cuya zona él supervisa.)
-- ═════════════════════════════════════════════════════════════════════════

-- ¿El actor supervisa la zona del cobrador c? (o es admin / sin zonas)
create or replace function app_gestor_ve_cobrador(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select app_es_admin()
      or app_supervisor_sin_zonas()
      or (app_rol() = 'supervisor'
          and app_supervisa_zona((select zona_id from usuarios where id = c)));
$$;
grant execute on function app_gestor_ve_cobrador(uuid) to authenticated;

drop policy if exists asignaciones_select on asignaciones;
drop policy if exists asignaciones_insert on asignaciones;
drop policy if exists asignaciones_update on asignaciones;
drop policy if exists asignaciones_delete on asignaciones;

create policy asignaciones_select on asignaciones for select to authenticated
  using ( app_gestor_ve_cobrador(cobrador_id) or cobrador_id = app_usuario_id() );
create policy asignaciones_insert on asignaciones for insert to authenticated
  with check ( app_gestor_ve_cobrador(cobrador_id) );
create policy asignaciones_update on asignaciones for update to authenticated
  using ( app_gestor_ve_cobrador(cobrador_id) ) with check ( app_gestor_ve_cobrador(cobrador_id) );
create policy asignaciones_delete on asignaciones for delete to authenticated
  using ( app_gestor_ve_cobrador(cobrador_id) );
