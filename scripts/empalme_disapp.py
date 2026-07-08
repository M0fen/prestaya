#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Empalme Disapp -> Presta Ya. Importador idempotente y auditable.
Ver docs/mapeo-empalme.md para el mapeo y las decisiones.

Modos:
  --audit                 Solo lectura: consolida los .xlsx, reporta cobertura de
                          fechas, dias faltantes, vendedores y huerfanos. NO toca DB.
  --dry-run  (default)    Consolida + reporta que HARIA (cuentas, banderas), sin escribir.
  --commit                Escribe de verdad (crea cobradores/auth, clientes, creditos,
                          stubs y pagos). Requiere --env-file con SUPABASE_URL/KEY.
  --prod                  Permite apuntar a produccion (si no, aborta cuando el .env no
                          parece de prueba). NUNCA usar sin intencion.
  --validate-sample N     Tras --commit: toma N clientes y muestra saldo/estado calculado.
  --env-file PATH         .env con SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL + SERVICE_ROLE_KEY
                          (default .env.prueba).
  --src PATH              Carpeta de exports (default C:\\Users\\Carlos\\migracion).
  --out PATH              Carpeta de reportes (default <src>\\_reportes).

Reglas de dinero (criticas):
  · creditos_*.xlsx: montos como TEXTO uruguayo '6.000,00' -> 6000.00
  · recaudos_*.xlsx: Excel se comio el separador de miles. float -> x1000, int -> tal cual.
  · Fechas dd/mm/yyyy. Los pagos NUNCA se borran; 'Saldo Pendiente' es metadato, no fuente.
  · El carton asigna el pago por dia_credito (= "Cuota #"), no por fecha.
"""
import argparse, glob, os, sys, json, re, secrets, urllib.request, urllib.parse, urllib.error
import datetime as dt
from collections import defaultdict, Counter

try:
    import openpyxl
except ImportError:
    sys.exit("Falta openpyxl:  python -m pip install openpyxl")

DEFAULT_SRC = r"C:\Users\Carlos\migracion"
MODALIDAD_FREC = {"diaria": "diario", "semanal": "semanal", "quincenal": "quincenal",
                  "mensual": "mensual", "personalizado": "diario"}
MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"]
BATCH = 500

# ══ Parsers ═════════════════════════════════════════════════════════════════
def parse_money_text(v):
    """Montos de creditos: '6.000,00' -> 6000.00. Tambien acepta numeros."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    s = str(v).strip().replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None

def parse_recaudo(v):
    """recaudos con el bug del separador de miles: int -> tal cual; float -> x1000;
       str -> parseo uruguayo."""
    if v is None or v == "" or isinstance(v, bool):
        return None
    if isinstance(v, int):
        return float(v)
    if isinstance(v, float):
        return round(v * 1000.0, 2)
    return parse_money_text(str(v))

def parse_date(v):
    if v is None or v == "":
        return None
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    m = re.match(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})", str(v))
    if m:
        d, mo, y = map(int, m.groups())
        try:
            return dt.date(y, mo, d)
        except ValueError:
            return None
    return None

def iso_ts(d):
    """date -> timestamptz al mediodia de Uruguay (evita corrimiento de dia por TZ)."""
    return f"{d.isoformat()}T12:00:00-03:00" if d else None

# ══ Lectura xlsx ════════════════════════════════════════════════════════════
def discover(src, prefix):
    return sorted(glob.glob(os.path.join(src, prefix + "*.xlsx")))

def header_map(ws):
    row1 = next(ws.iter_rows(min_row=1, max_row=1, values_only=True))
    return {str(c).strip().lower(): i for i, c in enumerate(row1) if c is not None}

def col(hm, *names):
    for n in names:
        i = hm.get(n.strip().lower())
        if i is not None:
            return i
    return None

