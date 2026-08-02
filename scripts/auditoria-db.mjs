// ─────────────────────────────────────────────────────────────────────────
//  AUDITORÍA READ-ONLY de la base VIVA (08-02). NO escribe NADA.
//  Corre: node --env-file=.env.local _audit_db.mjs
//  Secciones: salud, invariantes RPC, anomalías por tabla, coherencia cruzada
//  (rendiciones vs libro, aperturas, leads, comisiones, compras), y prueba
//  EMPÍRICA de RLS con la clave anónima (sin sesión → 0 filas esperadas).
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !svcKey) { console.error("Faltan env vars"); process.exit(1); }
const db = createClient(url, svcKey, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = anonKey ? createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

const N = (v) => Math.round(Number(v) || 0);
const hoyUY = () => { const d = new Date(Date.now() - 3 * 3600e3); return d.toISOString().slice(0, 10); };
const diaUY = (ts) => new Date(new Date(ts).getTime() - 3 * 3600e3).toISOString().slice(0, 10);
const diasAtras = (n) => { const d = new Date(Date.now() - 3 * 3600e3 - n * 86400e3); return d.toISOString().slice(0, 10); };

async function traerTodo(build, maxPag = 40) {
  const out = [];
  for (let i = 0; i < maxPag; i++) {
    const { data, error } = await build(i * 1000, i * 1000 + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return { rows: out, truncado: false };
  }
  return { rows: out, truncado: true };
}
async function cnt(tabla, mods) {
  let q = db.from(tabla).select("*", { count: "exact", head: true });
  if (mods) q = mods(q);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}
const sec = (t) => console.log(`\n═══ ${t} ═══`);
const ok = (m) => console.log(`  ✓ ${m}`);
const warn = (m) => console.log(`  ⚠ ${m}`);
const bad = (m) => console.log(`  ✗ ${m}`);

// ── A. Salud general ────────────────────────────────────────────────────────
try {
  sec("A. SALUD GENERAL");
  const [cliAct, prAct, prFin, prTotal] = await Promise.all([
    cnt("clientes", (q) => q.eq("activo", true)),
    cnt("prestamos", (q) => q.eq("estado", "activo")),
    cnt("prestamos", (q) => q.eq("estado", "finalizado")),
    cnt("prestamos"),
  ]);
  console.log(`  clientes activos=${cliAct} · prestamos activo=${prAct} finalizado=${prFin} total=${prTotal} (otros=${prTotal - prAct - prFin})`);
  const { rows: usrs } = await traerTodo((d, h) => db.from("usuarios").select("rol, activo, zona_id").range(d, h), 5);
  const act = usrs.filter((u) => u.activo);
  const porRol = {};
  for (const u of act) porRol[u.rol] = (porRol[u.rol] ?? 0) + 1;
  const sinZona = act.filter((u) => u.rol === "cobrador" && !u.zona_id).length;
  console.log(`  usuarios activos: ${JSON.stringify(porRol)} · cobradores SIN zona=${sinZona}`);
  const { data: ff } = await db.from("feature_flags").select("clave, activo").eq("clave", "modo_solo_lectura").maybeSingle();
  console.log(`  kill-switch modo_solo_lectura: ${ff ? (ff.activo ? "🔴 ACTIVO" : "apagado (normal)") : "sin flag"}`);
} catch (e) { bad(`Salud: ${e.message}`); }

// ── B. Invariantes de saldo (RPC 0071) ─────────────────────────────────────
try {
  sec("B. INVARIANTES DE SALDO (pagado_acum vs Σpagos, sobre-cobro)");
  const { data, error } = await db.rpc("app_reconciliacion_violaciones");
  if (error) throw error;
  const v = data ?? [];
  const drift = v.filter((r) => Math.abs(N(r.pagado_acum) - N(r.pagos_suma)) >= 1);
  const sobre = v.filter((r) => N(r.pagos_suma) - N(r.total_a_pagar) >= 1);
  const sobreActMat = sobre.filter((r) => {
    const ex = N(r.pagos_suma) - N(r.total_a_pagar);
    return r.estado === "activo" && ((N(r.cuota_diaria) > 0 && ex >= N(r.cuota_diaria)) || (N(r.total_a_pagar) > 0 && ex >= N(r.total_a_pagar) * 0.05));
  });
  if (drift.length === 0) ok("DRIFT pagado_acum vs Σpagos: 0 créditos (el denormalizado NO miente)");
  else bad(`DRIFT en ${drift.length} créditos: ${drift.slice(0, 5).map((r) => r.id).join(", ")}`);
  console.log(`  sobre-cobros totales=${sobre.length} · MATERIALES en activos=${sobreActMat.length}`);
  if (sobreActMat.length > 0) bad(`materiales activos: ${sobreActMat.slice(0, 5).map((r) => `${r.id} exceso=${N(r.pagos_suma) - N(r.total_a_pagar)}`).join(" · ")}`);
} catch (e) { bad(`RPC reconciliación: ${e.message}`); }

// ── C. Anomalías en pagos ──────────────────────────────────────────────────
try {
  sec("C. PAGOS — anomalías");
  const [montoCero, anulSin, anulSinMotivo] = await Promise.all([
    cnt("pagos", (q) => q.lte("monto", 0)),
    cnt("pagos", (q) => q.eq("anulado", true).is("anulado_por", null)),
    cnt("pagos", (q) => q.eq("anulado", true).is("motivo_anulacion", null)),
  ]);
  (montoCero === 0 ? ok : bad)(`pagos con monto<=0: ${montoCero}`);
  (anulSin === 0 ? ok : warn)(`anulados SIN anulado_por: ${anulSin}`);
  (anulSinMotivo === 0 ? ok : warn)(`anulados SIN motivo: ${anulSinMotivo}`);
  const anulados = await cnt("pagos", (q) => q.eq("anulado", true));
  console.log(`  total anulados (histórico): ${anulados}`);
} catch (e) { bad(`pagos: ${e.message}`); }

// ── D. Anomalías en prestamos ──────────────────────────────────────────────
try {
  sec("D. PRESTAMOS — anomalías");
  const [cuotaMala, diasMalos, futuros] = await Promise.all([
    cnt("prestamos", (q) => q.eq("estado", "activo").lte("cuota_diaria", 0)),
    cnt("prestamos", (q) => q.eq("estado", "activo").lte("total_dias", 0)),
    cnt("prestamos", (q) => q.eq("estado", "activo").gt("fecha_inicio", hoyUY())),
  ]);
  (cuotaMala === 0 ? ok : bad)(`activos con cuota_diaria<=0: ${cuotaMala}`);
  (diasMalos === 0 ? ok : bad)(`activos con total_dias<=0: ${diasMalos}`);
  (futuros === 0 ? ok : warn)(`activos con fecha_inicio futura: ${futuros}`);
  const finSinFecha = await cnt("prestamos", (q) => q.eq("estado", "finalizado").is("finalizado_en", null));
  (finSinFecha === 0 ? ok : warn)(`finalizados SIN finalizado_en: ${finSinFecha}`);
} catch (e) { bad(`prestamos: ${e.message}`); }

// ── E. Asignaciones — coherencia con la ruta y el dueño de comisión ────────
try {
  sec("E. ASIGNACIONES — coherencia");
  const { rows: asg, truncado: t1 } = await traerTodo((d, h) => db.from("asignaciones").select("cliente_id, cobrador_id").eq("activo", true).order("cliente_id").range(d, h), 30);
  const porCliente = new Map();
  for (const a of asg) porCliente.set(a.cliente_id, [...(porCliente.get(a.cliente_id) ?? []), a.cobrador_id]);
  const multi = [...porCliente.entries()].filter(([, v]) => v.length > 1);
  (multi.length === 0 ? ok : warn)(`clientes con >1 asignación ACTIVA: ${multi.length}${t1 ? " (truncado)" : ""}`);
  const { rows: prs, truncado: t2 } = await traerTodo((d, h) => db.from("prestamos").select("id, cliente_id, cobrador_id").eq("estado", "activo").order("id").range(d, h), 30);
  let stale = 0, sinAsg = 0;
  for (const p of prs) {
    const cobs = porCliente.get(p.cliente_id);
    if (!cobs || cobs.length === 0) { sinAsg++; continue; }
    if (p.cobrador_id && !cobs.includes(p.cobrador_id)) stale++;
  }
  console.log(`  prestamos activos=${prs.length}${t2 ? " (truncado)" : ""} · SIN asignación activa=${sinAsg} · cobrador_id STALE (≠ asignación)=${stale}`);
  if (sinAsg > 0) warn(`${sinAsg} créditos activos no están en la ruta de NADIE (nadie los cobra)`);
  if (stale > 0) warn(`${stale} créditos con dueño de comisión distinto al de la ruta`);
} catch (e) { bad(`asignaciones: ${e.message}`); }

// ── F. Compras del equipo — saldo == total − Σdescuentos ───────────────────
try {
  sec("F. COMPRAS DEL EQUIPO — coherencia de saldo");
  const { rows: compras } = await traerTodo((d, h) => db.from("compras_empleado").select("id, total, saldo, estado").order("id").range(d, h), 3);
  const { rows: descs } = await traerTodo((d, h) => db.from("descuentos_compra_empleado").select("compra_id, monto").order("id").range(d, h), 3);
  const descPor = new Map();
  for (const dd of descs) descPor.set(dd.compra_id, (descPor.get(dd.compra_id) ?? 0) + N(dd.monto));
  let malSaldo = 0, malEstado = 0;
  for (const c of compras) {
    const esperado = N(c.total) - (descPor.get(c.id) ?? 0);
    if (c.estado !== "cancelada" && Math.abs(N(c.saldo) - esperado) >= 1) { malSaldo++; warn(`compra ${c.id}: saldo=${N(c.saldo)} esperado=${esperado} (${c.estado})`); }
    if (c.estado === "saldada" && N(c.saldo) !== 0) { malEstado++; warn(`compra ${c.id}: saldada con saldo=${N(c.saldo)}`); }
  }
  console.log(`  compras=${compras.length} · descuentos=${descs.length} · saldo incoherente=${malSaldo} · estado incoherente=${malEstado}`);
  if (compras.length === 0) ok("sin compras aún (tabla vacía, nada que validar)");
} catch (e) { warn(`compras equipo: ${e.message} (¿0113 sin datos?)`); }

// ── G. Comisiones liquidadas — solapamientos ───────────────────────────────
try {
  sec("G. COMISIONES LIQUIDADAS — solapamientos por cobrador");
  const { rows: liq } = await traerTodo((d, h) => db.from("comisiones_liquidadas").select("cobrador_id, periodo_key, periodo_rango, monto").order("id").range(d, h), 3);
  const parse = (pg) => { const m = /^\[(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})\)$/.exec(pg ?? ""); return m ? { lo: m[1], hi: m[2] } : null; };
  const porCob = new Map();
  for (const l of liq) porCob.set(l.cobrador_id, [...(porCob.get(l.cobrador_id) ?? []), l]);
  let solapes = 0;
  for (const [cob, ls] of porCob) {
    for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
      const a = parse(ls[i].periodo_rango), b = parse(ls[j].periodo_rango);
      if (a && b && a.lo < b.hi && b.lo < a.hi) { solapes++; bad(`SOLAPE cobrador=${cob}: ${ls[i].periodo_key} ∩ ${ls[j].periodo_key}`); }
    }
  }
  (solapes === 0 ? ok : bad)(`liquidaciones=${liq.length} · solapamientos de rango=${solapes} (doble-comisión si >0)`);
} catch (e) { warn(`comisiones: ${e.message}`); }

