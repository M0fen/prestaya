-- ─────────────────────────────────────────────────────────────────────────
--  0017 · GASTOS del COBRADOR desde su app.
--  El cobrador puede registrar sus gastos de ruta (combustible, etc.) como
--  EGRESOS en `movimientos_caja`, y ver SOLO los suyos. Los gestores siguen
--  viendo/gestionando toda la caja (políticas de 0010 intactas). Estos gastos
--  alimentan el "efectivo a entregar" de la rendición, sin doble conteo:
--  el cobro entra a caja (+), el gasto sale de caja (−), y el cobrador entrega
--  la diferencia. Ejecutar en el SQL Editor DESPUÉS de 0010. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────

-- El cobrador registra SUS gastos (solo egresos, a su nombre).
drop policy if exists mov_caja_insert_cobrador on movimientos_caja;
create policy mov_caja_insert_cobrador on movimientos_caja for insert to authenticated
  with check (
    app_rol() = 'cobrador'
    and tipo = 'egreso'
    and registrado_por = app_usuario_id()
    and cobrador_id = app_usuario_id()
  );

-- El cobrador ve SUS movimientos (para listar sus gastos del día).
drop policy if exists mov_caja_select_cobrador on movimientos_caja;
create policy mov_caja_select_cobrador on movimientos_caja for select to authenticated
  using ( cobrador_id = app_usuario_id() );
