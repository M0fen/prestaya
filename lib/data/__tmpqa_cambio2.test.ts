// TEMPORAL — QA CAMBIO 2. BORRAR.
import { describe, it } from "vitest";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { objetivoDelDia, clasificarClienteRuta, type CreditoRuta } from "./ruta";
import { plazoVencido, totalCredito } from "@/lib/cartones";
import type { FrecuenciaPrestamo } from "@/types/db";

const OUT = "C:/Users/Carlos/AppData/Local/Temp/claude/c--Users-Carlos-Desktop-prestaya/b87513d3-f36d-42c1-9265-d00b6a29c46c/scratchpad/out.txt";
writeFileSync(OUT, "");
const log = (s: string) => appendFileSync(OUT, s + String.fromCharCode(10));
const DUMP = "C:/Users/Carlos/AppData/Local/Temp/claude/c--Users-Carlos-Desktop-prestaya/b87513d3-f36d-42c1-9265-d00b6a29c46c/scratchpad/dump.json";
type Row = Record<string, unknown>;
const dump = JSON.parse(readFileSync(DUMP, "utf-8")) as {
  asig: Row[]; pres: Row[]; pag: Row[]; vis: Row[]; cli: Row[]; usr: Row[];
};

const nombreCli = new Map(dump.cli.map((c) => [c.id as string, c.nombre as string]));
const nombreCob = new Map(dump.usr.map((u) => [u.id as string, u.nombre as string]));
const cliActivo = new Set(dump.cli.map((c) => c.id as string));
const pagosHoy = new Map(dump.pag.map((p) => [p.prestamo_id as string, Number(p.monto)]));
const noPagoSet = new Set(dump.vis.map((v) => v.prestamo_id as string));
const presPorCliente = new Map<string, Row[]>();
for (const p of dump.pres) {
  const k = p.cliente_id as string;
  const a = presPorCliente.get(k);
  if (a) a.push(p); else presPorCliente.set(k, [p]);
}
const clientesDeCobrador = new Map<string, Set<string>>();
for (const a of dump.asig) {
  const c = a.cobrador_id as string;
  if (!clientesDeCobrador.has(c)) clientesDeCobrador.set(c, new Set());
  clientesDeCobrador.get(c)!.add(a.cliente_id as string);
}

interface Caso {
  cobrador: string; cliente: string; clienteId: string;
  cuotaEnTermino: number; moraEnTermino: number; pagadoHoyEnTermino: number;
  pagadoHoyTotal: number; estadoHoy: string; nCred: number;
  detalle: { cuota: number; prog: number; mora: number; pagHoy: number; frec: string; venc: boolean }[];
  moraCruda: number;
}

