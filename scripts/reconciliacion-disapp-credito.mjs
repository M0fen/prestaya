// ─────────────────────────────────────────────────────────────────────────
//  RECONCILIACIÓN CRÉDITO-POR-CRÉDITO vs Disapp (export xlsx). Enlaza por el ID
//  de crédito de Disapp (nuestro prestamos.disapp_credit_id ↔ "ID Crédito") y
//  cuantifica, crédito por crédito: pagos, total, capital, saldo. Read-only.
//  Produce la lista EXACTA de qué difiere y por cuánto → para corregir con datos.
//    node --env-file=.env.local scripts/reconciliacion-disapp-credito.mjs [archivo.xlsx]
// ─────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import * as XLSXns from "xlsx";
import { createClient } from "@supabase/supabase-js";

const XLSX = XLSXns.read ? XLSXns : XLSXns.default;
const archivo = process.argv[2] || "creditos_2026-07-22_02-55.xlsx";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const fmt = (n) => "$" + Math.round(n).toLocaleString("es-UY");
// Disapp usa formato es: "1.144.722,52" → 1144722.52.
const num = (s) => {
  if (s == null) return 0;
  if (typeof s === "number") return s;
  return parseFloat(String(s).replace(/\./g, "").replace(",", ".")) || 0;
};

// ── 1) Cargar el export de Disapp (créditos activos) ────────────────────────
const wb = XLSX.read(readFileSync(archivo));
const filas = XLSX.utils.sheet_to_json(wb.Sheets["Créditos"] ?? wb.Sheets[wb.SheetNames[0]], { defval: null });
const disappActivos = new Map(); // idCredito(str) → {principal,total,pagos,saldo,estado,cliente}
let disappTotalFilas = 0, disappActCount = 0;
for (const r of filas) {
  disappTotalFilas++;
  const estado = String(r["Estado"] ?? "").trim();
  const id = String(r["ID Crédito"] ?? "").trim();
  if (!id) continue;
  const vend = String(r["Vendedor"] ?? "");
  const rec = {
    principal: num(r["Valor Crédito"]),
    total: num(r["Total c/ Intereses"]),
    pagos: num(r["Pagos"]),
    saldo: num(r["Saldo Pendiente"]),
    estado,
    cliente: r["Cliente"],
    modalidad: r["Modalidad"],
    // El vendedor trae la zona: "JHON ALBERT , SALTO" → zona = lo de después de la coma.
    zona: (vend.split(",").pop() || "").trim().toUpperCase() || "?",
  };
  if (/activo/i.test(estado)) { disappActivos.set(id, rec); disappActCount++; }
}
console.log(`Disapp: ${disappTotalFilas} filas · ${disappActCount} activos`);

// ── 2) Cargar nuestros préstamos activos ────────────────────────────────────
const nuestros = new Map(); // disapp_credit_id → {pagado,total,principal,id,estado}
let nuestrosAct = 0, sinLink = 0;
{
  let d = 0;
  for (;;) {
    const { data, error } = await db.from("prestamos")
      .select("id, disapp_credit_id, monto_prestado, cuota_diaria, total_dias, pagado_acum, estado")
      .eq("estado", "activo").order("id").range(d, d + 999);
    if (error) throw error;
    for (const p of data ?? []) {
      nuestrosAct++;
      const k = p.disapp_credit_id ? String(p.disapp_credit_id).trim() : null;
      if (!k) { sinLink++; continue; }
      nuestros.set(k, {
        id: p.id, pagado: Math.round(Number(p.pagado_acum) || 0),
        total: Math.round(Number(p.cuota_diaria) * Number(p.total_dias || 0)),
        principal: Math.round(Number(p.monto_prestado) || 0),
      });
    }
    if (!data || data.length < 1000) break;
    d += 1000;
  }
}
console.log(`Nuestros: ${nuestrosAct} activos (${sinLink} sin link a Disapp = app-nativos)\n`);

// ── 3) Cruzar ───────────────────────────────────────────────────────────────
const soloDisapp = [], soloNuestros = [], enAmbos = [];
for (const [id, d] of disappActivos) {
  const n = nuestros.get(id);
  if (!n) soloDisapp.push({ id, ...d });
  else enAmbos.push({ id, disapp: d, nuestro: n });
}
for (const [id, n] of nuestros) if (!disappActivos.has(id)) soloNuestros.push({ id, ...n });

