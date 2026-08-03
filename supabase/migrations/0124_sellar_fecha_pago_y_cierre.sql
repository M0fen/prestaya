-- ─────────────────────────────────────────────────────────────────────────
-- 0124 — Dos cierres de superficie SQL (auditoría 08-02). Ambos son huecos que
-- solo se explotan hablando PostgREST directo (insider con JWT válido), pero los
-- dos mueven DINERO REAL, así que la defensa tiene que vivir en la base.
--
--  (A) registrar_pago_seguro aceptaba `p_registrado_en` ARBITRARIO. El sellado
--      del día contable vivía SOLO en TypeScript (`sellarRegistroEn`), que un
--      insider esquiva llamando el RPC directo. Con una fecha de un día YA
--      RENDIDO, el pago existe (el cartón del cliente lo muestra, no reclama)
--      pero NO entra en la rendición de hoy (que filtra registrado_en >= hoy) →
--      el cobrador entrega ESE efectivo de menos y su cierre igual marca
--      "cuadra ✓". La rendición vieja ya está cerrada y nadie la recalcula, y la
--      reconciliación tampoco lo ve (pagado_acum == Σpagos, sin sobre-cobro).
--      Efectivo embolsado sin faltante. Y `registrado_en` es INMUTABLE (0121),
--      así que la mentira queda grabada para siempre.
--      → Se clampa DENTRO del RPC con la misma regla que el TS: si la fecha no
--        cae en el día UY del servidor (o viene del futuro), se usa now().
--      CERO REGRESIÓN verificada llamador por llamador:
--        · panel admin  → manda p_registrado_en = null (lib/acciones/pagosPanel.ts)
--        · app cobrador → ya viene sellada al mismo día UY (sellarRegistroEn)
--        · importadores históricos → NO usan este RPC (hacen INSERT directo con
--          service_role), así que su carga de fechas viejas sigue intacta.
--
--  (B) cierres_zona era EDITABLE y BORRABLE por el mismo supervisor al que
--      audita (policy `for all`). Es el eslabón del medio de la cadena de
--      custodia (cobrador → supervisor → caja central) y guarda el snapshot
--      autoritativo esperado/entregado/diferencia. Un supervisor con faltante
--      podía hacer PATCH poniendo diferencia=0, o DELETE y volver a cerrar con
--      números a mano (el unique(zona,fecha) no impide borrar y rehacer).
--      → SELECT/INSERT como antes; sin UPDATE ni DELETE; + trigger que congela
--        los montos (espejo del de movimientos_caja, 0118).
--      CERO REGRESIÓN verificada: el único write de la app sobre esta tabla es
--      el INSERT de lib/acciones/cierreZona.ts (no hay reapertura ni edición).
-- ─────────────────────────────────────────────────────────────────────────

-- ══ (A) Clamp del día contable dentro del RPC de cobro ═══════════════════════
-- Cuerpo IDÉNTICO al vigente (0079) salvo el clamp de la fecha.
create or replace function registrar_pago_seguro(
  p_prestamo_id   uuid,
  p_dia_credito   int,
  p_monto         numeric,
  p_registrado_por uuid,
  p_gps_lat       numeric,
  p_gps_lng       numeric,
  p_registrado_en timestamptz,
  p_op_id         uuid
) returns pagos
language plpgsql
as $$
declare
  v_total numeric;
  v_acum  numeric;
  v_monto numeric := round(p_monto);
  v_reg   timestamptz := coalesce(p_registrado_en, now());
  v_row   pagos;
begin
  -- SELLADO DEL DÍA CONTABLE (espejo de lib/fecha.ts::sellarRegistroEn): el pago
  -- pertenece al día de Uruguay del SERVIDOR. Un timestamp de otro día (pasado o
  -- futuro) se descarta y se usa now(). Cierra la evasión de la rendición por REST.
  if (v_reg at time zone 'America/Montevideo')::date
       is distinct from (now() at time zone 'America/Montevideo')::date
     or v_reg > now() + interval '5 minutes' then
    v_reg := now();
  end if;

  -- Serializa por crédito: dos cobros concurrentes al mismo crédito ya no se pisan.
  perform pg_advisory_xact_lock(hashtext(p_prestamo_id::text));

  select coalesce(cuota_diaria, 0) * coalesce(total_dias, 0), coalesce(pagado_acum, 0)
    into v_total, v_acum
    from prestamos
   where id = p_prestamo_id;
  if not found then
    raise exception 'prestamo % inexistente', p_prestamo_id using errcode = 'P0002';
  end if;

  -- Anti sobre-pago ATÓMICO (tolerancia 1 peso por cuota fraccionaria importada).
  if v_acum + v_monto > v_total + 1 then
    raise exception 'sobre-pago: acum % + monto % supera total %', v_acum, v_monto, v_total
      using errcode = 'P0409';
  end if;

  insert into pagos (prestamo_id, dia_credito, monto, registrado_por, gps_lat, gps_lng, registrado_en, op_id)
  values (p_prestamo_id, p_dia_credito, v_monto, p_registrado_por, p_gps_lat, p_gps_lng,
          v_reg, p_op_id)
  returning * into v_row;   -- op_id repetido rebota con 23505 (idempotente arriba)

  return v_row;
end;
$$;

grant execute on function registrar_pago_seguro(uuid, int, numeric, uuid, numeric, numeric, timestamptz, uuid) to authenticated, service_role;

-- ══ (B) cierres_zona: snapshot de custodia inmutable ═════════════════════════
-- IDEMPOTENTE: se dropean TODOS los nombres (el viejo `for all` y los nuevos) antes
-- de crear — así el archivo se puede re-correr entero sin el 42710 "already exists".
drop policy if exists cierres_zona_gestor_all on cierres_zona;
drop policy if exists cierres_zona_select on cierres_zona;
drop policy if exists cierres_zona_insert on cierres_zona;

-- Lectura: igual que antes (admin, supervisor sin zonas, o supervisor de la zona).
create policy cierres_zona_select on cierres_zona for select to authenticated
  using ( app_es_admin() or app_supervisor_sin_zonas() or app_supervisa_zona(zona_id) );

-- Alta: igual que antes + el sello queda a nombre de quien lo firma.
create policy cierres_zona_insert on cierres_zona for insert to authenticated
  with check ( ( app_es_admin() or app_supervisor_sin_zonas() or app_supervisa_zona(zona_id) )
               and supervisor_id = app_usuario_id() );

-- (sin policy de UPDATE ni DELETE: el cierre es un snapshot. Una corrección se
--  hace con un cierre compensatorio o, excepcionalmente, por service_role.)

-- Blindaje extra: aunque un camino con service_role intente editar los montos del
-- sello, el trigger los congela (espejo de mov_caja_no_editar_financiero, 0118).
create or replace function cierres_zona_no_editar_financiero()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.zona_id           is distinct from old.zona_id
     or new.fecha          is distinct from old.fecha
     or new.total_esperado is distinct from old.total_esperado
     or new.total_entregado is distinct from old.total_entregado
     or new.diferencia     is distinct from old.diferencia
     or new.supervisor_id  is distinct from old.supervisor_id then
    raise exception 'el cierre de zona es un registro de custodia inmutable (zona/fecha/montos/supervisor)'
      using errcode = 'P0403';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cierres_zona_inmutable on cierres_zona;
create trigger trg_cierres_zona_inmutable
  before update on cierres_zona
  for each row execute function cierres_zona_no_editar_financiero();
