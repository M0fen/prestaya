-- ─────────────────────────────────────────────────────────────────────────
--  Presta Ya — AJUSTES del GAMING (control del admin sobre la zona de juego).
--  Ejecutar en el SQL Editor DESPUÉS de 0008. Re-ejecutable.
--
--  Una sola fila (id = 1) con la configuración: encender/apagar la zona de
--  juego, elegir el juego arcade del mes, la meta de racha, el premio y los
--  mensajes. La vista del cliente (servida con service_role) la lee; el resto
--  del código degrada a los valores por defecto si esta tabla no existe.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists ajustes_juego (
  id                 int primary key default 1 check (id = 1),
  activo             boolean not null default true,
  juego_activo       text not null default 'penales-mundial',
  meta_racha         int not null default 10 check (meta_racha between 1 and 60),
  premio_meta        text not null default 'Mejor tasa en tu próximo crédito',
  mensaje_bienvenida text not null default 'Cada pago te acerca a tu meta. ¡Seguí así!',
  mostrar_misiones   boolean not null default true,
  actualizado_en     timestamptz not null default now()
);

insert into ajustes_juego (id) values (1) on conflict (id) do nothing;

alter table ajustes_juego enable row level security;

drop policy if exists ajustes_juego_select on ajustes_juego;
drop policy if exists ajustes_juego_update on ajustes_juego;

-- Gestores leen y editan. La vista de cliente usa service_role (ignora RLS).
create policy ajustes_juego_select on ajustes_juego for select to authenticated
  using ( app_es_gestor() );
create policy ajustes_juego_update on ajustes_juego for update to authenticated
  using ( app_es_gestor() ) with check ( app_es_gestor() );

drop trigger if exists trg_ajustes_juego_actualizado on ajustes_juego;
create trigger trg_ajustes_juego_actualizado
  before update on ajustes_juego
  for each row execute function set_actualizado_en();
