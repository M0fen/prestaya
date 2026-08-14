-- ─────────────────────────────────────────────────────────────────────────
--  0142 · Cierra la fuga EXECUTE-a-anon en las RPCs de escritura (inventario
--  del dinero, 08-14).
--
--  Medido contra pg_proc en la base viva: cinco funciones que ESCRIBEN plata
--  tenían EXECUTE para `anon` (dos de ellas SECURITY DEFINER):
--    · app_reparar_pagado_acum      DEFINER  anon=true  ← ni la app la llama
--    · crear_compra_empleado_seguro DEFINER  anon=true
--    · crear_credito_venta_seguro   invoker  anon=true
--    · registrar_pago_seguro        invoker  anon=true
--    · renovar_credito_seguro       invoker  anon=true
--
--  Es la MISMA clase de fuga que la 0123 cerró (EXECUTE a PUBLIC): las
--  funciones creadas o re-creadas después heredaron el GRANT por defecto de
--  Postgres (EXECUTE a PUBLIC en cada CREATE FUNCTION). Las invoker con anon
--  rebotan hoy en la RLS (app_usuario_id() nulo), pero el perímetro no se
--  apoya en "hoy rebota": se revoca. Y para que NO vuelva a pasar, el DO de
--  abajo es re-ejecutable — correrlo después de cualquier migración que toque
--  estas funciones.
--
--  `authenticated` se CONSERVA donde la app llama con sesión (pagos, renovar,
--  venta de tienda, compra de empleado, rifa); `app_reparar_pagado_acum` no
--  tiene ningún llamador en el código → queda solo para service_role/owner.
--  service_role no se ve afectado por estos revokes (BYPASSRLS + owner).
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as firma, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'app_reparar_pagado_acum',
        'crear_compra_empleado_seguro',
        'crear_credito_venta_seguro',
        'registrar_pago_seguro',
        'renovar_credito_seguro',
        'cerrar_rifa_seguro',
        'participar_rifa_seguro',
        'registrar_jugada_raspa_seguro',
        'registrar_jugada_raspa_pin'
      )
  loop
    execute format('revoke execute on function %s from public', r.firma);
    execute format('revoke execute on function %s from anon', r.firma);
    if r.proname = 'app_reparar_pagado_acum' then
      execute format('revoke execute on function %s from authenticated', r.firma);
    end if;
  end loop;
end $$;
