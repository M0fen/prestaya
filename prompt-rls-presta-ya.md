# Prompt para Claude Code — Presta Ya (políticas de seguridad / RLS)

> Úsalo DESPUÉS de tener el esquema creado y RLS activado en las tablas.
> Este paso define quién puede ver y tocar cada dato. Es crítico: maneja datos
> personales y dinero de ~4.000 personas.

---

## CONTEXTO

Las tablas de Presta Ya ya tienen Row Level Security (RLS) activado pero sin
políticas, así que ahora todo acceso está bloqueado. Vamos a escribir las
políticas que definen el acceso por rol. Entrégalo como un archivo de migración
SQL (ej. `supabase/migrations/0002_rls.sql`) para que yo lo ejecute en Supabase.

## QUIÉN ACCEDE Y CÓMO

Hay dos vías de acceso totalmente distintas:

1. USUARIOS INTERNOS (se loguean con Supabase Auth):
   - admin (Mauricio): ve y gestiona todo.
   - supervisor (su esposa): ve todo; gestiona casi todo.
   - cobrador: ve y opera SOLO los clientes que tiene asignados.
   Las políticas RLS de abajo gobiernan a estos usuarios (rol `authenticated`).

2. CLIENTE / DEUDOR (NO se loguea; entra por link con token):
   - NO usa Supabase Auth. La vista de cliente la sirve el servidor de Next.js
     con la SERVICE_ROLE_KEY (solo en servidor), que IGNORA el RLS.
   - Por eso la seguridad del cliente NO depende del RLS, sino de que el código
     del servidor filtre SIEMPRE por el `cliente_id` validado a partir del token.
   - IMPORTANTE: como el service role ignora RLS, nunca expongas esa llave al
     navegador y nunca hagas una consulta de cliente sin filtrar por su token.

## REGLAS DE NEGOCIO A CONFIRMAR ANTES DE ESCRIBIR

Antes de generar el SQL, pregúntame y espera respuesta:
1. ¿Los cobradores pueden CREAR clientes y préstamos nuevos en la calle, o eso
   solo lo hacen admin/supervisor? (El SQL de abajo asume que NO; ajústalo según
   responda.)
2. ¿La anulación de un pago la puede hacer un cobrador, o solo admin/supervisor?
   (El SQL asume que solo admin/supervisor.)

---

## POLÍTICAS RLS (punto de partida — revísalas críticamente)

