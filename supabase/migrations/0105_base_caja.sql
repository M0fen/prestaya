-- ─────────────────────────────────────────────────────────────────────────
-- 0105 — BASE DE CAJA del cobrador (con qué plata arranca el día).
--
-- Hasta hoy el sistema asume que el cobrador arranca en $0: la rendición calcula
--   esperado = max(0, recaudado − gastos)
-- Pero en la realidad el supervisor le entrega una BASE (efectivo de arranque /
-- vuelto). Sin registrarla, al cerrar el cobrador o se la queda o descuadra. Esto
-- agrega la base y ajusta la rendición a:
--   esperado = max(0, base + recaudado − gastos)   (= debería entregar base + cobros − gastos)
--
-- CERO REGRESIÓN: la base default 0 → mientras no se registre ninguna, el sistema
-- se comporta EXACTAMENTE como hoy.
--
--  · aperturas_caja: la base de un cobrador para un día (una por día, unique).
--    La setea un gestor (supervisor de la zona / admin). El cobrador ve la suya.
--  · rendiciones.base: la base CONGELADA en la rendición al cerrar (auditable).
--
-- Correr en el SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────

-- Base congelada en la rendición del día (default 0 = conducta previa).
alter table rendiciones add column if not exists base numeric(12,2) not null default 0 check (base >= 0);

-- Base de arranque por cobrador/día.
create table if not exists aperturas_caja (
  id             uuid primary key default gen_random_uuid(),
  cobrador_id    uuid not null references usuarios(id),
  fecha          date not null default ((now() at time zone 'America/Montevideo')::date),
  base           numeric(12,2) not null default 0 check (base >= 0),
  entregada_por  uuid references usuarios(id),   -- gestor que fijó/entregó la base
  nota           text,
  actualizado_en timestamptz not null default now(),
  registrado_en  timestamptz not null default now(),
  unique (cobrador_id, fecha)                     -- una base por cobrador y día
);
create index if not exists idx_aperturas_caja_fecha on aperturas_caja (fecha);
create index if not exists idx_aperturas_caja_cobrador on aperturas_caja (cobrador_id);

alter table aperturas_caja enable row level security;

-- El cobrador VE su propia base; el gestor VE/SETEA la de los cobradores que
-- alcanza (su zona; admin = todos). Espeja las políticas de caja por zona.
-- (app_gestor_ve_cobrador ya incluye admin y supervisor-de-la-zona; espeja asignaciones.)
drop policy if exists aperturas_select on aperturas_caja;
create policy aperturas_select on aperturas_caja for select to authenticated
  using ( app_gestor_ve_cobrador(cobrador_id) or cobrador_id = app_usuario_id() );

drop policy if exists aperturas_insert on aperturas_caja;
create policy aperturas_insert on aperturas_caja for insert to authenticated
  with check ( app_gestor_ve_cobrador(cobrador_id) );

drop policy if exists aperturas_update on aperturas_caja;
create policy aperturas_update on aperturas_caja for update to authenticated
  using ( app_gestor_ve_cobrador(cobrador_id) ) with check ( app_gestor_ve_cobrador(cobrador_id) );
