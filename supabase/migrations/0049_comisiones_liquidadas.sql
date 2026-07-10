-- ─────────────────────────────────────────────────────────────────────────
--  0049 · COMISIONES LIQUIDADAS — idempotencia del pago de comisión.
--  Problema: "Liquidar" calculaba recaudado×% y registraba un egreso, pero NO
--  dejaba rastro de "ya liquidado este período" → se podía pagar dos veces la
--  misma comisión. Esta tabla es el candado: UNA liquidación por (cobrador,
--  período). El unique la hace idempotente a nivel de base (a prueba de doble
--  clic / doble pestaña). Ejecutar en SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists comisiones_liquidadas (
  id                    uuid primary key default gen_random_uuid(),
  cobrador_id           uuid references usuarios(id) on delete cascade,
  -- Clave canónica del período: 'dia:2026-07-09' · 'semana:2026-07-07' ·
  -- 'mes:2026-07' · 'anio:2026'. La arma la capa de datos (lib/data/comisiones).
  periodo_key           text not null,
  monto                 numeric(14,2) not null check (monto >= 0),
  liquidado_por         uuid references usuarios(id) on delete set null,
  liquidado_por_nombre  text,
  liquidado_en          timestamptz not null default now(),
  -- Candado: una sola liquidación por cobrador y período.
  unique (cobrador_id, periodo_key)
);

create index if not exists idx_comisiones_liq_periodo on comisiones_liquidadas (periodo_key);

alter table comisiones_liquidadas enable row level security;
drop policy if exists comisiones_liq_gestor_all on comisiones_liquidadas;
create policy comisiones_liq_gestor_all on comisiones_liquidadas
  for all to authenticated using (app_es_gestor()) with check (app_es_gestor());
