# Prompt para Claude Code — Presta Ya (setup de base y capa de datos)

> Pega todo este contenido en Claude Code abierto dentro de una carpeta vacía
> del proyecto. Está pensado para construir primero los cimientos (base de
> datos + tipos + lógica) y dejar lo visual para un segundo paso.

---

## CONTEXTO DEL PROYECTO

Voy a construir "Presta Ya", la plataforma digital de un prestamista de cobro
diario en Uruguay con ~4.000 clientes. Tiene tres interfaces que comparten la
misma lógica: vista de cliente (solo lectura, por link), app de cobrador, y
panel de administración. EN ESTE PASO solo vamos a montar los cimientos: el
proyecto, la base de datos y la capa de datos. Lo visual va después.

REGLA CRÍTICA: esta app maneja DINERO de terceros. Un error de cálculo hace que
el prestamista pierda plata o cobre de más a un deudor. Prioriza corrección,
claridad y trazabilidad sobre velocidad. Comenta toda la lógica financiera.

STACK: Next.js 15 (App Router) + TypeScript + Tailwind CSS. Base de datos y auth
en Supabase (PostgreSQL). Despliegue en Vercel. Mobile-first.

---

## PASO 0 — Crear el skill del proyecto

Antes de nada, crea el archivo `.claude/skills/presta-ya/SKILL.md` con este
contenido, para que las reglas de negocio rijan TODO el desarrollo futuro:

```markdown
---
name: presta-ya
description: Reglas de negocio y diseño de Presta Ya, app de préstamos de cobro
  diario. Usar SIEMPRE que se trabaje en la vista de cliente, app de cobrador o
  panel admin de este proyecto.
---

# Presta Ya — Reglas del proyecto

## Naturaleza crítica
Maneja DINERO de terceros (préstamos de cobro diario, ~4.000 clientes). La
lógica de saldos y estados es crítica. Prioriza corrección y trazabilidad.
Nunca uses float para dinero: siempre numeric/decimal. Los pagos NO se borran
ni se editan: se anulan con registro de quién y por qué.

## Modelo del préstamo (idéntico en TODAS las interfaces)
- Cobro DIARIO de cuota fija. Un solo crédito activo por cliente a la vez.
- Cada día del crédito es una casilla con un estado:
  - PAGADO (verde #1FA971): el día tiene pago acumulado >= cuota diaria.
  - PENDIENTE (ámbar #E8A317): abono parcial (0 < pago < cuota), o es hoy y
    aún no se completa la cuota.
  - ATRASADO (rojo #D64545): día ya vencido sin pago.
  - FUTURO (gris #EEF1F8): día que aún no vence.
- Un abono parcial NO cuenta como día pagado: queda PENDIENTE.

## La lógica de estados es el núcleo
Debe vivir AISLADA de los componentes visuales (módulo propio, tipado en
TypeScript, testeable). Se reutiliza igual en cliente, cobrador y admin. Que un
día "atrasado" signifique lo mismo en las tres pantallas.

## El estado del cartón se CALCULA, no se guarda
La base guarda los pagos (verdad inmutable). Los estados de cada casilla se
derivan de los pagos en tiempo real. Nunca guardar el estado de la casilla.

## Paleta (exacta)
Azul rey #1E47C8 · azul oscuro #13308C · fondo #F6F8FD · tarjetas #FFFFFF ·
verde #1FA971 · ámbar #E8A317 · rojo #D64545 · texto #0F1B3D · secundario
#6B7494. Tipografía: Inter.

## Roles
admin (Mauricio, dueño), supervisor (su esposa), cobrador. Cada rol ve cosas
distintas. Un cobrador solo ve sus clientes asignados.

## Vista de cliente
Solo lectura. Sin botones de acción, sin WhatsApp, sin mostrar el cobrador.
Para adultos mayores: legible, números grandes, clara.
```

---

## PASO 1 — Andamiaje del proyecto

Crea el proyecto Next.js 15 con App Router, TypeScript y Tailwind. Instala el
cliente de Supabase (`@supabase/supabase-js` y `@supabase/ssr`). Propón una
estructura de carpetas limpia (lib para datos y lógica, types para tipos,
components para UI futura) y muéstramela antes de generar todo.

---

## PASO 2 — Esquema de la base de datos (Supabase / PostgreSQL)

Dame este esquema como un archivo de migración SQL en el proyecto (ej.
`supabase/migrations/0001_inicial.sql`) para que yo lo ejecute en el editor SQL
de Supabase. Revísalo, y si detectas alguna mejora de integridad o seguridad,
proponla ANTES de que lo ejecute:

