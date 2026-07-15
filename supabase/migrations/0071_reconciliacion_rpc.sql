-- ─────────────────────────────────────────────────────────────────────────
--  RECONCILIACIÓN DIARIA — RPC que devuelve SOLO los créditos que VIOLAN una
--  invariante de dinero, agregando en SQL (no trae 162k pagos al server).
--  La usa el cron `/api/cron/reconciliacion` cada mañana; el núcleo puro
--  (lib/reconciliacion.ts) clasifica la severidad. Idempotente (create or replace).
-- ─────────────────────────────────────────────────────────────────────────

create or replace function app_reconciliacion_violaciones()
returns table (
  id uuid,
  estado text,
  pagado_acum numeric,
  pagos_suma numeric,
  total_a_pagar numeric,
  cuota_diaria numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.estado,
    p.pagado_acum,
    coalesce(s.suma, 0)                    as pagos_suma,
    (p.cuota_diaria * p.total_dias)        as total_a_pagar,
    p.cuota_diaria
  from prestamos p
  left join (
    select prestamo_id, sum(monto) as suma
    from pagos
    where not anulado
    group by prestamo_id
  ) s on s.prestamo_id = p.id
  where
    -- INV 1: el denormalizado no coincide con el libro (trigger roto / dato tocado)
    abs(p.pagado_acum - coalesce(s.suma, 0)) >= 1
    -- INV 2: sobre-cobro (pagado > total a pagar)
    or (coalesce(s.suma, 0) - (p.cuota_diaria * p.total_dias)) >= 1;
$$;

-- Solo el server (cron con service_role) puede correrla; nunca anon/authenticated.
revoke all on function app_reconciliacion_violaciones() from anon, authenticated;
grant execute on function app_reconciliacion_violaciones() to service_role;
