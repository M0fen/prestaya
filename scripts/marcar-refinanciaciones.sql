-- ═══════════════════════════════════════════════════════════════════════════
--  MARCADO DE REFINANCIACIONES (regla R2) — cuadre con Disapp
--  Correr en el SQL Editor DESPUÉS de 0054_refinanciacion.sql.
--
--  Regla R2 (validada contra Disapp, error 0,75%): dentro de cada (cliente,
--  modalidad) queda VIVO solo el crédito MÁS NUEVO; los anteriores son
--  refinanciaciones (rollover 0%) → estado='refinanciado'. Reproduce la cartera
--  real de Disapp ($68,5M) desde nuestros $94,3M.
--
--  ⚠️ Es data de DINERO. Correr [1] REVISIÓN primero, exportar el CSV, mirar los
--  de saldo alto (que sean claramente rollovers: crédito viejo superado por uno
--  más nuevo del mismo cliente/modalidad). Recién ahí correr [2] APLICAR.
--
--  Esperado (VALIDADO contra la DB de PRUEBA en vivo vía app_cartera_activa,
--  2026-07-10): **561 créditos** marcados (453 diario, 99 semanal, 9 quincenal),
--  saldo removido **~$26,4M**, cartera **$95,5M → $69,1M** — vs Disapp $68,5M =
--  **0,83% de error / −17 créditos**. Si [1b] no da cerca de 561 / ~$26M, PARAR.
--  (La DB tiene 2.957 activos, más que el Excel 09/07 = 2.754, porque el import
--  UPSERT nunca finaliza los que Disapp cerró; R2 los limpia igual.)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── [1] REVISIÓN — qué se marcaría (NO escribe). Exportar a CSV y revisar. ──
with ranked as (
  select
    p.id, p.cliente_id, p.frecuencia, p.fecha_inicio, p.disapp_credit_ref,
    p.monto_prestado, p.cuota_diaria, p.total_dias,
    coalesce((select sum(pg.monto) from pagos pg
              where pg.prestamo_id = p.id and pg.anulado = false), 0) as pagado,
    row_number() over (partition by p.cliente_id, p.frecuencia
                       order by p.fecha_inicio desc, p.id desc) as rn,
    first_value(p.disapp_credit_ref) over (partition by p.cliente_id, p.frecuencia
                       order by p.fecha_inicio desc, p.id desc) as ref_vigente,
    first_value(p.fecha_inicio) over (partition by p.cliente_id, p.frecuencia
                       order by p.fecha_inicio desc, p.id desc) as fecha_vigente
  from prestamos p
  where p.estado = 'activo'
)
select
  c.nombre                                   as cliente,
  r.frecuencia,
  r.disapp_credit_ref                        as credito_a_refinanciar,
  r.fecha_inicio,
  r.monto_prestado,
  r.pagado,
  (r.cuota_diaria * r.total_dias - r.pagado) as saldo_estimado,
  r.ref_vigente                              as reemplazado_por,
  r.fecha_vigente                            as fecha_del_vigente
from ranked r
join clientes c on c.id = r.cliente_id
where r.rn > 1
order by saldo_estimado desc;

-- ── [1b] TOTALES del review (para comparar con lo esperado ~$25M / ~415 créd) ──
with ranked as (
  select p.id, p.cliente_id, p.frecuencia, p.cuota_diaria, p.total_dias,
    coalesce((select sum(pg.monto) from pagos pg
              where pg.prestamo_id = p.id and pg.anulado = false), 0) as pagado,
    row_number() over (partition by p.cliente_id, p.frecuencia
                       order by p.fecha_inicio desc, p.id desc) as rn
  from prestamos p where p.estado = 'activo'
)
select
  count(*)                                           as creditos_a_marcar,
  round(sum(cuota_diaria * total_dias - pagado))     as saldo_a_remover
from ranked where rn > 1;

-- ═══════════════════════════════════════════════════════════════════════════
-- ── [2] APLICAR — marca los refinanciados. Correr solo tras revisar [1]. ──
-- with ranked as (
--   select p.id,
--     row_number() over (partition by p.cliente_id, p.frecuencia
--                        order by p.fecha_inicio desc, p.id desc) as rn
--   from prestamos p where p.estado = 'activo'
-- )
-- update prestamos
--   set estado = 'refinanciado', refinanciado_en = now()
-- where id in (select id from ranked where rn > 1);

-- ── [2b] VERIFICAR post-aplicar: cartera activa resultante (debería dar ~$69M) ──
-- select
--   count(*) filter (where estado = 'activo')        as creditos_activos,
--   count(*) filter (where estado = 'refinanciado')  as creditos_refinanciados
-- from prestamos;

-- ═══════════════════════════════════════════════════════════════════════════
-- ── [3] REVERTIR (deshacer todo, reversible 100%) ──
-- update prestamos set estado = 'activo', refinanciado_en = null
-- where estado = 'refinanciado';
