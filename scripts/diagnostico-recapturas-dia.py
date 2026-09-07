# -*- coding: utf-8 -*-
"""
DIAGNÓSTICO de la guardia por DÍA del empalme. Solo lectura.

`empalme-0804.py` descarta como "recaptura" todo recaudo de Disapp cuyo
(crédito, día) ya tenga un pago nativo de la app — SIN mirar el monto. Eso es
correcto cuando es el mismo cobro anotado en los dos sistemas, y es PLATA REAL
TIRADA cuando ese día hubo dos cobros distintos (dos visitas, o un abono en la
app y la cuota completa en Disapp).

Este script replica el mismo predicado sobre los exports que hay en la carpeta
y parte las recapturas en tres:
  · MISMO MONTO que un pago de la app ese día      → el mismo cobro, descarte justo
  · la app suma ese día ≥ lo de Disapp (partido)    → cubierto, descarte justo
  · OTRO MONTO y la app NO lo cubre                 → AMBIGUO: a revisión humana

  python scripts/diagnostico-recapturas-dia.py                 → informe
  python scripts/diagnostico-recapturas-dia.py --csv           → + CSV para revisar
  python scripts/diagnostico-recapturas-dia.py --desde 2026-08-16
"""
import argparse
import csv
import datetime as dt
import io
import os
import re
import ssl
import sys
from collections import defaultdict
from urllib.parse import unquote

import pg8000.dbapi

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import empalme_disapp as E  # noqa: E402  (parsers de los xlsx, sin tocar la base)

UY = dt.timezone(dt.timedelta(hours=-3))


def conectar(envf):
    with open(os.path.join(RAIZ, envf), encoding="utf-8") as fh:
        url = next(l.split("=", 1)[1].strip().strip('"').strip("'")
                   for l in fh if l.startswith("SUPABASE_DB_URL="))
    m = re.match(r"postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+):(\d+)/(.+)", url)
    usr, pw, host, port, base = m.groups()
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return pg8000.dbapi.connect(user=unquote(usr), password=unquote(pw), host=host,
                                port=int(port), database=base.split("?")[0], ssl_context=ctx)


