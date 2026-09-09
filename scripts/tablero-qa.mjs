#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
//  TABLERO DE QA (§9 del plan maestro) — SOLO LECTURA contra la base viva.
//
//  "Si un número de estos se mueve, algo del workflow se rompió aunque los
//  tests estén verdes." Corre en segundos, sin sesión ni navegador:
//
//      node scripts/tablero-qa.mjs
//
//  Cadencia: semanal (junto con «Un día en la vida») y ante cualquier duda.
//  Métricas: invariantes rojas vs baseline conocido · candado trabajando ·
//  pedidos envejecidos · jornadas sin rendir · reportes desde la app ·
//  adopción de bases. El drift vs Disapp y la cola offline no viven en la
//  base (export manual / teléfono) — se listan como recordatorio.
//
//  BASELINE (medido 15-08-2026): lo heredado que los vigilantes cantan todos
//  los días sin que sea un incidente nuevo. Si un contador SUPERA su baseline,
//  eso sí es del día y hay que mirarlo.
// ─────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

function leerEnv(nombre) {
  if (process.env[nombre]) return process.env[nombre];
  const texto = readFileSync(join(raiz, ".env.local"), "utf8");
  const linea = texto.split(/\r?\n/).find((l) => l.startsWith(`${nombre}=`));
  if (!linea) throw new Error(`${nombre} no está en .env.local`);
  return linea.slice(nombre.length + 1).trim().replace(/^["']|["']$/g, "");
}

// Lo que los vigilantes cantan HOY por herencia del empalme / operación
// conocida. Ver memoria qa-fases-2-3-0815: no es plata nueva mal contada.
// ⚠️ LECCIÓN DEL 04-09, la que costó 18 corridas ciegas: un baseline que es un
// CONTADOR miente en las dos direcciones. `no-sobrecobro` valió exactamente 56
// durante 4 días, exactamente 292 durante 11 y exactamente 608 durante 19 —
// mientras entraban 4.495 pagos. Un número que no se mueve ni ±1 no está
// midiendo el día: está midiendo un stock viejo. Y encima, al RESOLVER casos el
// contador BAJA y cruza el tope hacia abajo, así que el tablero se pone verde
// con la plata todavía mal contada.
//
// Reglas nuevas, aplicadas abajo en el chequeo:
//   · `tope: null` YA NO ES SILENCIO — se compara contra la corrida anterior y
//     cualquier subida alarma. (Antes `tope != null && n > tope` cortaba antes
//     de mirar: `importado-saldado-sin-finalizar` pasó de 217 a 406 sin que
//     ninguna corrida lo cantara.)
//   · lo que duele se mide en PLATA, no en cantidad de filas (check 1b).
const BASELINE = {
  "no-sobrecobro": {
    // El stock heredado + lo que dejó el empalme del 17-08, medido el 04-09
    // DESPUÉS de anular 41 pagos duplicados ($38.350). No es un permiso: es el
    // punto de partida contra el que se mide si APARECEN casos nuevos. Lo que
    // de verdad vigila este renglón es la plata (check 1b) y el crecimiento.
    // ⚠️ EL TOPE SE MIDE CON EL MISMO INSTRUMENTO QUE LO REPORTA. Este número
    // sale del RPC 0071 vía `reconciliacion_log.detalle`, que aplica su propio
    // predicado; calibrarlo con una consulta SQL escrita a mano da otro valor
    // (581 vs 608) y deja el tope con margen negativo o falsamente holgado. 608
    // es el último valor QUE ESTE VIGILANTE reportó.
    //
    // Se espera que BAJE en la próxima corrida (el 04-09 se anularon 41 pagos
    // duplicados): si mañana no bajó, la anulación no impactó donde debía y hay
    // que mirarlo. El resto se resuelve contra el export fresco de Disapp.
    tope: 608,
    nota: "608 es lo último que reportó el propio vigilante (04-09 10:00Z, antes de anular 41 duplicados); tiene que BAJAR en la próxima corrida — si no baja, mirarlo",
  },
  "importado-saldado-sin-finalizar": {
    // Tenía `tope: null` con la nota "~217", y por la expresión de abajo eso
    // significaba que NO PODÍA alertar jamás. Creció a 406 (+87%) en silencio.
    tope: 406,
    nota: "zombies de Renovar: 406 medidos el 04-09 (eran 217 el 15-08 — creció +87% sin que nadie lo cantara)",
  },
  "gasto_sin_egreso": {
    // Los casos que justificaban el tope 1 ya salieron de la ventana de 14 días
    // del cron: el tope vigilaba un cero estructural.
    tope: 0,
    nota: "el caso viejo (Valentina, 04-08) ya salió de la ventana de 14 días: cualquiera que aparezca es de ahora",
  },
  "rendicion-existe": {
    // Tope 15 con 18 cobradores que cobran = un tope que iguala el universo de
    // la métrica es un tope apagado.
    tope: 0,
    nota: "cualquier cobrador que cobró y no rindió es del día (el acumulado en plata va en el check 4b)",
  },
  "base_sin_rendir": {
    tope: 0,
    nota: "las bases que justificaban el 15 ya salieron de la ventana de 14 días del cron",
  },
};

const alarmas = [];
function linea(titulo, valor, alarma = null) {
  console.log(`  ${titulo.padEnd(46, "·")} ${valor}`);
  if (alarma) {
    alarmas.push(alarma);
    console.log(`     ⚠ ${alarma}`);
  }
}

const db = new pg.Client({
  connectionString: leerEnv("SUPABASE_DB_URL"),
  ssl: { rejectUnauthorized: false },
});
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

console.log("═══ TABLERO DE QA · " + new Date().toISOString().slice(0, 16) + "Z ═══\n");

// ── 1 · Invariantes de los vigilantes (última corrida) ──────────────────────
{
  // Se traen DOS corridas: la de anoche y la anterior. Sin la anterior no hay
  // forma de distinguir "stock viejo conocido" de "esto subió hoy", que es la
  // única pregunta que importa cuando el baseline es un número grande heredado.
  const [ultima, previa] = await q(
    "select corrida_en, criticos, detalle from reconciliacion_log order by corrida_en desc limit 2",
  );
  if (!ultima) {
    linea("Vigilantes nocturnos", "SIN CORRIDAS", "reconciliacion_log vacío: ¿el cron murió?");
  } else {
    const horas = (Date.now() - new Date(ultima.corrida_en).getTime()) / 3_600_000;
    console.log(
      `  Vigilantes (corrida ${new Date(ultima.corrida_en).toISOString().slice(0, 16)}Z, hace ${horas.toFixed(0)} h)`,
    );
    if (horas > 30) alarmas.push("la última corrida de vigilantes tiene más de 30 h — ¿cron caído?");
    // `detalle` ES el mapa {invariante: cantidad} (verificado contra la base 15-08).
    const det = typeof ultima.detalle === "string" ? JSON.parse(ultima.detalle) : (ultima.detalle ?? {});
    const detPrevio = previa
      ? typeof previa.detalle === "string"
        ? JSON.parse(previa.detalle)
        : (previa.detalle ?? {})
      : {};
    const porInv = Object.fromEntries(Object.entries(det).filter(([, v]) => typeof v === "number"));
    for (const [inv, n] of Object.entries(porInv).sort((a, b) => b[1] - a[1])) {
      const base = BASELINE[inv];
      const antes = typeof detPrevio[inv] === "number" ? detPrevio[inv] : null;
      const delta = antes == null ? null : n - antes;

      // Dos motivos para alarmar, no uno:
      //  · SUPERA el tope conocido (lo de siempre), o
      //  · SUBIÓ respecto de anoche — aunque siga bajo el tope. Un baseline
      //    heredado grande tapaba justamente esto: entre 292 y 608 podían
      //    aparecer 300 casos nuevos sin que nada lo dijera.
      const superaTope = base ? base.tope != null && n > base.tope : n > 0;
      const subio = delta != null && delta > 0;
      const alarma = superaTope
        ? `${inv} = ${n} SUPERA lo conocido (${base?.tope ?? 0}) — mirar hoy`
        : subio
          ? `${inv} SUBIÓ ${delta} desde anoche (${antes} → ${n}) — son casos NUEVOS, no el stock viejo`
          : null;

      const tendencia = delta == null ? "" : delta === 0 ? "  (=)" : `  (${delta > 0 ? "+" : ""}${delta})`;
      linea(`   ${inv}`, `${n}${tendencia}${base ? `  (baseline: ${base.nota})` : ""}`, alarma);
    }

    // Las invariantes que NO vienen en el detalle son las que no tienen ninguna
    // violación: el RPC solo devuelve las que encontraron algo. Se listan como
    // limpias —para que se vea que existen y que hoy están en cero— pero NO
    // alarman: hacerlo sonaba dos alarmas falsas todos los días sobre dos
    // invariantes sanas, que es la forma más rápida de que se deje de leer el
    // tablero entero.
    const limpias = Object.keys(BASELINE).filter((inv) => !(inv in porInv));
    if (limpias.length) linea("   sin violaciones hoy", limpias.join(", "));
  }
}

// ── 1b · Lo que DUELE del sobre-cobro se mide en PLATA, no en filas ──────────
// El contador baja cuando se resuelven casos y sube cuando aparecen; cruzando el
// tope hacia abajo el tablero se ponía VERDE con el exceso todavía vivo. La
// plata no tiene esa ambigüedad.
{
  const [x] = await q(`
    select count(*)::int n,
           coalesce(sum(pagado_acum - cuota_diaria*total_dias), 0)::bigint exceso,
           count(*) filter (where estado = 'activo')::int n_activos,
           coalesce(sum(pagado_acum - cuota_diaria*total_dias)
                    filter (where estado = 'activo'), 0)::bigint exceso_activos
      from prestamos
     where pagado_acum > cuota_diaria*total_dias + 1
  `);
  // ⚠️ SE VIGILA EL EXCESO DE LOS **ACTIVOS**, no el total. El total es un stock
  // heredado que solo puede bajar a medida que se resuelve, y usarlo de tope
  // reproduce el mismo error que este tablero acaba de corregir: se anulan los
  // duplicados de los finalizados (−$805.103), aparece un doble cobro REAL de
  // $600.000 en créditos vivos, la suma queda por debajo del tope viejo y el
  // tablero se pone verde con plata cobrada dos veces a clientes que están
  // pagando hoy. El exceso de los ACTIVOS, en cambio, es plata que alguien puede
  // reclamar mañana: ese número no tiene por qué subir nunca.
  const TOPE_EXCESO_ACTIVOS = 370_276; // medido el 04-09 tras anular los 41 duplicados
  const exceso = Number(x?.exceso ?? 0);
  const excesoActivos = Number(x?.exceso_activos ?? 0);
  linea(
    "Sobre-cobro vivo (plata, no filas)",
    `$${exceso.toLocaleString("es-UY")} en ${x?.n ?? 0} créditos · ACTIVOS: $${excesoActivos.toLocaleString("es-UY")} en ${x?.n_activos ?? 0}`,
    excesoActivos > TOPE_EXCESO_ACTIVOS
      ? `el sobre-cobro en créditos ACTIVOS subió a $${excesoActivos.toLocaleString("es-UY")} (era $${TOPE_EXCESO_ACTIVOS.toLocaleString("es-UY")}): hay plata NUEVA contada dos veces a clientes que están pagando`
      : null,
  );
}

// ── 2 · El candado anti-duplicados trabaja ──────────────────────────────────
{
  const frenos = await q(
    `select accion, count(*)::int as k from auditoria
     where accion like 'Candado frenó%' and creado_en > now() - interval '7 days'
     group by accion order by k desc`,
  );
  if (frenos.length === 0) {
    linea(
      "Candado: frenos en 7 días",
      "0",
      null, // el rastro existe recién desde el 15-08: 0 todavía no prueba candado muerto
    );
    console.log("     (rastro nuevo del 15-08: un 0 sostenido POR SEMANAS = candado muerto o nadie duplica)");
  } else {
    for (const f of frenos) linea(`   ${f.accion}`, String(f.k));
  }
}

// ── 3 · Pedidos envejecidos (>24 h pendientes) ──────────────────────────────
{
  const [r] = await q(`
    select
      (select count(*)::int from solicitudes_renovacion where estado='pendiente' and solicitado_en < now() - interval '24 hours') as renov,
      (select count(*)::int from solicitudes_gasto      where estado='pendiente' and solicitado_en < now() - interval '24 hours') as gasto,
      (select count(*)::int from solicitudes_anulacion  where estado='pendiente' and solicitado_en < now() - interval '24 hours') as anul
  `);
  const total = r.renov + r.gasto + r.anul;
  linea(
    "Pedidos pendientes > 24 h (renov/gasto/anul)",
    `${r.renov} / ${r.gasto} / ${r.anul}`,
    total > 0 ? `${total} pedidos con más de un día: la cola se está resolviendo por WhatsApp otra vez` : null,
  );
}

// ── 4 · Jornadas sin rendir ─────────────────────────────────────────────────
{
  // ⚠️ CON PISO TEMPORAL Y CON TOPE PROPIO. Antes barría TODA la historia y se
  // comparaba contra el tope de OTRA métrica (`base_sin_rendir`, que mide una
  // ventana de 14 días del cron): imprimía "14 / 14" y gritaba "crecen las
  // jornadas sin rendir" todos los días, sobre un acumulado congelado desde el
  // 17-08 que es matemáticamente incapaz de moverse. Un contador histórico
  // contra un tope fijo es una alarma con fecha de defunción: primero grita para
  // siempre y después nadie la lee.
  //
  // Lo que se vigila es lo RECIENTE (30 días, que es donde todavía se puede
  // actuar); el acumulado histórico va como cifra informativa al lado.
  const TOPE_JORNADAS_SIN_ACTA_30D = 0;
  const [r] = await q(`
    select
      count(*) filter (where a.fecha >= (now() at time zone 'America/Montevideo')::date - 30)::int as recientes,
      count(*)::int as total
    from aperturas_caja a
    where a.fecha < (now() at time zone 'America/Montevideo')::date
      and not exists (select 1 from rendiciones r where r.cobrador_id = a.cobrador_id and r.fecha = a.fecha)
  `);
  linea(
    "Jornadas con base y sin acta (30 días / histórico)",
    `${r.recientes} / ${r.total}`,
    r.recientes > TOPE_JORNADAS_SIN_ACTA_30D
      ? `${r.recientes} jornada(s) de los últimos 30 días con base cargada y sin acta: esa plata no arrastra`
      : null,
  );
}

// ── 4b · CAJAS SIN CERRAR: la métrica REAL del arrastre (04-09) ──────────────
//  El chequeo de arriba mira jornadas CON BASE cargada, y como casi nadie carga
//  base, no veía nada. Esto mira lo que de verdad importa: el que COBRÓ en la
//  calle y no cerró su caja. Sin acta no hay arrastre, y por eso la caja
//  amanece en $0 — que es la queja "la caja no queda de un día para otro".
//  Medido el 03-09: 145 días-cobrador y $9.250.920 en 30 días. Con el piloto en
//  pausa esto es esperable; al retomar, cualquier número sostenido es la señal.
{
  const [r] = await q(`
    select count(*)::int as dias_cobrador, coalesce(sum(monto),0)::int as plata
    from (
      select (p.registrado_en - interval '3 hours')::date as dia, p.registrado_por as cid, sum(p.monto) as monto
      from pagos p
      where p.anulado = false and p.origen is null
        and p.registrado_en > now() - interval '7 days'
        and (p.registrado_en - interval '3 hours')::date < (now() at time zone 'America/Montevideo')::date
      group by 1, 2
    ) d
    left join rendiciones r on r.cobrador_id = d.cid and r.fecha = d.dia
    where r.id is null
  `);
  linea(
    "Cobró y NO cerró caja (7 días / plata)",
    `${r.dias_cobrador} días-cobrador / $${r.plata.toLocaleString("es-UY")}`,
    r.dias_cobrador > 0
      ? `${r.dias_cobrador} jornada(s) con cobros y sin acta: esa caja no arrastra y amanece en $0`
      : null,
  );
}

// ── 5 · Reportes desde la app ───────────────────────────────────────────────
{
  const [r] = await q(`
    select
      (select count(*)::int from incidencias where creado_en > now() - interval '7 days') as bichos,
      (select count(*)::int from incidencias where estado not in ('resuelta','cerrada','descartada')) as abiertas,
      (select count(*)::int from discrepancias_dinero where resuelto_en is null) as discrepancias
  `);
  linea("Incidencias 🐞 (7 días / abiertas)", `${r.bichos} / ${r.abiertas}`);
  linea(
    "Discrepancias de dinero SIN resolver",
    String(r.discrepancias),
    r.discrepancias > 0 ? "hay clientes reportando pagos que el libro no refleja — resolver YA" : null,
  );
}

// ── 6 · Adopción: bases cargadas / cobradores activos ───────────────────────
{
  const [r] = await q(`
    select
      (select count(*)::int from aperturas_caja where fecha = (now() at time zone 'America/Montevideo')::date) as hoy,
      (select count(*)::int from aperturas_caja where fecha = (now() at time zone 'America/Montevideo')::date - 1) as ayer,
      -- ⚠️ El denominador son los que REALMENTE cobran, no los 52 marcados
      -- 'activo' en la tabla (muchos son altas viejas que nunca salieron a la
      -- calle). Con 52 el renglón sale rojo para siempre: incluso el día que 15
      -- de 18 carguen base, 15 < 26 y la alarma sigue sonando — justo cuando la
      -- adopción sería una buena noticia.
      (select count(distinct p.registrado_por)::int from pagos p
        where p.anulado = false and p.origen is null
          and p.registrado_en >= now() - interval '7 days'
          and p.registrado_por is not null) as cobradores,
      (select count(*)::int from pagos
        where anulado = false and origen is null
          and registrado_en >= now() - interval '7 days') as pagos_7d
  `);
  // ⚠️ "PILOTO EN PAUSA" (nota de Carlos del 15-08) apagaba esta alarma. Una nota
  // con fecha se convirtió en excepción permanente: se siguieron cobrando 4.495
  // pagos por $9.988.459 en 30 días con la alarma muda. El juicio manual se
  // reemplaza por uno DERIVADO DEL DATO — si hubo cobros en la app en los
  // últimos 7 días, el piloto está vivo y la alarma se enciende sin excusa.
  const pilotoVivo = Number(r.pagos_7d) > 0;
  linea(
    "Bases hoy / ayer / cobradores que COBRAN",
    `${r.hoy} / ${r.ayer} / ${r.cobradores}${pilotoVivo ? `  · ${r.pagos_7d} cobros en la app en 7 días` : "  · sin cobros en 7 días"}`,
    pilotoVivo && r.cobradores > 0 && r.ayer < Math.ceil(r.cobradores / 2)
      ? `se está cobrando por la app (${r.pagos_7d} pagos de ${r.cobradores} cobrador(es) en 7 días) pero solo ${r.ayer} cargaron base ayer: esa caja no arrastra`
      : null,
  );
  if (!pilotoVivo)
    console.log("     (sin cobros en la app en 7 días — al retomar, esto vuelve a ser señal de alarma)");
}

// ── 6a-bis · FORMATO DE CRÉDITO INCOHERENTE (vigilancia nueva, 04-09) ────────
//  La queja: 8 planes SEMANALES quedaron programados día por día porque "Nueva
//  venta" no dejaba elegir el formato y el primer crédito nacía "diario". El
//  cartón los daba por vencidos a la semana y el scoring castigaba a clientes
//  que venían al día. El hueco se cerró (formato obligatorio + aviso de
//  coherencia), y esto es el detector para que NUNCA MÁS haga falta que alguien
//  se queje: si vuelve a aparecer uno cargado DESDE LA APP, salta acá solo.
//
//  La señal es estructural: con el 20% de interés del negocio la cuota es
//  ≈ 1,2 / cantidad de cuotas del capital; en 24-30 cuotas diarias da 4-5%. Una
//  cuota ≥20% del capital en ≤8 cuotas "diarias" liquida el crédito en días:
//  eso no es cobro diario. Se miran SOLO los creados por un usuario en la app
//  (creado_por no nulo): los heredados de Disapp son otra historia, con su
//  propio lote de revisión.
{
  // ⚠️ Tres calibraciones que salieron de la auditoría del 04-09:
  //  · `total_dias >= 2`: el PRÉSTAMO A UN PAGO (1 cuota) es un producto real
  //    del negocio —7 activos, clientes que lo repiten— y no un formato mal
  //    elegido. Contarlo hacía cantar al vigilante todos los meses.
  //  · Se sacó `origen <> 'disapp_import'`: ese valor no existe en
  //    `prestamos.origen` (su CHECK admite 'credito' y 'tienda'; el
  //    'disapp_import' vive en `pagos.origen`). Era un filtro muerto que
  //    aparentaba excluir algo. Lo que separa la app del empalme es
  //    `creado_por is not null`, que sí funciona.
  //  · El baseline es la LISTA de los conocidos, no un contador: con un número
  //    fijo, resolver uno viejo y cargar uno nuevo se compensaban y el
  //    vigilante quedaba ciego justo cuando había que mirar.
  const CONOCIDOS = [
    // Ambiguos del 04-09: clientes con historial 100% diario, dejados a
    // propósito para consultarlos con su cobrador antes de tocarlos.
    "MARIA PICA",
    "ANDREA JHOANA GONZALEZ HERNANDEZ",
    "ANA STEVES MARTíNEZ",
  ];
  const filas = await q(
    `select c.nombre, p.total_dias, round(p.cuota_diaria / nullif(p.monto_prestado,0) * 100)::int as pct,
            (p.creado_en > now() - interval '7 days') as reciente
       from prestamos p join clientes c on c.id = p.cliente_id
      where p.estado = 'activo' and p.frecuencia = 'diario'
        and p.total_dias between 2 and 8
        and p.creado_por is not null
        and p.cuota_diaria / nullif(p.monto_prestado, 0) >= 0.20
      order by p.creado_en desc`,
  );
  const nuevos = filas.filter((f) => !CONOCIDOS.includes(f.nombre));
  linea(
    "Créditos con formato incoherente (app)",
    `${filas.length}  (${CONOCIDOS.length} conocidos${nuevos.length ? ` · ${nuevos.length} NUEVOS` : ""})`,
    nuevos.length > 0
      ? `${nuevos.length} crédito(s) cargados como "diario" con cuota de días (${nuevos
          .slice(0, 3)
          .map((f) => `${f.nombre}: ${f.total_dias} cuotas al ${f.pct}%`)
          .join("; ")}) — correr scripts/formato-credito-diagnostico.ts`
      : null,
  );
}

// ── 6b · Supervisores SIN zona (decisión de Carlos, 15-08: no pueden existir) ─
//  Mientras haya alguno, la rama app_supervisor_sin_zonas() les abre TODO
//  (transición). Cuando este número llegue a 0 y se decida, se quita esa rama
//  de las policies (migración) y el aislamiento zonal queda sin excepciones.
{
  const [r] = await q(`
    select count(*)::int as sin_zona,
           (select count(*)::int from usuarios where rol='supervisor' and activo) as total
    from usuarios u
    where u.rol='supervisor' and u.activo
      and not exists (select 1 from supervisor_zonas sz where sz.supervisor_id = u.id)
  `);
  linea(
    "Supervisores sin zona / total",
    `${r.sin_zona} / ${r.total}`,
    r.sin_zona > 0
      ? `${r.sin_zona} supervisor(es) ven TODO por la rama de transición — asignar zonas y quitar app_supervisor_sin_zonas()`
      : null,
  );
}

//  Espejo para COBRADORES: un cobrador activo sin zona_id genera pedidos que
//  NINGÚN supervisor ve (la RLS 0140 deriva la zona del cliente desde la del
//  cobrador → NULL → solo el admin los ve) y "Recordarle a mi supervisor" no
//  tiene canal de zona (auditoría 21-08).
{
  const [r] = await q(`
    select count(*)::int as sin_zona,
           (select count(*)::int from usuarios where rol='cobrador' and activo) as total
    from usuarios u
    where u.rol='cobrador' and u.activo and u.zona_id is null
  `);
  linea(
    "Cobradores sin zona / total",
    `${r.sin_zona} / ${r.total}`,
    r.sin_zona > 0
      ? `${r.sin_zona} cobrador(es) activos sin zona: sus pedidos de la calle solo los ve el admin — asignarles zona`
      : null,
  );
}

// ── 7 · VIGILANTE DE POLICIES: la base viva vs el snapshot esperado ─────────
//  El incidente 0029-vs-0096 (08-14): el repo decía una policy y la base viva
//  tenía otra — un supervisor podía resolver pedidos de zonas ajenas y ningún
//  test lo veía (el harness aplica las migraciones del REPO). Este check
//  compara pg_policies REAL contra scripts/policies-esperadas.json.
//  Tras aplicar una migración legítima: node scripts/tablero-qa.mjs --regenerar-policies
{
  const rutaSnap = join(raiz, "scripts", "policies-esperadas.json");
  const vivas = (
    await q(`select tablename, policyname, cmd, coalesce(array_to_string(roles,','),'') as roles,
                    md5(coalesce(qual,'') || '|' || coalesce(with_check,'')) as md5
             from pg_policies where schemaname='public' order by tablename, policyname`)
  ).map((r) => ({ tabla: r.tablename, policy: r.policyname, cmd: r.cmd, roles: r.roles, md5: r.md5 }));

  if (process.argv.includes("--regenerar-policies")) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      rutaSnap,
      JSON.stringify(
        {
          generado: new Date().toISOString().slice(0, 10),
          nota: "Snapshot de pg_policies de la base VIVA (tabla, policy, cmd, roles, md5 del using|check). Regenerar tras cada migracion aplicada: node scripts/tablero-qa.mjs --regenerar-policies",
          policies: vivas,
        },
        null,
        1,
      ),
    );
    linea("Policies: snapshot REGENERADO", `${vivas.length} policies`);
  } else {
    const snap = JSON.parse(readFileSync(rutaSnap, "utf8"));
    const clave = (p) => `${p.tabla}.${p.policy}`;
    const esperadas = new Map(snap.policies.map((p) => [clave(p), p]));
    const enVivo = new Map(vivas.map((p) => [clave(p), p]));
    const faltan = [...esperadas.keys()].filter((k) => !enVivo.has(k));
    const sobran = [...enVivo.keys()].filter((k) => !esperadas.has(k));
    const cambiadas = [...esperadas.entries()]
      .filter(([k, e]) => enVivo.has(k))
      .filter(([k, e]) => {
        const v = enVivo.get(k);
        return v.md5 !== e.md5 || v.cmd !== e.cmd || v.roles !== e.roles;
      })
      .map(([k]) => k);
    const drift = faltan.length + sobran.length + cambiadas.length;
    linea(
      `Policies vivas vs snapshot ${snap.generado}`,
      drift === 0 ? `${vivas.length} — sin drift` : `DRIFT: −${faltan.length} +${sobran.length} ~${cambiadas.length}`,
      drift > 0
        ? `pg_policies cambió sin regenerar el snapshot: ${[...faltan.map((k) => "falta " + k), ...sobran.map((k) => "sobra " + k), ...cambiadas.map((k) => "cambió " + k)].slice(0, 6).join(" · ")}`
        : null,
    );
  }
}

