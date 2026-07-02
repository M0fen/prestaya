-- ─────────────────────────────────────────────────────────────────────────
--  0013 · RENDICIÓN DE JORNADA del cobrador (cierre de caja de la calle).
--  Al terminar el día el cobrador "rinde": declara cuánto EFECTIVO entrega y
--  qué GASTOS de ruta tuvo. El sistema conoce lo RECAUDADO (suma inmutable de
--  `pagos` que registró ese día) y calcula:
--     esperado   = recaudado − gastos     (lo que debería entregar)
--     diferencia = entregado − esperado   (<0 faltante · >0 sobrante · 0 cuadra)
--  Es la reconciliación anti-fuga que el arqueo (visual) no cerraba. NO mueve
--  la caja: los cobros ya están en `pagos`. Ejecutar en el SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists rendiciones (
  id              uuid primary key default gen_random_uuid(),
  cobrador_id     uuid not null references usuarios(id),
  fecha           date not null default ((now() at time zone 'America/Montevideo')::date),
  -- Snapshot de auditoría (lo cobrado por ese cobrador ese día).
  recaudado       numeric(12,2) not null default 0 check (recaudado >= 0),
  cobros_cantidad int not null default 0,
  -- Declarado por el cobrador al cerrar.
  gastos          numeric(12,2) not null default 0 check (gastos >= 0),
  entregado       numeric(12,2) not null default 0 check (entregado >= 0),
  -- entregado − (recaudado − gastos). Puede ser negativo (faltante).
  diferencia      numeric(12,2) not null default 0,
  notas           text,
  registrado_por  uuid references usuarios(id),
  creado_en       timestamptz not null default now(),
  -- Una rendición por cobrador por día.
  unique (cobrador_id, fecha)
);

create index if not exists idx_rendiciones_fecha on rendiciones (fecha desc);

alter table rendiciones enable row level security;

drop policy if exists rend_select on rendiciones;
drop policy if exists rend_insert on rendiciones;
drop policy if exists rend_delete on rendiciones;

-- El cobrador ve/crea SOLO su rendición; los gestores ven todas.
create policy rend_select on rendiciones for select to authenticated
  using ( app_es_gestor() or cobrador_id = app_usuario_id() );
create policy rend_insert on rendiciones for insert to authenticated
  with check ( cobrador_id = app_usuario_id() );
-- Corrección: solo el admin puede borrar una rendición (para rehacerla).
create policy rend_delete on rendiciones for delete to authenticated
  using ( app_rol() = 'admin' );
