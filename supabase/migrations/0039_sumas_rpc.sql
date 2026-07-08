-- ─────────────────────────────────────────────────────────────────────────
--  0039 · Funciones de AGREGACIÓN (sumas) para el panel a escala real.
--  Ejecutar en el SQL Editor. Re-ejecutable.
--
--  PostgREST tiene los agregados deshabilitados y devuelve máx. 1000 filas por
--  request. Sumar "recaudado hoy/mes" trayendo decenas de miles de pagos a JS
--  rompe (URL/tope). Estas funciones suman EN LA BASE, en una sola llamada.
--
--  ⚠️ NO son SECURITY DEFINER a propósito: corren con los privilegios del que
--  llama, así el RLS de `pagos` sigue aplicando. El admin suma toda la cartera;
--  un supervisor con zona suma solo lo de su zona (igual que el resto del panel).
-- ─────────────────────────────────────────────────────────────────────────

-- Suma de pagos vigentes (no anulados) registrados desde un instante.
create or replace function app_suma_pagos_desde(desde timestamptz)
returns numeric language sql stable as $$
  select coalesce(sum(monto), 0)::numeric
    from pagos
   where anulado = false
     and registrado_en >= desde;
$$;

-- Suma de pagos vigentes en un rango [desde, hasta).
create or replace function app_suma_pagos_entre(desde timestamptz, hasta timestamptz)
returns numeric language sql stable as $$
  select coalesce(sum(monto), 0)::numeric
    from pagos
   where anulado = false
     and registrado_en >= desde
     and registrado_en <  hasta;
$$;

-- Conteo de pagos vigentes en un rango [desde, hasta) (para "cobros del período").
create or replace function app_cuenta_pagos_entre(desde timestamptz, hasta timestamptz)
returns bigint language sql stable as $$
  select count(*)::bigint
    from pagos
   where anulado = false
     and registrado_en >= desde
     and registrado_en <  hasta;
$$;

grant execute on function app_suma_pagos_desde(timestamptz)             to authenticated;
grant execute on function app_suma_pagos_entre(timestamptz, timestamptz) to authenticated;
grant execute on function app_cuenta_pagos_entre(timestamptz, timestamptz) to authenticated;
