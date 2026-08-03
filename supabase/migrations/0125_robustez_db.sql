-- ─────────────────────────────────────────────────────────────────────────
-- 0125 — ROBUSTEZ DE LA BASE (auditoría DBA 08-02). Paquete MECÁNICO y de bajo
-- riesgo: índices, mantenimiento y constraints defensivas. Cero cambio de
-- comportamiento de la app. Correr en el SQL Editor, ideal fuera de hora pico
-- (los CREATE/DROP INDEX toman locks breves; a la escala actual son segundos).
--
--  (A) El vigilante del dinero (app_reconciliacion_violaciones + app_reparar_
--      pagado_acum) agrega Σ(monto) sobre TODA la historia de `pagos`. El índice
--      actual (prestamo_id, parcial) no incluye `monto` → seq scan + hash agg;
--      al millón de filas ese cron (el que garantiza que la plata cuadra) se
--      arriesga a morir por timeout = el peor modo de falla del sistema. Se
--      reemplaza por un índice COVERING (misma llave + include monto) → el RPC
--      pasa a index-only scan. NO suma un índice neto al write-path de pagos.
--  (B) Dos índices DUPLICADOS que pagan mantenimiento doble en las tablas más
--      calientes de INSERT (pagos y eventos_uso). Se dropea el redundante.
--  (C) Índice faltante en movimientos_caja por cobrador (gastos del día del
--      cobrador + ramas RLS filtran por cobrador_id; hoy resuelve por fecha).
--  (D) fillfactor/autovacuum: `prestamos` recibe ~1 UPDATE por pago del día
--      (pagado_acum) → páginas con espacio libre = updates HOT sin mantener los
--      ~9 índices. `pagos` es append-only → visibility map al día para que el
--      index-only scan de (A) rinda.
--  (E) ON DELETE CASCADE que borraría HISTORIA DE PLATA si algún día se borra el
--      padre (zonas/usuarios/clientes/compras). Latente (usuarios es soft-delete)
--      pero es una mina para cualquier script futuro → RESTRICT (falla ruidoso).
--      Los nombres de constraint se descubren dinámicamente (no se adivinan).
--  (F) CHECKs que faltaban en los PRECIOS de la tienda: la RPC de venta toma el
--      precio server-side de estas tablas → un precio negativo/basura entraría a
--      un crédito real. NOT VALID (no bloquea por filas viejas); validar después.
-- ─────────────────────────────────────────────────────────────────────────

-- ══ (A) Covering index para la agregación del vigilante ═════════════════════
create index if not exists idx_pagos_prestamo_monto
  on pagos (prestamo_id) include (monto)
  where anulado = false;
-- El viejo (misma llave, mismo parcial, sin include) queda redundante:
drop index if exists idx_pagos_prestamo;

-- ══ (B) Índices duplicados ══════════════════════════════════════════════════
-- eventos_uso: 0064 creó idx_eventos_uso_fecha y 0067 idx_eventos_uso_creado —
-- EXACTAMENTE iguales (creado_en desc). Cada navegación del staff pagaba doble.
drop index if exists idx_eventos_uso_creado;
-- pagos: idx_pagos_reg_en_vig (0051, parcial anulado=false) ⊂ idx_pagos_registrado_en
-- (0058, completo — necesario para el export CSV que incluye anuladas). Todo insert
-- (siempre anulado=false) escribía en ambos; el completo cubre todas las lecturas.
drop index if exists idx_pagos_reg_en_vig;

-- ══ (C) movimientos_caja por cobrador ═══════════════════════════════════════
create index if not exists idx_mov_caja_cobrador_fecha
  on movimientos_caja (cobrador_id, registrado_en)
  where cobrador_id is not null;

-- ══ (D) fillfactor + autovacuum de las tablas calientes ═════════════════════
-- prestamos: ~1 update/pago del día sobre 12k filas → dejar aire en las páginas
-- para updates HOT (sin re-escribir índices) y vacuum más seguido.
alter table prestamos set (fillfactor = 90, autovacuum_vacuum_scale_factor = 0.05);
-- (el fillfactor aplica a páginas nuevas; para reempacar las existentes —tabla
--  chica— correr en horario muerto:  vacuum full prestamos;  [bloquea unos seg])
-- pagos: append-only → PG13+ solo pasa autovacuum por inserts cada ~20% de la
-- tabla (= meses). Bajar el umbral mantiene el visibility map fresco → el
-- index-only scan de (A) rinde de verdad.
alter table pagos set (
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);

-- ══ (E) CASCADE → RESTRICT en historia de plata ═════════════════════════════
-- Descubre el nombre real de cada FK y la recrea con ON DELETE RESTRICT.
do $$
declare
  r record;
begin
  for r in
    select con.conname, con.conrelid::regclass::text as tabla,
           att.attname as columna, con.confrelid::regclass::text as ref
      from pg_constraint con
      join pg_attribute att
        on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
     where con.contype = 'f'
       and con.confdeltype = 'c'  -- ON DELETE CASCADE
       and (con.conrelid::regclass::text, att.attname) in (
             ('cierres_zona',            'zona_id'),
             ('comisiones_liquidadas',   'cobrador_id'),
             ('gestiones_cobranza',      'cliente_id'),
             ('solicitudes_renovacion',  'cliente_id'),
             ('descuentos_compra_empleado', 'compra_id')
           )
  loop
    execute format('alter table %s drop constraint %I', r.tabla, r.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%I) references %s(id) on delete restrict',
      r.tabla, r.conname, r.columna, r.ref
    );
    raise notice 'FK % de %.% → ON DELETE RESTRICT', r.conname, r.tabla, r.columna;
  end loop;
end $$;

-- ══ (F) CHECKs de precios de la tienda (alimentan créditos reales) ══════════
do $$ begin
  alter table productos add constraint chk_producto_precio_no_neg check (precio >= 0) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table productos add constraint chk_producto_interes_rango check (interes_pct >= 0 and interes_pct <= 100) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table producto_precio_cliente add constraint chk_precio_cliente_no_neg check (precio >= 0) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table producto_precio_segmento add constraint chk_precio_segmento_no_neg check (precio >= 0) not valid;
exception when duplicate_object then null; end $$;
-- Tras verificar que no hay filas viejas en violación, sellarlas:
--   alter table productos validate constraint chk_producto_precio_no_neg;
--   alter table productos validate constraint chk_producto_interes_rango;
--   alter table producto_precio_cliente validate constraint chk_precio_cliente_no_neg;
--   alter table producto_precio_segmento validate constraint chk_precio_segmento_no_neg;

-- ══ (G) OPCIONAL — retención con pg_cron (dentro de la base, sin crons de Vercel)
-- Solo telemetría y chat (NUNCA tablas de dinero/auditoría). Si la extensión no
-- está disponible en el plan, saltear esta sección sin culpa.
-- create extension if not exists pg_cron;
-- select cron.schedule('retencion-eventos-uso', '20 4 * * 0',
--   $$delete from eventos_uso where creado_en < now() - interval '180 days'$$);
-- select cron.schedule('retencion-mensajes', '25 4 * * 0',
--   $$delete from mensajes where creado_en < now() - interval '12 months'$$);