// Solo en Disapp activo (nos faltan / finalizados en los nuestros).
const capSoloDisapp = soloDisapp.reduce((s, c) => s + c.principal, 0);
const pagosSoloDisapp = soloDisapp.reduce((s, c) => s + c.pagos, 0);
console.log("═══ A) Activos en DISAPP pero NO activos en los nuestros ═══");
console.log(`  ${soloDisapp.length} créditos · capital ${fmt(capSoloDisapp)} · pagos Disapp ${fmt(pagosSoloDisapp)}`);
console.log(`  (créditos nuevos sin importar, o finalizados/otro estado en los nuestros)`);

console.log("\n═══ B) Activos en los NUESTROS pero NO activos en Disapp ═══");
console.log(`  ${soloNuestros.length} créditos · capital ${fmt(soloNuestros.reduce((s, c) => s + c.principal, 0))}`);
console.log(`  (finalizados/refinanciados en Disapp pero seguimos mostrándolos activos → posible sobre-cobro futuro)`);

// En ambos: diferencia de PAGOS (el corazón del gap de recaudo).
let difPagosTot = 0, difLista = [];
for (const e of enAmbos) {
  const dif = e.nuestro.pagado - e.disapp.pagos; // + = cobramos/atribuimos MÁS que Disapp
  difPagosTot += dif;
  if (Math.abs(dif) >= 1) difLista.push({ id: e.id, dif, nuestro: e.nuestro.pagado, disapp: e.disapp.pagos, cli: e.disapp.cliente });
}
difLista.sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif));
const masNuestro = difLista.filter((x) => x.dif > 0);
const masDisapp = difLista.filter((x) => x.dif < 0);
console.log("\n═══ C) En AMBOS: diferencia de PAGOS por crédito ═══");
console.log(`  ${enAmbos.length} matcheados · ${difLista.length} con diferencia`);
console.log(`  Cobramos/atribuimos MÁS que Disapp: ${masNuestro.length} créditos, ${fmt(masNuestro.reduce((s, x) => s + x.dif, 0))}`);
console.log(`  Cobramos/atribuimos MENOS que Disapp: ${masDisapp.length} créditos, ${fmt(masDisapp.reduce((s, x) => s + x.dif, 0))}`);
console.log(`  NETO (nuestro − Disapp): ${fmt(difPagosTot)}`);
console.log("\n  Top 15 diferencias (nuestro vs Disapp):");
for (const x of difLista.slice(0, 15))
  console.log(`   · ${x.id.padEnd(9)} ${String(x.cli ?? "").slice(0, 22).padEnd(22)} nuestro ${fmt(x.nuestro).padStart(12)} vs Disapp ${fmt(x.disapp).padStart(12)} → ${x.dif > 0 ? "+" : ""}${fmt(x.dif)}`);

// Corte por ZONA de las diferencias de pago (¿afecta al piloto = Zona Centro?).
const porZona = new Map();
for (const e of enAmbos) {
  const dif = e.nuestro.pagado - e.disapp.pagos;
  if (Math.abs(dif) < 1) continue;
  const z = porZona.get(e.disapp.zona) ?? { n: 0, dif: 0 };
  z.n++; z.dif += dif; porZona.set(e.disapp.zona, z);
}
console.log("\n═══ D) Diferencias de pago por ZONA (¿afecta al piloto?) ═══");
for (const [z, v] of [...porZona.entries()].sort((a, b) => Math.abs(b[1].dif) - Math.abs(a[1].dif)))
  console.log(`  ${z.padEnd(14)} ${String(v.n).padStart(4)} créditos · neto ${fmt(v.dif)}`);
// También: créditos "solo en Disapp" y "solo nuestros" por zona.
const soloDisappZona = new Map(), soloNuestrosZonaN = soloNuestros.length;
for (const c of soloDisapp) soloDisappZona.set(c.zona, (soloDisappZona.get(c.zona) ?? 0) + 1);
console.log("  — 'solo en Disapp' (nos faltan) por zona:");
for (const [z, n] of [...soloDisappZona.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8))
  console.log(`      ${z.padEnd(14)} ${n}`);

console.log("\n═══ RESUMEN DEL GAP DE RECAUDO ═══");
console.log(`  Gap total sobre activos ≈ (A pagos que se van) + (C neto) = ${fmt(-pagosSoloDisapp)} + ${fmt(difPagosTot)}`);
console.log(`  → Diferencias concretas por crédito arriba. Corregir con cuidado (money): revisar refis antes de tocar.`);
