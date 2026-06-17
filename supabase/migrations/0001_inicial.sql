-- ─────────────────────────────────────────────────────────────────────────
--  Presta Ya — migración inicial
--  Ejecutar en el editor SQL de Supabase.
--
--  Convenciones:
--   · Dinero SIEMPRE en numeric (nunca float).
--   · Los pagos NO se borran ni editan: se anulan con auditoría.
--   · El estado de cada casilla del cartón NO se guarda: se calcula desde pagos.
--
--  Las líneas marcadas con "✦ MEJORA" son añadidos propuestos sobre el esquema
--  original (integridad / rendimiento / seguridad). Son seguros y no rompen el
--  modelo; puedes quitarlas si no las quieres.
-- ─────────────────────────────────────────────────────────────────────────

-- Extensión necesaria para tokens y uuid
create extension if not exists pgcrypto;

-- ✦ MEJORA: función reutilizable para mantener `actualizado_en` al día.
create or replace function set_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────
-- USUARIOS DEL SISTEMA (Mauricio, esposa, cobradores)
-- ─────────────────────────────────────────────
create table usuarios (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  telefono      text,
  rol           text not null check (rol in ('admin','supervisor','cobrador')),
  activo        boolean not null default true,
  auth_user_id  uuid references auth.users(id), -- vínculo con login de Supabase
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now() -- ✦ MEJORA: auditoría
);

-- ✦ MEJORA: un usuario de login (auth.users) mapea a UN solo usuario del sistema.
-- Además acelera el lookup auth.uid() -> usuario que harán las políticas RLS.
create unique index uniq_usuarios_auth_user on usuarios (auth_user_id)
  where (auth_user_id is not null);

create trigger trg_usuarios_actualizado
  before update on usuarios
  for each row execute function set_actualizado_en(); -- ✦ MEJORA

-- ─────────────────────────────────────────────
-- CLIENTES (deudores)
-- ─────────────────────────────────────────────
create table clientes (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  documento       text unique,
  telefono        text,
  direccion       text,
  token_acceso    text unique not null default encode(gen_random_bytes(24),'hex'),
  calificacion    text default 'nuevo'
                  check (calificacion in ('nuevo','excelente','bueno','regular','riesgo')),
  notas           text,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now() -- ✦ MEJORA: auditoría
);

create trigger trg_clientes_actualizado
  before update on clientes
  for each row execute function set_actualizado_en(); -- ✦ MEJORA

-- ─────────────────────────────────────────────
-- PRÉSTAMOS (un cliente puede tener varios en el tiempo, uno activo)
-- ─────────────────────────────────────────────
create table prestamos (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references clientes(id),
  cobrador_id       uuid references usuarios(id),
  monto_prestado    numeric(12,2) not null check (monto_prestado > 0), -- ✦ MEJORA: > 0
  cuota_diaria      numeric(12,2) not null check (cuota_diaria > 0),   -- ✦ MEJORA: > 0
  total_dias        int not null check (total_dias > 0),
  fecha_inicio      date not null,
  estado            text not null default 'activo'
                    check (estado in ('activo','finalizado','cancelado','incobrable')),
  creado_por        uuid references usuarios(id),
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(), -- ✦ MEJORA: auditoría
  finalizado_en     timestamptz
);

-- Un cliente solo puede tener UN préstamo activo a la vez (regla a nivel de BD)
create unique index un_prestamo_activo_por_cliente
  on prestamos (cliente_id)
  where (estado = 'activo');

-- ✦ MEJORA: índices para las búsquedas más frecuentes (FK no se indexan solas).
create index idx_prestamos_cliente  on prestamos (cliente_id);
create index idx_prestamos_cobrador on prestamos (cobrador_id);

create trigger trg_prestamos_actualizado
  before update on prestamos
  for each row execute function set_actualizado_en(); -- ✦ MEJORA

