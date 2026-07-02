-- ─────────────────────────────────────────────────────────────────────────
--  Presta Ya — CAJA / TESORERÍA. Movimientos de efectivo que NO son cobros.
--  Ejecutar en el SQL Editor DESPUÉS de 0009. Re-ejecutable.
--
--  Los COBROS (ingreso principal) ya viven en `pagos` (libro inmutable). Esta
--  tabla registra el resto del movimiento de caja: gastos, desembolsos de
--  créditos, aportes de capital y retiros del dueño. El resumen del día
--  combina `pagos` (ingresos por cobro) + `movimientos_caja`.
--
--    tipo:  ingreso    (+) aporte de capital u otro ingreso
--           egreso     (−) gasto operativo (combustible, sueldo, alquiler…)
--           desembolso (−) plata entregada al colocar un crédito
--           retiro     (−) retiro del dueño
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists movimientos_caja (
  id             uuid primary key default gen_random_uuid(),
  tipo           text not null check (tipo in ('ingreso','egreso','desembolso','retiro')),
  categoria      text,
  monto          numeric(12,2) not null check (monto > 0),
  descripcion    text,
  cobrador_id    uuid references usuarios(id),      -- opcional (a quién se asocia)
  registrado_por uuid references usuarios(id),
  fecha          date not null default ((now() at time zone 'America/Montevideo')::date),
  registrado_en  timestamptz not null default now()
);

create index if not exists idx_mov_caja_fecha on movimientos_caja (registrado_en desc);
create index if not exists idx_mov_caja_tipo on movimientos_caja (tipo);

alter table movimientos_caja enable row level security;

drop policy if exists mov_caja_select on movimientos_caja;
drop policy if exists mov_caja_insert on movimientos_caja;
drop policy if exists mov_caja_delete on movimientos_caja;

-- Solo gestores gestionan la caja (ven, cargan y anulan movimientos).
create policy mov_caja_select on movimientos_caja for select to authenticated
  using ( app_es_gestor() );
create policy mov_caja_insert on movimientos_caja for insert to authenticated
  with check ( app_es_gestor() and registrado_por = app_usuario_id() );
create policy mov_caja_delete on movimientos_caja for delete to authenticated
  using ( app_rol() = 'admin' );
