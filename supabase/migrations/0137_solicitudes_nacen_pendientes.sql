-- ─────────────────────────────────────────────────────────────────────────
--  0137 · UNA SOLICITUD NACE PENDIENTE. Siempre. Sin excepción.
--
--  EL AGUJERO (auditoría 09-08).
--  `solicitudes_gasto` tiene una policy de INSERT para el cobrador que solo ata
--  DE QUIÉN es la solicitud:
--      WITH CHECK (cobrador_id = app_usuario_id() AND solicitado_por = app_usuario_id())
--  No dice nada del ESTADO ni de las firmas de resolución. Todos los cobradores
--  tienen usuario y clave propios, así que cualquiera podía POSTear directo a
--  /rest/v1/solicitudes_gasto una fila así:
--
--      { cobrador_id: <él>, solicitado_por: <él>, monto: 80000,
--        estado: 'aprobada', resuelto_por_nombre: 'Mauricio (Mauro)' }
--
--  Y desde ahí no tenía que hacer nada más: la app cuenta los gastos APROBADOS
--  para bajar lo que tiene que entregar en el cierre, la pantalla le dice
--  "Cuadra ✓", y el gasto NO aparece en la bandeja del admin —porque la bandeja
--  lista los `pendiente`—. En el historial figura como "Aprobado · Mauricio
--  (Mauro)", idéntico a uno real.
--
--  QUÉ TAN GRAVE, HONESTAMENTE. No pasó nunca (1 sola solicitud de gasto en todo
--  el piloto) y hoy, SIN forjar nada, el cobrador ya puede bajarse el esperado
--  pidiendo un gasto normal por la app. Lo que compraba el forjado era la
--  INVISIBILIDAD: un gasto pendiente dispara alerta al día siguiente; el
--  "aprobado" trucho no dispara nada.
--
--  LA REGLA, en una línea: **quien pide no firma**. Una solicitud entra al mundo
--  pendiente y sin resolver; resolverla es un UPDATE, y los UPDATE de estas tres
--  tablas no los puede hacer nadie por REST (no hay policy de UPDATE): solo las
--  Server Actions, que validan el rol antes de tocar nada.
--
--  POR QUÉ UN TRIGGER Y NO SOLO LA POLICY. La policy protege el camino REST del
--  cobrador; el trigger protege TODOS los caminos, incluido un import, un script
--  o una Server Action con un bug. Es el mismo criterio que `pagos_no_borrar` y
--  `prestamos_no_borrar`: la última línea la pone la base, no la app.
--
--  Se aplica a las TRES colas por consistencia. En gasto cierra un agujero real
--  (el cobrador puede insertar); en renovación y anulación el INSERT ya exige
--  gestor, así que ahí es cinturón sobre tirantes — pero un supervisor tampoco
--  tiene por qué poder auto-firmarse una aprobación.
--
--  IDEMPOTENTE y SIN RIESGO PARA LO QUE YA FUNCIONA: se verificó que los tres
--  únicos caminos de INSERT de la app (lib/acciones/gastos.ts:88,
--  lib/acciones/anulaciones.ts:346, lib/data/solicitudesRenovacion.ts:39) crean
--  la fila SIN estado y SIN firmas — o sea, ya cumplen la regla. Resolver siempre
--  es UPDATE. Este trigger no cambia el comportamiento de ningún flujo vivo.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.solicitud_nace_pendiente()
returns trigger
language plpgsql
as $$
begin
  -- El estado inicial lo pone la BASE, no quien inserta. Se normaliza en vez de
  -- rechazar: un cliente que manda 'aprobada' no recibe un error que le enseñe
  -- dónde está el límite — recibe una solicitud pendiente, como corresponde.
  new.estado := 'pendiente';
  -- Las firmas de resolución son de quien resuelve. Quien pide no las escribe.
  new.resuelto_por  := null;
  new.resuelto_en   := null;
  new.motivo_rechazo := null;
  return new;
end;
$$;

comment on function public.solicitud_nace_pendiente() is
  'Fuerza que toda solicitud entre pendiente y sin firmar. Quien pide no firma su propia aprobación (0137).';

-- ── solicitudes_gasto — acá estaba el agujero real ─────────────────────────
-- Tiene `resuelto_por_nombre` (las otras dos no), así que necesita su propio
-- trigger que lo limpie también: sin eso, la fila forjada seguía mostrando
-- "Aprobado · Mauricio (Mauro)" en el historial del cobrador.
create or replace function public.solicitud_gasto_nace_pendiente()
returns trigger
language plpgsql
as $$
begin
  new.estado := 'pendiente';
  new.resuelto_por := null;
  new.resuelto_por_nombre := null;
  new.resuelto_en := null;
  new.motivo_rechazo := null;
  return new;
end;
$$;

drop trigger if exists trg_solgasto_nace_pendiente on public.solicitudes_gasto;
create trigger trg_solgasto_nace_pendiente
  before insert on public.solicitudes_gasto
  for each row execute function public.solicitud_gasto_nace_pendiente();

-- ── solicitudes_renovacion ─────────────────────────────────────────────────
drop trigger if exists trg_solren_nace_pendiente on public.solicitudes_renovacion;
create trigger trg_solren_nace_pendiente
  before insert on public.solicitudes_renovacion
  for each row execute function public.solicitud_nace_pendiente();

-- ── solicitudes_anulacion ──────────────────────────────────────────────────
-- Ojo: su estado resuelto se llama 'confirmada', no 'aprobada'; el CHECK acepta
-- 'pendiente' igual, así que la normalización vale sin tocar la restricción.
drop trigger if exists trg_solanul_nace_pendiente on public.solicitudes_anulacion;
create trigger trg_solanul_nace_pendiente
  before insert on public.solicitudes_anulacion
  for each row execute function public.solicitud_nace_pendiente();

-- ── Cinturón: la policy también lo dice ────────────────────────────────────
-- El trigger ya lo garantiza, pero dejar la regla ESCRITA en la policy hace que
-- el próximo que lea el permiso entienda el límite sin tener que ir a buscar el
-- trigger. Y si algún día alguien saca el trigger, la puerta REST sigue cerrada.
drop policy if exists solgasto_cobrador_insert on public.solicitudes_gasto;
create policy solgasto_cobrador_insert on public.solicitudes_gasto
  for insert
  with check (
    cobrador_id = app_usuario_id()
    and solicitado_por = app_usuario_id()
    -- Quien pide no firma: nace pendiente y sin resolver.
    and estado = 'pendiente'
    and resuelto_por is null
    and resuelto_por_nombre is null
    and resuelto_en is null
    and motivo_rechazo is null
  );