// ── H. Rendiciones (7 días) vs libro de pagos por cobrador/día ─────────────
try {
  sec("H. RENDICIONES vs LIBRO (últimos 7 días)");
  const desde = diasAtras(7);
  const { data: rends, error: eR } = await db.from("rendiciones").select("cobrador_id, fecha, recaudado, gastos, entregado, diferencia, base").gte("fecha", desde).order("fecha");
  if (eR) throw eR;
  const { rows: pgs, truncado } = await traerTodo((d, h) => db.from("pagos").select("monto, registrado_por, registrado_en").eq("anulado", false).gte("registrado_en", `${desde}T03:00:00Z`).order("id").range(d, h), 40);
  const libro = new Map(); // `${cob}|${dia}` → Σ
  for (const p of pgs) { if (!p.registrado_por) continue; const k = `${p.registrado_por}|${diaUY(p.registrado_en)}`; libro.set(k, (libro.get(k) ?? 0) + N(p.monto)); }
  let cuadra = 0, difiere = 0;
  const hoy = hoyUY();
  for (const r of rends ?? []) {
    const k = `${r.cobrador_id}|${r.fecha}`;
    const lib = libro.get(k) ?? 0;
    if (Math.abs(lib - N(r.recaudado)) < 1) cuadra++;
    else { difiere++; warn(`(${r.fecha}) cobrador=${String(r.cobrador_id).slice(0, 8)}… rendición=${N(r.recaudado)} vs libro=${lib} (Δ=${lib - N(r.recaudado)} → cobro post-rendición o anulación posterior)`); }
    libro.delete(k);
  }
  // días con recaudo en el libro SIN rendición (cobrador no rindió)
  const sinRendicion = [...libro.entries()].filter(([k, v]) => v > 0 && !k.endsWith(`|${hoy}`));
  console.log(`  rendiciones=${(rends ?? []).length} · cuadran=${cuadra} · difieren=${difiere}${truncado ? " (pagos truncados)" : ""}`);
  (sinRendicion.length === 0 ? ok : bad)(`días-cobrador con recaudo y SIN rendición (excl. hoy): ${sinRendicion.length}`);
  for (const [k, v] of sinRendicion.slice(0, 10)) bad(`  SIN RENDIR: ${k.split("|")[1]} cobrador=${k.split("|")[0].slice(0, 8)}… recaudó $${v.toLocaleString("es-UY")}`);
} catch (e) { bad(`rendiciones: ${e.message}`); }