def rows_of(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    hm = header_map(ws)
    for r in ws.iter_rows(min_row=2, values_only=True):
        yield hm, r
    wb.close()

def _raw(r, i): return r[i] if i is not None else None
def _s(r, i):   return str(r[i]).strip() if (i is not None and r[i] not in (None, "")) else None
def _int(r, i):
    if i is None or r[i] in (None, ""):
        return None
    try:
        return int(float(str(r[i]).replace(",", ".")))
    except ValueError:
        return None

def es_supervisor(nombre): return bool(nombre) and "SUPERVISOR" in nombre.upper()
def es_admin_vend(nombre): return bool(nombre) and "ADMINISTRADOR" in nombre.upper()

# ══ Consolidacion (pura, sin DB) ════════════════════════════════════════════
def load_clientes(src):
    clientes = {}     # disapp_id -> {..}
    docs_vistos = {}  # documento -> disapp_id (el 1ro que lo uso)
    dup_docs = 0
    for path in discover(src, "clientes"):
        for hm, r in rows_of(path):
            ic = col(hm, "ID")
            if ic is None or r[ic] in (None, ""):
                continue
            did = str(r[ic]).strip()
            if did in clientes:
                continue
            doc = _s(r, col(hm, "Documento"))
            doc_final = doc
            if doc:
                if doc in docs_vistos:      # decision 2: 1ro conserva, dup -> NULL
                    doc_final = None
                    dup_docs += 1
                else:
                    docs_vistos[doc] = did
            clientes[did] = {
                "disapp_id": did,
                "nombre": _s(r, col(hm, "Nombre")) or "(sin nombre)",
                "documento": doc_final,
                "documento_original": doc,
                "telefono": _s(r, col(hm, "Teléfono", "Telefono")),
                "direccion": _s(r, col(hm, "Dirección", "Direccion")),
                "notas": _s(r, col(hm, "Observación", "Observacion")),
                "vendedor": _s(r, col(hm, "Vendedor")),
                "activo": (_s(r, col(hm, "Estado")) or "").lower() != "inactivo",
            }
    return clientes, docs_vistos, dup_docs

def load_creditos(src):
    by_id = {}
    vendedores = {}   # id_vendedor -> nombre
    vend_por_texto = {}  # nombre texto -> id_vendedor
    for path in discover(src, "creditos"):
        for hm, r in rows_of(path):
            idc = col(hm, "ID Crédito", "ID Credito")
            if idc is None or r[idc] in (None, ""):
                continue
            idv = _s(r, col(hm, "ID Vendedor"))
            vnom = _s(r, col(hm, "Vendedor"))
            if idv and vnom:
                vendedores[idv] = vnom
                vend_por_texto[vnom] = idv
            mod = (_s(r, col(hm, "Modalidad")) or "diaria").lower()
            by_id[str(r[idc]).strip()] = {
                "disapp_credit_id": str(r[idc]).strip(),
                "ref": _s(r, col(hm, "Crédito #", "Credito #")),
                "id_cliente": _s(r, col(hm, "ID Cliente")),
                "id_vendedor": idv,
                "vendedor": vnom,
                "monto_prestado": parse_money_text(_raw(r, col(hm, "Valor Crédito", "Valor Credito"))),
                "cuota": parse_money_text(_raw(r, col(hm, "Valor Cuota"))),
                "cuotas": _int(r, col(hm, "Cuotas")),
                "frecuencia": MODALIDAD_FREC.get(mod, "diario"),
                "modalidad_rara": mod not in MODALIDAD_FREC or mod == "personalizado",
                "fecha": parse_date(_raw(r, col(hm, "Fecha Crédito", "Fecha Credito"))),
            }
    return by_id, vendedores, vend_por_texto

def load_pagos(src):
    pagos = {}
    files = discover(src, "recaudos")
    for path in files:
        for hm, r in rows_of(path):
            ip = col(hm, "ID Pago")
            if ip is None or r[ip] in (None, ""):
                continue
            key = str(r[ip]).strip()
            if key in pagos:
                continue
            raw_rec = _raw(r, col(hm, "Recaudo"))
            pagos[key] = {
                "id_pago": key,
                "ref": _s(r, col(hm, "Ref. Crédito", "Ref. Credito")),
                "vendedor": _s(r, col(hm, "Vendedor")),
                "documento": _s(r, col(hm, "Documento")),
                "monto": parse_recaudo(raw_rec),
                "corregido": isinstance(raw_rec, float),
                "cuota_num": _int(r, col(hm, "Cuota #")),
                "total_cuotas": _int(r, col(hm, "Total Cuotas")),
                "valor_cuota": parse_recaudo(_raw(r, col(hm, "Valor Cuota"))),
                "total_credito": parse_recaudo(_raw(r, col(hm, "Total Crédito", "Total Credito"))),
                "fecha": parse_date(_raw(r, col(hm, "Fecha Pago"))),
            }
    return pagos, files

def consolidar(src):
    clientes, docs, dup_docs = load_clientes(src)
    creditos, vendedores, vend_por_texto = load_creditos(src)
    pagos, prec_files = load_pagos(src)
    # refs de creditos activos (por "Credito #")
    refs_activos = {c["ref"]: cid for cid, c in creditos.items() if c["ref"]}
    # huerfanos: refs en pagos que no son de un credito activo
    huerfanos = defaultdict(list)   # ref -> [pago,..]
    for p in pagos.values():
        if p["ref"] and p["ref"] not in refs_activos:
            huerfanos[p["ref"]].append(p)
    return {
        "clientes": clientes, "docs": docs, "dup_docs": dup_docs,
        "creditos": creditos, "vendedores": vendedores, "vend_por_texto": vend_por_texto,
        "pagos": pagos, "prec_files": prec_files,
        "refs_activos": refs_activos, "huerfanos": huerfanos,
    }

# ══ AUDIT ═══════════════════════════════════════════════════════════════════
def audit(src, out):
    print("Leyendo exports de:", src)
    d = consolidar(src)
    clientes, creditos, pagos = d["clientes"], d["creditos"], d["pagos"]
    corregidos = sum(1 for p in pagos.values() if p["corregido"])
    total = sum(p["monto"] for p in pagos.values() if p["monto"])
    print("\n" + "=" * 68 + "\nRESUMEN\n" + "=" * 68)
    print(f"  Clientes unicos:                 {len(clientes):>8}")
    print(f"  Creditos activos:                {len(creditos):>8}")
    print(f"  Archivos de recaudos:            {len(d['prec_files']):>8}")
    print(f"  Pagos unicos:                    {len(pagos):>8}")
    print(f"  Pagos corregidos x1000:          {corregidos:>8}")
    print(f"  Documentos duplicados (a NULL):  {d['dup_docs']:>8}")
    print(f"  Suma recaudo (corregida):      $ {total:>14,.0f}")

    por_mes, suma_mes = Counter(), defaultdict(float)
    fechas = []
    for p in pagos.values():
        if p["fecha"]:
            fechas.append(p["fecha"]); mk = (p["fecha"].year, p["fecha"].month)
            por_mes[mk] += 1; suma_mes[mk] += p["monto"] or 0
    if fechas:
        print(f"\n  Rango: {min(fechas)}  ->  {max(fechas)}")
        print("  --- Pagos y $ por mes ---")
        for mk in sorted(por_mes):
            y, m = mk
            print(f"     {MESES[m-1]}-{y}:  {por_mes[mk]:>6} pagos   $ {suma_mes[mk]:>14,.0f}")

    pagos_huerf = sum(len(v) for v in d["huerfanos"].values())
    print(f"\n  Refs huerfanas (stub): {len(d['huerfanos'])}   pagos afectados: {pagos_huerf}")
    sup = sorted({v for v in d["vendedores"].values() if es_supervisor(v)})
    print(f"  Vendedores: {len(d['vendedores'])}  (supervisores: {len(sup)})")
    for s in sup:
        print("    [SUP]", s)

    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "audit.json"), "w", encoding="utf-8") as f:
        json.dump({"clientes": len(clientes), "creditos": len(creditos),
                   "pagos": len(pagos), "corregidos_x1000": corregidos,
                   "dup_docs": d["dup_docs"], "suma": round(total, 2),
                   "huerfanos": len(d["huerfanos"]), "pagos_huerfanos": pagos_huerf,
                   "vendedores": sorted(d["vendedores"].values())},
                  f, ensure_ascii=False, indent=2)
    print(f"\n  Reporte: {os.path.join(out, 'audit.json')}")

