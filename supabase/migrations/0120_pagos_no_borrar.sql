-- ─────────────────────────────────────────────────────────────────────────
--  0120 · GUARDIA contra DELETE de pagos (cierra el último borde del append-only).
--
--  Hallazgo de la auditoría de durabilidad (07-30): la inmutabilidad del libro de
--  pagos se apoya en RLS (sin policy de DELETE = nadie borra) y en el trigger de
--  UPDATE. PERO service_role BYPASSA RLS: un script o acción del servidor con la
--  service key podía BORRAR filas del libro, y solo lo notaría la reconciliación
--  ex-post. El trigger de pagado_acum (0063) YA contempla ese DELETE ("por si un
--  proceso administrativo borra por service_role") — o sea, era un camino real.
--
--  Los triggers SÍ corren para service_role (el bypass es de RLS, NO de triggers),
--  así que esta guardia cierra el hueco de verdad: BEFORE DELETE que lanza excepción,
--  salvo que la MISMA transacción declare explícitamente la intención con un GUC de
--  sesión (escotilla para un borrado administrativo excepcional y deliberado).
--
--  Uso de la escotilla (solo en un caso justificado, dentro de una transacción):
--      begin;
--      set local app.permitir_borrado_pagos = 'on';
--      delete from pagos where id = '...';   -- o lo que corresponda
--      commit;
--  Sin ese `set local`, cualquier DELETE (incluido service_role o un script
--  accidental) es rechazado.
--
--  Re-ejecutable. Correr en el SQL Editor DESPUÉS de 0119.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function pagos_no_borrar()
returns trigger language plpgsql as $$
begin
  -- current_setting(..., true) = no lanza si el GUC no está seteado (devuelve null).
  if coalesce(current_setting('app.permitir_borrado_pagos', true), 'off') <> 'on' then
    raise exception
      'El libro de pagos es inmutable: no se borran filas (usá anulación). Para un borrado administrativo excepcional, hacé `set local app.permitir_borrado_pagos = ''on''` en la misma transacción.';
  end if;
  return OLD;
end;
$$;

drop trigger if exists trg_pagos_no_borrar on pagos;
create trigger trg_pagos_no_borrar
  before delete on pagos
  for each row execute function pagos_no_borrar();
