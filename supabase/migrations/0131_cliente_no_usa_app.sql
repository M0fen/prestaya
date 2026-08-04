-- ─────────────────────────────────────────────────────────────────────────
--  0131 · "Este cliente NO va a usar la app" — cerrar la campaña de altas.
--  Ejecutar en el SQL Editor. Re-ejecutable. Solo agrega columnas.
--
--  POR QUÉ: la entrega del cartón se mide en tres estados (pendiente →
--  entregado → activo). Pero hay clientes que NUNCA van a poder abrirlo:
--  verificado en la base, **55 clientes de Zona Centro tienen teléfono FIJO**
--  (no celular). Sin una salida, esos quedan "pendientes" para siempre: el
--  cobrador vuelve a intentarlo en cada visita y el avance de la campaña nunca
--  llega a 100% aunque el trabajo esté hecho.
--
--  Marcarlo NO es dar de baja al cliente ni tocar su crédito: sigue en la ruta,
--  se le sigue cobrando igual. Solo dice "a esta persona el cartón digital no
--  le sirve", que además es un dato de NEGOCIO (cuántos de mis clientes no son
--  alcanzables por la app).
--
--  Reversible por diseño: poner `app_no_aplica_en = null` lo devuelve a
--  pendiente. Nada se borra.
-- ─────────────────────────────────────────────────────────────────────────

alter table clientes add column if not exists app_no_aplica_en timestamptz;
alter table clientes add column if not exists app_no_aplica_motivo text;
alter table clientes add column if not exists app_no_aplica_por uuid references usuarios(id);

comment on column clientes.app_no_aplica_en is
  'Marcado por el cobrador: este cliente no va a usar el cartón digital (sin celular, no quiere, lo ve un familiar). NO es una baja: sigue en la ruta y se le cobra igual. Null = vuelve a contar como pendiente.';

-- Motivos permitidos (los mismos que ofrece la app; texto libre corto si no).
alter table clientes drop constraint if exists chk_app_no_aplica_motivo;
alter table clientes add constraint chk_app_no_aplica_motivo
  check (app_no_aplica_motivo is null or length(app_no_aplica_motivo) <= 60);

-- El estado se consulta junto al resto del alta (por cliente y por ruta).
create index if not exists idx_clientes_app_no_aplica
  on clientes (app_no_aplica_en) where app_no_aplica_en is not null;

-- Verificación:
--   select count(*) from clientes where app_no_aplica_en is not null;
