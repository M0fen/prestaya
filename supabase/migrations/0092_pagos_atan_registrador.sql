-- ─────────────────────────────────────────────────────────────────────────
-- 0092 — SEGURIDAD money-critical: atar el pago a quien lo registra.
--
-- HALLAZGO (caza adversarial 07-28): la política pagos_insert (0035) valida que el
-- crédito sea visible para el actor, pero NO ata `registrado_por` al principal
-- autenticado — a diferencia de movimientos_caja (0010) y gastos_cobrador (0017), que
-- SÍ exigen `registrado_por = app_usuario_id()`. La RPC registrar_pago_seguro (0079)
-- es security INVOKER (su insert queda sujeto a esta RLS) e inserta p_registrado_por
-- verbatim, y está grant a `authenticated`. El anon key + el JWT del cobrador viven en
-- el navegador (la PWA usa createSupabaseBrowser).
--
-- ATAQUE que esto cierra: un cobrador cobra $500 en efectivo a SU cliente y, en vez de
-- usar la app, hace un POST crudo a /rest/v1/rpc/registrar_pago_seguro con
-- p_registrado_por = NULL (o el id de otro cobrador). Hoy la RLS lo permite: el pago
-- entra al libro (el cartón del cliente muestra la cuota PAGADA), pero como
-- recaudo/rendición/faltante/comisión se llavean por `registrado_por`, un pago con
-- registrado_por = NULL NO cae en la rendición de NADIE → el cobrador se queda el
-- efectivo sin faltante que lo delate; y con el id de una víctima, le imputa un
-- faltante-fantasma. La reconciliación pagado_acum==Σpagos sigue cuadrando → invisible.
--
-- FIX: agregar `registrado_por = app_usuario_id()` al with-check. El camino HONESTO no
-- cambia (el server action del cobrador ya setea registrado_por = su propio id =
-- app_usuario_id()). El PANEL y los IMPORTS escriben con service_role (bypassa RLS), así
-- que NO se ven afectados (siguen atribuyendo al cobrador dueño de la ruta). Un cobrador
-- desactivado queda igualmente bloqueado (app_usuario_id() filtra activo=true).
--
-- NO cambia la inmutabilidad (trigger 0002), ni que la anulación (pagos_update) sea
-- admin-only (0031). La corre Carlos en el SQL Editor. Idempotente.
-- ─────────────────────────────────────────────────────────────────────────

drop policy if exists pagos_insert on pagos;
create policy pagos_insert on pagos for insert to authenticated
  with check (
    -- ⭐ El pago SIEMPRE se atribuye a quien lo registra (anti-robo / anti-framing).
    registrado_por = app_usuario_id()
    and exists (
      select 1 from prestamos p
      where p.id = prestamo_id
        and ( app_gestor_ve_cliente(p.cliente_id)
              or app_zona_de_cliente(p.cliente_id) is null
              or app_cobrador_tiene_cliente(p.cliente_id) )
    )
  );