// ── I. Aperturas vs base congelada (14 días) — INV6 en vivo ────────────────
try {
  sec("I. BASE DE CAJA (aperturas vs rendiciones, 14 días)");
  const desde = diasAtras(14);
  const [{ data: aps }, { data: rds }] = await Promise.all([
    db.from("aperturas_caja").select("cobrador_id, fecha, base").gte("fecha", desde),
    db.from("rendiciones").select("cobrador_id, fecha, base").gte("fecha", desde),
  ]);
  const rMap = new Map((rds ?? []).map((r) => [`${r.cobrador_id}|${r.fecha}`, N(r.base)]));
  let inc = 0;
  for (const a of aps ?? []) {
    const k = `${a.cobrador_id}|${a.fecha}`;
    if (rMap.has(k) && Math.abs(N(a.base) - rMap.get(k)) >= 1) { inc++; warn(`base editada: ${k} apertura=${N(a.base)} rendición=${rMap.get(k)}`); }
  }
  (inc === 0 ? ok : bad)(`aperturas=${(aps ?? []).length} · bases apertura≠rendición: ${inc}`);
} catch (e) { warn(`base caja: ${e.message}`); }

// ── J. Leads de tienda convertidos — INV7 en vivo ──────────────────────────
try {
  sec("J. TIENDA — leads 'convertida' → crédito válido");
  const { data: leads } = await db.from("solicitudes_producto").select("id, prestamo_id").eq("estado", "convertida");
  const ls = leads ?? [];
  if (ls.length === 0) ok("sin leads convertidos aún");
  else {
    const ids = [...new Set(ls.map((l) => l.prestamo_id).filter(Boolean))];
    const { data: prs } = ids.length ? await db.from("prestamos").select("id, origen").in("id", ids) : { data: [] };
    const orig = new Map((prs ?? []).map((p) => [p.id, p.origen]));
    const rotos = ls.filter((l) => !l.prestamo_id || !orig.has(l.prestamo_id) || orig.get(l.prestamo_id) !== "tienda");
    (rotos.length === 0 ? ok : bad)(`convertidas=${ls.length} · ROTAS=${rotos.length}`);
  }
} catch (e) { warn(`leads: ${e.message}`); }

