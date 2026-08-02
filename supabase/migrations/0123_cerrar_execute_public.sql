-- ─────────────────────────────────────────────────────────────────────────
-- 0123 — 🔴 URGENTE: cerrar el EXECUTE que quedó abierto a PUBLIC.
--
-- CAUSA RAÍZ: Postgres otorga `EXECUTE ... TO PUBLIC` por DEFECTO a toda función
-- nueva. `REVOKE ... FROM authenticated` (0108) quita el grant explícito de ESE rol
-- pero NO toca el de PUBLIC — y el chequeo de privilegio pasa si PUBLIC lo tiene.
-- Resultado: funciones que se creían cerradas siguen ejecutables por CUALQUIERA
-- con la anon key (que es pública por diseño: viaja en el navegador).
--
-- ⚠️ VERIFICADO EN VIVO (08-02, anon key, SIN sesión):
--   · app_reconciliacion_violaciones() → devolvió 56 filas con saldo y drift de
--     créditos REALES. Fuga de datos financieros de toda la operación.
--   · El EXECUTE de app_cartera_activa() también pasa; la salvó su gate interno
--     `app_es_gestor()` devolviendo vacío (defensa en profundidad que funcionó).
--
-- Las de juego (raspadita/rifa) son las más peligrosas: son SECURITY DEFINER y
-- confían en sus parámetros → con el EXECUTE abierto se pueden ACUÑAR folios de
-- premio y DECIDIR el ganador de una rifa desde afuera de la app.
--
-- COMPATIBILIDAD (verificada llamador por llamador antes de escribir esto):
--   · app_reconciliacion_violaciones → cron + panel empalme usan createSupabaseAdmin()
--   · registrar_jugada_raspa_*      → app/c/[token]/actions.ts usa createSupabaseAdmin()
--   · participar_rifa_seguro        → app/c/[token]/actions.ts usa createSupabaseAdmin()
--   · cerrar_rifa_seguro            → lib/acciones/rifas.ts usa createSupabaseServer()
--     (SESIÓN del admin) → acá NO se le puede revocar a `authenticated` sin romper
--     el botón "Sortear". Se cierra con un GATE INTERNO `app_es_admin()` + revoke
--     de public/anon, que es lo que realmente frenaba al insider.
-- ─────────────────────────────────────────────────────────────────────────

-- ══ (1) Reconciliación: exponía saldos y drift de TODOS los créditos ═════════
revoke all on function app_reconciliacion_violaciones() from public, anon, authenticated;
grant execute on function app_reconciliacion_violaciones() to service_role;

-- ══ (2) Raspadita: SECURITY DEFINER que confía en p_ganadas → acuñaba folios ══
-- (0108 quiso cerrarlas revocando solo de `authenticated`; faltaba PUBLIC.)
revoke all on function registrar_jugada_raspa_seguro(uuid, uuid, text, text, int) from public, anon, authenticated;
grant execute on function registrar_jugada_raspa_seguro(uuid, uuid, text, text, int) to service_role;

revoke all on function registrar_jugada_raspa_pin(uuid, uuid, text, text, int) from public, anon, authenticated;
grant execute on function registrar_jugada_raspa_pin(uuid, uuid, text, text, int) to service_role;

-- ══ (3) Rifa — participar: se llama solo con service_role ════════════════════
revoke all on function participar_rifa_seguro(uuid, uuid) from public, anon, authenticated;
grant execute on function participar_rifa_seguro(uuid, uuid) to service_role;

-- ══ (4) Rifa — cerrar/sortear: GATE INTERNO admin (el arreglo de fondo) ══════
-- Antes NO tenía ningún gate: un cobrador (o cualquiera con la anon key) podía
-- cerrar la rifa eligiendo ganador, y por idempotencia el admin ya no re-sorteaba.
-- Cuerpo IDÉNTICO al de 0098 (mismo retorno bigint, mismas columnas, mismo folio
-- y misma idempotencia) + el gate. Se conserva el grant a `authenticated` porque
-- la acción del admin lo llama con su sesión; el gate es quien filtra el rol.
create or replace function cerrar_rifa_seguro(p_rifa uuid, p_ganador uuid, p_numero int)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_folio bigint;
begin
  -- GATE: solo el administrador sortea/cierra una rifa (premio real de por medio).
  if not app_es_admin() then
    raise exception 'solo un administrador cierra una rifa' using errcode = 'P0401';
  end if;

  perform pg_advisory_xact_lock(hashtext('rifa:' || p_rifa::text));
  select folio into v_folio from rifas where id = p_rifa and estado = 'cerrada';
  if found then return v_folio; end if;   -- idempotente: no re-sortea
  v_folio := nextval('rifa_folio_seq');
  update rifas
     set estado = 'cerrada', ganador_cliente_id = p_ganador, ganador_numero = p_numero,
         sorteo_en = now(), folio = v_folio
   where id = p_rifa;
  return v_folio;
end;
$$;
revoke all on function cerrar_rifa_seguro(uuid, uuid, int) from public, anon;
grant execute on function cerrar_rifa_seguro(uuid, uuid, int) to authenticated, service_role;

-- ══ (5) Que el patrón NO se repita ══════════════════════════════════════════
-- Desde acá, toda función NUEVA nace sin EXECUTE para PUBLIC. Los grants
-- explícitos (`grant execute ... to authenticated`) siguen funcionando igual.
alter default privileges in schema public revoke execute on functions from public;

-- ── Verificación (read-only). PUBLIC tiene EXECUTE si aparece un `=X/` suelto ──
--   select p.proname, pg_catalog.array_to_string(p.proacl, E'\n')
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('app_reconciliacion_violaciones','registrar_jugada_raspa_pin',
--                        'registrar_jugada_raspa_seguro','participar_rifa_seguro','cerrar_rifa_seguro');
