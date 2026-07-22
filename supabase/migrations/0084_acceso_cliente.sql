-- ─────────────────────────────────────────────────────────────────────────
--  0084 · ALTA DEL CLIENTE EN LA APP — trazabilidad de la entrega del link.
--
--  Los clientes todavía no tienen su link del cartón. El cobrador se los
--  entrega en la calle (QR + WhatsApp). Para que el alta sea un proceso
--  medible —y no "creo que ya se lo di"— guardamos DOS señales distintas:
--
--    · acceso_entregado_en / _por : lo declaró el COBRADOR (compartió el link).
--    · acceso_visto_en            : el CLIENTE abrió su cartón de verdad.
--                                   Es la única prueba real del alta.
--
--  Se llenan solas desde la app (nunca a mano). Si esta migración todavía no
--  corrió, la app degrada sola: el QR y el compartir funcionan igual, solo no
--  muestra el estado del alta.
--
--  Ejecutar en el SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────
alter table clientes
  add column if not exists acceso_entregado_en  timestamptz,
  add column if not exists acceso_entregado_por uuid references usuarios(id) on delete set null,
  add column if not exists acceso_visto_en      timestamptz;

comment on column clientes.acceso_entregado_en  is 'Cuándo el cobrador le compartió el link/QR de su cartón.';
comment on column clientes.acceso_entregado_por is 'Quién se lo entregó (usuarios.id).';
comment on column clientes.acceso_visto_en      is 'Primera vez que el CLIENTE abrió su cartón (prueba real del alta).';

-- Listado "a quién me falta darle de alta": el cobrador filtra por su ruta y
-- estas columnas. Índice parcial mínimo (solo los pendientes, que son los que
-- se consultan) — no pesa en las escrituras de la tabla.
create index if not exists clientes_sin_acceso_idx
  on clientes (id)
  where acceso_visto_en is null;
