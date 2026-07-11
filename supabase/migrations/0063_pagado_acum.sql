-- ─────────────────────────────────────────────────────────────────────────
--  0063 · pagado_acum DENORMALIZADO — cartera instantánea (perf, sin staleness).
--
--  app_cartera_activa()/_zona agregaban el Σ de ~150k pagos EN CADA carga (medido:
--  4,3 s para la cartera completa del admin). Ese Σ por-crédito cambia SOLO cuando
--  entra/anula un pago (pocos/día), así que se guarda denormalizado y se mantiene
--  con trigger. Las RPC pasan a LEER la columna (sin agregar el libro) → ~instantáneo.
--
--  ⚠️ Money-critical pero SEGURO: `pagos` sigue siendo la verdad inmutable; esto es
--  solo un CACHE derivado. Se backfillea EXACTO desde el libro y el trigger lo
--  mantiene con aritmética simple (monto es inmutable por 0002 → solo alta y
--  anulación lo mueven). Reconciliable en cualquier momento contra el Σ real.
--
--  El trigger es SECURITY DEFINER: el cobrador que inserta un pago NO tiene UPDATE
--  sobre `prestamos` por RLS; el trigger corre como owner y actualiza el acumulado.
--
--  Re-ejecutable. Correr en el SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Columna cache (Σ de pagos vigentes del crédito). Default 0 para créditos sin pagos.
alter table prestamos add column if not exists pagado_acum numeric(14,2) not null default 0;
comment on column prestamos.pagado_acum is
  'CACHE derivado: Σ monto de pagos NO anulados del crédito (0063). Verdad = tabla pagos; mantenido por trigger trg_pagos_acum. Reconciliable.';

-- 2) Backfill EXACTO desde el libro (una agregación + join; créditos sin pagos = 0).
update prestamos p set pagado_acum = coalesce(s.suma, 0)
from (
  select prestamo_id, sum(monto) as suma
  from pagos where anulado = false
  group by prestamo_id
) s
where s.prestamo_id = p.id;
-- (los prestamos sin ninguna fila en `s` quedan en el default 0, que es correcto)

-- 3) Trigger que mantiene pagado_acum. monto es inmutable (0002); solo cambian:
--    INSERT de pago vigente (+), anulación false→true (−), des-anulación true→false (+),
--    y DELETE de un pago vigente (−, por si un proceso administrativo borra por service_role).
create or replace function pagos_mantener_acum()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.anulado = false then
      update prestamos set pagado_acum = pagado_acum + NEW.monto where id = NEW.prestamo_id;
    end if;
  elsif TG_OP = 'UPDATE' then
    if OLD.anulado = false and NEW.anulado = true then
      update prestamos set pagado_acum = pagado_acum - OLD.monto where id = OLD.prestamo_id;
    elsif OLD.anulado = true and NEW.anulado = false then
      update prestamos set pagado_acum = pagado_acum + NEW.monto where id = NEW.prestamo_id;
    end if;
  elsif TG_OP = 'DELETE' then
    if OLD.anulado = false then
      update prestamos set pagado_acum = pagado_acum - OLD.monto where id = OLD.prestamo_id;
    end if;
  end if;
  return null; -- AFTER trigger
end;
$$;

drop trigger if exists trg_pagos_acum on pagos;
create trigger trg_pagos_acum
  after insert or update or delete on pagos
  for each row execute function pagos_mantener_acum();

-- 4) Las RPC de cartera LEEN pagado_acum (ya no agregan el libro). Misma forma de
--    salida (campo 'pagado') → lib/data/activos.ts las consume igual, sin cambios.
create or replace function app_cartera_activa()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when app_es_gestor() then (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'cliente_id', p.cliente_id, 'cobrador_id', p.cobrador_id,
      'monto_prestado', p.monto_prestado, 'cuota_diaria', p.cuota_diaria,
      'total_dias', p.total_dias, 'frecuencia', p.frecuencia,
      'fecha_inicio', p.fecha_inicio, 'disapp_credit_ref', p.disapp_credit_ref,
      'interes_pct', p.interes_pct, 'cliente_nombre', c.nombre,
      'cliente_documento', c.documento, 'cliente_telefono', c.telefono,
      'cliente_direccion', c.direccion, 'cliente_calificacion', c.calificacion,
      'cliente_gps_lat', c.gps_lat, 'cliente_gps_lng', c.gps_lng,
      'cobrador_nombre', u.nombre, 'pagado', p.pagado_acum
    )), '[]'::jsonb)
    from prestamos p
    join clientes c on c.id = p.cliente_id
    left join usuarios u on u.id = p.cobrador_id
    where p.estado = 'activo'
  ) else '[]'::jsonb end;
$$;

create or replace function app_cartera_activa_zona(cliente_ids uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  select case when app_es_gestor() then (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'cliente_id', p.cliente_id, 'cobrador_id', p.cobrador_id,
      'monto_prestado', p.monto_prestado, 'cuota_diaria', p.cuota_diaria,
      'total_dias', p.total_dias, 'frecuencia', p.frecuencia,
      'fecha_inicio', p.fecha_inicio, 'disapp_credit_ref', p.disapp_credit_ref,
      'interes_pct', p.interes_pct, 'cliente_nombre', c.nombre,
      'cliente_documento', c.documento, 'cliente_telefono', c.telefono,
      'cliente_direccion', c.direccion, 'cliente_calificacion', c.calificacion,
      'cliente_gps_lat', c.gps_lat, 'cliente_gps_lng', c.gps_lng,
      'cobrador_nombre', u.nombre, 'pagado', p.pagado_acum
    )), '[]'::jsonb)
    from prestamos p
    join clientes c on c.id = p.cliente_id
    left join usuarios u on u.id = p.cobrador_id
    where p.estado = 'activo'
      and p.cliente_id = any(cliente_ids)
  ) else '[]'::jsonb end;
$$;
