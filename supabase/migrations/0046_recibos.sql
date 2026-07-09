-- ─────────────────────────────────────────────────────────────────────────
--  0046 · RECIBOS a trabajadores. El admin emite un recibo/comprobante de pago a
--  un trabajador (cobrador/supervisor): comisión, sueldo, adelanto, etc. Queda
--  numerado, guardado e imprimible. NO es una factura fiscal (eso lo regula la
--  DGI); es un comprobante interno de pago. Ejecutar en SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists recibos (
  id                 uuid primary key default gen_random_uuid(),
  -- Correlativo legible (autoincremental).
  numero             bigint generated always as identity,
  trabajador_id      uuid references usuarios(id) on delete set null,
  trabajador_nombre  text not null,
  -- Concepto libre: "Comisión", "Sueldo", "Adelanto", "Viáticos", etc.
  concepto           text not null,
  monto              numeric(14,2) not null check (monto >= 0),
  -- Período/descripción (texto libre: "Julio 2026", "1 al 15 de julio"...).
  periodo            text,
  nota               text,
  emitido_por        uuid references usuarios(id) on delete set null,
  emitido_por_nombre text,
  emitido_en         timestamptz not null default now()
);
create index if not exists idx_recibos_trabajador on recibos (trabajador_id, emitido_en desc);

-- Solo GESTORES leen/gestionan (la escritura la limita el admin en la acción).
alter table recibos enable row level security;
drop policy if exists recibos_gestor_all on recibos;
create policy recibos_gestor_all on recibos
  for all to authenticated using (app_es_gestor()) with check (app_es_gestor());
