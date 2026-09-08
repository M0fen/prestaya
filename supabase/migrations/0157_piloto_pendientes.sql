-- ─────────────────────────────────────────────────────────────────────────
--  0157 · PENDIENTES DEL PILOTO (panel dev /admin/piloto).
--
--  Lo que hay que decidir o arreglar y que hasta hoy vivía repartido entre la
--  memoria de sesión, informes en el chat y CSVs sueltos: cada pendiente con su
--  dueño, su plata, desde cuándo, su estado y el historial de cambios (quién lo
--  movió, cuándo, con qué nota). Nada se borra: se marca resuelto o aceptado.
--
--  ACCESO: RLS encendida y SIN políticas → solo service_role. La única puerta
--  es el servidor, detrás de requireDev(). No es dato de negocio para el
--  panel del dueño; es la agenda técnica del piloto.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists piloto_pendientes (
  id               uuid primary key default gen_random_uuid(),
  clave            text unique,               -- idempotencia del seed (null en los creados a mano)
  titulo           text not null,
  detalle          text,
  dueno            text not null default 'carlos'
                     check (dueno in ('carlos','mauricio','carolina','equipo')),
  categoria        text not null default 'datos'
                     check (categoria in ('plata','datos','adopcion','tecnico','negocio')),
  prioridad        text not null default 'media'
                     check (prioridad in ('alta','media','baja')),
  monto            numeric(14,2),             -- plata en juego, si la hay
  estado           text not null default 'abierto'
                     check (estado in ('abierto','en_progreso','resuelto','aceptado')),
  origen           text,                      -- de dónde salió (sesión, informe, incidencia…)
  desde            date not null default ((now() at time zone 'America/Montevideo')::date),
  creado_en        timestamptz not null default now(),
  creado_por       uuid references usuarios(id),
  actualizado_en   timestamptz not null default now(),
  resuelto_en      timestamptz,
  nota_resolucion  text,
  historial        jsonb not null default '[]'::jsonb   -- [{en, por, de, a, nota}]
);
create index if not exists idx_piloto_pendientes_estado on piloto_pendientes (estado, prioridad);

alter table piloto_pendientes enable row level security;
-- (sin políticas a propósito: ver cabecera)

