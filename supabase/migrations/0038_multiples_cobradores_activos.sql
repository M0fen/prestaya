-- ─────────────────────────────────────────────────────────────────────────
--  0038 · Permitir MÚLTIPLES cobradores activos por cliente.
--  Ejecutar en el SQL Editor. Re-ejecutable.
--
--  Consistente con 0037 (múltiples créditos activos): 54 clientes tienen
--  créditos activos de cobradores DISTINTOS, y cada cobrador debe ver a ese
--  cliente en SU ruta. La regla original "un solo cobrador activo por cliente"
--  (0001) lo impedía. Se levanta.
--
--  La tabla mantiene `unique (cobrador_id, cliente_id)`: no se duplica la misma
--  asignación, pero un cliente puede estar activo con varios cobradores.
--  `app_zona_de_cliente` sigue tomando una zona (limit 1); para los pocos casos
--  multi-cobrador la zona derivada es una de las suyas (se afina si se configuran
--  zonas). El reasignar del admin sigue consolidando (baja todas, activa una).
-- ─────────────────────────────────────────────────────────────────────────

drop index if exists un_cobrador_activo_por_cliente;

-- Lookup cliente -> cobradores activos (reemplaza el que daba el índice único).
create index if not exists idx_asignaciones_cliente_activo
  on asignaciones (cliente_id) where (activo = true);
