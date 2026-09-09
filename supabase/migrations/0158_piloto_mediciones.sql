-- ─────────────────────────────────────────────────────────────────────────
--  0158 · MEDICIONES VIVAS DEL PILOTO + corrección de las cifras congeladas.
--
--  POR QUÉ: los pendientes de la 0157 nacieron con la plata TIPEADA A MANO
--  desde los informes. Medidas contra la base viva el 08-09, tres estaban mal:
--    · "477 sobre-pagados, $1.164.945"  → son 1.213 y $2.473.241 (y lo que de
--      verdad duele son los 642 que TIENEN pagos nativos: $2.002.498).
--    · "191 créditos total-como-capital" → son 231, con $45,5M de deuda viva.
--    · "0 actas desde el 14-08"          → la última acta ES del 14-08 (4 en
--      todo el piloto); la frase se leía como que el 14-08 tampoco hubo.
--  Un panel que existe para "tener todo en cuenta" no puede envejecer en
--  silencio: lo que se puede medir, se mide. `medicion` ata un pendiente a una
--  medición viva y el panel muestra el número de HOY al lado del congelado.
--
--  Se agrega además el pendiente que faltaba y que es el más grave del piloto:
--  la adopción está CAYENDO (16 cobradores en 30 días → 5 en 14 → 2 en 7).
-- ─────────────────────────────────────────────────────────────────────────
alter table piloto_pendientes add column if not exists medicion text;
comment on column piloto_pendientes.medicion is
  'Slug de una medición viva (ver piloto_mediciones()). NULL = la cifra es un dato histórico congelado.';

-- ══ Mediciones vivas, todas de una ═══════════════════════════════════════
-- Una sola llamada desde el panel (dev-gated, service_role). SECURITY DEFINER
-- con search_path fijo: lee tablas que el rol llamador no necesita ver de otro modo.
create or replace function piloto_mediciones()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'medido_en', now(),

    -- Sobre-pago: el crédito registra más plata que su total. Se parte por
    -- ORIGEN: con pagos nativos = la calle cobró de más o se registró dos veces
    -- (duele); solo importado = ruido del espejo de Disapp.
    'sobrepago', (
      select jsonb_build_object(
        'n', count(*),
        'monto', round(coalesce(sum(exceso), 0)),
        'n_nativo', count(*) filter (where tiene_nativo),
        'monto_nativo', round(coalesce(sum(exceso) filter (where tiene_nativo), 0)),
        'n_activos', count(*) filter (where estado = 'activo'))
      from (
        select p.estado, p.pagado_acum - p.cuota_diaria * p.total_dias as exceso,
               exists (select 1 from pagos g
                        where g.prestamo_id = p.id and g.anulado = false and g.origen is null) as tiene_nativo
          from prestamos p
         where p.pagado_acum > p.cuota_diaria * p.total_dias + 1) t),

    -- Créditos donde monto_prestado == total a pagar (herencia del import de
    -- julio): el interés mostrado y el scoring salen mal.
    'total_como_capital', (
      select jsonb_build_object(
        'n', count(*),
        'monto', round(coalesce(sum(cuota_diaria * total_dias - pagado_acum), 0)))
      from prestamos
     where estado = 'activo' and abs(monto_prestado - cuota_diaria * total_dias) < 1),

    -- Plata activa cuyo cliente no está en la ruta de nadie: nadie sale a cobrarla.
    'sin_ruta', (
      select jsonb_build_object(
        'n', count(*),
        'monto', round(coalesce(sum(p.cuota_diaria * p.total_dias - p.pagado_acum), 0)))
      from prestamos p
     where p.estado = 'activo'
       and not exists (select 1 from asignaciones a where a.cliente_id = p.cliente_id and a.activo)),

    -- El ritual de cierre: sin acta no arrastra la caja al día siguiente.
    'actas', (
      select jsonb_build_object(
        'total', count(*),
        'ultima', max(fecha),
        'dias_sin', case when max(fecha) is null then null
                    else ((now() at time zone 'America/Montevideo')::date - max(fecha)) end)
      from rendiciones),

    'bases', (
      select jsonb_build_object('total', count(*), 'ultima', max(fecha)) from aperturas_caja),

    -- ADOPCIÓN: cuántos cobradores DISTINTOS cobraron por la app. La tendencia
    -- 30 → 14 → 7 es la señal más importante del piloto.
    'adopcion', (
      select jsonb_build_object(
        'activos', (select count(*) from usuarios where activo and rol = 'cobrador'),
        'c30', count(distinct registrado_por) filter (where registrado_en >= now() - interval '30 days'),
        'c14', count(distinct registrado_por) filter (where registrado_en >= now() - interval '14 days'),
        'c7',  count(distinct registrado_por) filter (where registrado_en >= now() - interval '7 days'),
        'cobros7', count(*) filter (where registrado_en >= now() - interval '7 days'),
        'monto7', round(coalesce(sum(monto) filter (where registrado_en >= now() - interval '7 days'), 0)))
      from pagos
     where origen is null and anulado = false and registrado_en >= now() - interval '30 days'),

    -- Los 9 que Disapp borró y la app sigue cobrando (regla 08-04).
    'borrados_disapp', (
      select jsonb_build_object(
        'n', count(*),
        'monto', round(coalesce(sum(cuota_diaria * total_dias - pagado_acum), 0)))
      from prestamos
     where estado = 'activo'
       and disapp_credit_ref = any (array['PRD0003302848','PRD0003208309','PRD0003141157','PRD0003353565',
                                          'PRD0003216388','PRD0003328086','PRD0003288492','PRD0003334193',
                                          'PRD0003259694'])),

    -- MELANI VERA: mientras el pago nativo de $10.400 siga vivo, el par no se unifica.
    'vera', (
      select jsonb_build_object(
        'monto', round(coalesce(sum(g.monto), 0)),
        'n', count(*))
      from pagos g join prestamos p on p.id = g.prestamo_id
     where p.disapp_credit_ref like 'PRD0003628989%' and g.origen is null and g.anulado = false),

    -- Refs de Disapp con DOS créditos en la app (el import de julio duplicó).
    'refs_dobles', (
      select jsonb_build_object('n', count(*))
      from (select disapp_credit_ref from prestamos
             where disapp_credit_ref is not null
             group by 1 having count(*) > 1) t)
  );