// ── K. Cierres de zona (14 días) ───────────────────────────────────────────
try {
  sec("K. CIERRES DE ZONA (14 días)");
  const { data: cz } = await db.from("cierres_zona").select("zona_id, fecha, total_esperado, total_entregado, diferencia, cobradores_pendientes").gte("fecha", diasAtras(14)).order("fecha");
  const cs = cz ?? [];
  const conPend = cs.filter((c) => N(c.cobradores_pendientes) > 0);
  const conDif = cs.filter((c) => N(c.diferencia) !== 0);
  console.log(`  cierres=${cs.length} · sellados con pendientes (histórico, ya bloqueado)=${conPend.length} · con diferencia≠0=${conDif.length}`);
  for (const c of conDif.slice(0, 6)) warn(`(${c.fecha}) zona=${c.zona_id ? String(c.zona_id).slice(0, 8) : "SIN"} dif=${N(c.diferencia)}`);
} catch (e) { warn(`cierres: ${e.message}`); }

// ── L. Movimientos de caja ─────────────────────────────────────────────────
try {
  sec("L. MOVIMIENTOS DE CAJA");
  const [neg, sinReg] = await Promise.all([
    cnt("movimientos_caja", (q) => q.lte("monto", 0)),
    cnt("movimientos_caja", (q) => q.is("registrado_por", null)),
  ]);
  (neg === 0 ? ok : bad)(`movimientos con monto<=0: ${neg}`);
  console.log(`  sin registrado_por (legacy): ${sinReg}`);
} catch (e) { warn(`caja: ${e.message}`); }

