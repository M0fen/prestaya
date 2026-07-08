-- ─────────────────────────────────────────────────────────────────────────
--  0035 · RLS por zona — CERRAR ESCRITURAS cruzadas (hallazgo auditoría senior).
--  Ejecutar en el editor SQL de Supabase, DESPUÉS de 0031. Re-ejecutable.
--
--  CONTEXTO DEL HALLAZGO
--  --------------------
--  0031 acotó por zona el SELECT y el UPDATE de clientes/préstamos/pagos, pero
--  dejó las políticas de INSERT de `prestamos`, `pagos` y `visitas` en el nivel
--  grueso de 0002 (`app_es_gestor()` = cualquier admin O supervisor). Eso deja
--  un hueco de DEFENSA EN PROFUNDIDAD: un supervisor de la Zona A podría, con
--  llamadas DIRECTAS a PostgREST (su JWT + la anon key pública), insertar un
--  pago o crear un préstamo sobre un cliente de la Zona B — saltándose las
--  Server Actions (que sí validan zona con lib/permisos.ts).
--
--  Por la app NO es alcanzable hoy (no hay Server Action de gestor que inserte
--  pagos/préstamos; el cobrador inserta solo sobre sus asignados). Pero la RLS
--  es la última línea y la separación de deberes sobre DINERO debe sostenerse
--  también a nivel base. Esta migración cierra ese hueco.
--
--  REGLA ÚNICA de escritura (idéntica en las 3 tablas y espejada en
--  lib/permisos.ts → puedeEscribirEnZona):
--    permitido si  (a) el gestor VE la zona del cliente, o
--                  (b) el cliente aún NO tiene zona (sin cobrador asignado →
--                      estado de transición; cualquier gestor, igual criterio
--                      que el alta de clientes de 0031), o
--                  (c) es el cobrador con ese cliente asignado.
--  Aislamiento real: un supervisor con zona NO puede escribir sobre un cliente
--  de OTRA zona (que sí tiene zona y no es la suya).
--
--  NO cambia: la inmutabilidad de pagos (trigger 0002), que la anulación
--  (pagos_update) sea admin-only (0031), ni el alta de clientes.
-- ─────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
--  PAGOS — insertar acotado por zona (gestor) o por asignación (cobrador).
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists pagos_insert on pagos;
create policy pagos_insert on pagos for insert to authenticated
  with check (
    exists (
      select 1 from prestamos p
      where p.id = prestamo_id
        and ( app_gestor_ve_cliente(p.cliente_id)
              or app_zona_de_cliente(p.cliente_id) is null
              or app_cobrador_tiene_cliente(p.cliente_id) )
    )
  );

-- ═════════════════════════════════════════════════════════════════════════
--  PRÉSTAMOS — crear acotado por zona del cliente (con transición zona=null).
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists prestamos_insert on prestamos;
create policy prestamos_insert on prestamos for insert to authenticated
  with check (
    app_gestor_ve_cliente(cliente_id)
    or app_zona_de_cliente(cliente_id) is null
    or app_cobrador_tiene_cliente(cliente_id)
  );

-- ═════════════════════════════════════════════════════════════════════════
--  VISITAS — insertar acotado igual que pagos.
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists visitas_insert on visitas;
create policy visitas_insert on visitas for insert to authenticated
  with check (
    exists (
      select 1 from prestamos p
      where p.id = prestamo_id
        and ( app_gestor_ve_cliente(p.cliente_id)
              or app_zona_de_cliente(p.cliente_id) is null
              or app_cobrador_tiene_cliente(p.cliente_id) )
    )
  );
