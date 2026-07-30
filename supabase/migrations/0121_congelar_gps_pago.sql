-- ─────────────────────────────────────────────────────────────────────────
--  0121 · Congelar el GPS del pago en el trigger de inmutabilidad.
--
--  Hallazgo de la auditoría de durabilidad (07-30): el trigger que congela un pago
--  (pagos_no_editar_financiero, 0002) protege monto/prestamo_id/dia_credito/
--  registrado_por/registrado_en, pero NO gps_lat/gps_lng. Un gestor con permiso de
--  UPDATE (habilitado para la anulación) podía, por PostgREST crudo, reescribir la
--  ubicación registrada de un cobro sin tocar los campos financieros. No mueve
--  plata, pero erosiona la EVIDENCIA anti-fantasma del cobro en la calle: la
--  ubicación de un cobro es un hecho histórico y debe ser inmutable como el resto.
--
--  Esta migración reemplaza la función del trigger agregando gps_lat/gps_lng a la
--  lista de campos protegidos. Los campos de anulación (anulado/anulado_por/
--  anulado_en/motivo_anulacion) siguen siendo los únicos editables.
--
--  Re-ejecutable. Correr en el SQL Editor DESPUÉS de 0120.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function pagos_no_editar_financiero()
returns trigger language plpgsql as $$
begin
  -- Todos los campos financieros, de auditoría y de EVIDENCIA (GPS) del pago
  -- original son inmutables. Solo la anulación (anulado/anulado_por/anulado_en/
  -- motivo_anulacion) puede cambiar.
  if NEW.monto          is distinct from OLD.monto
     or NEW.prestamo_id    is distinct from OLD.prestamo_id
     or NEW.dia_credito    is distinct from OLD.dia_credito
     or NEW.registrado_por is distinct from OLD.registrado_por
     or NEW.registrado_en  is distinct from OLD.registrado_en
     or NEW.gps_lat        is distinct from OLD.gps_lat
     or NEW.gps_lng        is distinct from OLD.gps_lng then
    raise exception 'Los datos financieros y la ubicación de un pago no se modifican. Use anulación.';
  end if;
  return NEW;
end;
$$;

-- El trigger trg_pagos_inmutables (0002) ya apunta a esta función; el CREATE OR
-- REPLACE de arriba basta. Se re-asegura por si acaso (idempotente).
drop trigger if exists trg_pagos_inmutables on pagos;
create trigger trg_pagos_inmutables
  before update on pagos
  for each row execute function pagos_no_editar_financiero();
