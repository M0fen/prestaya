-- ─────────────────────────────────────────────────────────────────────────
--  0033 · CHAT por GRUPOS (Fase D). Ejecutar en el SQL Editor DESPUÉS de 0032.
--
--  Suma dos tipos de canal al chat existente, SIN romper 'general' ni el hilo
--  privado por cobrador ('cobrador'):
--    · 'supervisores' → admin + supervisores (coordinación de mandos).
--    · 'zona'         → admin + supervisor(es) de esa zona + cobradores de esa
--                       zona (columna zona_id).
--
--  Membresía DERIVADA de la zona (no hay tabla de miembros): al mover un
--  cobrador de zona o asignar un supervisor, su acceso al canal se ajusta solo.
--  Reusa los helpers de 0031 (app_es_admin / app_supervisa_zona) + app_mi_zona.
--  El cuerpo sigue cifrado (0008) y el RLS decide quién ve cada canal.
-- ─────────────────────────────────────────────────────────────────────────

-- Zona propia del actor (para el canal de zona del cobrador).
create or replace function app_mi_zona()
returns uuid language sql stable security definer set search_path = public as $$
  select zona_id from usuarios where id = app_usuario_id();
$$;
grant execute on function app_mi_zona() to authenticated;

-- 1) Nuevos tipos de ámbito + columna zona_id.
alter table mensajes drop constraint if exists mensajes_ambito_check;
alter table mensajes add constraint mensajes_ambito_check
  check (ambito in ('general','cobrador','supervisores','zona'));

alter table mensajes add column if not exists zona_id uuid references zonas(id);

-- Coherencia ámbito ↔ columnas (cada tipo exige/prohíbe lo suyo).
alter table mensajes drop constraint if exists mensajes_ambito_coherente;
alter table mensajes add constraint mensajes_ambito_coherente check (
  (ambito = 'general'      and cobrador_id is null and zona_id is null) or
  (ambito = 'cobrador'     and cobrador_id is not null and zona_id is null) or
  (ambito = 'supervisores' and cobrador_id is null and zona_id is null) or
  (ambito = 'zona'         and cobrador_id is null and zona_id is not null)
);

create index if not exists idx_mensajes_zona
  on mensajes (zona_id, creado_en) where ambito = 'zona';
create index if not exists idx_mensajes_supervisores
  on mensajes (creado_en) where ambito = 'supervisores';

-- 2) RLS: cada quien ve/escribe solo sus canales.
drop policy if exists mensajes_select on mensajes;
drop policy if exists mensajes_insert on mensajes;

create policy mensajes_select on mensajes for select to authenticated
  using (
    ambito = 'general'
    or (ambito = 'supervisores' and app_es_gestor())
    or (ambito = 'cobrador'
        and ( app_gestor_ve_cobrador(cobrador_id) or cobrador_id = app_usuario_id() ))
    or (ambito = 'zona'
        and ( app_es_admin() or app_supervisa_zona(zona_id) or app_mi_zona() = zona_id ))
  );

create policy mensajes_insert on mensajes for insert to authenticated
  with check (
    autor_id = app_usuario_id()
    and (
      ambito = 'general'
      or (ambito = 'supervisores' and app_es_gestor())
      or (ambito = 'cobrador'
          and ( app_gestor_ve_cobrador(cobrador_id) or cobrador_id = app_usuario_id() ))
      or (ambito = 'zona'
          and ( app_es_admin() or app_supervisa_zona(zona_id) or app_mi_zona() = zona_id ))
    )
  );

-- (La policy de delete de 0007 —solo admin— no cambia.)