function correr(hoy: Date, conPagos: boolean) {
  const porCobrador = new Map<string, ReturnType<typeof arqueoVacio>>();
  const casos: Caso[] = [];
  function arqueoVacio() {
    return {
      esperado: 0, atrasoEsperado: 0, atrasoRecuperado: 0, recaudado: 0, recaudadoRuta: 0,
      cobrados: 0, abonos: 0, noPagos: 0, clientes: 0, moraCruda: 0,
      soloMora: 0, mixtos: 0, alDiaCron: 0, vencidosPuros: 0,
    };
  }

  for (const [cobradorId, cliIds] of clientesDeCobrador) {
    const arq = arqueoVacio();
    for (const cid of cliIds) {
      if (!cliActivo.has(cid)) continue;
      const todos = presPorCliente.get(cid) ?? [];
      const propios = todos.filter((p) => !(p.cobrador_id && p.cobrador_id !== cobradorId));
      const vivos = propios.filter((p) => {
        const tc = totalCredito(Number(p.cuota_diaria), Number(p.total_dias));
        return !(tc > 0 && Number(p.pagado_acum) >= tc - 0.5);
      });
      if (vivos.length === 0) continue;
      const esNoPago = vivos.some((p) => noPagoSet.has(p.id as string));
      const detalle: Caso["detalle"] = [];
      let moraCruda = 0;
      const creditos: CreditoRuta[] = vivos.map((p) => {
        const cuotaDiaria = Number(p.cuota_diaria);
        const totalDias = Number(p.total_dias);
        const fechaInicio = p.fecha_inicio as string;
        const frecuencia = (p.frecuencia as FrecuenciaPrestamo) ?? "diario";
        const pagadoAcum = Number(p.pagado_acum);
        const pagadoHoy = conPagos ? (pagosHoy.get(p.id as string) ?? 0) : 0;
        const venc = plazoVencido(
          { cuota_diaria: cuotaDiaria, total_dias: totalDias, fecha_inicio: fechaInicio, frecuencia },
          hoy,
        );
        const { cuotaHoy: programada, mora } = objetivoDelDia(
          { cuota: cuotaDiaria, totalDias, fechaInicio, frecuencia, pagadoAcum: pagadoAcum - pagadoHoy },
          hoy,
        );
        const aPedir = Math.min(cuotaDiaria, programada + mora);
        if (!venc) moraCruda += mora;
        detalle.push({ cuota: cuotaDiaria, prog: programada, mora, pagHoy: pagadoHoy, frec: frecuencia, venc });
        return {
          cuota: aPedir < 0.5 ? 0 : aPedir,
          cuotaProgramada: programada,
          pagadoHoy,
          plazoVencido: venc,
          alDia: programada <= 0.5 && mora <= 0.5 && cuotaDiaria > 0 && totalDias > 0 && !venc,
        };
      });
      const clase = clasificarClienteRuta(creditos, esNoPago);
      arq.recaudado += clase.pagadoHoyTotal;
      if (clase.soloVencido) arq.vencidosPuros++;
      if (clase.cuentaEnRuta && !clase.alDiaCronograma) {
        arq.esperado += clase.cuotaEnTermino;
        arq.recaudadoRuta += Math.min(clase.pagadoHoyEnTermino, clase.cuotaEnTermino);
        arq.atrasoEsperado += clase.moraEnTermino;
        arq.atrasoRecuperado += Math.min(
          Math.max(0, clase.pagadoHoyEnTermino - clase.cuotaEnTermino),
          clase.moraEnTermino,
        );
        arq.moraCruda += moraCruda;
        arq.clientes += 1;
        if (clase.estadoHoy === "pagado") arq.cobrados++;
        else if (clase.estadoHoy === "abono") arq.abonos++;
        else if (clase.estadoHoy === "no_pago") arq.noPagos++;
        if (clase.cuotaEnTermino <= 0 && clase.moraEnTermino > 0) arq.soloMora++;
        if (clase.cuotaEnTermino > 0 && clase.moraEnTermino > 0) arq.mixtos++;
        casos.push({
          cobrador: nombreCob.get(cobradorId) ?? cobradorId,
          cliente: nombreCli.get(cid) ?? cid,
          clienteId: cid,
          cuotaEnTermino: clase.cuotaEnTermino,
          moraEnTermino: clase.moraEnTermino,
          pagadoHoyEnTermino: clase.pagadoHoyEnTermino,
          pagadoHoyTotal: clase.pagadoHoyTotal,
          estadoHoy: clase.estadoHoy,
          nCred: creditos.length,
          detalle,
          moraCruda,
        });
      } else if (clase.alDiaCronograma) arq.alDiaCron++;
    }
    porCobrador.set(cobradorId, arq);
  }
  return { porCobrador, casos };
}

const M = (n: number) => "$" + Math.round(n).toLocaleString("es-UY");

