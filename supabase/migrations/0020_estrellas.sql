-- ─────────────────────────────────────────────────────────────────────────
--  0020 · ESTRELLAS (redenciones). Sistema de recompensas dinero-adyacente.
--
--  Los FRAGMENTOS de estrella NO se guardan: se DERIVAN del conteo de pagos NO
--  anulados (1 pago = 1 fragmento; 5 fragmentos = 1 estrella). Si un pago se
--  anula, el fragmento desaparece solo → nunca hay "estrellas fantasma".
--  Lo ÚNICO que se persiste son las REDENCIONES (canjes), acá.
--
--  El cliente SOLICITA (queda 'pendiente') desde su vista por token (vía Server
--  Action con service_role, que valida el token). El admin APRUEBA/RECHAZA.
--  Tope de 5 estrellas por ciclo (mes calendario) — se valida en el servidor.
--  Ejecutar en el SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists estrellas_redenciones (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references clientes(id) on delete cascade,
  estrellas     int  not null check (estrellas > 0 and estrellas <= 5),
  ciclo         text not null,        -- "YYYY-MM" del mes de la solicitud
  estado        text not null default 'pendiente'
                   check (estado in ('pendiente','aprobada','rechazada')),
  nota          text,
  solicitado_en timestamptz not null default now(),
  resuelto_por  uuid references usuarios(id),
  resuelto_en   timestamptz
);

create index if not exists idx_redenciones_cliente on estrellas_redenciones (cliente_id);
create index if not exists idx_redenciones_estado  on estrellas_redenciones (estado);

alter table estrellas_redenciones enable row level security;

drop policy if exists redenciones_select_gestor on estrellas_redenciones;
drop policy if exists redenciones_update_gestor on estrellas_redenciones;

-- Solo gestores ven y resuelven (aprobar/rechazar). El cliente NO tiene acceso
-- directo: sus solicitudes entran por service_role (Server Action con token),
-- que ignora RLS. Sin acceso anónimo. No hay delete (traza).
create policy redenciones_select_gestor on estrellas_redenciones
  for select to authenticated using ( app_es_gestor() );
create policy redenciones_update_gestor on estrellas_redenciones
  for update to authenticated using ( app_es_gestor() ) with check ( app_es_gestor() );
