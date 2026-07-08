# Pruebas de seguridad — RLS por zona (Fase B, migración 0031)

Objetivo: comprobar que **un supervisor de la zona A no puede leer datos de la
zona B**, que **el cobrador no ve la cartera**, y que **el admin sigue viendo
todo**. Es el equivalente por zona al test del token del cliente.

Todas las consultas se corren en el **SQL Editor de Supabase**. La técnica es
"ponerse en los zapatos" de un usuario autenticado fijando su `auth.uid` y
cambiando al rol `authenticated` (el mismo rol con el que entra la app).

> ⚠️ Corré cada bloque completo (incluye el `reset role` al final). Si algo
> falla a la mitad y quedás con `role authenticated`, ejecutá `reset role;`.

## 0. Preparar datos de prueba (una sola vez)

```sql
-- Dos zonas
insert into zonas (nombre) values ('Zona A test'), ('Zona B test')
  returning id, nombre;
-- Anotá los UUID: :zona_a y :zona_b

-- Un cobrador en cada zona (usá cobradores reales o de prueba)
update usuarios set zona_id = :zona_a where id = :cobrador_a;
update usuarios set zona_id = :zona_b where id = :cobrador_b;

-- El supervisor de prueba cubre SOLO la zona A
insert into supervisor_zonas (supervisor_id, zona_id) values (:supervisor, :zona_a);

-- Asegurá que cada cobrador tenga al menos un cliente asignado (activo).
```

## 1. El supervisor de A NO ve clientes de la zona B

```sql
-- Ponerse como el supervisor (cubre solo zona A)
select set_config('request.jwt.claims',
  (select json_build_object('sub', auth_user_id)::text
     from usuarios where id = :supervisor), true);
set role authenticated;

-- Debe listar SOLO clientes cuya zona derivada sea A (o sin zona = ninguno).
select id, nombre, app_zona_de_cliente(id) as zona from clientes order by nombre;

-- Prueba dura: contar clientes de la zona B visibles → debe ser 0.
select count(*) as clientes_zona_b_visibles
  from clientes where app_zona_de_cliente(id) = :zona_b;   -- ESPERADO: 0

reset role;
```

**Esperado:** la primera consulta trae solo clientes de la zona A; el contador
de clientes de la zona B visibles es **0**.

## 2. El supervisor de A NO ve pagos de la zona B

```sql
select set_config('request.jwt.claims',
  (select json_build_object('sub', auth_user_id)::text
     from usuarios where id = :supervisor), true);
set role authenticated;

-- Pagos visibles cuyo cliente es de la zona B → debe ser 0.
select count(*) as pagos_zona_b_visibles
  from pagos pg
  join prestamos p on p.id = pg.prestamo_id
 where app_zona_de_cliente(p.cliente_id) = :zona_b;         -- ESPERADO: 0

reset role;
```

## 3. El cobrador NO ve la cartera (solo sus asignados)

```sql
select set_config('request.jwt.claims',
  (select json_build_object('sub', auth_user_id)::text
     from usuarios where id = :cobrador_a), true);
set role authenticated;

-- Solo debe ver SUS clientes asignados, no toda la cartera.
select count(*) as clientes_visibles_cobrador from clientes;
-- Comparar contra el total real (visto como admin) → debe ser menor.

reset role;
```

## 4. El admin sigue viendo TODO

```sql
select set_config('request.jwt.claims',
  (select json_build_object('sub', auth_user_id)::text
     from usuarios where rol = 'admin' limit 1), true);
set role authenticated;

select count(*) as clientes_admin from clientes;   -- ESPERADO: total de la cartera

reset role;
```

## 5. Fallback de transición: supervisor SIN zonas ve todo

```sql
-- Quitarle temporalmente las zonas al supervisor
delete from supervisor_zonas where supervisor_id = :supervisor;

select set_config('request.jwt.claims',
  (select json_build_object('sub', auth_user_id)::text
     from usuarios where id = :supervisor), true);
set role authenticated;

select count(*) as clientes_supervisor_sin_zonas from clientes;  -- ESPERADO: total
reset role;

-- Restaurar
insert into supervisor_zonas (supervisor_id, zona_id) values (:supervisor, :zona_a)
  on conflict do nothing;
```

## 6. Anulación de pagos: solo el admin por RLS

```sql
-- Como supervisor, intentar anular un pago (update) → debe fallar / 0 filas.
select set_config('request.jwt.claims',
  (select json_build_object('sub', auth_user_id)::text
     from usuarios where id = :supervisor), true);
set role authenticated;

update pagos set anulado = true, anulado_por = :supervisor, anulado_en = now(),
       motivo_anulacion = 'prueba'
 where id = :algun_pago;                       -- ESPERADO: 0 filas afectadas
reset role;
```

**Esperado:** 0 filas. El supervisor no puede anular por la base; su camino es
la **solicitud con doble registro** (Fase C), que ejecuta la anulación con
`service_role` recién tras la confirmación de una segunda persona.

## 7. ESCRITURA cruzada por zona: bloqueada (migración 0035)

Verifica el hallazgo de la auditoría senior: un supervisor de la zona A **no
puede INSERTAR** pagos/préstamos/visitas sobre clientes de la zona B, ni siquiera
por PostgREST directo. Requiere haber corrido la **migración 0035**.

```sql
-- Como supervisor de la zona A, intentar registrar un pago sobre un préstamo de
-- un cliente de la ZONA B → debe fallar por RLS (violates row-level security).
select set_config('request.jwt.claims',
  (select json_build_object('sub', auth_user_id)::text
     from usuarios where id = :supervisor), true);
set role authenticated;

-- :prestamo_zona_b = un préstamo cuyo cliente deriva a la zona B.
insert into pagos (prestamo_id, dia_credito, monto, registrado_por)
values (:prestamo_zona_b, 1, 100, :supervisor);   -- ESPERADO: ERROR RLS (0 filas)

reset role;
```

**Esperado:** error `new row violates row-level security policy for table
"pagos"`. Repetir el mismo intento con un préstamo de la **zona A** debe
funcionar (o fallar solo por otra validación, no por RLS). El admin puede en
ambas zonas. Espejo en código: `puedeEscribirEnZona` (lib/permisos.ts) con sus
tests de aislamiento.

---

### Limpieza (al terminar)

```sql
delete from supervisor_zonas where zona_id in (:zona_a, :zona_b);
update usuarios set zona_id = null where id in (:cobrador_a, :cobrador_b);
delete from zonas where nombre in ('Zona A test', 'Zona B test');
```