```sql
-- ─────────────────────────────────────────────
-- FUNCIONES AYUDANTES
-- Van con SECURITY DEFINER a propósito: corren como dueño y saltan el RLS,
-- lo que evita recursión infinita cuando una política sobre `usuarios`
-- necesita consultar `usuarios`.
-- ─────────────────────────────────────────────
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

-- ─────────────────────────────────────────────
-- USUARIOS: gestores ven a todos; el cobrador solo se ve a sí mismo.
-- Solo admin crea/edita/borra usuarios.
-- ─────────────────────────────────────────────
create policy usuarios_select on usuarios for select to authenticated
  using ( app_es_gestor() or id = app_usuario_id() );
create policy usuarios_insert on usuarios for insert to authenticated
  with check ( app_rol() = 'admin' );
create policy usuarios_update on usuarios for update to authenticated
  using ( app_rol() = 'admin' ) with check ( app_rol() = 'admin' );
create policy usuarios_delete on usuarios for delete to authenticated
  using ( app_rol() = 'admin' );

-- ─────────────────────────────────────────────
-- CLIENTES: gestores ven todos; cobrador solo sus asignados.
-- (Asume que solo gestores crean/editan clientes — confirmar.)
-- ─────────────────────────────────────────────
create policy clientes_select on clientes for select to authenticated
  using ( app_es_gestor() or app_cobrador_tiene_cliente(id) );
create policy clientes_insert on clientes for insert to authenticated
  with check ( app_es_gestor() );
create policy clientes_update on clientes for update to authenticated
  using ( app_es_gestor() ) with check ( app_es_gestor() );
create policy clientes_delete on clientes for delete to authenticated
  using ( app_rol() = 'admin' );

-- ─────────────────────────────────────────────
-- PRÉSTAMOS: gestores todo; cobrador solo los de sus clientes asignados.
-- (Asume que solo gestores crean préstamos — confirmar.)
-- ─────────────────────────────────────────────
create policy prestamos_select on prestamos for select to authenticated
  using ( app_es_gestor() or app_cobrador_tiene_cliente(cliente_id) );
create policy prestamos_insert on prestamos for insert to authenticated
  with check ( app_es_gestor() );
create policy prestamos_update on prestamos for update to authenticated
  using ( app_es_gestor() ) with check ( app_es_gestor() );
create policy prestamos_delete on prestamos for delete to authenticated
  using ( app_rol() = 'admin' );

-- ─────────────────────────────────────────────
-- PAGOS: el libro contable. Cobrador inserta y ve los de sus clientes.
-- La anulación (update) solo gestores. NADIE borra (no hay policy de delete).
-- ─────────────────────────────────────────────
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

-- ─────────────────────────────────────────────
-- INMUTABILIDAD DE PAGOS (trigger, no RLS).
-- El RLS controla QUIÉN; este trigger controla QUÉ se puede cambiar:
-- solo los campos de anulación, nunca los financieros.
-- ─────────────────────────────────────────────
create or replace function pagos_no_editar_financiero()
returns trigger language plpgsql as $$
begin
  if NEW.monto        is distinct from OLD.monto
     or NEW.prestamo_id  is distinct from OLD.prestamo_id
     or NEW.dia_credito  is distinct from OLD.dia_credito
     or NEW.monto        is distinct from OLD.monto
     or NEW.registrado_en is distinct from OLD.registrado_en then
    raise exception 'Los datos financieros de un pago no se modifican. Use anulación.';
  end if;
  return NEW;
end;
$$;
create trigger trg_pagos_inmutables
  before update on pagos
  for each row execute function pagos_no_editar_financiero();

-- ─────────────────────────────────────────────
-- VISITAS: igual lógica que pagos para lectura/inserción.
-- ─────────────────────────────────────────────
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

-- ─────────────────────────────────────────────
-- ASIGNACIONES: gestores administran; cobrador ve solo las suyas.
-- ─────────────────────────────────────────────
create policy asignaciones_select on asignaciones for select to authenticated
  using ( app_es_gestor() or cobrador_id = app_usuario_id() );
create policy asignaciones_insert on asignaciones for insert to authenticated
  with check ( app_es_gestor() );
create policy asignaciones_update on asignaciones for update to authenticated
  using ( app_es_gestor() ) with check ( app_es_gestor() );
create policy asignaciones_delete on asignaciones for delete to authenticated
  using ( app_es_gestor() );
```

---

## DESPUÉS DE GENERAR EL SQL

1. Explícame en lenguaje simple qué puede y qué NO puede hacer cada rol con
   estas políticas, en una tabla. Quiero entenderlo, no solo ejecutarlo.
2. Dame un plan de PRUEBAS concreto para verificar el RLS antes de cargar datos
   reales: cómo crear un usuario de cada rol, y qué consultas correr como cada
   uno para confirmar que un cobrador NO puede ver clientes ajenos, que nadie
   puede borrar pagos, y que la anulación solo la hacen gestores.
3. Recuérdame que el patrón de la vista de cliente (service role + filtro por
   token en el servidor) NO está cubierto por estas políticas y se prueba aparte.

## CÓMO PROCEDER

No generes el SQL hasta confirmar conmigo las dos reglas de negocio del inicio.
Luego entrega la migración, la tabla explicativa de permisos y el plan de
pruebas. Avanza por pasos y espera mi validación.
```