function reporte(tag: string, hoy: Date, conPagos: boolean) {
  const { porCobrador, casos } = correr(hoy, conPagos);
  const tot = { esperado: 0, atrasoEsperado: 0, recaudado: 0, recaudadoRuta: 0, atrasoRecuperado: 0, cobrados: 0, abonos: 0, noPagos: 0, clientes: 0, moraCruda: 0, soloMora: 0, mixtos: 0, alDiaCron: 0, vencidosPuros: 0 };
  let cobConEsperado0 = 0, cobConEsperado0YMora = 0, cobActivos = 0, cob100 = 0;
  for (const [id, a] of porCobrador) {
    if (a.clientes === 0) continue;
    cobActivos++;
    for (const k of Object.keys(tot) as (keyof typeof tot)[]) tot[k] += (a as never)[k];
    if (a.esperado === 0) {
      cobConEsperado0++;
      if (a.atrasoEsperado > 0) cobConEsperado0YMora++;
    }
    const resueltos = a.cobrados + a.noPagos;
    if (a.esperado > 0 && a.recaudadoRuta >= a.esperado && resueltos < a.clientes) cob100++;
    if (tag === "HOY" && (a.esperado === 0 || a.abonos > 0)) {
      const pct = a.esperado > 0 ? Math.min(100, Math.round((a.recaudadoRuta / a.esperado) * 100)) : 0;
      log(
        `  [${tag}] ${nombreCob.get(id)}: esperado=${M(a.esperado)} recRuta=${M(a.recaudadoRuta)} pct=${pct}% ` +
        `falta=${M(a.esperado - a.recaudadoRuta)} atrasoEsp=${M(a.atrasoEsperado)} moraCruda=${M(a.moraCruda)} ` +
        `cobrados=${a.cobrados}/${a.clientes} abonos=${a.abonos} pend=${Math.max(0, a.clientes - a.cobrados - a.abonos - a.noPagos)}`,
      );
    }
  }
  log(`\n===== ${tag} (${hoy.toDateString()}) =====`);
  log(`cobradores con ruta: ${cobActivos} · clientes en ruta: ${tot.clientes}`);
  log(`esperado=${M(tot.esperado)} recaudadoRuta=${M(tot.recaudadoRuta)} recaudado=${M(tot.recaudado)}`);
  log(`atrasoEsperado=${M(tot.atrasoEsperado)} (mora CRUDA en término=${M(tot.moraCruda)}) atrasoRecuperado=${M(tot.atrasoRecuperado)}`);
  log(`cobrados=${tot.cobrados} abonos=${tot.abonos} noPagos=${tot.noPagos} soloMora=${tot.soloMora} mixtos=${tot.mixtos} alDiaCron=${tot.alDiaCron} vencPuros=${tot.vencidosPuros}`);
  log(`cobradores con esperado=$0 → "Completo ✓" y 0%: ${cobConEsperado0} (de ellos con atraso cobrable>0: ${cobConEsperado0YMora})`);
  log(`cobradores con recaudadoRuta>=esperado ("Completo ✓") pero ruta sin terminar: ${cob100}`);
  return { porCobrador, casos, tot };
}

