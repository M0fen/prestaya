-- ─────────────────────────────────────────────────────────────────────────
--  0062 · RPC de cartera activa ACOTADA por zona (perf de "Mi jornada" del
--  supervisor — el mayor cuello medido: app_cartera_activa() = ~3,5 s / 1,4 MB).
--
--  app_cartera_activa() (0040) trae TODA la cartera (~2.400 créditos) y agrega
--  los pagos de TODO el libro; el supervisor luego filtraba en JS a su zona
--  (~150 créditos). Esta variante recibe los cliente_ids del alcance del actor y
--  filtra/agrega EN SQL: solo su zona → payload y trabajo ~15× menores.
--
--  Misma FORMA de salida que app_cartera_activa (mismos campos) → lib/data/
--  activos.ts la consume igual. SECURITY DEFINER (bypassa el RLS por-fila sobre
--  pagos, que es el costo) con scope EXPLÍCITO por cliente_ids. Guardada por
--  app_es_gestor(). getActivosConPagos la usa para alcance NO global, con
--  fallback a la RPC completa + filtro JS si esta aún no corrió.
--
--  Solo función → aplica al instante. Re-ejecutable. Correr en el SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function app_cartera_activa_zona(cliente_ids uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  select case when app_es_gestor() then (
    with pg as (
      select p.prestamo_id, sum(p.monto) as pagado
      from pagos p
      join prestamos pp on pp.id = p.prestamo_id and pp.estado = 'activo'
      where p.anulado = false
        and pp.cliente_id = any(cliente_ids)          -- ← scope por zona (agrega solo su cartera)
      group by p.prestamo_id
    )
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'cliente_id', p.cliente_id,
        'cobrador_id', p.cobrador_id,
        'monto_prestado', p.monto_prestado,
        'cuota_diaria', p.cuota_diaria,
        'total_dias', p.total_dias,
        'frecuencia', p.frecuencia,
        'fecha_inicio', p.fecha_inicio,
        'disapp_credit_ref', p.disapp_credit_ref,
        'interes_pct', p.interes_pct,
        'cliente_nombre', c.nombre,
        'cliente_documento', c.documento,
        'cliente_telefono', c.telefono,
        'cliente_direccion', c.direccion,
        'cliente_calificacion', c.calificacion,
        'cliente_gps_lat', c.gps_lat,
        'cliente_gps_lng', c.gps_lng,
        'cobrador_nombre', u.nombre,
        'pagado', coalesce(pg.pagado, 0)
      )
    ), '[]'::jsonb)
    from prestamos p
    join clientes c on c.id = p.cliente_id
    left join usuarios u on u.id = p.cobrador_id
    left join pg on pg.prestamo_id = p.id
    where p.estado = 'activo'
      and p.cliente_id = any(cliente_ids)             -- ← scope por zona
  ) else '[]'::jsonb end;
$$;
grant execute on function app_cartera_activa_zona(uuid[]) to authenticated;
