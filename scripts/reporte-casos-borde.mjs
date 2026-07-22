// ─────────────────────────────────────────────────────────────────────────
//  INFORME de casos borde de Zona Centro (créditos refinanciados en nuestro
//  sistema que Disapp sigue mostrando activos). Genera un HTML presentable para
//  que Mauricio investigue qué pasó con cada cliente. Read-only. Con datos
//  personales → NO se commitea (archivo local).
//    node --env-file=.env.local scripts/reporte-casos-borde.mjs
// ─────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from "node:fs";
import * as XLSXns from "xlsx";
import { createClient } from "@supabase/supabase-js";
const XLSX = XLSXns.read ? XLSXns : XLSXns.default;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ZONA = "764c2556-4e2d-410a-b39a-63c6dbf984c3";
const num = (s) => (s == null ? 0 : typeof s === "number" ? s : parseFloat(String(s).replace(/\./g, "").replace(",", ".")) || 0);
const $ = (n) => "$" + Math.round(n).toLocaleString("es-UY");
const iso = (f) => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(f ?? "")); return m ? `${m[3]}-${m[2]}-${m[1]}` : String(f ?? ""); };
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const { data: cobs } = await db.from("usuarios").select("id, nombre, disapp_vendedor_id").eq("rol", "cobrador").eq("zona_id", ZONA).eq("activo", true);
const vend = new Set(cobs.map((c) => String(c.disapp_vendedor_id)));
const cobNom = new Map(cobs.map((c) => [c.id, c.nombre]));
const cobIds = cobs.map((c) => c.id);

// Disapp: por crédito y por cliente.
const rows = XLSX.utils.sheet_to_json(XLSX.read(readFileSync("creditos_2026-07-22_02-55.xlsx")).Sheets["Créditos"], { defval: null });
const disappCred = new Map(), disappPorCli = new Map(), disappCentro = new Map();
for (const r of rows) {
  const idc = String(r["ID Cliente"] ?? "");
  const rec = { id: String(r["ID Crédito"] ?? ""), estado: String(r["Estado"] ?? ""), fecha: r["Fecha Crédito"], valor: num(r["Valor Crédito"]), total: num(r["Total c/ Intereses"]), pagos: num(r["Pagos"]), saldo: num(r["Saldo Pendiente"]), cuotasPend: r["Cuotas Pend."], cliente: r["Cliente"], vendedor: r["Vendedor"] };
  disappCred.set(rec.id, rec);
  (disappPorCli.get(idc) ?? disappPorCli.set(idc, []).get(idc)).push(rec);
  if (/activo/i.test(rec.estado) && vend.has(String(r["ID Vendedor"] ?? ""))) disappCentro.set(rec.id, idc);
}

// Nuestros.
const nuestros = [];
{ let d = 0; for (;;) { const { data } = await db.from("prestamos").select("id, disapp_credit_id, disapp_credit_ref, estado, cliente_id, cobrador_id, monto_prestado, cuota_diaria, total_dias, pagado_acum, fecha_inicio, refinanciado_en").in("cobrador_id", cobIds).order("id").range(d, d + 999); nuestros.push(...(data ?? [])); if (!data || data.length < 1000) break; d += 1000; } }
const porDisapp = new Map(nuestros.filter((p) => p.disapp_credit_id).map((p) => [String(p.disapp_credit_id), p]));
const activosIds = new Set(nuestros.filter((p) => p.estado === "activo" && p.disapp_credit_id).map((p) => String(p.disapp_credit_id)));
const cliConActivo = new Set(nuestros.filter((p) => p.estado === "activo").map((p) => p.cliente_id));

// Identificar los casos borde.
const casos = [];
for (const [cid, idCli] of disappCentro) {
  if (activosIds.has(cid)) continue;
  const nu = porDisapp.get(cid);
  if (!nu || cliConActivo.has(nu.cliente_id)) continue;
  const dis = disappCred.get(cid);
  const masNuevoActivo = (disappPorCli.get(idCli) ?? []).some((x) => /activo/i.test(x.estado) && x.id !== cid && iso(x.fecha) > iso(dis.fecha));
  casos.push({ cid, idCli, nu, dis, grupo: masNuevoActivo ? 1 : 2 });
}
casos.sort((a, b) => a.grupo - b.grupo || b.dis.saldo - a.dis.saldo);