describe("QA CAMBIO 2 (temporal)", () => {
  it("HOY", () => {
    const hoy = new Date(2026, 7, 7); // viernes 07-08-2026
    const { casos, tot } = reporte("HOY", hoy, true);

    // A) clientes que PAGARON hoy y quedan "abono" aunque cubrieron la cuota del día
    const abonoConMetaCubierta = casos.filter(
      (c) => c.estadoHoy === "abono" && c.cuotaEnTermino > 0 && c.pagadoHoyEnTermino >= c.cuotaEnTermino - 0.5,
    );
    log(`\nA) pagaron >= cuota del día pero salen "Abono" (por la mora): ${abonoConMetaCubierta.length}`);
    for (const c of abonoConMetaCubierta.slice(0, 8))
      log(`   ${c.cliente} (${c.cobrador}) cuotaHoy=${M(c.cuotaEnTermino)} mora=${M(c.moraEnTermino)} pagó=${M(c.pagadoHoyEnTermino)}`);

    // B) IMPUTACIÓN CRUZADA: pagó en un crédito y el otro (el que vence hoy) quedó sin cobrar,
    //    pero recaudadoRuta lo cuenta como cobrado.
    const cruzados = casos.filter((c) => {
      if (c.nCred < 2 || c.pagadoHoyEnTermino <= 0) return false;
      const enTerm = c.detalle.filter((d) => !d.venc);
      const conCuotaHoySinPago = enTerm.filter((d) => d.prog > 0.5 && d.pagHoy <= 0.5);
      const otroConPago = enTerm.filter((d) => d.pagHoy > 0.5);
      if (conCuotaHoySinPago.length === 0 || otroConPago.length === 0) return false;
      const cuotaSinCobrar = conCuotaHoySinPago.reduce((s, d) => s + d.prog, 0);
      const contadoDeMas = Math.min(c.pagadoHoyEnTermino, c.cuotaEnTermino) - (c.cuotaEnTermino - cuotaSinCobrar);
      return contadoDeMas > 0.5;
    });
    log(`\nB) imputación CRUZADA entre créditos del mismo cliente: ${cruzados.length}`);
    for (const c of cruzados.slice(0, 10)) {
      const enTerm = c.detalle.filter((d) => !d.venc);
      const sinCobrar = enTerm.filter((d) => d.prog > 0.5 && d.pagHoy <= 0.5).reduce((s, d) => s + d.prog, 0);
      log(`   ${c.cliente} (${c.cobrador}) cuotaEnTermino=${M(c.cuotaEnTermino)} pagóHoy=${M(c.pagadoHoyEnTermino)} estado=${c.estadoHoy}`);
      for (const d of enTerm) log(`      · ${d.frec} cuota=${M(d.cuota)} prog=${M(d.prog)} mora=${M(d.mora)} pagóHoy=${M(d.pagHoy)}`);
      log(`      → cuota de HOY sin cobrar: ${M(sinCobrar)} y recaudadoRuta la cuenta igual`);
    }

    // C) potencial: clientes con ≥2 créditos donde uno vence hoy y otro tiene mora
    const potencialCruce = casos.filter((c) => {
      const enTerm = c.detalle.filter((d) => !d.venc);
      return enTerm.some((d) => d.prog > 0.5) && enTerm.some((d) => d.mora > 0.5 && d.prog <= 0.5);
    });
    log(`\nC) clientes EXPUESTOS a la imputación cruzada (un crédito vence hoy + otro solo mora): ${potencialCruce.length}`);
    for (const c of potencialCruce.slice(0, 6)) {
      log(`   ${c.cliente} (${c.cobrador}):`);
      for (const d of c.detalle.filter((x) => !x.venc)) log(`      · ${d.frec} cuota=${M(d.cuota)} prog=${M(d.prog)} mora=${M(d.mora)}`);
    }

    // D) mora que el contador nuevo NO ve (tope a una cuota)
    log(`\nD) atrasoEsperado=${M(tot.atrasoEsperado)} vs mora real en término=${M(tot.moraCruda)} → invisible ${M(tot.moraCruda - tot.atrasoEsperado)}`);

    // E) clientes solo-mora: pendientes eternos que no mueven la meta
    const soloMora = casos.filter((c) => c.cuotaEnTermino <= 0 && c.moraEnTermino > 0);
    log(`\nE) clientes SOLO-MORA en la ruta (aportan $0 a la meta, cuentan en el denominador): ${soloMora.length}`);
    log(`   plata cobrable que representan: ${M(soloMora.reduce((s, c) => s + c.moraEnTermino, 0))}`);

    // F) mixtos: nunca "resueltos" si pagan solo la cuota del día
    const mixtos = casos.filter((c) => c.cuotaEnTermino > 0 && c.moraEnTermino > 0);
    log(`\nF) clientes MIXTOS (cuota hoy + mora): ${mixtos.length} — pagando la cuota del día quedan "Abono" y nunca "resueltos"`);
  });

  it("DOMINGO 09-08-2026", () => {
    const dom = new Date(2026, 7, 9);
    const { casos, tot } = reporte("DOM", dom, false);
    const soloMora = casos.filter((c) => c.cuotaEnTermino <= 0 && c.moraEnTermino > 0);
    log(`\nDOMINGO: clientes visibles en ruta = ${tot.clientes}; de ellos solo-mora = ${soloMora.length}`);
    log(`DOMINGO: esperado total = ${M(tot.esperado)} → el hero muestra "Completo ✓ / 0% / de $0" con ${M(tot.atrasoEsperado)} de atraso cobrable (mora real ${M(tot.moraCruda)})`);
  });
});