// ── 7b · ¿CORRIÓ CADA MIGRACIÓN? El snapshot no alcanza ─────────────────────
//  El incidente del 09-09: la 0096 (endurecimiento de RLS de nueve tablas) NUNCA
//  se aplicó — abortaba en su primera línea, `drop policy ... on recibos`, porque
//  esa tabla no existía; el `if exists` protege la POLICY, no la TABLA, y el SQL
//  Editor revirtió el archivo entero. Pasó 25 días sin que nadie lo notara, y el
//  check de arriba lo BENDIJO: compara contra un snapshot que se regenera DESDE LA
//  BASE VIVA, o sea que congela como "esperado" lo que haya, incluso lo que falta.
//  Esto compara contra los ARCHIVOS del repo, que es la única fuente que sabe lo
//  que TENDRÍA que existir.
{
  const { readdirSync } = await import("node:fs");
  const dir = join(raiz, "supabase", "migrations");
  const archivos = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const tablasRepo = new Set();
  const funcsRepo = new Set();
  const policiesRepo = new Map(); // "tabla.policy" → archivo que la declara último
  //  Se leen los archivos EN ORDEN y gana la última palabra: si una migración
  //  posterior borra la tabla (mascotas, 0023) o la policy, deja de esperarse.
  //  Solo se mira el schema `public`: las policies sobre storage.objects viven en
  //  otro schema y se consultan aparte (si no, salen como falsos faltantes).
  for (const f of archivos) {
    const txt = readFileSync(join(dir, f), "utf8");
    for (const m of txt.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)/gi)) tablasRepo.add(m[1]);
    for (const m of txt.matchAll(/drop table (?:if exists )?(?:public\.)?(\w+)/gi)) tablasRepo.delete(m[1]);
    for (const m of txt.matchAll(/create or replace function\s+(?:public\.)?(\w+)/gi)) funcsRepo.add(m[1]);
    for (const m of txt.matchAll(/drop function (?:if exists )?(?:public\.)?(\w+)/gi)) funcsRepo.delete(m[1]);
    for (const m of txt.matchAll(/create policy\s+"?(\w+)"?\s+on\s+(\w+)?\.?(\w+)/gi)) {
      const schema = m[3] ? m[2] : "public";
      const tabla = m[3] ?? m[2];
      if (schema === "public") policiesRepo.set(`${tabla}.${m[1]}`, f);
    }
    // una policy que este archivo BORRA y no vuelve a crear deja de esperarse
    for (const m of txt.matchAll(/drop policy (?:if exists )?"?(\w+)"?\s+on\s+(?:public\.)?(\w+)/gi))
      if (!new RegExp(`create policy\\s+"?${m[1]}"?\\s+on`, "i").test(txt)) policiesRepo.delete(`${m[2]}.${m[1]}`);
  }
  // una policy de una tabla que ya no existe tampoco se espera
  for (const k of [...policiesRepo.keys()]) if (!tablasRepo.has(k.split(".")[0])) policiesRepo.delete(k);
  const tablasDb = new Set((await q(`select tablename from pg_tables where schemaname='public'`)).map((r) => r.tablename));
  const funcsDb = new Set((await q(`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`)).map((r) => r.proname));
  const polDb = new Set(
    (await q(`select tablename, policyname from pg_policies where schemaname='public'`))
      .map((r) => `${r.tablename}.${r.policyname}`),
  );

  const faltanT = [...tablasRepo].filter((t) => t !== "public" && !tablasDb.has(t));
  const faltanF = [...funcsRepo].filter((f) => !funcsDb.has(f));
  const faltanP = [...policiesRepo.keys()].filter((k) => !polDb.has(k));
  const total = faltanT.length + faltanF.length + faltanP.length;
  linea(
    "Migraciones del repo aplicadas",
    total === 0 ? `${archivos.length} archivos — todo presente` : `FALTAN ${total} objetos`,
    total > 0
      ? `el repo los crea y la base no los tiene (¿una migración abortó?): ` +
        [...faltanT.map((t) => "tabla " + t), ...faltanF.map((f) => "func " + f + "()"),
         ...faltanP.map((p) => "policy " + p + " (" + policiesRepo.get(p) + ")")].slice(0, 8).join(" · ")
      : null,
  );
}

// ── 8 · Lo que NO vive en la base (recordatorio) ────────────────────────────
console.log("\n  Manuales: drift vs EXPORT de Disapp (nunca contra su dashboard) · ops");
console.log("  atascadas en la cola offline (viven en cada teléfono; el cierre las canta)");
console.log("  · errores [PY-ERROR] en los logs de Vercel.");

await db.end();

console.log("\n═══ VEREDICTO ═══");
if (alarmas.length === 0) {
  console.log("🟢 Tablero en verde: nada se movió fuera de lo conocido.");
} else {
  console.log(`🔴 ${alarmas.length} señal(es) de alarma:`);
  for (const a of alarmas) console.log("   · " + a);
  process.exitCode = 1;
}
