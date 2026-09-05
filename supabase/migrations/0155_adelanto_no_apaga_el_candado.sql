-- ─────────────────────────────────────────────────────────────────────────
--  0155 · EL ADELANTO DEJA DE APAGAR EL CANDADO ANTI DOBLE-COBRO
--
--  EL PROBLEMA. El botón «adelantar próxima» manda `adelanto = true`, y esa
--  bandera apagaba LAS DOS guardias a la vez: el chequeo de la Server Action y el
--  P0413 de adentro de esta función. Pero la bandera significa «este toque es un
--  adelanto», no «el cliente pagó dos veces de verdad» — es la MISMA bandera para
--  dos cosas distintas, y con ella puesta no quedaba ninguna red.
--
--  Dejó 6 pares en el libro ($3.150), cuatro de ellos POSTERIORES a la 0147 que
--  cerró el hueco anterior. El peor: TRES pagos de $500 al mismo crédito y la
--  MISMA cuota, en 35 segundos.
--
--  POR QUÉ SE APAGABA. El candado compara monto y ventana de tiempo, pero NO la
--  cuota. Un adelanto legítimo —el cliente paga la de hoy y la que viene, mismo
--  importe, un minuto después— disparaba el P0413. Apagarlo entero era la salida
--  fácil.
--
--  LA SEPARACIÓN. `p_permitir_gemelo` deja de significar «no mires nada» y pasa a
--  significar «aceptá el mismo monto, pero en OTRA CUOTA»:
--    · adelantar la próxima  → otra cuota → entra, como debe ser;
--    · tocar dos veces la misma cuota por el mismo monto en minutos → NO es un
--      adelanto, es un toque repetido → P0413, con bandera o sin ella.
--
--  Y la bandera QUEDA GUARDADA (`pagos.es_adelanto`): hasta ahora no se persistía,
--  así que en el libro un adelanto legítimo y un toque de más eran idénticos y no
--  se podían distinguir ni mirándolos de a uno.
-- ─────────────────────────────────────────────────────────────────────────

alter table pagos
  add column if not exists es_adelanto boolean not null default false;

comment on column pagos.es_adelanto is
  'El cobrador marcó este cobro como ADELANTO de una cuota futura. Se guarda para '
  'poder distinguir en el libro un adelanto legítimo de un toque repetido: antes '
  'de 0155 la bandera no se persistía y los dos se veían iguales.';

create or replace function registrar_pago_seguro(
  p_prestamo_id uuid, p_dia_credito integer, p_monto numeric, p_registrado_por uuid,
  p_gps_lat numeric, p_gps_lng numeric, p_registrado_en timestamptz, p_op_id uuid,
  p_permitir_gemelo boolean default false,
  -- Nuevo y con default: las llamadas viejas siguen funcionando igual.
  p_es_adelanto boolean default false
) returns pagos language plpgsql as $$
declare
  v_total  numeric;
  v_acum   numeric;
  v_estado text;
  v_dueno  uuid;
  v_monto  numeric := round(p_monto);
  v_reg    timestamptz := coalesce(p_registrado_en, now());
  v_row    pagos;
begin
  if (v_reg at time zone 'America/Montevideo')::date
       is distinct from (now() at time zone 'America/Montevideo')::date
     or v_reg > now() + interval '5 minutes' then
    v_reg := now();
  end if;

  perform pg_advisory_xact_lock(hashtext(p_prestamo_id::text));

  -- 0152: se lee también el DUEÑO del crédito, bajo el mismo lock, para congelar
  -- a quién le corresponde la comisión de este cobro.
  select coalesce(cuota_diaria, 0) * coalesce(total_dias, 0), coalesce(pagado_acum, 0),
         estado, cobrador_id
    into v_total, v_acum, v_estado, v_dueno
    from prestamos
   where id = p_prestamo_id;
  if not found then
    raise exception 'prestamo % inexistente', p_prestamo_id using errcode = 'P0002';
  end if;

  if v_estado is distinct from 'activo' then
    raise exception 'el crédito no está activo (%)', v_estado using errcode = 'P0402';
  end if;

  -- ── EL CANDADO ANTI DOBLE-COBRO ────────────────────────────────────────
  -- Sin bandera: no entra el mismo MONTO al mismo crédito dentro de la ventana.
  -- Con bandera (adelanto): sí entra el mismo monto —es lo que un adelanto ES—
  -- pero NUNCA sobre la MISMA CUOTA. Repetir cuota y monto en minutos no es
  -- adelantar nada.
  if exists (
    select 1 from pagos g
    where g.prestamo_id = p_prestamo_id
      and g.anulado = false
      and g.origen is null
      and (p_op_id is null or g.op_id is distinct from p_op_id)
      and abs(g.monto - v_monto) < 0.5
      and g.registrado_en is not null
      and abs(extract(epoch from (g.registrado_en - v_reg))) <= 600
      and (not coalesce(p_permitir_gemelo, false) or g.dia_credito = p_dia_credito)
  ) then
    raise exception 'gemelo: el mismo monto ya entró a este crédito hace minutos'
      using errcode = 'P0413';
  end if;

  if v_acum + v_monto > v_total + 1 then
    raise exception 'sobre-pago: acum % + monto % supera total %', v_acum, v_monto, v_total
      using errcode = 'P0409';
  end if;

  insert into pagos (prestamo_id, dia_credito, monto, registrado_por, gps_lat, gps_lng,
                     registrado_en, op_id, comision_cobrador_id, es_adelanto)
  values (p_prestamo_id, p_dia_credito, v_monto, p_registrado_por, p_gps_lat, p_gps_lng,
          v_reg, p_op_id, v_dueno, coalesce(p_es_adelanto, false))
  returning * into v_row;

  return v_row;
end;
$$;
