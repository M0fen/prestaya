-- ─────────────────────────────────────────────────────────────────────────
--  0036 · Columnas de ID EXTERNO para el empalme Disapp → Presta Ya.
--  Ejecutar en el SQL Editor (primero en el proyecto de PRUEBA). Re-ejecutable.
--
--  Objetivo: idempotencia del import. Cada entidad guarda su llave de Disapp con
--  índice único, para que correr el importador dos veces NO duplique nada
--  (UPSERT por la llave externa). Los IDs se guardan como TEXT (nunca se hace
--  aritmética con ellos; evita sorpresas de formato / ceros a la izquierda).
--
--  NO toca datos ni lógica financiera. Solo agrega columnas nullables + índices.
--  La inmutabilidad de pagos (trigger 0002) no se ve afectada: estas columnas se
--  setean en el INSERT del import y no se editan después.
--
--  ⚠️ Los índices únicos son NO parciales a propósito: PostgREST necesita un
--  índice único NO parcial para el UPSERT (ON CONFLICT). Postgres igual permite
--  múltiples NULL en un índice único normal, así que la unicidad de los valores
--  reales se mantiene sin bloquear las filas sin ID externo.
-- ─────────────────────────────────────────────────────────────────────────

-- ── CLIENTES ───────────────────────────────────────────────────────────────
alter table clientes add column if not exists disapp_id text;
create unique index if not exists clientes_disapp_id_uidx on clientes (disapp_id);

-- ── COBRADORES / SUPERVISORES (usuarios) ───────────────────────────────────
-- El `ID Vendedor` de Disapp es la llave ESTABLE del cobrador (el nombre es
-- texto libre y sucio). Mapeamos por acá, no por nombre.
alter table usuarios add column if not exists disapp_vendedor_id text;
create unique index if not exists usuarios_disapp_vendedor_id_uidx
  on usuarios (disapp_vendedor_id);

-- ── PRÉSTAMOS ──────────────────────────────────────────────────────────────
alter table prestamos add column if not exists disapp_credit_id text;   -- "ID Crédito"
alter table prestamos add column if not exists disapp_credit_ref text;  -- "Crédito #" (PRD...)
create unique index if not exists prestamos_disapp_credit_id_uidx
  on prestamos (disapp_credit_id);
create index if not exists prestamos_disapp_credit_ref_idx
  on prestamos (disapp_credit_ref);

-- ── PAGOS ──────────────────────────────────────────────────────────────────
-- Llave de idempotencia = "ID Pago" de Disapp (único). Guardamos también la
-- referencia de crédito por si el pago apunta a un crédito histórico (huérfano),
-- y la procedencia del import para trazabilidad.
alter table pagos add column if not exists disapp_pago_id text;
alter table pagos add column if not exists disapp_credit_ref text;
alter table pagos add column if not exists origen text;         -- ej. 'disapp_import'
alter table pagos add column if not exists importado_en timestamptz;
create unique index if not exists pagos_disapp_pago_id_uidx on pagos (disapp_pago_id);
