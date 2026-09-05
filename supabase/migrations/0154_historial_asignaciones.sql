-- ─────────────────────────────────────────────────────────────────────────
--  0154 · HISTORIAL DE ASIGNACIONES — que una baja deje rastro
--
--  HOY NO EXISTE. `asignaciones` tiene seis columnas y ninguna dice cuándo se
--  dio de baja una relación, quién la bajó ni por qué: solo la bandera `activo`.
--  Resultado: hay 33 asignaciones inactivas en la base y no hay forma de saber
--  cuándo ni quién las desactivó — son del 8-9 de julio y eso es todo lo que se
--  puede afirmar. Sin esto, ninguna reasignación se puede auditar hacia atrás ni
--  deshacer.
--
--  POR QUÉ UNA TABLA DE EVENTOS Y NO DOS COLUMNAS EN `asignaciones`:
--
--   1. Dos columnas guardan solo la ÚLTIMA baja. Un cliente que va A → B → A → B
--      pierde todo el recorrido menos el último tramo, y justamente el recorrido
--      es lo que se quiere poder auditar.
--   2. `reasignarCliente` reactiva filas viejas con un UPSERT sobre el índice
--      (cobrador_id, cliente_id). Con columnas de baja habría que acordarse de
--      limpiarlas en cada reactivación; la que se olvide deja una fila "activa"
--      que dice cuándo se dio de baja. Un evento nuevo no puede quedar sucio.
--   3. Los eventos permiten registrar también el ALTA, que es la otra mitad de
--      la pregunta "¿de quién era este cliente el 15 de agosto?".
--
--  ⚠️ EL HISTORIAL ARRANCA ACÁ. No se reconstruye el pasado: lo anterior no es
--  recuperable desde el esquema y inventarlo sería peor que no tenerlo. La tabla
--  nace vacía a propósito.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists asignaciones_eventos (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references clientes(id),
  cobrador_id   uuid not null references usuarios(id),
  -- 'alta'  = el cliente entró a la ruta de este cobrador
  -- 'baja'  = salió de su ruta
  accion        text not null check (accion in ('alta', 'baja')),
  -- Por qué. Texto libre corto, escrito por quien lo hizo. Puede faltar en los
  -- movimientos automáticos (el alta que hace una venta nueva, por ejemplo).
  motivo        text,
  -- Quién lo hizo. NULL solo para movimientos del sistema.
  actor_id      uuid references usuarios(id),
  actor_nombre  text,
  creado_en     timestamptz not null default now()
);

comment on table asignaciones_eventos is
  'Historial de entradas y salidas de un cliente en la ruta de un cobrador. '
  'Arranca el 04-09-2026: lo anterior no es reconstruible desde el esquema. '
  'Solo se escribe (nunca se edita ni se borra): es un libro, como `auditoria`.';

-- Las dos preguntas que se van a hacer: "¿qué pasó con este cliente?" y
-- "¿qué se movió de la ruta de este cobrador?".
create index if not exists idx_asig_eventos_cliente
  on asignaciones_eventos (cliente_id, creado_en desc);
create index if not exists idx_asig_eventos_cobrador
  on asignaciones_eventos (cobrador_id, creado_en desc);

alter table asignaciones_eventos enable row level security;

-- LECTURA: los gestores, acotado por su zona igual que el resto del panel. Se
-- reusa `app_gestor_ve_cliente`, que es la misma función que gobierna quién ve
-- una ficha — así el historial no puede mostrar más de lo que ya se ve.
drop policy if exists asig_eventos_select on asignaciones_eventos;
create policy asig_eventos_select on asignaciones_eventos
  for select using (app_es_gestor() and app_gestor_ve_cliente(cliente_id));

-- ESCRITURA: nadie por la API. Estos eventos los escribe el servidor por una vía
-- de confianza (service_role), en la misma transacción que el movimiento que
-- describen. Un libro que cualquiera puede escribir no es un libro.
drop policy if exists asig_eventos_insert on asignaciones_eventos;
create policy asig_eventos_insert on asignaciones_eventos
  for insert with check (false);

-- Sin UPDATE ni DELETE: no hay policy, así que están vetados para todos los roles
-- de API (igual que el resto del libro inmutable).