$$;

-- Solo el servidor detrás de requireDev() la llama.
revoke execute on function piloto_mediciones() from public;
revoke execute on function piloto_mediciones() from anon;
revoke execute on function piloto_mediciones() from authenticated;
grant execute on function piloto_mediciones() to service_role;

-- ══ Atar los pendientes medibles y corregir lo que estaba mal ═════════════
do $$
declare
  sello jsonb := jsonb_build_object(
    'en', now(), 'por', 'Carlos', 'de', null, 'a', 'abierto',
    'nota', 'Cifra corregida contra la base viva (08-09) y atada a una medición viva.');
begin
  update piloto_pendientes set medicion = 'refs_dobles' where clave = 'refs-dobles-julio';
  update piloto_pendientes set medicion = 'vera' where clave = 'vera-10400';
  update piloto_pendientes set medicion = 'borrados_disapp' where clave = 'borrados-disapp-9';

  update piloto_pendientes set
    titulo = 'Sobre-pago: 1.213 créditos registran más plata que su total ($2.473.241)',
    detalle = 'Medido contra la base el 08-09. Lo que DUELE son los 642 que tienen pagos NATIVOS ' ||
              '($2.002.498): la calle cobró de más, o el mismo cobro se registró en la app y en la ' ||
              'oficina (doble registro del 08-08/17-08). Los otros 569 ($470.043) son solo importados: ' ||
              'ruido del espejo de Disapp. Los mayores: NICOLAS CUELLO $79.050, MIRTA FIGUEIRA $31.500, ' ||
              'NANCY MONTALDO $25.600, JORGE MACHADO $21.750, SILVINA FAGIANI $20.000. ' ||
              'Lista: scripts/_espejo_activos_20260907-0204.csv (clase sobrepagado). ' ||
              'Al anotarlo el 07-09 se contaron solo los 477 que salieron del espejo de ese día.',
    monto = 2473241,
    medicion = 'sobrepago',
    historial = historial || jsonb_build_array(sello)
  where clave = 'sobrepagados-477';

  update piloto_pendientes set
    titulo = '231 créditos activos con el TOTAL como capital ($45,5M de deuda viva)',
    detalle = 'El import de julio creó créditos donde monto_prestado = total con intereses. Medido el ' ||
              '08-09: 231 activos (eran "191" en la nota del 12-08) que cargan $45.509.987 de deuda viva ' ||
              '— más de la mitad de la cartera. Afecta el interés que se muestra y el scoring; NO afecta ' ||
              'el cobro diario (la cuota y el cartón salen de cuota_diaria × total_dias).',
    monto = 45509987,
    prioridad = 'media',
    medicion = 'total_como_capital',
    historial = historial || jsonb_build_array(sello)
  where clave = 'total-como-capital-191';

  update piloto_pendientes set
    titulo = 'Nadie cierra caja: la última acta es del 14-08 (4 en todo el piloto)',
    detalle = 'El arrastre de caja existe y está probado, pero se alimenta del ACTA de cierre. Medido el ' ||
              '08-09: 4 actas en total (03-08, 09-08 ×2, 14-08) y 14 bases cargadas (la última el 17-08). ' ||
              'Sin acta, cada cobrador amanece con base $0 salvo que el supervisor se la cargue en ' ||
              '/admin/jornada. Es adopción del ritual de cierre, no un bug.',
    medicion = 'actas',
    historial = historial || jsonb_build_array(sello)
  where clave = 'actas-caja';

  -- El pendiente que faltaba, y es el más grave.
  insert into piloto_pendientes (clave, titulo, detalle, dueno, categoria, prioridad, monto, estado, origen, desde, medicion, historial)
  values (
    'adopcion-cayendo',
    'La adopción está CAYENDO: 16 cobradores usaron la app en 30 días, 5 en 14, 2 en 7',
    'Medido el 08-09 sobre pagos nativos (origen null): 30 días → 16 cobradores / 3.355 cobros / $5,93M; ' ||
    '14 días → 5 cobradores / 517 cobros / $1,02M; 7 días → 2 cobradores / 141 cobros / $268.090. ' ||
    'De 52 cobradores con credenciales. En 14 días la app la sostienen María Artunduaga (333 cobros, ' ||
    '$672.420) y Víctor Moralez (151, $227.400); Valentina Ramírez 20, Jorge Ospina 11, Anyela Quiñonez 2. ' ||
    'Todo lo demás que se ve en el panel entra por el empalme con Disapp, no por la app. Esta es LA ' ||
    'pregunta del piloto: si sigue cayendo, la app no se está usando aunque los números de cartera crezcan.',
    'mauricio', 'adopcion', 'alta', null, 'abierto', 'medición 08-09',
    date '2026-09-08', 'adopcion', jsonb_build_array(jsonb_build_object(
      'en', now(), 'por', 'Carlos', 'de', null, 'a', 'abierto',
      'nota', 'Detectado midiendo la base para verificar las cifras del panel.')))
  on conflict (clave) do nothing;
end $$;
