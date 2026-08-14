-- ─────────────────────────────────────────────────────────────────────────
--  0139 · Las solicitudes de colocación llevan TIPO: renovación o venta nueva.
--
--  Regla de Carlos (08-13): la colocación solo pide autorización cuando el monto
--  supera el +20% sobre el último crédito. Hasta hoy, una VENTA NUEVA por encima
--  del techo era un rechazo seco ("pedíselo a tu supervisor") que se resolvía por
--  FUERA de la app — el mismo callejón que la auditoría del 10-08 marcó como el
--  problema de la cola de aprobaciones. Ahora genera una solicitud igual que la
--  renovación, pero al aprobarla hay que crear un crédito NUEVO sin finalizar el
--  anterior (que puede seguir vivo o ya estar saldado hace meses): por eso la
--  tabla necesita distinguir el tipo.
--
--    · 'renovacion' → aprobar FINALIZA el crédito anterior y crea el nuevo.
--    · 'venta'      → aprobar solo CREA el nuevo; prestamo_anterior_id es la
--                     referencia de tasa/techo, NO se toca.
--
--  Todo lo existente es renovación: default 'renovacion' y sin backfill.
-- ─────────────────────────────────────────────────────────────────────────
alter table solicitudes_renovacion
  add column if not exists tipo text not null default 'renovacion';

do $$ begin
  alter table solicitudes_renovacion
    add constraint solren_tipo_valido check (tipo in ('renovacion','venta'));
exception when duplicate_object then null; end $$;
