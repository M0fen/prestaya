#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SHADOW-MODE — diff diario Presta Ya vs Disapp (la fuente de verdad durante el piloto).

"En una migración, el legado sigue siendo autoritativo y cada día se DIFFEA viejo vs
nuevo; recién cuando coinciden N días seguidos, el nuevo gana la autoridad." Este
script compara, por crédito, lo que Presta Ya tiene contra el export FRESCO de Disapp
(columna Pagos = abonado, Saldo Pendiente), y reporta si estamos en sync.

NO escribe nada: solo LEE y compara.

  python scripts/shadow-disapp.py --src "C:\\Users\\Carlos\\migracion\\creditos_YYYY-MM-DD.xlsx"
    --env-file .env.prueba   (default: el creditos más nuevo de la carpeta migracion)
"""
import sys, os, glob, json, urllib.request
import openpyxl

def arg(flag, default=None):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import empalme_disapp as E

ENVF = arg("--env-file", ".env.prueba")
SRC = arg("--src")
if not SRC:
    cands = sorted(glob.glob(r"C:\Users\Carlos\migracion\creditos_*.xlsx"))
    if not cands:
        sys.exit("No encontré un creditos_*.xlsx en migracion; pasá --src PATH")
    SRC = cands[-1]

env = E.load_env(ENVF)
url = (env.get("SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL")).rstrip("/")
key = env.get("SUPABASE_SERVICE_ROLE_KEY")
H = {"apikey": key, "Authorization": "Bearer " + key}

def num(v):
    if v is None: return 0.0
    if isinstance(v, (int, float)): return float(v)
    s = str(v).strip().replace(".", "").replace(",", ".")
    try: return float(s)
    except: return 0.0

def fetch(path):
    out = []; s = 0
    while True:
        req = urllib.request.Request(url + "/rest/v1/" + path, headers={**H, "Range": f"{s}-{s+999}"})
        with urllib.request.urlopen(req) as r: ch = json.loads(r.read() or "[]")
        out += ch
        if len(ch) < 1000: break
        s += 1000
    return out

print(f"SHADOW-MODE — Presta Ya vs Disapp\n  export: {os.path.basename(SRC)}\n  base:   {url.split('//')[1].split('.')[0]}")

# ── Disapp (fuente de verdad): ref -> pagos, saldo ──
wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
ws = wb.worksheets[0]; rows = list(ws.iter_rows(values_only=True)); hdr = [str(h) for h in rows[0]]
def ci(sub):
    for i, h in enumerate(hdr):
        if sub.lower() in h.replace("�", "").lower(): return i
iPag = ci("Pagos"); iSaldo = ci("Saldo"); iRef = 1
disapp = {}
for r in rows[1:]:
    if r[0] is None: continue
    disapp[str(r[iRef]).strip()] = {"pagos": num(r[iPag]), "saldo": num(r[iSaldo])}
wb.close()

# ── Presta Ya: créditos activos ──
pres = fetch("prestamos?select=disapp_credit_ref,cuota_diaria,total_dias,pagado_acum&estado=eq.activo&order=id.asc")
def N(v): return round(float(v or 0))

matched = insync = atras = adelante = sinmatch = 0
drift_atras = drift_adelante = 0
peores = []
cartera_ny = cartera_disapp = 0
for p in pres:
    ref = p.get("disapp_credit_ref")
    d = disapp.get(ref) if ref else None
    ny_pagado = N(p["pagado_acum"])
    ny_saldo = N(p["cuota_diaria"]) * int(p["total_dias"] or 0) - ny_pagado
    cartera_ny += max(0, ny_saldo)
    if d is None:
        sinmatch += 1
        continue
    matched += 1
    cartera_disapp += max(0, round(d["saldo"]))
    dr = round(d["pagos"]) - ny_pagado  # >0 = Disapp cobró más (estamos atrás)
    if dr == 0: insync += 1
    elif dr > 0:
        atras += 1; drift_atras += dr
        peores.append((ref, ny_pagado, round(d["pagos"]), dr))
    else:
        adelante += 1; drift_adelante += -dr

print(f"\n  créditos activos Presta Ya: {len(pres)}  · matcheados con Disapp: {matched}  · sin match: {sinmatch}")
print(f"  EN SYNC (pagado idéntico): {insync}")
print(f"  ATRÁS (Disapp cobró más → nos faltan recaudos): {atras}  ·  ${drift_atras:,.0f}")
print(f"  ADELANTE (tenemos MÁS que Disapp → revisar): {adelante}  ·  ${drift_adelante:,.0f}")
print(f"\n  CARTERA (saldo de activos matcheados):  Presta Ya ${cartera_ny:,.0f}  vs  Disapp ${cartera_disapp:,.0f}")
gap = cartera_ny - cartera_disapp
print(f"  gap de cartera: ${gap:,.0f}  (nota: refleja la diferencia de MODELO — nuestro")
print(f"     cuota×días vs el 'Saldo Pendiente' con intereses de Disapp — no necesariamente plata perdida)")

if peores:
    print("\n  Créditos ADELANTE (tenemos más que Disapp) — a revisar (ref, nuestro, Disapp, de más):")
    for x in sorted(peores, key=lambda t: -t[3])[:10]:
        print(f"    {x[0]}  {x[1]:>10,} vs {x[2]:>10,}  → de más ${x[3]:,}")

# El veredicto se basa en el PAGADO (comparable directo); el "adelante" pesa por monto.
adel_pct = (drift_adelante / cartera_disapp) if cartera_disapp else 0
if atras == 0 and adelante == 0:
    veredicto = "✅ EN SYNC con Disapp (mismo pagado en todos los créditos matcheados)"
elif adelante == 0:
    veredicto = "🟡 Al día o faltan recaudos nuevos (esperable si Disapp tiene cobros más recientes)"
elif adel_pct < 0.001:
    veredicto = f"🟡 {adelante} crédito(s) levemente ADELANTE (${drift_adelante:,}, <0.1% — a revisar sin urgencia)"
else:
    veredicto = f"🔴 {adelante} crédito(s) ADELANTE de Disapp por ${drift_adelante:,} — revisar"
print(f"\n  VEREDICTO: {veredicto}")
sys.exit(0 if adel_pct < 0.001 else 1)
