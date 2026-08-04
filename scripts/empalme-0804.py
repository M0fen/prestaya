#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
EMPALME TOTAL 2026-08-04 — sincronizar Presta Ya con Disapp a día de hoy (todas
las zonas), la noche previa al arranque del piloto.

Qué hace (en orden, cada paso idempotente — se puede RE-CORRER con exports más
nuevos, p.ej. mañana con los recaudos del 08-04):
  1. CLIENTES nuevos de Disapp que no tenemos (por disapp_id; documento choca → NULL).
  2. CRÉDITOS activos de Disapp que no tenemos (por disapp_credit_id y ref).
  3. ASIGNACIONES: cada crédito nuevo deja al cliente en la ruta de su cobrador
     (INV10: crédito activo sin ruta = crítico). No se pisa la ruta de terceros
     con crédito activo propio.
  4. RECAUDOS: inserta los pagos frescos (≥ 2026-07-21) deduplicados por
     disapp_pago_id, CAPADOS POR CRÉDITO contra la columna 'Pagos' del export de
     créditos de HOY. El cap tira desde el FRENTE (los más viejos): el excedente
     típico es el recaudo del 07-21 que YA vive dentro del ajuste de la
     sincronización de Zona Centro — insertarlo lo contaría dos veces.
     Para créditos nuevos entra TODA su historia de recaudos (con el mismo cap).
  5. TOP-UPS: si tras el paso 4 un crédito con target sigue por debajo del
     'Pagos' de Disapp (p.ej. semanales de supervisor, cuyos pagos Disapp no
     exporta), se siembra UN ajuste exacto (disapp_pago_id = recon-<hoy>-<id>).
  6. FINALIZAR: activos nuestros que ya NO están activos en Disapp y quedaron
     con saldo (refinanciados/cerrados allá) → estado 'finalizado' +
     finalizado_en. EXCEPCIÓN: clientes BORRADOS en Disapp se dejan activos
     (decisión: acá no hay clientes fantasma; se siguen cobrando).

La VERDAD por crédito es la columna 'Pagos' del export de créditos (identidad
Pagos+Saldo==Total c/Intereses verificada en el 100% de los activos). El estado
del cartón se deriva (FIFO); acá solo se alinea el libro de pagos.

  Dry-run:  python scripts/empalme-0804.py --env-file .env.local
  Escribir: python scripts/empalme-0804.py --env-file .env.local --commit
  Opcional: --src PATH (default C:\\Users\\Carlos\\migracion) · --forzar (saltea
            la guardia de pagos nativos de la app)

