-- ─────────────────────────────────────────────────────────────────────────
--  0159 · LA APP SE SIENTE LENTA: la RLS llamaba una función por CADA FILA.
--
--  LA QUEJA (08-09, del piloto): "se siente un poco lento".
--
--  LO QUE SE MIDIÓ contra la base viva, con sesión real de cada rol y las
--  cuatro consultas que arma cualquier pantalla (clientes, asignaciones,
--  préstamos, pagos de la ruta):
--      supervisor  14.420 ms      cobrador  6.097 ms      admin  3.264 ms
--  Listar los 130 clientes de UN cobrador tardaba 3.930 ms. En pg_stat_statements,
--  la consulta que lee los pagos de la ruta acumulaba 20.039 SEGUNDOS de base en
--  130.768 llamadas (153 ms de media), y `pagos` llevaba 100.471 escaneos
--  secuenciales que leyeron 18.478 millones de filas.
--
--  LA CAUSA: policies como
--      using ( app_cobrador_tiene_cliente(id) or app_gestor_ve_cliente(id) )
--  Esas funciones son STABLE + SECURITY DEFINER, así que Postgres NO puede
--  inline-arlas: son una llamada de verdad POR CADA FILA de la tabla (13.320 en
--  clientes), y adentro cada una vuelve a preguntar quién sos (app_usuario_id() →
--  otro select sobre usuarios). El planner nunca ve un índice: ve una caja negra.
--
--  LO QUE NO ERA: se probó primero el patrón "initplan" que recomienda Supabase
--  —envolver cada llamada en (select ...)— sobre las 121 policies que lo
--  ameritaban: dio 1,0-1,1×. No sirve cuando la función RECIBE la fila.
--
--  EL ARREGLO: escribir el predicado en SQL plano, de modo que
--   · el cobrador entre por su asignación → EXISTS que usa el índice
--     asignaciones(cobrador_id, cliente_id);
--   · lo que NO depende de la fila (quién soy, qué rol tengo, qué cobradores y
--     clientes alcanzo) se calcule UNA VEZ por consulta, envuelto en (select ...);
--   · no quede NINGUNA llamada a una función app_* que reciba un dato de la fila.
--
--  MEDIDO DESPUÉS, mismas consultas, mismos usuarios:
--      supervisor  436 ms (33,0x)   cobrador  325 ms (18,8x)   admin  386 ms (8,5x)
--
--  EQUIVALENCIA: verificada fila por fila sobre TODOS los usuarios activos con
--  sesión (los 3 admin, los 3 supervisores y los cobradores con ruta): el conjunto
--  de clientes, asignaciones, préstamos y pagos que ve cada uno es IDÉNTICO al de
--  antes. El script que aplica esta migración vuelve a comprobarlo dentro de la
--  misma transacción y hace ROLLBACK si una sola fila difiere.
--
--  SEMÁNTICA PRESERVADA A PROPÓSITO, aunque huela raro:
--   · `app_supervisor_sin_zonas()` (hoy devuelve false por 0148) se mantiene como
--     un OR suelto, NO condicionado al rol supervisor — igual que el original.
--   · el alcance del supervisor se arma por ZONA DEL COBRADOR asignado, que es lo
--     que hacía app_zona_de_cliente(). Aquel usaba `limit 1` sobre los cobradores
--     del cliente: con dos cobradores de zonas distintas elegía uno arbitrario.
--     Medido: 0 clientes con ruta en dos zonas reales (1 caso toca la ficha de
--     sistema "Administrador Presta Ya", que no tiene zona) → hoy es idéntico, y
--     de aparecer el caso la versión nueva es la correcta (si un cobrador MÍO lo
--     tiene asignado, es mi cliente).
--
--  NO se toca ninguna policy de INSERT/UPDATE/DELETE: sólo se cambia CÓMO se
--  decide qué filas se VEN, nunca quién puede escribir.
-- ─────────────────────────────────────────────────────────────────────────

-- Si la tabla está tomada por la operación, fallar rápido en vez de colgar la app.
set local lock_timeout = '5s';

-- ══ clientes ═════════════════════════════════════════════════════════════
alter policy "clientes_select" on clientes using (
  -- el cobrador: por su propia asignación (índice)
  exists (select 1 from asignaciones a
           where a.cliente_id = clientes.id and a.activo = true
             and a.cobrador_id = (select app_usuario_id()))
  -- el gestor: alcance calculado una sola vez
  or (select app_rol()) = 'admin'
  or (select app_supervisor_sin_zonas())
  or ((select app_rol()) = 'supervisor' and clientes.id in (
        select a2.cliente_id from asignaciones a2
         where a2.activo = true and a2.cobrador_id in (
               select u2.id from usuarios u2
                where u2.zona_id in (select sz.zona_id from supervisor_zonas sz
                                      where sz.supervisor_id = (select app_usuario_id())))))
);

-- ══ asignaciones ═════════════════════════════════════════════════════════
alter policy "asignaciones_select" on asignaciones using (
  asignaciones.cobrador_id = (select app_usuario_id())
  or (select app_rol()) = 'admin'
  or (select app_supervisor_sin_zonas())
  or ((select app_rol()) = 'supervisor' and asignaciones.cobrador_id in (
        select u2.id from usuarios u2
         where u2.zona_id in (select sz.zona_id from supervisor_zonas sz
                               where sz.supervisor_id = (select app_usuario_id()))))
);

-- ══ prestamos ════════════════════════════════════════════════════════════
alter policy "prestamos_select" on prestamos using (
  exists (select 1 from asignaciones a
           where a.cliente_id = prestamos.cliente_id and a.activo = true
             and a.cobrador_id = (select app_usuario_id()))
  or (select app_rol()) = 'admin'
  or (select app_supervisor_sin_zonas())
  or ((select app_rol()) = 'supervisor' and prestamos.cliente_id in (
        select a2.cliente_id from asignaciones a2
         where a2.activo = true and a2.cobrador_id in (
               select u2.id from usuarios u2
                where u2.zona_id in (select sz.zona_id from supervisor_zonas sz
                                      where sz.supervisor_id = (select app_usuario_id())))))
);

-- ══ pagos (se cuelgan del préstamo) ══════════════════════════════════════
alter policy "pagos_select" on pagos using (
  exists (select 1 from prestamos p
           where p.id = pagos.prestamo_id
             and (exists (select 1 from asignaciones a
                           where a.cliente_id = p.cliente_id and a.activo = true
                             and a.cobrador_id = (select app_usuario_id()))
                  or (select app_rol()) = 'admin'
                  or (select app_supervisor_sin_zonas())
                  or ((select app_rol()) = 'supervisor' and p.cliente_id in (
                        select a2.cliente_id from asignaciones a2
                         where a2.activo = true and a2.cobrador_id in (
                               select u2.id from usuarios u2
                                where u2.zona_id in (select sz.zona_id from supervisor_zonas sz
                                                      where sz.supervisor_id = (select app_usuario_id())))))))
);
