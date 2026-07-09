-- ─────────────────────────────────────────────────────────────────────────
--  0041 · PARIDAD con Disapp — columnas que Disapp muestra y Presta Ya no tenía.
--  Ejecutar en el SQL Editor (primero en PRUEBA). RE-EJECUTABLE (2ª corrida = 0
--  cambios): todo es `add column if not exists` / `create index if not exists`.
--
--  No toca datos ni lógica financiera; solo agrega columnas nullables/con default
--  e índices. Las políticas RLS existentes de cada tabla cubren las columnas
--  nuevas automáticamente (no se crean políticas nuevas).
-- ─────────────────────────────────────────────────────────────────────────

-- ── a) movimientos_caja: cuenta operativa vs capital + visibilidad ─────────
--  cuenta='operativa'  → gastos de ruta (pantalla "Caja Diaria").
--  cuenta='capital'    → aportes de capital, retiros del dueño, transferencias,
--                        descuadres (pantalla "Inversión de Capital").
--  visible             → si el movimiento aparece en la app del cobrador
--                        (columna "Visible Sí/No" de Disapp).
alter table movimientos_caja
  add column if not exists cuenta text not null default 'operativa'
    check (cuenta in ('operativa','capital'));
alter table movimientos_caja
  add column if not exists visible boolean not null default true;
create index if not exists idx_mov_caja_cuenta
  on movimientos_caja (cuenta, registrado_en desc);

-- ── b) clientes: atributos que Disapp muestra ─────────────────────────────
--  reportado = cliente reportado a buró / lista de morosos. Es un ATRIBUTO del
--  cliente — NO confundir con la tabla `reportes` (quejas del cliente vía token).
alter table clientes add column if not exists reportado boolean not null default false;
alter table clientes add column if not exists genero text
  check (genero in ('masculino','femenino','otro'));
alter table clientes add column if not exists ciudad text;
alter table clientes add column if not exists direccion_secundaria text;

-- ── c) prestamos: bandera de float de supervisor + interés informativo ─────
--  es_float_supervisor marca los 86 créditos VIP al 0% gestionados por
--  CESAR/BOSO/EDWIN (cartera semanal de supervisor).
--  interes_pct es OPCIONAL e INFORMATIVO (lo setea el importador desde Disapp):
--  la app NO lo usa para calcular saldo (el saldo sale del cartón). Sirve para
--  que el informe muestre el % exacto de Disapp en vez de derivarlo.
alter table prestamos add column if not exists es_float_supervisor boolean not null default false;
alter table prestamos add column if not exists interes_pct numeric(6,3);

-- ── d) usuarios: documento (cédula del vendedor, columna de la lista de Disapp) ─
alter table usuarios add column if not exists documento text;

-- ── e) RPC de RECAUDOS por rango (página "Recaudos" — pagos del día) ────────
--  Patrón 0040: SECURITY DEFINER, chequea app_es_gestor() UNA vez, salta RLS.
--  Devuelve UN jsonb (no una tabla) para no chocar con el tope de 1000 filas de
--  PostgREST (un día puede tener >1000 pagos). El SALDO por crédito NO se calcula
--  acá: sale del cartón en TS (verdad única). Trae los pagos NO anulados del rango
--  + los agregados (nº pagos, monto total, créditos únicos). El "vendedor" del
--  pago = quién lo registró (registrado_por). TODO ZONA: hoy devuelve todo a
--  cualquier gestor (idéntico al resto del panel; filtrar por zona al configurarlas).
create or replace function app_recaudos_rango(
  desde timestamptz, hasta timestamptz, vendedor uuid default null
) returns jsonb language sql stable security definer set search_path = public as $$
  select case when app_es_gestor() then (
    with r as (
      select p.id as pago_id, p.registrado_en, p.monto,
             pp.id as prestamo_id, pp.disapp_credit_ref,
             (pp.cuota_diaria * pp.total_dias) as total_credito,
             c.nombre as cliente_nombre, c.documento as cliente_documento,
             u.nombre as cobrador_nombre
      from pagos p
      join prestamos pp on pp.id = p.prestamo_id
      join clientes c on c.id = pp.cliente_id
      left join usuarios u on u.id = p.registrado_por
      where p.anulado = false
        and p.registrado_en >= desde and p.registrado_en < hasta
        and (vendedor is null or p.registrado_por = vendedor)
    )
    select jsonb_build_object(
      'pagos', coalesce((
        select jsonb_agg(jsonb_build_object(
          'pago_id', pago_id, 'registrado_en', registrado_en, 'monto', monto,
          'prestamo_id', prestamo_id, 'disapp_credit_ref', disapp_credit_ref,
          'total_credito', total_credito, 'cliente_nombre', cliente_nombre,
          'cliente_documento', cliente_documento, 'cobrador_nombre', cobrador_nombre
        ) order by registrado_en desc) from r
      ), '[]'::jsonb),
      'total_pagos', (select count(*) from r),
      'monto_total', coalesce((select sum(monto) from r), 0),
      'creditos_unicos', (select count(distinct prestamo_id) from r)
    )
  ) else jsonb_build_object(
    'pagos', '[]'::jsonb, 'total_pagos', 0, 'monto_total', 0, 'creditos_unicos', 0
  ) end;
$$;
grant execute on function app_recaudos_rango(timestamptz, timestamptz, uuid) to authenticated;

-- ── f) RLS: sin cambios. Verificar que movimientos_caja conserva sus políticas
--  (0010: select/insert/delete de gestor · 0017: insert/select de cobrador).
--  Diagnóstico (no falla si difiere; solo informa):
do $$
declare n int;
begin
  select count(*) into n from pg_policies where tablename = 'movimientos_caja';
  raise notice 'movimientos_caja: % políticas RLS (esperado 5)', n;
end $$;
