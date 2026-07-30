-- ─────────────────────────────────────────────────────────────────────────
--  0118 · INMUTABILIDAD de movimientos_caja (2ª capa, espejo de pagos).
--
--  Hallazgo de la auditoría de durabilidad (07-30): movimientos_caja (egresos,
--  desembolsos, retiros del dueño) es un LIBRO de plata, pero se protegía SOLO
--  por RLS — no hay policy de UPDATE (deny por defecto) y 0075 quitó el DELETE.
--  Funciona hoy porque `authenticated` no puede editar y ningún código lo edita.
--  PERO, a diferencia de `pagos`, NO tenía la 2ª capa (trigger): si mañana se
--  agrega por error una policy de UPDATE, o un script con service_role toca la
--  tabla, un movimiento se podía reescribir sin rastro. Esta migración cierra ese
--  borde con un trigger BEFORE UPDATE que congela los campos financieros y de
--  auditoría (igual que trg_pagos_inmutables sobre pagos, 0002).
--
--  NOTA: este libro no tiene concepto de "anulación" (a diferencia de pagos), así
--  que no hay campos editables legítimos hoy. Se dejan mutables solo `descripcion`
--  y `visible` (metadatos no financieros) por si en el futuro se agrega editar la
--  glosa o el toggle "Visible en la app del cobrador", sin reabrir el monto.
--
--  Re-ejecutable. Correr en el SQL Editor DESPUÉS de 0117.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function mov_caja_no_editar_financiero()
returns trigger language plpgsql as $$
begin
  -- Congela el dinero y la identidad del movimiento (quién/cuándo/tipo/cuenta).
  if NEW.tipo           is distinct from OLD.tipo
     or NEW.monto          is distinct from OLD.monto
     or NEW.categoria      is distinct from OLD.categoria
     or NEW.cuenta         is distinct from OLD.cuenta
     or NEW.cobrador_id    is distinct from OLD.cobrador_id
     or NEW.registrado_por is distinct from OLD.registrado_por
     or NEW.fecha          is distinct from OLD.fecha
     or NEW.registrado_en  is distinct from OLD.registrado_en then
    raise exception 'Los datos financieros de un movimiento de caja no se modifican (libro inmutable).';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_mov_caja_inmutables on movimientos_caja;
create trigger trg_mov_caja_inmutables
  before update on movimientos_caja
  for each row execute function mov_caja_no_editar_financiero();
