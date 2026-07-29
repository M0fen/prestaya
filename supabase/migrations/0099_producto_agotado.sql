-- ─────────────────────────────────────────────────────────────────────────
--  0099 · TIENDA — control de STOCK simple: marca "agotado" por producto.
--
--  Un producto agotado SIGUE visible en la vitrina (con cartel "Agotado") pero NO
--  se puede pedir: el botón "Me interesa" queda deshabilitado y `registrarInteres`
--  lo rechaza server-side (no genera lead de algo que no hay). El admin lo repone
--  destildando el flag. Es un control binario simple (sin cantidades), suficiente
--  para "hay / no hay". Default false → todos los productos actuales quedan disponibles.
--
--  Solo agrega una columna → aplica al instante. Re-ejecutable. Correr en SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

alter table productos add column if not exists agotado boolean not null default false;