// ── SIM A: todos pagan EXACTAMENTE la cuota que vence hoy (meta 100% cubierta) ──
describe("SIM A — meta cubierta al 100%", () => {
  it("hero vs lista", () => {
    const hoy = new Date(2026, 7, 7);
    let heroCompleto = 0, cobActivos = 0, totFaltan = 0, totClientes = 0;
    const peores: string[] = [];
    for (const [cobradorId, cliIds] of clientesDeCobrador) {
      let esperado = 0, recaudadoRuta = 0, cobrados = 0, abonos = 0, noPagos = 0, clientes = 0, atrasoEsp = 0;
      for (const cid of cliIds) {
        if (!cliActivo.has(cid)) continue;
        const todos = presPorCliente.get(cid) ?? [];
        const propios = todos.filter((p) => !(p.cobrador_id && p.cobrador_id !== cobradorId));
        const vivos = propios.filter((p) => {
          const tc = totalCredito(Number(p.cuota_diaria), Number(p.total_dias));
          return !(tc > 0 && Number(p.pagado_acum) >= tc - 0.5);
        });
        if (vivos.length === 0) continue;
        // 1ª pasada: objetivo sin pagos
        const base: CreditoRuta[] = vivos.map((p) => {
          const cuotaDiaria = Number(p.cuota_diaria), totalDias = Number(p.total_dias);
          const fechaInicio = p.fecha_inicio as string;
          const frecuencia = (p.frecuencia as FrecuenciaPrestamo) ?? "diario";
          const venc = plazoVencido({ cuota_diaria: cuotaDiaria, total_dias: totalDias, fecha_inicio: fechaInicio, frecuencia }, hoy);
          const { cuotaHoy: prog, mora } = objetivoDelDia(
            { cuota: cuotaDiaria, totalDias, fechaInicio, frecuencia, pagadoAcum: Number(p.pagado_acum) }, hoy);
          const aPedir = Math.min(cuotaDiaria, prog + mora);
          return { cuota: aPedir < 0.5 ? 0 : aPedir, cuotaProgramada: prog, pagadoHoy: prog, plazoVencido: venc,
                   alDia: prog <= 0.5 && mora <= 0.5 && cuotaDiaria > 0 && totalDias > 0 && !venc };
        });
        const clase = clasificarClienteRuta(base, false);
        if (clase.cuentaEnRuta && !clase.alDiaCronograma) {
          esperado += clase.cuotaEnTermino;
          recaudadoRuta += Math.min(clase.pagadoHoyEnTermino, clase.cuotaEnTermino);
          atrasoEsp += clase.moraEnTermino;
          clientes++;
          if (clase.estadoHoy === "pagado") cobrados++;
          else if (clase.estadoHoy === "abono") abonos++;
          else if (clase.estadoHoy === "no_pago") noPagos++;
        }
      }
      if (clientes === 0) continue;
      cobActivos++;
      const resueltos = cobrados + noPagos;
      const faltan = Math.max(0, clientes - resueltos);
      const pct = esperado > 0 ? Math.min(100, Math.round((recaudadoRuta / esperado) * 100)) : 0;
      const avance = Math.round((resueltos / clientes) * 100);
      totFaltan += faltan; totClientes += clientes;
      if (esperado - recaudadoRuta <= 0) heroCompleto++;
      if (faltan > 0)
        peores.push(`   ${nombreCob.get(cobradorId)}: HERO "${esperado - recaudadoRuta <= 0 ? "Completo ✓" : "Falta " + M(esperado - recaudadoRuta)}" ${pct}% de ${M(esperado)} | LISTA "Te faltan ${faltan} de ${clientes} · ${avance}%" | atraso sin cobrar ${M(atrasoEsp)} | abonos=${abonos}`);
    }
    log(`\n===== SIM A: todos pagan exacto la cuota que vence hoy =====`);
    log(`cobradores con hero "Completo ✓": ${heroCompleto}/${cobActivos}`);
    log(`clientes que igual quedan SIN resolver: ${totFaltan} de ${totClientes}`);
    peores.sort().forEach((l) => log(l));
  });
});

// ── Créditos que SE SALDAN hoy: desaparecen de la ruta ──
describe("saldados hoy", () => {
  it("mide", () => {
    const hoy = new Date(2026, 7, 7);
    let n = 0, plata = 0, metaPerdida = 0;
    const ej: string[] = [];
    for (const p of dump.pres) {
      const pagadoHoy = pagosHoy.get(p.id as string) ?? 0;
      if (pagadoHoy <= 0) continue;
      const cuotaDiaria = Number(p.cuota_diaria), totalDias = Number(p.total_dias);
      const tc = totalCredito(cuotaDiaria, totalDias);
      if (!(tc > 0 && Number(p.pagado_acum) >= tc - 0.5)) continue;
      const frecuencia = (p.frecuencia as FrecuenciaPrestamo) ?? "diario";
      const { cuotaHoy: prog, mora } = objetivoDelDia(
        { cuota: cuotaDiaria, totalDias, fechaInicio: p.fecha_inicio as string, frecuencia, pagadoAcum: Number(p.pagado_acum) - pagadoHoy }, hoy);
      n++; plata += pagadoHoy; metaPerdida += prog;
      if (ej.length < 8) ej.push(`   ${nombreCli.get(p.cliente_id as string)}: pagó hoy ${M(pagadoHoy)}, cuota que vencía hoy ${M(prog)} (mora ${M(mora)}) → crédito y cliente salen de la ruta`);
    }
    log(`\n===== SALDADOS HOY (crédito sale de la ruta apenas se cobra) =====`);
    log(`créditos: ${n} · plata cobrada hoy que la ruta ya no ve: ${M(plata)} · meta del día que se evapora: ${M(metaPerdida)}`);
    ej.forEach((l) => log(l));
  });
});