// Enriquecer con cliente + historial + pagos.
const bloques = [];
for (const c of casos) {
  const { data: cli } = await db.from("clientes").select("nombre, documento, telefono, direccion, disapp_id").eq("id", c.nu.cliente_id).maybeSingle();
  const { data: hist } = await db.from("prestamos").select("disapp_credit_id, disapp_credit_ref, estado, monto_prestado, cuota_diaria, total_dias, pagado_acum, fecha_inicio, refinanciado_en").eq("cliente_id", c.nu.cliente_id).order("fecha_inicio");
  const { data: pagos } = await db.from("pagos").select("monto, registrado_en, disapp_pago_id, anulado").eq("prestamo_id", c.nu.id).eq("anulado", false).order("registrado_en");
  const disCli = (disappPorCli.get(c.idCli) ?? []).sort((a, b) => iso(a.fecha).localeCompare(iso(b.fecha)));
  const totalN = Math.round(c.nu.cuota_diaria * c.nu.total_dias);

  const filasHist = (hist ?? []).map((h) => `<tr class="${h.disapp_credit_id === c.cid ? "hl" : ""}"><td>${esc(h.disapp_credit_id ?? h.disapp_credit_ref ?? "—")}</td><td>${esc(h.estado)}</td><td class="r">${$(h.monto_prestado)}</td><td class="r">${$(h.pagado_acum)} / ${$(Math.round(h.cuota_diaria * h.total_dias))}</td><td>${esc(h.fecha_inicio)}</td><td>${h.refinanciado_en ? esc(h.refinanciado_en.slice(0, 10)) : "—"}</td></tr>`).join("");
  const filasDis = disCli.map((x) => `<tr class="${x.id === c.cid ? "hl" : ""}"><td>${esc(x.id)}</td><td>${esc(x.estado)}</td><td class="r">${$(x.valor)}</td><td class="r">${$(x.pagos)}</td><td class="r">${$(x.saldo)}</td><td>${esc(x.fecha)}</td></tr>`).join("");
  const filasPagos = (pagos ?? []).map((p) => `<tr><td class="r">${$(p.monto)}</td><td>${esc((p.registrado_en ?? "").slice(0, 10))}</td><td>${esc(p.disapp_pago_id ?? "—")}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">Sin pagos registrados</td></tr>`;

  const hip = c.grupo === 1
    ? `Refinanciado en nuestro sistema el <b>${esc((c.nu.refinanciado_en ?? "").slice(0, 10))}</b>. El cliente <b>tiene un crédito más nuevo activo en Disapp</b> (el refi existe en ambos lados). Disapp simplemente aún muestra también el viejo. <b>Acción: ninguna, está correcto.</b>`
    : `Refinanciado en nuestro sistema el <b>${esc((c.nu.refinanciado_en ?? "").slice(0, 10))}</b>, PERO en Disapp <b>este es el único crédito activo del cliente</b> (no hay uno más nuevo). Dos posibilidades: <b>(a)</b> el cliente pagó por otro crédito nuestro (ver historial) y Disapp quedó atrasado → dejar; <b>(b)</b> el marcado del 10/07 fue un error y el cliente <b>sí debe ${$(c.dis.saldo)}</b> → re-activar y cobrar.`;
  const pregunta = c.grupo === 1 ? "" : `<div class="ask"><b>👉 Para Mauricio:</b> ${esc(cli?.nombre)} — ¿tomó un crédito NUEVO alrededor del 10/07/2026, o dejó de pagar este? En Disapp figura activo debiendo <b>${$(c.dis.saldo)}</b>. Si NO refinanció, hay que re-activarlo.</div>`;

  bloques.push(`
  <section class="caso g${c.grupo}">
    <div class="chdr"><span class="badge b${c.grupo}">${c.grupo === 1 ? "GRUPO 1 · correcto" : "GRUPO 2 · REVISAR"}</span>
      <h2>${esc(cli?.nombre ?? "?")}</h2></div>
    <div class="meta">Doc <b>${esc(cli?.documento ?? "—")}</b> · Tel <b>${esc(cli?.telefono ?? "—")}</b> · ${esc(cli?.direccion ?? "sin dirección")} · Cobrador <b>${esc(cobNom.get(c.nu.cobrador_id))}</b> · ID Cliente Disapp <b>${esc(c.idCli)}</b></div>
    <div class="cols">
      <div class="box"><h3>Nuestro sistema — crédito ${esc(c.cid)}</h3>
        <p>Estado: <b>${esc(c.nu.estado)}</b> · Pagado <b>${$(c.nu.pagado_acum)}</b> de <b>${$(totalN)}</b> · Inicio ${esc(c.nu.fecha_inicio)} · Refinanciado ${esc((c.nu.refinanciado_en ?? "—").slice(0, 10))}</p>
        <table><thead><tr><th>Pago</th><th>Fecha</th><th>Origen (disapp_pago_id)</th></tr></thead><tbody>${filasPagos}</tbody></table></div>
      <div class="box dis"><h3>Disapp — crédito ${esc(c.cid)}</h3>
        <p>Estado: <b>Activo</b> · Pagos <b>${$(c.dis.pagos)}</b> · Saldo pendiente <b>${$(c.dis.saldo)}</b> de <b>${$(c.dis.total)}</b> · Fecha ${esc(c.dis.fecha)}</p></div>
    </div>
    <h4>Historial del cliente — NUESTRO sistema (${(hist ?? []).length} créditos)</h4>
    <table><thead><tr><th>Crédito</th><th>Estado</th><th class="r">Monto</th><th class="r">Pagado/Total</th><th>Inicio</th><th>Refi</th></tr></thead><tbody>${filasHist}</tbody></table>
    <h4>Créditos del cliente — DISAPP (${disCli.length})</h4>
    <table><thead><tr><th>Crédito</th><th>Estado</th><th class="r">Valor</th><th class="r">Pagos</th><th class="r">Saldo</th><th>Fecha</th></tr></thead><tbody>${filasDis}</tbody></table>
    <div class="hip"><b>¿Qué pasó?</b> ${hip}</div>${pregunta}
  </section>`);
}

const g1 = casos.filter((c) => c.grupo === 1).length, g2 = casos.filter((c) => c.grupo === 2).length;
const html = `<!doctype html><html lang="es"><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Casos borde Zona Centro — para Mauricio</title>
<style>
 body{font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;color:#0F1B3D;background:#F6F8FD;margin:0;padding:24px;line-height:1.5}
 .wrap{max-width:900px;margin:0 auto}
 h1{font-size:23px;margin:0 0 4px} .sub{color:#6B7494;font-size:14px;margin-bottom:20px}
 .resumen{background:#fff;border:1px solid #E1E8F6;border-radius:14px;padding:16px;margin-bottom:22px;font-size:14px}
 .caso{background:#fff;border:1px solid #E1E8F6;border-radius:16px;padding:18px;margin-bottom:18px}
 .caso.g2{border-left:5px solid #E8A317}.caso.g1{border-left:5px solid #1FA971}
 .chdr{display:flex;align-items:center;gap:12px} .chdr h2{font-size:18px;margin:0}
 .badge{font-size:11px;font-weight:800;padding:4px 10px;border-radius:999px;text-transform:uppercase;letter-spacing:.05em}
 .b1{background:#E4F5EC;color:#136243}.b2{background:#FDF3E2;color:#96610b}
 .meta{color:#6B7494;font-size:12.5px;margin:8px 0 14px}
 .cols{display:flex;gap:12px;flex-wrap:wrap} .box{flex:1;min-width:280px;background:#F8FAFF;border:1px solid #E8EEFB;border-radius:12px;padding:12px}
 .box.dis{background:#FFF9F0;border-color:#F3E3C6} .box h3{font-size:13px;margin:0 0 8px;color:#1E47C8} .box.dis h3{color:#B9770E} .box p{font-size:13px;margin:0 0 8px}
 h4{font-size:13px;margin:16px 0 6px;color:#3A4468} table{width:100%;border-collapse:collapse;font-size:12px} th,td{text-align:left;padding:4px 8px;border-bottom:1px solid #EEF1F8} th{color:#6B7494;font-weight:700} td.r,th.r{text-align:right;font-variant-numeric:tabular-nums} .muted{color:#9AA3BC;text-align:center} tr.hl{background:#FFF6DE;font-weight:600}
 .hip{margin-top:14px;background:#EEF3FF;border:1px solid #D9E4FF;border-radius:10px;padding:11px 13px;font-size:13px}
 .ask{margin-top:8px;background:#FFF0F0;border:1px solid #F5D0D0;border-radius:10px;padding:11px 13px;font-size:13px}
 @media print{body{background:#fff}.caso{break-inside:avoid}}
</style></head><body><div class="wrap">
 <h1>Casos borde — Zona Centro (créditos refinanciados)</h1>
 <div class="sub">Reconciliación con Disapp · snapshot 22/07/2026 · para revisar con Mauricio</div>
 <div class="resumen"><b>Qué son:</b> ${casos.length} créditos que en NUESTRO sistema quedaron <b>refinanciados</b> (lote del 10/07/2026) pero Disapp sigue mostrando <b>activos</b>. <b>${g1} son correctos</b> (Grupo 1: el refi existe también en Disapp). <b>${g2} hay que revisar</b> (Grupo 2: Disapp no tiene un crédito más nuevo del cliente → o pagó por otro lado, o el cliente aún debe). <b>Ninguno tiene riesgo de sobre-cobro hoy</b> (están inactivos en nuestro sistema); el riesgo del Grupo 2 es dejar de cobrar algo que el cliente sí debe.</div>
 ${bloques.join("\n")}
</div></body></html>`;

const out = "reporte-casos-borde-zona-centro.html";
writeFileSync(out, html);
console.log(`✓ Informe generado: ${out} (${casos.length} casos · Grupo 1: ${g1} · Grupo 2: ${g2})`);
