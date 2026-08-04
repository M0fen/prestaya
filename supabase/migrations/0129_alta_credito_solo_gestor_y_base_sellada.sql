-- ─────────────────────────────────────────────────────────────────────────
--  0129 · Dos cierres de la auditoría de "censo / alta de crédito / base de caja"
--  (08-04). Ejecutar en el SQL Editor. Re-ejecutable.
--
--  (A) CREAR UN CRÉDITO ES DE GESTOR — también a nivel base.
--      `crearCreditoNuevo` exige admin/supervisor… pero SOLO en TypeScript. La
--      policy de INSERT de `prestamos` (0035) aceptaba además la rama
--      `app_cobrador_tiene_cliente(cliente_id)`: con su propia sesión y la anon
--      key (pública, va en el navegador), un COBRADOR podía POSTear una fila a
--      /rest/v1/prestamos y colocarse capital a sí mismo — saltando el CAP de
--      $100.000, el tope del tramo, el kill-switch y la auditoría. 0126 congeló
--      UPDATE y DELETE de `prestamos`, pero no el INSERT.
--      Esa rama venía de 0035, cuyo objetivo era cerrar escrituras cruzadas
--      entre supervisores; el permiso al cobrador fue colateral.
--      Los RPC de dinero (crear_credito_venta_seguro, renovar_credito_seguro)
--      son SECURITY DEFINER: no los toca esta policy.
--
--  (B) LA BASE DE CAJA SE SELLA CON LA RENDICIÓN.
--      `esperado = base + recaudado − gastos`. Si la base se edita DESPUÉS de
--      que el cobrador rindió, lo ya rendido no cambia: solo queda una
--      divergencia (que INV6 canta recién a la mañana siguiente). Y subirla
--      sabiendo lo que el cobrador trae sirve para fabricarle un faltante.
--      El guard nuevo del Server Action lo frena por la app; este trigger lo
--      frena también por la API.
-- ─────────────────────────────────────────────────────────────────────────

-- ── (A) INSERT de préstamos: solo gestor con alcance sobre el cliente ──────
drop policy if exists prestamos_insert on prestamos;
create policy prestamos_insert on prestamos for insert to authenticated
  with check (
    app_es_gestor()
    and (
      app_gestor_ve_cliente(cliente_id)
      -- Cliente sin zona resoluble (censado por alguien sin zona, o en
      -- transición): se permite adoptarlo, igual que antes. Sigue exigiendo
      -- gestor, que es lo que faltaba.
      or app_zona_de_cliente(cliente_id) is null
    )
  );

-- ── (B) aperturas_caja congelada si ya hay rendición de ese cobrador/día ───
create or replace function apertura_no_editar_post_rendicion()
returns trigger language plpgsql as $$
begin
  -- Vías de confianza (service_role / SECURITY DEFINER) siguen pudiendo
  -- corregir: la escotilla es deliberada para reparaciones administrativas.
  if current_user not in ('authenticated', 'anon') then
    return NEW;
  end if;
  if exists (
    select 1 from rendiciones r
    where r.cobrador_id = NEW.cobrador_id
      and r.fecha = NEW.fecha
  ) then
    raise exception
      'La base de caja de ese cobrador ya quedó sellada con su rendición del día; no se edita después de cerrar.'
      using errcode = 'P0403';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_apertura_post_rendicion on aperturas_caja;
create trigger trg_apertura_post_rendicion
  before insert or update on aperturas_caja
  for each row execute function apertura_no_editar_post_rendicion();

-- Verificación:
--   · Un cobrador logueado que POSTee a /rest/v1/prestamos debe recibir 42501.
--   · Fijar la base de un cobrador que ya rindió hoy debe devolver P0403.