```sql
-- Extensión necesaria para tokens y uuid
create extension if not exists pgcrypto;

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
  creado_en     timestamptz not null default now()
);

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
  creado_en       timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- PRÉSTAMOS (un cliente puede tener varios en el tiempo, uno activo)
-- ─────────────────────────────────────────────
create table prestamos (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references clientes(id),
  cobrador_id       uuid references usuarios(id),
  monto_prestado    numeric(12,2) not null,
  cuota_diaria      numeric(12,2) not null,
  total_dias        int not null check (total_dias > 0),
  fecha_inicio      date not null,
  estado            text not null default 'activo'
                    check (estado in ('activo','finalizado','cancelado','incobrable')),
  creado_por        uuid references usuarios(id),
  creado_en         timestamptz not null default now(),
  finalizado_en     timestamptz
);

-- Un cliente solo puede tener UN préstamo activo a la vez (regla a nivel de BD)
create unique index un_prestamo_activo_por_cliente
  on prestamos (cliente_id)
  where (estado = 'activo');

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
  motivo_anulacion text
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
```

DECISIONES QUE DEBES RESPETAR (no las cambies sin avisarme):
- Dinero siempre en `numeric`, nunca float.
- Los pagos no se borran ni editan: se anulan con `anulado = true` + auditoría.
- El estado de cada casilla del cartón NO se guarda: se calcula desde `pagos`.
- El índice único garantiza un solo préstamo activo por cliente a nivel de BD.

---

## PASO 3 — Variables de entorno (credenciales seguras)

Crea un archivo `.env.local.example` con las variables necesarias, SIN valores
reales:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

NO escribas ni inventes claves reales en ningún archivo. Yo pegaré mis claves en
`.env.local` (que debe estar en `.gitignore`). La `SERVICE_ROLE_KEY` se usa SOLO
en el servidor (server components / route handlers), NUNCA en el navegador.

---

## PASO 4 — Tipos y capa de acceso a datos

1. Crea los tipos TypeScript que reflejen el esquema (interfaces Usuario,
   Cliente, Prestamo, Pago, Visita, Asignacion), en `types/`.
2. Crea una capa de acceso a datos en `lib/` con funciones tipadas para leer y
   escribir (ej. obtener un cliente por token, obtener el préstamo activo de un
   cliente, listar los pagos de un préstamo, registrar un pago). Sepáralas por
   entidad. No mezcles SQL con componentes visuales.

---

## PASO 5 — La lógica de estados del cartón (el núcleo)

Crea un módulo aislado y bien tipado en `lib/cartones.ts` (o similar) que, dado
un préstamo y sus pagos, calcule el estado de cada día (pagado / pendiente /
atrasado / futuro), el total pagado, el saldo pendiente, el progreso, la próxima
cuota y el historial. Esta es la pieza más importante del sistema y se reutiliza
en las tres interfaces. Reglas exactas:

- futuro: la fecha del día es posterior a hoy.
- pagado: pago acumulado del día >= cuota diaria.
- pendiente: hay abono parcial (0 < pago < cuota), o es hoy sin completar.
- atrasado: día ya vencido sin ningún pago.

Acompáñalo de pruebas unitarias que cubran todos los casos (día pagado completo,
abono parcial, día atrasado sin pago, día futuro, el día de hoy). Como maneja
dinero, esta lógica debe estar probada.

> Tengo una implementación de referencia de esta lógica (de un prototipo de
> diseño) que te puedo pasar para que la portes fielmente. Pídemela cuando
> llegues a este paso.

---

## PASO 6 — Patrón de acceso de la vista de cliente (seguridad)

La vista de cliente se accede por un link con token, SIN login. El patrón seguro
es: el servidor de Next.js (server component o route handler) recibe el token,
consulta Supabase con la SERVICE_ROLE_KEY (solo en servidor), valida que el
token corresponda a un cliente, y devuelve ÚNICAMENTE los datos de ese cliente.
El navegador nunca habla directo con Supabase en esta vista. Implementa este
patrón cuando montemos la vista de cliente.

---

## CÓMO QUIERO QUE PROCEDAS

No generes todo de golpe. Avanza por pasos y muéstrame para validar:
1. Primero el Paso 0 (skill) y el Paso 1 (andamiaje + estructura propuesta).
   Espera mi aprobación.
2. Luego el Paso 2 (migración SQL) y revísalo críticamente antes de que lo corra.
3. Sigue con Pasos 3, 4 y 5.
4. El Paso 6 y todo lo visual quedan para después; no los hagas todavía.

Empieza por los Pasos 0 y 1.
```
