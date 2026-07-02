-- ─────────────────────────────────────────────────────────────────────────
--  Presta Ya — CENSO en calle (alta de clientes por el cobrador).
--  Ejecutar en el SQL Editor DESPUÉS de 0001–0004. Re-ejecutable.
--
--  Decisión de negocio: el cobrador da de alta clientes NUEVOS directamente
--  (queda activo al instante). El alta la procesa una Server Action que valida
--  que sea un cobrador/gestor activo y usa service_role; por eso NO se cambia
--  el RLS de inserción. Acá solo sumamos trazabilidad para que el admin vea
--  quién y cómo se registró cada cliente.
-- ─────────────────────────────────────────────────────────────────────────

alter table clientes
  add column if not exists creado_por uuid references usuarios(id),
  add column if not exists origen text not null default 'oficina'
    check (origen in ('oficina', 'censo')),
  add column if not exists gps_lat numeric(9, 6),
  add column if not exists gps_lng numeric(9, 6);

-- Para listar/filtrar "lo censado por los cobradores" en el panel admin.
create index if not exists idx_clientes_origen on clientes (origen, creado_en desc);
