-- ─────────────────────────────────────────────────────────────────────────
--  0055 · GESTIONES DE COBRANZA (mini-CRM del supervisor)
--
--  Convierte la vigilancia (hoy solo-lectura) en CONTROL: el gestor registra
--  qué hizo con un moroso (visita/llamada/…) y, sobre todo, el COMPROMISO DE
--  PAGO ("$X el viernes"). El sistema NO guarda si se cumplió: lo DERIVA del
--  libro inmutable de pagos (auto-verificado) → cumplido / vence hoy / incumplido.
--
--  Append-only (como `pagos`/`auditoria`): sin UPDATE/DELETE. Corregir = agregar
--  una gestión nueva que supersede. Los compromisos viejos quedan como historia.
--  RLS por zona reusando 0031 (app_es_admin / app_gestor_ve_cliente). El cobrador
--  NO gestiona (es tarea del gestor); si a futuro se quiere, agregar
--  app_cobrador_tiene_cliente al using/check. Re-ejecutable. Correr en SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists gestiones_cobranza (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references clientes(id) on delete cascade,
  prestamo_id       uuid references prestamos(id) on delete set null,
  gestor_id         uuid not null references usuarios(id),
  gestor_nombre     text,
  -- Tipo de gestión. 'compromiso' = quedó una promesa de pago (usa monto+fecha).
  tipo              text not null check (tipo in
                      ('visita','llamada','mensaje','compromiso','acuerdo','ilocalizable','otro')),
  resultado         text,                              -- qué pasó (texto libre corto)
  monto_compromiso  numeric(12,2) check (monto_compromiso is null or monto_compromiso > 0),
  fecha_compromiso  date,                              -- para cuándo prometió pagar
  creado_en         timestamptz not null default now()
);

-- Timeline por cliente (más nuevo primero) + búsqueda de compromisos por vencimiento.
create index if not exists idx_gestiones_cliente on gestiones_cobranza (cliente_id, creado_en desc);
create index if not exists idx_gestiones_compromiso
  on gestiones_cobranza (fecha_compromiso) where fecha_compromiso is not null;

alter table gestiones_cobranza enable row level security;

-- Lectura/alta: admin todo; supervisor solo clientes de SU zona (helper de 0031).
drop policy if exists gestiones_select on gestiones_cobranza;
create policy gestiones_select on gestiones_cobranza
  for select to authenticated
  using ( app_es_admin() or app_gestor_ve_cliente(cliente_id) );

drop policy if exists gestiones_insert on gestiones_cobranza;
create policy gestiones_insert on gestiones_cobranza
  for insert to authenticated
  with check ( app_es_admin() or app_gestor_ve_cliente(cliente_id) );
-- Sin policy de UPDATE/DELETE a propósito → append-only (inmutable).