NO borra ni edita nada jamás (0126 lo veta a nivel BD, además). Solo inserta
pagos/clientes/créditos/asignaciones y avanza estados activo→finalizado.
"""
import sys, os, json, datetime as dt, urllib.parse, urllib.request
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import empalme_disapp as E  # parsers + consolidar + get_rows/upsert/http probados

def arg(flag, default=None):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default

COMMIT = "--commit" in sys.argv
FORZAR = "--forzar" in sys.argv
SRC = arg("--src", r"C:\Users\Carlos\migracion")
ENVF = arg("--env-file", ".env.local")
FRONTERA = dt.date(2026, 7, 21)   # el último import de recaudos llegó hasta el 07-20
# CORTE del export de CRÉDITOS: hasta qué día (inclusive) su columna 'Pagos'
# refleja los recaudos. El CAP anti-duplicado solo aplica a recaudos ≤ corte;
# los posteriores entran SIEMPRE (el target viejo no los conoce y caparlos
# tiraría cobros reales). Si mañana llega solo el excel de recaudos del 08-04
# sin créditos frescos: dejar --corte 2026-08-03. Si llegan créditos frescos:
# subir el corte a la fecha de ese export.
CORTE = dt.date.fromisoformat(arg("--corte", "2026-08-03"))
TOL = 1.0
HOY = dt.date.today()
SELLO = HOY.strftime("%Y%m%d")

env = E.load_env(ENVF)
url = (env.get("SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
key = env.get("SUPABASE_SERVICE_ROLE_KEY")
if not url or not key:
    sys.exit(f"Faltan SUPABASE_URL/SERVICE_ROLE_KEY en {ENVF}")
db = {"url": url, "key": key, "host": urllib.parse.urlparse(url).netloc}
print(f"EMPALME 0804 → {db['host'].split('.')[0]}  | modo: {'🔴 COMMIT (escribe)' if COMMIT else '🟡 DRY-RUN'}")

# ══ 0. Cargar exports + base ════════════════════════════════════════════════
d = E.consolidar(SRC)

# Créditos del export con TODO (incluye Tasa %): re-leo el xlsx de créditos acá
# para no depender de que load_creditos exponga la tasa.
import openpyxl, glob as _glob
creds_hoy = {}
for path in sorted(_glob.glob(os.path.join(SRC, "creditos*.xlsx"))):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    hdr = [str(c).strip() if c is not None else "" for c in next(ws.iter_rows(min_row=1, max_row=1, values_only=True))]
    hm = {h.lower(): i for i, h in enumerate(hdr) if h}
    def gv(r, *names):
        for n in names:
            i = hm.get(n.lower())
            if i is not None:
                return r[i]
        return None
    for r in ws.iter_rows(min_row=2, values_only=True):
        cid = gv(r, "ID Crédito", "ID Credito")
        if cid in (None, ""):
            continue
        cid = str(cid).strip()
        if cid in creds_hoy:
            continue
        if (str(gv(r, "Estado") or "")).strip().lower() != "activo":
            continue
        mod = (str(gv(r, "Modalidad") or "diaria")).strip().lower()
        tasa_raw = gv(r, "Tasa %", "Tasa")
        tasa = E.parse_money_text(str(tasa_raw).replace("%", "")) if tasa_raw not in (None, "") else None
        creds_hoy[cid] = {
            "cid": cid,
            "ref": (str(gv(r, "Crédito #", "Credito #") or "")).strip() or None,
            "id_cliente": (str(gv(r, "ID Cliente") or "")).strip() or None,
            "id_vendedor": (str(gv(r, "ID Vendedor") or "")).strip() or None,
            "vendedor": (str(gv(r, "Vendedor") or "")).strip(),
            "frecuencia": E.MODALIDAD_FREC.get(mod, "diario"),
            "valor": E.parse_money_text(gv(r, "Valor Crédito", "Valor Credito")) or 0,
            "tci": E.parse_money_text(gv(r, "Total c/ Intereses", "Total con Intereses")) or 0,
            "pagos": E.parse_money_text(gv(r, "Pagos")) or 0,
            "cuota": E.parse_money_text(gv(r, "Valor Cuota")) or 0,
            "cuotas": int(gv(r, "Cuotas") or 0),
            "fecha": E.parse_date(gv(r, "Fecha Crédito", "Fecha Credito")),
            "tasa": round(tasa) if tasa is not None else None,
        }
    wb.close()
ref2hoy = {c["ref"]: c for c in creds_hoy.values() if c["ref"]}
print(f"  export créditos HOY: {len(creds_hoy)} activos · export clientes: {len(d['clientes'])} · pagos únicos: {len(d['pagos'])}")

usuarios = E.get_rows(db, "usuarios", "id,nombre,rol,zona_id,disapp_vendedor_id,activo")
zonas = E.get_rows(db, "zonas", "id,nombre")
zona_nom = {z["id"]: z["nombre"] for z in zonas}
vend2user = {str(u["disapp_vendedor_id"]): u for u in usuarios if u.get("disapp_vendedor_id") is not None}
user_zona = {u["id"]: (zona_nom.get(u["zona_id"]) if u.get("zona_id") else None) or "(sin zona)" for u in usuarios}

clientes_db = E.get_rows(db, "clientes", "id,disapp_id,documento,activo")
cliDe = {str(c["disapp_id"]): c["id"] for c in clientes_db if c.get("disapp_id")}
docs_db = {c["documento"] for c in clientes_db if c.get("documento")}
ids_cli_file = set(d["clientes"].keys())
borrados_en_disapp = {c["id"] for c in clientes_db if c.get("disapp_id") and c["disapp_id"] not in ids_cli_file}

pres = E.get_rows(db, "prestamos", "id,cliente_id,cobrador_id,disapp_credit_id,disapp_credit_ref,estado,cuota_diaria,total_dias,pagado_acum")
by_ref_db = {p["disapp_credit_ref"]: p for p in pres if p.get("disapp_credit_ref")}
ids_credit_db = {str(p["disapp_credit_id"]) for p in pres if p.get("disapp_credit_id")}
activos_db = [p for p in pres if p["estado"] == "activo"]

# pagos ya en la base (para no contar dos veces en el CAP al re-correr)
ya_ids = set()
for row in E.get_rows(db, "pagos", "id,disapp_pago_id", {"registrado_en": "gte.2026-06-01"}):
    if row.get("disapp_pago_id"):
        ya_ids.add(str(row["disapp_pago_id"]))
print(f"  base: {len(clientes_db)} clientes · {len(pres)} créditos ({len(activos_db)} activos) · pagos recientes ya importados: {len(ya_ids)}")

# ══ 1. Clientes nuevos ══════════════════════════════════════════════════════
faltan_creds = [c for c in creds_hoy.values() if c["ref"] not in by_ref_db and c["cid"] not in ids_credit_db]
cli_nuevos = {}
docs_previstos = set()
for c in faltan_creds:
    did = c["id_cliente"]
    if not did or did in cliDe or did in cli_nuevos:
        continue
    f = d["clientes"].get(did) or {}
    doc = f.get("documento")
    if doc and (doc in docs_db or doc in docs_previstos):
        doc = None  # misma regla del empalme: el 1ro conserva el documento
    if doc:
        docs_previstos.add(doc)
    cli_nuevos[did] = {
        "disapp_id": did,
        "nombre": f.get("nombre") or "(sin nombre)",
        "documento": doc,
        "telefono": f.get("telefono"),
        "direccion": f.get("direccion"),
        "activo": True,
        "origen": "oficina",
    }

# ══ 2. Créditos nuevos ══════════════════════════════════════════════════════
sin_vendedor = [c for c in faltan_creds if str(c["id_vendedor"]) not in vend2user]
crear = [c for c in faltan_creds if str(c["id_vendedor"]) in vend2user]

# ══ 2b. RESUCITAR: activos HOY en Disapp que acá quedaron finalizados ═══════
# La sincronización ZC del 07-21 finalizó 245 créditos porque el export de aquel
# día no los listaba; el export de HOY dice que siguen activos (con saldo). La
# verdad es el export más fresco → se reactivan (0126 lo permite vía service).
resucitar = []
for ref, c in ref2hoy.items():
    p = by_ref_db.get(ref)
    if p and p["estado"] != "activo":
        resucitar.append({"id": p["id"], "ref": ref, "estado": p["estado"],
                          "cliente_id": p["cliente_id"], "cobrador_id": p["cobrador_id"]})

# ══ 4a. Candidatos de pagos por crédito (antes de asignaciones p/ conocer scope)
cand_por_ref = defaultdict(list)
for p in d["pagos"].values():
    if not p["ref"] or not p["fecha"] or str(p["id_pago"]) in ya_ids:
        continue
    es_nuevo = p["ref"] in {c["ref"] for c in crear}
    if p["ref"] in by_ref_db and p["fecha"] >= FRONTERA:
        cand_por_ref[p["ref"]].append(p)      # crédito existente: solo lo fresco
    elif es_nuevo:
        cand_por_ref[p["ref"]].append(p)      # crédito nuevo: toda su historia
for lst in cand_por_ref.values():
    lst.sort(key=lambda p: (p["fecha"], str(p["id_pago"])))

# CAP por crédito con target (matcheados y nuevos): tirar desde el FRENTE.
insertar = []            # pagos reales a insertar
descartes = []           # (ref, pago) descartados por el cap
topups = []              # ajustes exactos
sim_final = {}           # ref -> pagado final simulado
refs_crear = {c["ref"]: c for c in crear if c["ref"]}
sim_corte = {}  # ref -> pagado simulado SOLO hasta el corte (base p/ top-ups)
for ref, lst in cand_por_ref.items():
    hoy_file = ref2hoy.get(ref)
    if ref in by_ref_db:
        base_pagado = round(float(by_ref_db[ref]["pagado_acum"] or 0), 2)
    else:
        base_pagado = 0.0
    capables = [p for p in lst if p["fecha"] <= CORTE]   # el target los conoce
    post = [p for p in lst if p["fecha"] > CORTE]        # posteriores: entran siempre
    if hoy_file:  # hay target
        target = round(hoy_file["pagos"], 2)
        exceso = round(base_pagado + sum(p["monto"] or 0 for p in capables) - target, 2)
        keep = list(capables)
        while exceso > TOL and keep:
            m = keep[0]["monto"] or 0
            if m <= exceso + TOL:
                descartes.append((ref, keep.pop(0)))
                exceso = round(exceso - m, 2)
            else:
                break  # el próximo no entra entero en el exceso: no tirar de más
        insertar.extend((ref, p) for p in keep + post)
        sim_corte[ref] = round(base_pagado + sum(p["monto"] or 0 for p in keep), 2)
        sim_final[ref] = round(sim_corte[ref] + sum(p["monto"] or 0 for p in post), 2)
    else:  # stale (activo acá, cerrado allá): sin target, entra todo lo fresco
        insertar.extend((ref, p) for p in lst)
        sim_final[ref] = round(base_pagado + sum(p["monto"] or 0 for p in lst), 2)

# ══ 5. Top-ups exactos p/ créditos con target que quedan cortos ═════════════
for ref, c in ref2hoy.items():
    en_db = ref in by_ref_db
    es_nuevo = ref in refs_crear
    if not en_db and not es_nuevo:
        continue
    base_pagado = round(float(by_ref_db[ref]["pagado_acum"] or 0), 2) if en_db else 0.0
    # El hueco se mide contra lo simulado HASTA EL CORTE: el target no conoce
    # los recaudos posteriores, y esos no tapan un faltante de la ventana vieja.
    fin_corte = sim_corte.get(ref, sim_final.get(ref, base_pagado))
    delta = round(c["pagos"] - fin_corte, 2)
    if delta > TOL:
        topups.append({"ref": ref, "cid": c["cid"], "delta": delta, "vend": c["vendedor"]})
        sim_final[ref] = round(sim_final.get(ref, base_pagado) + delta, 2)

# ══ 6. Finalizar stales con saldo (excepto clientes borrados en Disapp) ═════
finalizar = []
mantener_borrados = []
for p in activos_db:
    ref = p.get("disapp_credit_ref")
    if not ref or ref in ref2hoy:
        continue
    total = round(float(p["cuota_diaria"] or 0)) * int(p["total_dias"] or 0)
    fin = sim_final.get(ref, round(float(p["pagado_acum"] or 0), 2))
    if total - fin <= TOL:
        continue  # queda saldado con lo importado: el estado derivado ya lo refleja
    if p["cliente_id"] in borrados_en_disapp:
        mantener_borrados.append(p)  # Disapp lo borró; acá se sigue cobrando
        continue
    finalizar.append({"id": p["id"], "ref": ref, "colgado": round(total - fin)})

# ══ 3. Asignaciones para créditos nuevos ════════════════════════════════════
asig = E.get_rows(db, "asignaciones", "id,cobrador_id,cliente_id,activo")
act_pair = {(a["cliente_id"], a["cobrador_id"]): a for a in asig if a["activo"]}
inact_pair = {(a["cliente_id"], a["cobrador_id"]): a for a in asig if not a["activo"]}
# créditos activos por (cliente, cobrador) en el estado FINAL (activos − finalizar + nuevos)
finalizar_ids = {f["id"] for f in finalizar}
cred_act_final = defaultdict(int)
for p in activos_db:
    if p["id"] not in finalizar_ids:
        cred_act_final[(p["cliente_id"], p["cobrador_id"])] += 1
asig_activar, asig_crear, asig_bajar = [], [], []
pares_nuevos = set()
for r in resucitar:  # el crédito revive → su cliente vuelve a la ruta del dueño
    par = (r["cliente_id"], r["cobrador_id"])
    cred_act_final[par] += 1
    if par not in act_pair and par not in pares_nuevos:
        pares_nuevos.add(par)
        if par in inact_pair:
            asig_activar.append(inact_pair[par] | {"cliente_id": r["cliente_id"]})
        else:
            asig_crear.append({"cliente_id": r["cliente_id"], "cobrador_id": r["cobrador_id"]})
for c in crear:
    cliente_id = cliDe.get(c["id_cliente"])  # None si el cliente es nuevo (se resuelve al aplicar)
    cobrador_id = vend2user[str(c["id_vendedor"])]["id"]
    key_par = (c["id_cliente"], cobrador_id)
    if key_par in pares_nuevos:
        continue
    pares_nuevos.add(key_par)
    cred_act_final[(cliente_id, cobrador_id)] += 1
    if cliente_id is None:
        asig_crear.append({"cliente_disapp": c["id_cliente"], "cobrador_id": cobrador_id})
        continue
    if (cliente_id, cobrador_id) in act_pair:
        pass  # ya está en la ruta correcta
    elif (cliente_id, cobrador_id) in inact_pair:
        asig_activar.append(inact_pair[(cliente_id, cobrador_id)] | {"cliente_id": cliente_id})
    else:
        asig_crear.append({"cliente_id": cliente_id, "cobrador_id": cobrador_id})
# bajar pares activos de OTROS cobradores sin crédito activo final con ese cliente
clientes_tocados = {cliDe.get(c["id_cliente"]) for c in crear} - {None}
for (cli, cob), a in act_pair.items():
    if cli in clientes_tocados and cred_act_final.get((cli, cob), 0) == 0:
        asig_bajar.append(a)

# ══ Guardia: pagos nativos de la app en la ventana ══════════════════════════
nativos = E.get_rows(db, "pagos", "id,prestamo_id,registrado_en,origen,disapp_pago_id",
                     {"anulado": "eq.false", "registrado_en": f"gte.{FRONTERA}",
                      "origen": "not.in.(disapp_import,reconciliacion_zc,reconciliacion_0804)"})
nativos = [n for n in nativos if not str(n.get("disapp_pago_id") or "").startswith("recon-")]
UY = dt.timezone(dt.timedelta(hours=-3))
def dia_uy(ts):
    try:
        return dt.datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone(UY).date().isoformat()
    except ValueError:
        return str(ts)[:10]
nativo_en = {(n["prestamo_id"], dia_uy(n["registrado_en"])) for n in nativos}
choques = []
for ref, p in insertar:
    pdb = by_ref_db.get(ref)
    if pdb and (pdb["id"], p["fecha"].isoformat()) in nativo_en:
        choques.append((ref, p))

# ══ RESUMEN (dry-run y commit) ══════════════════════════════════════════════
def zona_de(c):
    u = vend2user.get(str(c.get("id_vendedor") or ""))
    return user_zona.get(u["id"], "(sin zona)") if u else "(sin usuario)"

print("\n═══ PLAN ═══")
print(f"  1) Clientes a crear: {len(cli_nuevos)}")
pz = defaultdict(lambda: [0, 0.0])
for c in crear:
    pz[zona_de(c)][0] += 1
    pz[zona_de(c)][1] += c["tci"] - c["pagos"]
print(f"  2) Créditos a crear: {len(crear)}  (saldo Disapp ${round(sum(c['tci']-c['pagos'] for c in crear)):,})")
for k, (n, s) in sorted(pz.items(), key=lambda x: -x[1][0]):
    print(f"       {k}: {n}  (saldo ${round(s):,})")
if sin_vendedor:
    print(f"     ⚠ sin vendedor mapeado (NO se crean): {len(sin_vendedor)}")
if resucitar:
    de = defaultdict(int)
    for r in resucitar:
        de[r["estado"]] += 1
    print(f"  2b) Resucitar (activos HOY en Disapp, acá {dict(de)}): {len(resucitar)}")
print(f"  3) Asignaciones: crear {len(asig_crear)} · reactivar {len(asig_activar)} · bajar {len(asig_bajar)}")
n_ins = len(insertar); s_ins = round(sum(p['monto'] or 0 for _, p in insertar))
print(f"  4) Recaudos a insertar: {n_ins}  ${s_ins:,}")
print(f"       descartados por CAP (ya viven en ajustes — no duplicar): {len(descartes)}  ${round(sum(p['monto'] or 0 for _, p in descartes)):,}")
print(f"  5) Top-ups exactos: {len(topups)}  ${round(sum(t['delta'] for t in topups)):,}")
sup_top = [t for t in topups if "SUPERVISOR" in (t["vend"] or "").upper()]
print(f"       de ellos en créditos de SUPERVISOR: {len(sup_top)}  ${round(sum(t['delta'] for t in sup_top)):,}")
print(f"  6) Finalizar (cerrados en Disapp con saldo acá): {len(finalizar)}  (saldo colgado ${round(sum(f['colgado'] for f in finalizar)):,})")
print(f"       clientes borrados en Disapp que se MANTIENEN activos: {len(mantener_borrados)}")

# end-state esperado contra el export de hoy
exact = under = over = 0
for ref, c in ref2hoy.items():
    if ref not in by_ref_db and ref not in refs_crear:
        continue
    gap = round(c["pagos"] - sim_final.get(ref, round(float(by_ref_db[ref]["pagado_acum"] or 0), 2) if ref in by_ref_db else 0.0), 2)
    if abs(gap) <= TOL: exact += 1
    elif gap > 0: under += 1
    else: over += 1
n_post = sum(1 for _, p in insertar if p["fecha"] > CORTE)
print(f"\n  END-STATE esperado vs 'Pagos' Disapp (al corte {CORTE}): exactos {exact} · cortos {under} · pasados {over} (de {exact+under+over})")
if n_post:
    print(f"  (recaudos POSTERIORES al corte incluidos sin cap: {n_post} — contra un target viejo van a figurar como 'pasados': esperado)")

huerf = {p["ref"] for p in d["pagos"].values() if p["ref"] and p["fecha"] and p["fecha"] >= FRONTERA
         and p["ref"] not in by_ref_db and p["ref"] not in ref2hoy}
print(f"  (pendiente estructural: {len(huerf)} refs nacieron y cerraron en la ventana — necesitan export TODOS-los-estados)")

if choques:
    print(f"\n🔴 GUARDIA: {len(choques)} recaudos chocan crédito+día con pagos NATIVOS de la app.")
    for ref, p in choques[:8]:
        print(f"     {ref} {p['fecha']} ${round(p['monto'] or 0):,}")
    if not FORZAR:
        sys.exit("   Abortado. Revisar (o --forzar a sabiendas).")
else:
    print(f"\n  ✓ guardia: sin choques con pagos nativos ({len(nativos)} revisados)")

if not COMMIT:
    print("\n🟡 DRY-RUN: no se escribió nada. Aplicar con --commit.")
    sys.exit(0)

# ══ APLICAR ═════════════════════════════════════════════════════════════════
print("\n═══ APLICANDO ═══")
# 1) clientes (upsert ignore por disapp_id) y re-fetch del mapa
if cli_nuevos:
    E.upsert(db, "clientes", list(cli_nuevos.values()), "disapp_id", ignore=True, rep=False)
    clientes_db = E.get_rows(db, "clientes", "id,disapp_id")
    cliDe = {str(c["disapp_id"]): c["id"] for c in clientes_db if c.get("disapp_id")}

# 2) créditos (insert plano; idempotencia por el pre-filtro contra la base)
filas_credito = []
for c in crear:
    cliente_id = cliDe.get(c["id_cliente"])
    if not cliente_id:
        print(f"  ✗ crédito {c['cid']}: cliente disapp {c['id_cliente']} no resuelto")
        continue
    filas_credito.append({
        "cliente_id": cliente_id,
        "cobrador_id": vend2user[str(c["id_vendedor"])]["id"],
        "monto_prestado": round(c["valor"]),
        "cuota_diaria": round(c["cuota"]),
        "total_dias": c["cuotas"],
        "fecha_inicio": (c["fecha"] or dt.date(2026, 7, 1)).isoformat(),
        "frecuencia": c["frecuencia"],
        "estado": "activo",
        "interes_pct": c["tasa"] if c["tasa"] is not None else 20,
        "disapp_credit_id": c["cid"],
        "disapp_credit_ref": c["ref"],
    })
creados = []
for i in range(0, len(filas_credito), 200):
    st, data = E.http(db["url"] + "/rest/v1/prestamos", "POST", key, filas_credito[i:i+200],
                      "return=representation")
    if st >= 300:
        raise RuntimeError(f"insert prestamos [{st}]: {str(data)[:400]}")
    creados.extend(data)
    print(f"    prestamos: {min(i+200, len(filas_credito))}/{len(filas_credito)}", end="\r")
print(f"\n  ✓ créditos creados: {len(creados)}")
for row in creados:
    if row.get("disapp_credit_ref"):
        by_ref_db[row["disapp_credit_ref"]] = row

# 2b) resucitar
okR = 0
for r in resucitar:
    st, _ = E.http(db["url"] + f"/rest/v1/prestamos?id=eq.{r['id']}", "PATCH", key,
                   {"estado": "activo", "finalizado_en": None}, "return=minimal")
    if st < 300:
        okR += 1
    else:
        print(f"  ✗ resucitar {r['ref']}: [{st}]")
print(f"  ✓ resucitados: {okR}/{len(resucitar)}")

# 3) asignaciones
ahora_iso = dt.datetime.now(UY).isoformat()
filas_asig = []
for a in asig_crear:
    cliente_id = a.get("cliente_id") or cliDe.get(a.get("cliente_disapp", ""))
    if not cliente_id or (cliente_id, a["cobrador_id"]) in act_pair:
        continue
    filas_asig.append({"cliente_id": cliente_id, "cobrador_id": a["cobrador_id"], "activo": True, "asignado_en": ahora_iso})
if filas_asig:
    st, data = E.http(db["url"] + "/rest/v1/asignaciones", "POST", key, filas_asig, "return=minimal")
    if st >= 300:
        raise RuntimeError(f"insert asignaciones [{st}]: {str(data)[:400]}")
for a in asig_activar:
    E.http(db["url"] + f"/rest/v1/asignaciones?id=eq.{a['id']}", "PATCH", key, {"activo": True}, "return=minimal")
for a in asig_bajar:
    E.http(db["url"] + f"/rest/v1/asignaciones?id=eq.{a['id']}", "PATCH", key, {"activo": False}, "return=minimal")
print(f"  ✓ asignaciones: +{len(filas_asig)} nuevas · {len(asig_activar)} reactivadas · {len(asig_bajar)} bajadas")

# 4) recaudos (upsert ignore por disapp_pago_id)
vend_txt2id = d["vend_por_texto"]
filas_pago = []
for ref, p in insertar:
    pdb = by_ref_db.get(ref)
    if not pdb:
        continue  # crédito que no se pudo crear
    td = int(pdb.get("total_dias") or 10**6)
    dc = p["cuota_num"] or 1
    dc = max(1, min(dc, td))
    idv = vend_txt2id.get(p["vendedor"])
    u = vend2user.get(str(idv)) if idv is not None else None
    filas_pago.append({
        "prestamo_id": pdb["id"],
        "dia_credito": dc,
        "monto": p["monto"] or 0.01,
        "registrado_por": (u or {}).get("id") or pdb.get("cobrador_id"),
        "registrado_en": E.iso_ts(p["fecha"]),
        "origen": "disapp_import",
        "importado_en": dt.datetime.now().isoformat(),
        "disapp_pago_id": p["id_pago"],
        "disapp_credit_ref": ref,
    })
antes = E.count_rows(db, "pagos")
E.upsert(db, "pagos", filas_pago, "disapp_pago_id", ignore=True, rep=False)
despues = E.count_rows(db, "pagos")
print(f"  ✓ recaudos: {despues - antes} insertados (candidatos {len(filas_pago)}; el resto ya existía)")

# 5) top-ups exactos
filas_top = []
for t in topups:
    pdb = by_ref_db.get(t["ref"])
    if not pdb:
        continue
    filas_top.append({
        "prestamo_id": pdb["id"],
        "dia_credito": 1,
        "monto": t["delta"],
        "registrado_por": pdb.get("cobrador_id"),
        "registrado_en": E.iso_ts(HOY),
        "origen": "reconciliacion_0804",
        "importado_en": dt.datetime.now().isoformat(),
        "disapp_pago_id": f"recon-{SELLO}-{t['cid']}",
        "disapp_credit_ref": t["ref"],
    })
E.upsert(db, "pagos", filas_top, "disapp_pago_id", ignore=True, rep=False)
print(f"  ✓ top-ups: {len(filas_top)}")

# 6) finalizar
okF = 0
for f in finalizar:
    st, _ = E.http(db["url"] + f"/rest/v1/prestamos?id=eq.{f['id']}&estado=eq.activo", "PATCH", key,
                   {"estado": "finalizado", "finalizado_en": ahora_iso}, "return=minimal")
    if st < 300:
        okF += 1
print(f"  ✓ finalizados: {okF}/{len(finalizar)}")

# ══ VERIFICACIÓN end-state real ═════════════════════════════════════════════
print("\n═══ VERIFICACIÓN (contra la base, no simulada) ═══")
pres2 = E.get_rows(db, "prestamos", "id,disapp_credit_ref,estado,cuota_diaria,total_dias,pagado_acum,cobrador_id")
by_ref2 = {p["disapp_credit_ref"]: p for p in pres2 if p.get("disapp_credit_ref")}
exact = under = over = 0
peor = []
for ref, c in ref2hoy.items():
    p = by_ref2.get(ref)
    if not p:
        continue
    gap = round(c["pagos"] - float(p["pagado_acum"] or 0), 2)
    if abs(gap) <= TOL: exact += 1
    elif gap > 0: under += 1; peor.append((ref, gap))
    else: over += 1; peor.append((ref, gap))
print(f"  vs 'Pagos' Disapp hoy: EXACTOS {exact} · cortos {under} · pasados {over}")
for ref, g in sorted(peor, key=lambda x: -abs(x[1]))[:8]:
    print(f"    {ref}: {'falta' if g > 0 else 'sobra'} ${round(abs(g)):,}")
act2 = [p for p in pres2 if p["estado"] == "activo"]
cart = sum(max(0, round(float(p["cuota_diaria"] or 0)) * int(p["total_dias"] or 0) - round(float(p["pagado_acum"] or 0))) for p in act2)
print(f"  activos: {len(act2)} · cartera (cuota×días−pagado): ${cart:,}")
print("\nSiguiente: correr scripts/shadow-disapp.py --env-file .env.local --src <creditos de hoy> para el diff independiente.")
