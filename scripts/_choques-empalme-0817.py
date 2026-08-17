# -*- coding: utf-8 -*-
# SOLO LECTURA: ¿qué cobradores usaron la APP en el hueco (06-08 → 16-08) y
# cuánto de lo de Disapp choca con ellos? Decide el cruce POR COBRADOR.
import os, re, ssl, sys, glob, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pg8000.native
from empalme_disapp import load_pagos  # mismo parseo que el importador

def leer_env(ruta):
    with open(ruta, encoding="utf-8") as f:
        for l in f:
            m = re.match(r"^SUPABASE_DB_URL=(.+)$", l.strip())
            if m: return m.group(1).strip().strip('"').strip("'")
url = leer_env(r"c:\Users\Carlos\Desktop\prestaya\.env.local")
m = re.match(r"postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+):(\d+)/(.+)", url)
u, p, h, pt, bd = m.groups()
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
con = pg8000.native.Connection(u, host=h, port=int(pt), database=bd.split("?")[0], password=p, ssl_context=ctx)

DESDE = dt.date(2026, 8, 6)
# 1) Pagos NATIVOS de la app en el hueco, por cobrador y día
print("=== APP: pagos nativos por cobrador (06-08 → hoy) ===")
app = {}
for r in con.run("""
  select u.nombre, (pg.registrado_en at time zone 'America/Montevideo')::date d, count(*), sum(pg.monto)::bigint
  from pagos pg join usuarios u on u.id = pg.registrado_por
  where pg.anulado=false and pg.origen is null and pg.registrado_en >= '2026-08-06 03:00+00'
  group by 1,2 order by 1,2
"""):
    app.setdefault(r[0], []).append((r[1], r[2], r[3]))
for cob, dias in sorted(app.items(), key=lambda kv: -sum(x[2] for x in kv[1])):
    tot = sum(x[2] for x in dias); n = sum(x[1] for x in dias)
    print(f"  {cob:32} {n:5} pagos  ${tot:>10,}  dias={len(dias)}")
print("  cobradores con actividad en la app:", len(app))

# 2) Disapp: recaudos del export por vendedor (nombre Disapp) en el hueco
print("\n=== DISAPP export: recaudos por vendedor (>= 06-08) ===")
src = r"C:\Users\Carlos\migracion"
recs, _files = load_pagos(src)
por_v = {}
for rc in recs.values():
    f = rc.get("fecha")
    if not f or f < DESDE: continue
    v = rc.get("vendedor") or "?"
    a = por_v.setdefault(v, [0, 0])
    a[0] += 1; a[1] += rc.get("monto") or 0
for v, (n, t) in sorted(por_v.items(), key=lambda kv: -kv[1][1]):
    print(f"  {v:32} {n:5} pagos  ${t:>10,}")
con.close()