describe("extras", () => {
  it("mide", () => {
    const hoy = new Date(2026, 7, 7);
    let expCruce = 0, expCruceMonto = 0, mixVenc = 0, mixVencConPago = 0, mixVencPlata = 0;
    const ej: string[] = [];
    const ej2: string[] = [];
    for (const [cobradorId, cliIds] of clientesDeCobrador) {
      for (const cid of cliIds) {
        if (!cliActivo.has(cid)) continue;
        const todos = presPorCliente.get(cid) ?? [];
        const propios = todos.filter((p) => !(p.cobrador_id && p.cobrador_id !== cobradorId));
        const vivos = propios.filter((p) => {
          const tc = totalCredito(Number(p.cuota_diaria), Number(p.total_dias));
          return !(tc > 0 && Number(p.pagado_acum) >= tc - 0.5);
        });
        if (vivos.length === 0) continue;
        const det = vivos.map((p) => {
          const cuotaDiaria = Number(p.cuota_diaria), totalDias = Number(p.total_dias);
          const fechaInicio = p.fecha_inicio as string;
          const frecuencia = (p.frecuencia as FrecuenciaPrestamo) ?? "diario";
          const pagadoHoy = pagosHoy.get(p.id as string) ?? 0;
          const venc = plazoVencido({ cuota_diaria: cuotaDiaria, total_dias: totalDias, fecha_inicio: fechaInicio, frecuencia }, hoy);
          const { cuotaHoy: prog, mora } = objetivoDelDia(
            { cuota: cuotaDiaria, totalDias, fechaInicio, frecuencia, pagadoAcum: Number(p.pagado_acum) - pagadoHoy }, hoy);
          return { prog, mora, venc, pagadoHoy, cuotaDiaria, frecuencia };
        });
        const enT = det.filter((d) => !d.venc);
        const vencidos = det.filter((d) => d.venc);
        if (enT.some((d) => d.prog > 0.5) && enT.some((d) => d.mora > 0.5 && d.prog <= 0.5)) {
          expCruce++;
          const m = enT.filter((d) => d.prog > 0.5).reduce((s, d) => s + d.prog, 0);
          expCruceMonto += m;
          if (ej.length < 5) ej.push(`   ${nombreCli.get(cid)} (${nombreCob.get(cobradorId)}): meta del día en riesgo ${M(m)}`);
        }
        if (enT.length > 0 && vencidos.length > 0) {
          mixVenc++;
          const p = vencidos.reduce((s, d) => s + d.pagadoHoy, 0);
          if (p > 0) { mixVencConPago++; mixVencPlata += p;
            if (ej2.length < 6) ej2.push(`   ${nombreCli.get(cid)} (${nombreCob.get(cobradorId)}): recuperó ${M(p)} de un crédito VENCIDO hoy → tarjeta no lo muestra (recuperadoHoy=0), estado sigue pendiente`); }
        }
      }
    }
    log(`\n===== EXTRAS =====`);
    log(`clientes expuestos a imputación CRUZADA: ${expCruce} · meta del día que se puede dar por cobrada sin cobrarla: ${M(expCruceMonto)}`);
    ej.forEach((l) => log(l));
    log(`clientes con crédito VENCIDO + crédito EN TÉRMINO (mismo cobrador): ${mixVenc}; con recuperación hoy: ${mixVencConPago} (${M(mixVencPlata)})`);
    ej2.forEach((l) => log(l));
  });
});
