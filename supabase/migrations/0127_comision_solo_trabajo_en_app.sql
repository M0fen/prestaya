-- ─────────────────────────────────────────────────────────────────────────
--  0127 · COMISIONES = solo trabajo hecho EN LA APP (origen IS NULL).
--  Ejecutar en el SQL Editor. Re-ejecutable. Un solo cambio de función + una
--  limpieza puntual de un dato demo.
--
--  POR QUÉ (hallazgo de la auditoría post-empalme del 08-04, cuantificado en
--  la base viva): `app_comision_por_ruta` (0069) suma TODO pago no-anulado del
--  rango. Pero desde el empalme, la base convive con dos clases de plata:
--
--    · origen IS NULL          → pago registrado por un cobrador EN LA APP
--                                (el único trabajo que Presta Ya debe comisionar)
--    · origen = 'disapp_import'        (176.818) · cobros hechos en el mundo
--      viejo e importados por Excel — su comisión YA se liquidó allá.
--    · origen = 'ajuste_migracion'     (3.601)  · reconstrucción del empalme.
--    · origen = 'reconciliacion_zc'    (617)    · ajustes sincronización 07-21.
--    · origen = 'reconciliacion_0804'  (149)    · top-ups exactos del 08-04
--      ($644.806, $475.000 de créditos internos de supervisores).
--
--  Sin este filtro, la pantalla de Comisiones de HOY (mes de agosto) muestra
--  una base de $3.886.290 —100% importada, $0 nativa— y liquidarla pagaría
--  ~$116.589 (3%) por plata que Disapp ya comisionó. Liquidar julio pagaría
--  ~$1.301.717 de más. Y como las zonas no-piloto siguen importándose a
--  DIARIO, todos los períodos futuros quedaban contaminados igual.
--
--  Regla de negocio resultante: la comisión de una zona nace $0 y crece SOLO
--  con lo que sus cobradores registran en la app (piloto Zona Centro desde el
--  08-05; cada zona, desde el día que migre). Los paneles de negocio
--  (recaudo del día, cartera) NO cambian: siguen incluyendo los imports,
--  porque ahí la pregunta es "cuánta plata entró", no "cuánto trabajo en la
--  app hubo". Este split es deliberado.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function app_comision_por_ruta(desde timestamptz, hasta timestamptz)
returns table(cobrador_id uuid, recaudado numeric, cobros bigint)
language sql stable security definer set search_path = public as $$
  select pp.cobrador_id,
         coalesce(sum(p.monto), 0)::numeric as recaudado,
         count(*)::bigint as cobros
  from pagos p
  join prestamos pp on pp.id = p.prestamo_id
  where app_es_gestor()
    and p.anulado = false
    -- SOLO trabajo hecho en la app: los pagos importados de Disapp y los
    -- ajustes de reconciliación (origen no nulo) ya fueron comisionados o son
    -- asientos contables, nunca base de comisión.
    and p.origen is null
    and p.registrado_en >= desde
    and p.registrado_en < hasta
    and pp.cobrador_id is not null
  group by pp.cobrador_id;
$$;

grant execute on function app_comision_por_ruta(timestamptz, timestamptz) to authenticated;

-- Limpieza puntual: única liquidación existente = DEMO del 10 de julio
-- ($2.807, "Comisión Hoy · 10 jul"); su egreso demo ya fue borrado el 08-04.
-- Se borra para que el historial de comisiones arranque limpio en el piloto.
delete from comisiones_liquidadas where id = 'c39969cb-8d9c-4254-a99c-5295c3e5b1e2';

-- Verificación (debe devolver 0 filas: agosto no tiene trabajo en-app todavía):
-- select * from app_comision_por_ruta('2026-08-01T00:00:00-03:00','2026-09-01T00:00:00-03:00');