# ══ DB (PostgREST + GoTrue admin) ═══════════════════════════════════════════
def load_env(path):
    env = {}
    if os.path.isfile(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env

def http(url, method, key, body=None, prefer=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", key); req.add_header("Authorization", "Bearer " + key)
    req.add_header("Content-Type", "application/json")
    if prefer:
        req.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            txt = resp.read().decode()
            return resp.status, (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def upsert(db, table, rows, on_conflict, ignore=False, rep=True):
    if not rows:
        return []
    res = "ignore-duplicates" if ignore else "merge-duplicates"
    prefer = f"resolution={res},return={'representation' if rep else 'minimal'}"
    base = db["url"] + "/rest/v1/" + table + "?on_conflict=" + on_conflict
    out = []
    for i in range(0, len(rows), BATCH):
        st, data = http(base, "POST", db["key"], rows[i:i+BATCH], prefer)
        if st >= 300:
            raise RuntimeError(f"upsert {table} [{st}]: {str(data)[:500]}")
        if rep and isinstance(data, list):
            out.extend(data)
        sys.stdout.write(f"\r    {table}: {min(i+BATCH,len(rows))}/{len(rows)}")
        sys.stdout.flush()
    print()
    return out

def get_rows(db, table, select, params=None):
    """GET paginado (para armar mapas grandes)."""
    out = []
    off = 0
    while True:
        q = {"select": select, "limit": 1000, "offset": off}
        if params:
            q.update(params)
        url = db["url"] + "/rest/v1/" + table + "?" + urllib.parse.urlencode(q)
        st, data = http(url, "GET", db["key"])
        if st >= 300:
            raise RuntimeError(f"get {table} [{st}]: {str(data)[:300]}")
        out.extend(data or [])
        if not data or len(data) < 1000:
            break
        off += 1000
    return out

def crear_auth(db, email, password):
    st, data = http(db["url"] + "/auth/v1/admin/users", "POST", db["key"],
                    {"email": email, "password": password, "email_confirm": True})
    if st >= 300 or not isinstance(data, dict):
        return None, f"[{st}] {str(data)[:200]}"
    return data.get("id"), None

def rand_pass():
    abc = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(abc) for _ in range(12))

# ══ COMMIT ══════════════════════════════════════════════════════════════════
def commit_import(src, out, db, dry):
    d = consolidar(src)
    os.makedirs(out, exist_ok=True)
    modo = "DRY-RUN (no escribe)" if dry else "COMMIT (escribe)"
    destino = db["host"] if db else "sin conexion (conteos previos a la DB)"
    print(f"\n=== IMPORT {modo} → {destino} ===")

    # ── 1. Cobradores / supervisores (usuarios + auth) ─────────────────────
    admin_id = None
    if not dry:
        admins = get_rows(db, "usuarios", "id", {"rol": "eq.admin", "limit": 1})
        admin_id = admins[0]["id"] if admins else None
    id_vend_to_uuid = {}     # id_vendedor -> usuario uuid
    creds_csv = []
    print(f"\n[1] Cobradores/supervisores: {len(d['vendedores'])}")
    for idv, nombre in sorted(d["vendedores"].items()):
        rol = "supervisor" if es_supervisor(nombre) else "cobrador"
        if es_admin_vend(nombre) and admin_id:
            id_vend_to_uuid[idv] = admin_id
            continue
        if dry:
            continue
        # idempotencia: ya existe por disapp_vendedor_id?
        ya = get_rows(db, "usuarios", "id", {"disapp_vendedor_id": f"eq.{idv}", "limit": 1})
        if ya:
            id_vend_to_uuid[idv] = ya[0]["id"]
            continue
        email = f"cobrador-{idv}@import.prestaya.local"
        pwd = rand_pass()
        auth_id, err = crear_auth(db, email, pwd)
        if err:
            print(f"    ! auth {nombre}: {err}"); continue
        fila = upsert(db, "usuarios", [{
            "nombre": nombre, "rol": rol, "activo": True,
            "auth_user_id": auth_id, "disapp_vendedor_id": idv,
        }], "disapp_vendedor_id")
        if fila:
            id_vend_to_uuid[idv] = fila[0]["id"]
            creds_csv.append(f"{rol},{nombre},{email},{pwd}")
    if creds_csv:
        p = os.path.join(out, "credenciales_cobradores.csv")
        with open(p, "w", encoding="utf-8") as f:
            f.write("rol,nombre,email,password\n" + "\n".join(creds_csv) + "\n")
        print(f"    Credenciales -> {p}  ({len(creds_csv)} nuevas)")
    vtexto_to_uuid = {t: id_vend_to_uuid.get(i) for t, i in d["vend_por_texto"].items()}

    # ── 2. Clientes ─────────────────────────────────────────────────────────
    filas_cli = [{
        "disapp_id": c["disapp_id"], "nombre": c["nombre"], "documento": c["documento"],
        "telefono": c["telefono"], "direccion": c["direccion"], "notas": c["notas"],
        "activo": c["activo"],
    } for c in d["clientes"].values()]
    print(f"\n[2] Clientes: {len(filas_cli)}  (documentos a NULL por duplicado: {d['dup_docs']})")
    disapp_to_uuid, doc_to_uuid = {}, {}
    if not dry:
        rep = upsert(db, "clientes", filas_cli, "disapp_id")
        for row in rep:
            disapp_to_uuid[row["disapp_id"]] = row["id"]
            if row.get("documento"):
                doc_to_uuid[row["documento"]] = row["id"]

    # ── 3. Creditos activos (skip supervisores) ────────────────────────────
    sup_ids = {i for i, n in d["vendedores"].items() if es_supervisor(n)}
    filas_cred, ref_to_uuid, ref_total_dias = [], {}, {}
    skip_sup = skip_cli = 0
    for c in d["creditos"].values():
        if c["id_vendedor"] in sup_ids:
            skip_sup += 1; continue
        cli = disapp_to_uuid.get(c["id_cliente"]) if not dry else "?"
        if not dry and not cli:
            skip_cli += 1; continue
        td = c["cuotas"] or 1
        filas_cred.append({
            "disapp_credit_id": c["disapp_credit_id"], "disapp_credit_ref": c["ref"],
            "cliente_id": cli, "cobrador_id": id_vend_to_uuid.get(c["id_vendedor"]),
            "monto_prestado": c["monto_prestado"] or 1, "cuota_diaria": c["cuota"] or 1,
            "total_dias": td, "frecuencia": c["frecuencia"], "estado": "activo",
            "fecha_inicio": c["fecha"].isoformat() if c["fecha"] else None,
        })
        if c["ref"]:
            ref_total_dias[c["ref"]] = td
    print(f"\n[3] Creditos activos: {len(filas_cred)}  (skip supervisores: {skip_sup}, sin cliente: {skip_cli})")
    if not dry:
        rep = upsert(db, "prestamos", filas_cred, "disapp_credit_id")
        for row in rep:
            if row.get("disapp_credit_ref"):
                ref_to_uuid[row["disapp_credit_ref"]] = row["id"]

    # ── 3b. Asignaciones cobrador<->cliente (RUTA del cobrador) ──────────────
    # SIN esto, el RLS (app_cobrador_tiene_cliente) deja la ruta del cobrador
    # VACÍA. Una asignación por cada (cobrador, cliente) de un crédito ACTIVO
    # (deduplicado). Un cliente con créditos activos de varios cobradores queda
    # en la ruta de todos ellos (la tabla lo permite: unique (cobrador,cliente)).
    pares = {(f["cobrador_id"], f["cliente_id"])
             for f in filas_cred if f["cobrador_id"] and f["cliente_id"]}
    filas_asig = [{"cobrador_id": cob, "cliente_id": cli, "activo": True} for cob, cli in pares]
    print(f"\n[3b] Asignaciones cobrador↔cliente: {len(filas_asig)}")
    if not dry:
        upsert(db, "asignaciones", filas_asig, "cobrador_id,cliente_id", rep=False)

    # ── 4. Stubs historicos (huerfanos) ─────────────────────────────────────
    synth_uuid = None
    filas_stub = []
    for ref, plist in d["huerfanos"].items():
        cuota_max = max((p["cuota_num"] or 1) for p in plist)
        td = max(cuota_max, max((p["total_cuotas"] or 1) for p in plist))
        doc = next((p["documento"] for p in plist if p["documento"]), None)
        vend = next((p["vendedor"] for p in plist if p["vendedor"]), None)
        fmin = min((p["fecha"] for p in plist if p["fecha"]), default=None)
        cuota = next((p["valor_cuota"] for p in plist if p["valor_cuota"]), None) or 1
        montoc = max((p["total_credito"] or 0) for p in plist) or (cuota * td)
        filas_stub.append({
            "_ref": ref, "_doc": doc, "_vend": vend,
            "disapp_credit_id": "STUB:" + ref, "disapp_credit_ref": ref,
            "monto_prestado": montoc, "cuota_diaria": cuota, "total_dias": td,
            "frecuencia": "diario", "estado": "finalizado",
            "fecha_inicio": fmin.isoformat() if fmin else None,
        })
        ref_total_dias[ref] = td
    sin_doc = sum(1 for s in filas_stub if not (s["_doc"] and (s["_doc"] in doc_to_uuid or dry)))
    print(f"\n[4] Stubs historicos: {len(filas_stub)}  (sin match de documento: {sin_doc} -> cliente sintetico)")
    if not dry and filas_stub:
        # cliente sintetico para huerfanos sin documento matcheable
        rep = upsert(db, "clientes", [{
            "disapp_id": "SYNTH:historico", "nombre": "(histórico sin identificar)",
            "documento": None, "activo": False,
        }], "disapp_id")
        synth_uuid = rep[0]["id"] if rep else None
        for s in filas_stub:
            s["cliente_id"] = doc_to_uuid.get(s["_doc"]) or synth_uuid
            s["cobrador_id"] = vtexto_to_uuid.get(s["_vend"])
        limpio = [{k: v for k, v in s.items() if not k.startswith("_")} for s in filas_stub]
        rep = upsert(db, "prestamos", limpio, "disapp_credit_id")
        for row in rep:
            if row.get("disapp_credit_ref"):
                ref_to_uuid[row["disapp_credit_ref"]] = row["id"]

    # ── 5. Pagos ────────────────────────────────────────────────────────────
    filas_pago, sin_prestamo, clamps = [], 0, 0
    for p in d["pagos"].values():
        pid = ref_to_uuid.get(p["ref"]) if not dry else "?"
        if not dry and not pid:
            sin_prestamo += 1; continue
        td = ref_total_dias.get(p["ref"], 10**6)
        dc = p["cuota_num"] or 1
        if dc > td:
            dc = td; clamps += 1
        if dc < 1:
            dc = 1
        filas_pago.append({
            "prestamo_id": pid, "dia_credito": dc, "monto": p["monto"] or 0.01,
            "registrado_por": vtexto_to_uuid.get(p["vendedor"]),
            "registrado_en": iso_ts(p["fecha"]) or iso_ts(dt.date.today()),
            "origen": "disapp_import", "importado_en": dt.datetime.now().isoformat(),
            "disapp_pago_id": p["id_pago"], "disapp_credit_ref": p["ref"],
        })
    print(f"\n[5] Pagos: {len(filas_pago)}  (sin prestamo: {sin_prestamo}, dia_credito clamped: {clamps})")
    if not dry:
        upsert(db, "pagos", filas_pago, "disapp_pago_id", ignore=True, rep=False)

    print("\n" + ("=== DRY-RUN OK (no se escribio nada) ===" if dry
                  else "=== COMMIT COMPLETO ==="))

# ══ VALIDATE ════════════════════════════════════════════════════════════════
def count_rows(db, table, params=None):
    q = {"select": "id", "limit": 1}
    if params:
        q.update(params)
    url = db["url"] + "/rest/v1/" + table + "?" + urllib.parse.urlencode(q)
    req = urllib.request.Request(url, method="GET")
    req.add_header("apikey", db["key"]); req.add_header("Authorization", "Bearer " + db["key"])
    req.add_header("Prefer", "count=exact")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            cr = resp.headers.get("Content-Range", "")
            return int(cr.split("/")[-1]) if "/" in cr else None
    except urllib.error.HTTPError:
        return None

def validate_sample(db, n):
    import random
    print("\n=== RECONCILIACION (contra la DB de prueba) ===")
    print(f"  clientes:            {count_rows(db, 'clientes')}")
    print(f"  cobradores/usuarios: {count_rows(db, 'usuarios')}")
    print(f"  prestamos totales:   {count_rows(db, 'prestamos')}")
    print(f"    · activos:         {count_rows(db, 'prestamos', {'estado':'eq.activo'})}")
    print(f"    · finalizados:     {count_rows(db, 'prestamos', {'estado':'eq.finalizado'})}")
    print(f"  pagos:               {count_rows(db, 'pagos')}")

    print(f"\n=== VALIDACION: {n} creditos ACTIVOS al azar (compará contra Disapp) ===")
    # Muestreo sobre creditos activos (los que definen el carton de go-live).
    act = get_rows(db, "prestamos", "id,cliente_id,cuota_diaria,total_dias,disapp_credit_ref",
                   {"estado": "eq.activo"})
    for pr in random.sample(act, min(n, len(act))):
        cli = get_rows(db, "clientes", "nombre", {"id": f"eq.{pr['cliente_id']}", "limit": 1})
        nombre = cli[0]["nombre"] if cli else "?"
        pagos = get_rows(db, "pagos", "monto", {"prestamo_id": f"eq.{pr['id']}", "anulado": "eq.false"})
        pagado = sum(float(x["monto"]) for x in pagos)
        total = float(pr["cuota_diaria"]) * int(pr["total_dias"])
        print(f"  {nombre[:30]:30} {str(pr['disapp_credit_ref'] or ''):>12}  "
              f"pagado ${pagado:>11,.0f} / total ${total:>11,.0f}  "
              f"saldo ${max(0,total-pagado):>11,.0f}  ({len(pagos)} pagos)")

# ══ main ════════════════════════════════════════════════════════════════════
def main():
    ap = argparse.ArgumentParser(description="Empalme Disapp -> Presta Ya")
    ap.add_argument("--src", default=DEFAULT_SRC)
    ap.add_argument("--out", default=None)
    ap.add_argument("--env-file", default=".env.prueba")
    ap.add_argument("--audit", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--prod", action="store_true")
    ap.add_argument("--validate-sample", type=int, default=0)
    a = ap.parse_args()
    out = a.out or os.path.join(a.src, "_reportes")
    if not os.path.isdir(a.src):
        sys.exit(f"No existe la carpeta de datos: {a.src}")

    if a.audit:
        audit(a.src, out)
        return

    # write path (dry-run por defecto)
    dry = not a.commit
    db = None
    if a.commit or a.validate_sample:
        env = load_env(a.env_file)
        url = env.get("SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL")
        key = env.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            sys.exit(f"Faltan SUPABASE_URL/SERVICE_ROLE_KEY en {a.env_file}")
        host = urllib.parse.urlparse(url).netloc
        es_prueba = any(x in os.path.basename(a.env_file).lower() for x in ("prueba", "test"))
        print(f"Destino: {host}  (.env: {a.env_file})")
        if a.commit and not es_prueba and not a.prod:
            sys.exit("ABORTADO: el .env no parece de prueba y no pasaste --prod.")
        db = {"url": url.rstrip("/"), "key": key, "host": host}

    if a.validate_sample and not a.commit:
        validate_sample(db, a.validate_sample)
        return

    commit_import(a.src, out, db, dry)
    if a.commit and a.validate_sample:
        validate_sample(db, a.validate_sample)

if __name__ == "__main__":
    main()
