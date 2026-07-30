-- ─────────────────────────────────────────────────────────────────────────
--  0119 · GUARDIA + REPARACIÓN de pagado_acum (cache derivado, 0063).
--
--  Hallazgo de la auditoría de durabilidad (07-30): `pagado_acum` (el Σ
--  denormalizado de pagos vigentes por crédito) NO tenía CHECK (>= 0). El trigger
--  hace `pagado_acum = pagado_acum - monto` en anulaciones/DELETE; una secuencia
--  patológica (des-anulación/re-anulación desordenada por service_role, o un
--  backfill corrido dos veces) podía dejarlo negativo, y la BD no lo frenaba en el
--  momento. Hoy solo lo detecta el cron ex-post (INV1) y la reparación era un
--  script a mano. Esta migración: (1) da una GUARDIA de escritura (CHECK >= 0), y
--  (2) convierte la reparación en un BOTÓN (RPC), no un script.
--
--  Re-ejecutable. Correr en el SQL Editor DESPUÉS de 0118.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) RPC de reparación: recomputa pagado_acum EXACTO desde el libro (Σ pagos
--    vigentes) para UN crédito (p_prestamo_id) o para TODOS los que divergen
--    (p_prestamo_id = null). Devuelve cuántos reparó. SECURITY DEFINER (necesita
--    UPDATE sobre prestamos, que el gestor no tiene por RLS) y gateado a ADMIN.
--    Es la contraparte de acción a la detección INV1 del cron: detectar → reparar.
create or replace function app_reparar_pagado_acum(p_prestamo_id uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_reparados integer;
begin
  if app_rol() is distinct from 'admin' then
    raise exception 'Solo un admin puede reparar pagado_acum';
  end if;

  with correcto as (
    select p.id,
           coalesce((
             select sum(pg.monto) from pagos pg
             where pg.prestamo_id = p.id and pg.anulado = false
           ), 0)::numeric(14,2) as suma
    from prestamos p
    where p_prestamo_id is null or p.id = p_prestamo_id
  ),
  fix as (
    update prestamos p
       set pagado_acum = c.suma
    from correcto c
    where c.id = p.id
      and p.pagado_acum is distinct from c.suma
    returning p.id
  )
  select count(*) into v_reparados from fix;

  return v_reparados;
end;
$$;

comment on function app_reparar_pagado_acum(uuid) is
  'Recomputa pagado_acum = Σ pagos vigentes (0119). Reparación puntual o global de la divergencia INV1. Solo admin.';

-- 2) GUARDIA de escritura: pagado_acum nunca negativo. NOT VALID para que aplique
--    de inmediato a nuevas escrituras SIN escanear/bloquear la tabla entera ahora.
--    (idempotente: se salta si ya existe la constraint).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_pagado_acum_no_negativo'
  ) then
    alter table prestamos
      add constraint chk_pagado_acum_no_negativo check (pagado_acum >= 0) not valid;
  end if;
end $$;

-- 3) (OPCIONAL, correr aparte cuando quieras validar el histórico) Antes de VALIDAR,
--    reparar cualquier divergencia y confirmar que no hay negativos:
--        select app_reparar_pagado_acum();                    -- repara todo
--        select count(*) from prestamos where pagado_acum < 0; -- debe dar 0
--    y recién entonces:
--        alter table prestamos validate constraint chk_pagado_acum_no_negativo;