-- ── Seed: la agenda al 07-09-2026, tal como quedó en los informes ─────────
insert into piloto_pendientes (clave, titulo, detalle, dueno, categoria, prioridad, monto, estado, origen, desde, nota_resolucion, resuelto_en)
values
  ('vera-10400',
   'MELANI VERA: pago nativo de $10.400 el 21-08 sobre la ficha doble',
   'Disapp registra $400 por día para ese préstamo (PRD0003628989); el 21-08 Víctor cargó $10.400 de una sobre la ficha importada: dedazo casi seguro. La unificación de fichas se niega mientras haya pagos nativos sobre la importada. Decidir: anular el pago (motivo dedazo) y unificar, o confirmar que la plata entró.',
   'mauricio', 'plata', 'alta', 10400, 'abierto', 'espejo 07-09', '2026-09-07', null, null),
  ('sobrepagados-477',
   '477 créditos sobre-pagados: $1,16M registrados dos veces (app + oficina)',
   'Cerrados como finalizado el 07-09 sin tocar un pago; el exceso sigue registrado. Doble registro del 08-08/17-08 (el cobrador en la app y la oficina en Disapp). Los grandes: NICOLAS CUELLO $79.050, MIRTA FIGUEIRA $31.500, NANCY MONTALDO $25.600, JORGE MACHADO $21.750, SILVINA FAGIANI $20.000. Lista completa: scripts/_espejo_activos_20260907-0204.csv (clase sobrepagado). Decidir qué se anula.',
   'mauricio', 'plata', 'alta', 1164945, 'abierto', 'espejo 07-09', '2026-09-07', null, null),
  ('pasados-215',
   '215 créditos "pasados" vs Disapp: la app tiene $3,24M más que el libro de Disapp',
   'Herencia del empalme del 17-08 (213 ya estaban antes de la noche del 06-09). Los 10 mayores: MARÍA DOLORES $484.050, KARENT LONDOÑO $144.000, EDWARD MUÑOZ $138.500 y $116.560, DANIELA MERCEDES $120.400/$92.867/$81.400. Se ven en scripts/verificar-post-empalme.py sección 1.',
   'mauricio', 'plata', 'media', 3239631, 'abierto', 'verificación 07-09', '2026-09-06', null, null),
  ('maicol-rivero-0808',
   'MAICOL RIVERO: $18.296 en tres entradas nativas el 08-08 (día 1 de Leonel en la app)',
   '$8.398 sobre el crédito de julio, $8.398 sobre una renovación creada ese día y $1.500 sobre otro $7.000 del mismo día — para un préstamo de $7.000. El 07-09 se creó el $7.000 del 28-08 que Disapp sí tiene (PRD0003668219, $3.500 cobrados). Quedan dos nativos del 10-08 que Disapp no conoce.',
   'mauricio', 'plata', 'media', 18296, 'abierto', 'espejo 07-09', '2026-09-07', null, null),
  ('sosa-anahi-nativos',
   'MIGUEL SOSA y ANAHI MARTÍNEZ: un nativo de $5.000 cada uno que Disapp no tiene',
   'SOSA: nativo del 13-08 con $5.850 cargados en bultos (Disapp tiene el $5.000 del 28-07 pagado y un $3.000 nuevo del 24-08, ambos ya en la app). ANAHI: nativo $5.000 del 20-08 con $250 (Disapp tiene $10.000 del 01-09, ya creado). ¿Son préstamos reales que la oficina no registró, o hay que cancelarlos?',
   'mauricio', 'datos', 'media', 10000, 'abierto', 'espejo 07-09', '2026-09-07', null, null),
  ('borrados-disapp-9',
   '9 clientes borrados en Disapp que la app sigue cobrando ($176.250 de deuda)',
   'Regla del 08-04: si Disapp BORRÓ al cliente, el crédito queda activo acá. Son de Brayan Toro (Durazno) y Edwin Campo (Tacuarembó): SAGARDOY $36.000, SUAREZ $24.900, OCAMPO $20.400, VOLPE $20.400, GODOY $19.650, CASTRO $19.200, GARCIA $18.000, CORTAZZO $14.400, SEVERO $3.300. Confirmar con la oficina si se cobran o se dan de baja.',
   'carlos', 'negocio', 'media', 176250, 'abierto', 'espejo 07-09', '2026-08-04', null, null),
  ('vendedor-14610',
   'Vendedor Disapp 14610 "JUAN JOSE RAMIREZ" sin usuario en la app: 42 créditos ($355.000), 32 clientes sin ruta',
   'Aparece en Disapp desde el 24-08. Crear el usuario con disapp_vendedor_id=14610 y re-correr el empalme (idempotente) los trae solos.',
   'mauricio', 'adopcion', 'baja', 355000, 'aceptado', 'empalme 06-09', '2026-09-06',
   'Carlos (07-09): "lo del vendedor dejalo así, todavía no es importante en prueba piloto".', now()),
  ('pares-187',
   '187 pares nativo+importado ($157.770, 16 sobre-cobrados) + 6 del adelanto ($3.150)',
   'Cobros que la app y Disapp registraron por separado para el mismo crédito/día. No son pruebas (análisis 06-09) pero tampoco están identificados como duplicados uno por uno: no anular sin mirar.',
   'carlos', 'plata', 'media', 160920, 'abierto', 'análisis 05/06-09', '2026-09-05', null, null),
  ('actas-caja',
   'Nadie cierra caja: 0 actas desde el 14-08 (145 días-cobrador, $9,25M sin acta)',
   'El arrastre de caja existe y funciona, pero se alimenta del ACTA de cierre. Sin acta, cada cobrador amanece con base $0 salvo que el supervisor la cargue en /admin/jornada. Es adopción (ritual de cierre), no bug.',
   'mauricio', 'adopcion', 'alta', null, 'abierto', 'caja 04-09', '2026-09-04', null, null),
  ('refs-dobles-julio',
   '5 refs con DOS créditos en la app (imports de julio: el "total como capital" al lado del real)',
   'PRD0003416799, PRD0002811795, PRD0003243228, PRD0003153961, PRD0003208599. Con dos créditos por ref, by_ref_db elige según el orden de la base y refs_cero le manda TODA la historia al de pagado=0 → plata dos veces sobre un crédito muerto ($15.480). Excluidas con --excluir-ref el 07-09; hay que depurar el par (cancelar el vacío).',
   'carlos', 'tecnico', 'media', 15480, 'abierto', 'empalme 07-09', '2026-09-07', null, null),
  ('total-como-capital-191',
   '191 créditos con el TOTAL como capital (herencia del import de julio)',
   'El import de julio creó créditos donde monto_prestado = total con intereses. Afecta interés mostrado y scoring; no afecta el cobro diario.',
   'mauricio', 'datos', 'baja', null, 'abierto', 'verificación 12-08', '2026-08-12', null, null),
  ('cortos-15',
   '15 créditos "cortos" vs Disapp ($6.343): recaudos que chocan por día con un nativo de otro monto',
   'La guardia por día los saltea (la app manda). ANGIE $1.000, MARÍA ARTUNDUAGA $880/$600/$500, DANIELA $500, KARENT $480/$400, JORGE $460… Decidir por crédito si el nativo o Disapp tiene razón.',
   'carlos', 'plata', 'baja', 6343, 'abierto', 'verificación 07-09', '2026-09-07', null, null),
  ('push-0-suscriptos',
   'Push: 0 suscriptos; los gestores abrieron "Pedidos" 1 vez en 14 días',
   'Por eso el aviso del +20% está en cuatro lugares (franja en vivo, tab, Mi jornada, Pedidos). Falta que supervisor y admin toquen "Activar avisos" en su teléfono.',
   'mauricio', 'adopcion', 'media', null, 'abierto', 'regla +20% 06-09', '2026-09-06', null, null),
  ('supervisores-telefono',
   'Supervisores sin teléfono cargado en su ficha',
   'Sin teléfono no hay WhatsApp de avisos ni recuperación de clave por SMS.',
   'mauricio', 'adopcion', 'baja', null, 'abierto', 'quejas 19-08', '2026-08-19', null, null),
  ('duplicados-ruta-45',
   '45 clientes duplicados en la misma ruta (127 grupos / 254 fichas) y 12% de nombres con casing roto',
   'Fichas repetidas del export ("ADRIáN", anotaciones dentro del nombre). Unificar de a poco con el censo; el casing se puede normalizar en bloque.',
   'mauricio', 'datos', 'baja', null, 'abierto', 'empalme 06-09', '2026-09-06', null, null),
  ('lock-emnapi',
   'package-lock pierde @emnapi/runtime con cada npm install en Windows → CI rojo silencioso',
   'Pasó el 03-08 (b041321) y el 06-09 (9d94694). Fijar: npm install con --no-optional consistente, o pin en overrides.',
   'carlos', 'tecnico', 'media', null, 'abierto', 'deploy 06-09', '2026-09-07', null, null),
  ('premios-precio',
   'Precio de los 3 premios de los juegos (presupuesto de juegos)',
   'El simulador "cuánto dejo en la calle" necesita el costo de cada premio para congelarlo al entregar.',
   'mauricio', 'negocio', 'baja', null, 'abierto', 'juegos 04-08', '2026-08-04', null, null),
  ('cap-capital-vs-total',
   'CAP del primer crédito: ¿se mide sobre el capital o sobre el total con intereses?',
   'Hoy el CAP ($100.000) se compara contra el capital. Confirmar con Mauricio.',
   'carlos', 'negocio', 'baja', null, 'abierto', 'pilot-readiness 30-07', '2026-07-30', null, null)
on conflict (clave) do nothing;
