-- ─────────────────────────────────────────────────────────────────────────
--  0016 · CONFIGURACIÓN de MORA (recargo por atraso, configurable).
--  Una sola fila (id=1). El recargo se CALCULA (no se guarda en el cartón, que
--  sigue siendo cuota×días inmutable): la mora es un cargo aparte que el equipo
--  ve y decide cobrar. El `tope_pct` ayuda a no pasarse de lo razonable/legal
--  (ley de usura 18.212). Ejecutar en el SQL Editor. Re-ejecutable.
--    modo: off        → sin recargo
--          fijo        → $ `valor` por cuota vencida (pasada la gracia)
--          pct         → `valor`% de la deuda vencida
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists config_mora (
  id              int primary key default 1 check (id = 1),
  modo            text not null default 'off' check (modo in ('off','fijo','pct')),
  valor           numeric(12,2) not null default 0 check (valor >= 0),
  cuotas_gracia   int not null default 1 check (cuotas_gracia >= 0),
  tope_pct        numeric(5,2) not null default 30 check (tope_pct >= 0 and tope_pct <= 100),
  actualizado_por uuid references usuarios(id),
  actualizado_en  timestamptz not null default now()
);

alter table config_mora enable row level security;

drop policy if exists config_mora_select on config_mora;
drop policy if exists config_mora_write on config_mora;

-- Solo gestores ven y editan la política de mora.
create policy config_mora_select on config_mora for select to authenticated
  using ( app_es_gestor() );
create policy config_mora_write on config_mora for all to authenticated
  using ( app_es_gestor() ) with check ( app_es_gestor() );

insert into config_mora (id) values (1) on conflict (id) do nothing;
