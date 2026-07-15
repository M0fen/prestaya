-- ─────────────────────────────────────────────────────────────────────────
--  FEATURE FLAGS en DB — para poder cambiar comportamiento SIN redeploy.
--  El uso crítico es el KILL SWITCH "modo solo lectura": si la reconciliación
--  detecta corrupción de dinero, se CONGELAN las escrituras de plata al instante
--  (desde el panel o el SQL editor) mientras se investiga, sin esperar a Vercel.
--  "El kill switch es esencial para fintechs." Idempotente.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists feature_flags (
  clave          text primary key,
  activo         boolean not null default false,
  descripcion    text,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid
);

-- El kill switch de escrituras de plata (arranca APAGADO = operación normal).
insert into feature_flags (clave, activo, descripcion)
values ('modo_solo_lectura', false, 'Congela las escrituras de dinero (pagos, caja, comisiones, gastos, cierre) — kill switch de emergencia.')
on conflict (clave) do nothing;

alter table feature_flags enable row level security;

-- LECTURA: cualquier usuario interno autenticado puede leer los flags (la app
-- consulta el kill switch antes de cada escritura de plata).
drop policy if exists ff_select on feature_flags;
create policy ff_select on feature_flags for select to authenticated using (true);

-- ESCRITURA: solo el service_role (server / acción admin). El panel togglea con el
-- admin client; nadie puede prender/apagar un flag desde el navegador.
drop policy if exists ff_write on feature_flags;
create policy ff_write on feature_flags for all to service_role using (true) with check (true);
