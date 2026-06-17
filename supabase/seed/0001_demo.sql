-- ─────────────────────────────────────────────────────────────────────────
--  Presta Ya — datos de DEMO (opcional) para probar la vista por token.
--  Equivalente al script scripts/seed-demo.mjs, por si preferís el SQL Editor.
--  Token del link: demo-maria-fernanda  →  /c/demo-maria-fernanda
--
--  Es seguro re-ejecutarlo: borra el demo anterior por IDs fijos y lo recrea.
--  fecha_inicio = hoy − 11 días  →  hoy es el día 12 del crédito (abono parcial).
-- ─────────────────────────────────────────────────────────────────────────

-- Limpieza del demo anterior (respeta el orden de las llaves foráneas).
delete from pagos     where prestamo_id = '00000000-0000-0000-0000-0000000000a1';
delete from prestamos where id          = '00000000-0000-0000-0000-0000000000a1';
delete from clientes  where id          = '00000000-0000-0000-0000-000000000001';

insert into clientes (id, nombre, documento, telefono, direccion, token_acceso, calificacion, activo)
values (
  '00000000-0000-0000-0000-000000000001',
  'María Fernanda', '12345678', '099 123 456',
  'Av. 18 de Julio 1234, Montevideo',
  'demo-maria-fernanda', 'bueno', true
);

insert into prestamos (id, cliente_id, monto_prestado, cuota_diaria, total_dias, fecha_inicio, estado)
values (
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-000000000001',
  500000, 20000, 30,
  current_date - 11,   -- hoy = día 12
  'activo'
);

-- Días 1–10 pagados completos + abono parcial el día 12 (hoy).
-- Día 11 sin pago → atrasado. Días 13–30 → futuros.
insert into pagos (prestamo_id, dia_credito, monto) values
  ('00000000-0000-0000-0000-0000000000a1',  1, 20000),
  ('00000000-0000-0000-0000-0000000000a1',  2, 20000),
  ('00000000-0000-0000-0000-0000000000a1',  3, 20000),
  ('00000000-0000-0000-0000-0000000000a1',  4, 20000),
  ('00000000-0000-0000-0000-0000000000a1',  5, 20000),
  ('00000000-0000-0000-0000-0000000000a1',  6, 20000),
  ('00000000-0000-0000-0000-0000000000a1',  7, 20000),
  ('00000000-0000-0000-0000-0000000000a1',  8, 20000),
  ('00000000-0000-0000-0000-0000000000a1',  9, 20000),
  ('00000000-0000-0000-0000-0000000000a1', 10, 20000),
  ('00000000-0000-0000-0000-0000000000a1', 12, 10000);

-- Anuncio de demo para el banner (requiere migración 0003_anuncios.sql).
delete from anuncios where id = '00000000-0000-0000-0000-0000000000b1';
insert into anuncios (id, titulo, cuerpo, cta_texto, cta_url, tema, prioridad, activo, segmento)
values (
  '00000000-0000-0000-0000-0000000000b1',
  'Promo de junio: paga 5 días seguidos y participa por un premio 🎁',
  'Mantén tu racha al día y entra al sorteo del mes.',
  'Ver detalles', '#', 'azul', 10, true, 'todos'
);
