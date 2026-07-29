-- ─────────────────────────────────────────────────────────────────────────
--  0094 · Acota POR ZONA la lectura de solicitudes_anulacion.
--
--  Hoy `solanul_select` (0032) usa `app_es_gestor()` sin acotar → cualquier
--  gestor lee TODAS las solicitudes de anulación. La UI ya se acotó por zona
--  (app/admin/(panel)/anulaciones), pero un supervisor con su anon key + JWT
--  puede leer por PostgREST crudo el `motivo` (texto libre, puede tener nombre /
--  monto / documento) y el `solicitado_por_nombre` de anulaciones de OTRAS zonas
--  (fuga de PII). Esto cierra el bypass por REST directo (defensa en profundidad;
--  espeja lo que 0060 hizo con usuarios/solicitudes_gasto).
--
--  La zona de una anulación se deriva del PAGO → préstamo → cliente → cobrador
--  con asignación activa (misma verdad que app_zona_de_cliente). Se encapsula en
--  un helper SECURITY DEFINER para no depender del RLS de `pagos` dentro del USING.
--
--  Confirmar/rechazar NO se ven afectados: las server actions re-validan la zona
--  del pago server-side y el flip lo hace service_role; la policy de escritura
--  (solanul_write) queda igual. El admin (app_es_admin) sigue viendo todas.
--
--  Solo cambia RLS + una función → aplica al instante. Re-ejecutable. SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

-- ¿El gestor puede ver este PAGO por la zona de su cliente? (admin = siempre).
-- SECURITY DEFINER: resuelve el cliente del pago sin chocar con el RLS de pagos.
create or replace function app_gestor_ve_pago(p_pago uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select app_es_admin()
      or app_gestor_ve_cliente(
           (select pr.cliente_id
              from pagos pg
              join prestamos pr on pr.id = pg.prestamo_id
             where pg.id = p_pago)
         );
$$;
grant execute on function app_gestor_ve_pago(uuid) to authenticated;

drop policy if exists solanul_select on solicitudes_anulacion;
create policy solanul_select on solicitudes_anulacion for select to authenticated
  using ( app_gestor_ve_pago(pago_id) );