// ── M. RLS EMPÍRICA — clave ANÓNIMA sin sesión debe ver CERO ───────────────
if (anon) {
  sec("M. RLS EMPÍRICA (anon sin sesión → se espera 0 filas en TODO)");
  const tablas = ["pagos","prestamos","clientes","usuarios","movimientos_caja","rendiciones","aperturas_caja","cierres_zona","comisiones_liquidadas","compras_empleado","descuentos_compra_empleado","solicitudes_gasto","solicitudes_anulacion","solicitudes_renovacion","solicitudes_producto","discrepancias_dinero","recibos","auditoria","feature_flags","zonas","asignaciones","reconciliacion_log","leads_publicos","productos","eventos_uso","aperturas"];
  let fugas = 0;
  for (const t of tablas) {
    try {
      const { data, error } = await anon.from(t).select("*").limit(1);
      if (error) { ok(`${t}: bloqueada (${error.code ?? "err"})`); continue; }
      if ((data ?? []).length > 0) { fugas++; bad(`${t}: 🔓 FUGA — anon LEE filas!`); }
      else ok(`${t}: 0 filas`);
    } catch { ok(`${t}: bloqueada`); }
  }
  console.log(fugas === 0 ? "  ✅ RLS: ninguna tabla legible por anónimo" : `  🔴 ${fugas} tablas con fuga anónima`);
}

// ── N. Clientes — documentos duplicados ────────────────────────────────────
try {
  sec("N. CLIENTES — documentos duplicados (activos)");
  const { rows: cls, truncado } = await traerTodo((d, h) => db.from("clientes").select("id, documento").eq("activo", true).order("id").range(d, h), 20);
  const por = new Map();
  for (const c of cls) { const doc = (c.documento ?? "").replace(/\D/g, ""); if (doc.length >= 6) por.set(doc, (por.get(doc) ?? 0) + 1); }
  const dups = [...por.values()].filter((v) => v > 1).length;
  console.log(`  clientes activos leídos=${cls.length}${truncado ? " (truncado)" : ""} · documentos repetidos=${dups}`);
} catch (e) { warn(`clientes: ${e.message}`); }

console.log("\n═══ FIN AUDITORÍA DB (read-only, nada modificado) ═══");
