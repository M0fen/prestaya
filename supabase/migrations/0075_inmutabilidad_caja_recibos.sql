-- ─────────────────────────────────────────────────────────────────────────
-- 0075 — INMUTABILIDAD del libro de caja y de los recibos (hallazgo de auditoría #13).
--
-- El libro de dinero debe ser APPEND-ONLY, como `pagos`: un movimiento se corrige
-- con un movimiento COMPENSATORIO, JAMÁS borrando o editando (trazabilidad).
--
-- ANTES:
--   · movimientos_caja tenía una policy DELETE para admin (`app_rol()='admin'`) →
--     el admin podía BORRAR un egreso/retiro y descuadrar el libro sin rastro.
--   · recibos tenía `for all to authenticated using(app_es_gestor())` → CUALQUIER
--     gestor (incl. un supervisor) podía UPDATE/DELETE recibos del dueño (payroll).
--
-- Verificado: NINGÚN código de la app borra ni edita estas tablas (solo INSERT +
-- SELECT), así que quitar UPDATE/DELETE no rompe nada. La idempotencia de caja
-- (0074) además asume que el egreso, una vez escrito, NO desaparece.
--
-- Idempotente y TOLERANTE: la parte de `recibos` solo corre si la tabla existe
-- (0046 puede no haberse aplicado en esta base → el código ya trata recibos como
-- best-effort). La parte de `movimientos_caja` aplica siempre.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) movimientos_caja: quitar el DELETE. (No había policy de UPDATE → ya era
--    ineditable; ahora tampoco borrable.) Queda SELECT (gestor) + INSERT (autor).
drop policy if exists mov_caja_delete on movimientos_caja;

-- 2) recibos: reemplazar el `for all` por SELECT + INSERT (sin UPDATE ni DELETE).
--    Solo si la tabla existe (evita "relation recibos does not exist").
do $$
begin
  if to_regclass('public.recibos') is not null then
    drop policy if exists recibos_gestor_all on recibos;
    drop policy if exists recibos_select on recibos;
    drop policy if exists recibos_insert on recibos;

    create policy recibos_select on recibos
      for select to authenticated using ( app_es_gestor() );
    create policy recibos_insert on recibos
      for insert to authenticated with check ( app_es_gestor() );
    -- (sin policy de UPDATE/DELETE → RLS deniega: el recibo es append-only)
  end if;
end $$;

-- Nota: el aislamiento por ZONA de la caja/recibos/auditoría (que un supervisor no
-- vea los retiros/capital/payroll del dueño) es el hallazgo #14, aparte — requiere
-- decidir qué ve el supervisor y espejar 0066. Importa con 2+ zonas.
