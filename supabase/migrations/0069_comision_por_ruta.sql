-- ─────────────────────────────────────────────────────────────────────────
--  0069 · Comisión atribuida al DUEÑO DE LA RUTA (no a quien registró el pago).
--  Ejecutar en el SQL Editor. Re-ejecutable. SEGURA (solo agrega una función,
--  no toca tablas ni datos; misma forma que las RPCs de 0040).
--
--  BUG que corrige: la comisión salía de `app_recaudo_agregado.porCobrador`, que
--  agrupa los pagos por `registrado_por` (quién lo tecleó). Un cobro registrado
--  por la OFICINA / una TRANSFERENCIA / otro cobrador quedaba atribuido a ese
--  registrador; como la lista de comisiones es solo rol='cobrador', ese recaudo
--  se DESCARTABA → el cobrador dueño de la ruta NO cobraba su comisión sobre ese
--  pago. Regla del negocio: el dueño de la ruta gana comisión por TODO lo cobrado
--  de su ruta, sin importar quién lo registró.
--
--  Esta RPC agrupa por `prestamos.cobrador_id` (el cobrador del crédito). Es
--  security definer (salta el RLS por-fila para escanear rápido) pero verifica el
--  ROL una vez con `app_es_gestor()`; un no-gestor recibe 0 filas. Rango
--  [desde, hasta) — `hasta` EXCLUSIVO (espeja `diaUYFinIso`, inicio del día
--  siguiente). No toca el dashboard: `app_recaudo_agregado` sigue por registrado_por
--  (ahí "quién cobró hoy" es lo correcto); esto es SOLO para liquidar comisiones.
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
    and p.registrado_en >= desde
    and p.registrado_en < hasta
    and pp.cobrador_id is not null
  group by pp.cobrador_id;
$$;

grant execute on function app_comision_por_ruta(timestamptz, timestamptz) to authenticated;