def money(n):
    return "$" + f"{round(float(n or 0)):,}".replace(",", ".")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=r"C:\Users\Carlos\migracion")
    ap.add_argument("--env-file", default=".env.local")
    ap.add_argument("--desde", default="2026-08-05", help="PILOTO_DESDE del empalme")
    ap.add_argument("--csv", action="store_true")
    a = ap.parse_args()
    desde = dt.date.fromisoformat(a.desde)

    print("  leyendo exports…")
    pagos, archivos = E.load_pagos(a.src)
    print(f"  {len(pagos):,} recaudos distintos en {len(archivos)} archivos")

    cn = conectar(a.env_file)
    cur = cn.cursor()

    # ref de Disapp → préstamo (mismo mapeo que el empalme: by_ref_db).
    cur.execute("select id, disapp_credit_ref, cliente_id, cobrador_id from prestamos where disapp_credit_ref is not null")
    ref2p = {}
    for pid, ref, cli, cob in cur.fetchall():
        ref2p[str(ref)] = (str(pid), str(cli), str(cob) if cob else None)

    # Folios ya importados: esos no son candidatos, el empalme los saltea antes.
    cur.execute("select disapp_pago_id from pagos where disapp_pago_id is not null")
    ya = {str(r[0]) for r in cur.fetchall()}

    # Pagos NATIVOS por (préstamo, día UY) → lista de montos. Misma ventana que el empalme.
    cur.execute("""
        select prestamo_id::text, (registrado_en at time zone 'America/Montevideo')::date, monto
          from pagos where anulado=false and origen is null and registrado_en >= %s
    """, (desde.isoformat(),))
    nativo_dia = defaultdict(list)
    for pid, d, m in cur.fetchall():
        nativo_dia[(pid, d)].append(float(m))

    cur.execute("select id::text, nombre from clientes")
    nombres_cli = dict(cur.fetchall())
    cur.execute("select id::text, nombre from usuarios")
    nombres_u = dict(cur.fetchall())
    cur.close()
    cn.close()

    # ── El predicado del empalme, replicado ────────────────────────────────
    mismo, partido, ambiguo, entran = [], [], [], 0
    for p in pagos.values():
        if p["id_pago"] in ya or not p["fecha"] or p["fecha"] < desde:
            continue
        t = ref2p.get(p["ref"])
        if not t:
            continue
        pid, cli, cob = t
        app = nativo_dia.get((pid, p["fecha"]))
        if not app:
            entran += 1
            continue
        m = float(p["monto"] or 0)
        fila = {
            "fecha": p["fecha"], "cliente": nombres_cli.get(cli, "?"),
            "cobrador": nombres_u.get(cob, "?") if cob else "?",
            "ref": p["ref"], "folio": p["id_pago"], "disapp": m,
            "app_montos": app, "app_suma": sum(app), "cuota": p["cuota_num"],
        }
        if any(abs(x - m) < 0.5 for x in app):
            mismo.append(fila)
        elif sum(app) + 0.5 >= m:
            partido.append(fila)
        else:
            ambiguo.append(fila)

    print("\n" + "=" * 80)
    print(f"  RECAPTURAS POR DÍA (recaudos de Disapp ≥ {desde} que el empalme descarta)")
    print("=" * 80)
    tot = len(mismo) + len(partido) + len(ambiguo)
    print(f"  candidatos que ENTRAN (sin pago de la app ese día): {entran:,}")
    print(f"  recapturas totales: {tot:,}")
    print(f"     mismo monto que la app ese día     {len(mismo):>5}  {money(sum(f['disapp'] for f in mismo)):>12}  → descarte justo")
    print(f"     la app cubre la suma (partido)     {len(partido):>5}  {money(sum(f['disapp'] for f in partido)):>12}  → descarte justo")
    print(f"     OTRO monto, la app NO lo cubre     {len(ambiguo):>5}  {money(sum(f['disapp'] for f in ambiguo)):>12}  → AMBIGUO")
    if tot:
        print(f"  ambiguo = {100.0 * len(ambiguo) / tot:.1f}% de las recapturas")

    if ambiguo:
        print("\n  AMBIGUOS por cobrador:")
        por_cob = defaultdict(lambda: [0, 0.0])
        for f in ambiguo:
            por_cob[f["cobrador"]][0] += 1
            por_cob[f["cobrador"]][1] += f["disapp"]
        for cob, (n, s) in sorted(por_cob.items(), key=lambda kv: -kv[1][1]):
            print(f"     {str(cob)[:24]:24} {n:>4}  {money(s):>12}")
        print("\n  primeros 20 (Disapp vs lo que la app tiene ese día):")
        print(f"  {'fecha':10} {'cliente':26} {'cobrador':16} {'disapp':>9}  app ese día")
        for f in sorted(ambiguo, key=lambda x: -x["disapp"])[:20]:
            apps = " + ".join(money(x) for x in f["app_montos"])
            print(f"  {str(f['fecha']):10} {str(f['cliente'])[:26]:26} {str(f['cobrador'])[:16]:16} {money(f['disapp']):>9}  {apps}")

    if a.csv:
        ruta = os.path.join(HERE, f"_recapturas_ambiguas_{dt.date.today():%Y%m%d}.csv")
        with open(ruta, "w", newline="", encoding="utf-8-sig") as fh:
            w = csv.writer(fh, delimiter=";")
            w.writerow(["clase", "fecha", "cliente", "cobrador", "credito_ref", "folio_disapp",
                        "cuota_disapp", "monto_disapp", "montos_app_ese_dia", "suma_app"])
            for clase, lst in (("ambiguo", ambiguo), ("partido", partido), ("mismo", mismo)):
                for f in lst:
                    w.writerow([clase, f["fecha"], f["cliente"], f["cobrador"], f["ref"], f["folio"],
                                f["cuota"], round(f["disapp"]),
                                " + ".join(str(round(x)) for x in f["app_montos"]), round(f["app_suma"])])
        print(f"\n  CSV: {ruta}")

    print("\n  ⚠️ SOLO LECTURA. No se tocó nada.\n")


if __name__ == "__main__":
    main()