-- ─────────────────────────────────────────────
-- PAGOS (libro contable inmutable — la verdad del dinero)
-- ─────────────────────────────────────────────
create table pagos (
  id               uuid primary key default gen_random_uuid(),
  prestamo_id      uuid not null references prestamos(id),
  dia_credito      int not null check (dia_credito >= 1),
  monto            numeric(12,2) not null check (monto > 0),
  registrado_por   uuid references usuarios(id),
  registrado_en    timestamptz not null default now(),
  gps_lat          numeric(9,6),
  gps_lng          numeric(9,6),
  -- reversiones sin borrar (corrección de errores)
  anulado          boolean not null default false,
  anulado_por      uuid references usuarios(id),
  anulado_en       timestamptz,
  motivo_anulacion text,
  -- ✦ MEJORA: si un pago está anulado, EXIGE quién, cuándo y por qué.
  constraint chk_pago_anulacion_completa check (
    anulado = false
    or (anulado_por is not null and anulado_en is not null and motivo_anulacion is not null)
  )
);

create index idx_pagos_prestamo on pagos (prestamo_id) where (anulado = false);

-- ─────────────────────────────────────────────
-- VISITAS (registro de ruta: "pasé y no pagó", etc.)
-- ─────────────────────────────────────────────
create table visitas (
  id             uuid primary key default gen_random_uuid(),
  prestamo_id    uuid not null references prestamos(id),
  cobrador_id    uuid references usuarios(id),
  resultado      text not null check (resultado in ('pago','abono','no_pago','no_estaba','otro')),
  motivo         text,
  gps_lat        numeric(9,6),
  gps_lng        numeric(9,6),
  registrado_en  timestamptz not null default now()
);

-- ✦ MEJORA: índices para listar visitas por préstamo / por cobrador.
create index idx_visitas_prestamo on visitas (prestamo_id);
create index idx_visitas_cobrador on visitas (cobrador_id);

-- ─────────────────────────────────────────────
-- ASIGNACIONES (qué cobrador atiende a qué cliente)
-- ─────────────────────────────────────────────
create table asignaciones (
  id            uuid primary key default gen_random_uuid(),
  cobrador_id   uuid not null references usuarios(id),
  cliente_id    uuid not null references clientes(id),
  activo        boolean not null default true,
  asignado_en   timestamptz not null default now(),
  unique (cobrador_id, cliente_id)
);

-- ✦ MEJORA: índice para la consulta "clientes de este cobrador" (RLS / rutas).
create index idx_asignaciones_cobrador on asignaciones (cobrador_id) where (activo = true);

-- ─────────────────────────────────────────────
-- SEGURIDAD: activar Row Level Security en todas las tablas.
-- (Las políticas detalladas por rol se definen en un paso dedicado posterior.)
-- Con RLS activo y sin políticas, el acceso anónimo queda BLOQUEADO por defecto,
-- que es el estado seguro mientras diseñamos las políticas.
-- ─────────────────────────────────────────────
alter table usuarios     enable row level security;
alter table clientes     enable row level security;
alter table prestamos    enable row level security;
alter table pagos        enable row level security;
alter table visitas      enable row level security;
alter table asignaciones enable row level security;

-- ═════════════════════════════════════════════════════════════════════════
--  PROPUESTAS APLICADAS (A y B)
-- ═════════════════════════════════════════════════════════════════════════

-- (A) Un solo cobrador ACTIVO por cliente: un cliente nunca está asignado a
--     dos cobradores a la vez.
create unique index un_cobrador_activo_por_cliente
  on asignaciones (cliente_id)
  where (activo = true);

-- (B) Impedir registrar un pago en un día fuera del rango del crédito
--     (dia_credito > total_dias). Integridad de dinero: cruza tablas, por eso
--     se implementa como trigger.
create or replace function chk_dia_credito_en_rango()
returns trigger language plpgsql as $$
declare v_total int;
begin
  select total_dias into v_total from prestamos where id = new.prestamo_id;
  if new.dia_credito > v_total then
    raise exception 'dia_credito % excede total_dias % del préstamo',
      new.dia_credito, v_total;
  end if;
  return new;
end;
$$;
create trigger trg_pagos_dia_en_rango
  before insert on pagos
  for each row execute function chk_dia_credito_en_rango();
