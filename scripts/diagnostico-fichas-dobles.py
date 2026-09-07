# -*- coding: utf-8 -*-
"""
DIAGNÓSTICO: la MISMA persona con DOS fichas y DOS créditos vivos por la misma
plata. Solo lectura — propone, no ejecuta.

El incidente (06-09): el empalme creó una ficha nueva (origen 'oficina',
documento NULL porque la cédula "chocaba") para un cliente que YA existía como
ficha de censo (sin disapp_id) con un crédito nativo activo del MISMO cobrador,
MISMO monto, a 1-2 días. Resultado: dos deudas por un préstamo, las dos en ruta.

Criterio: crédito activo importado (creado_por NULL, con ref de Disapp) sobre
una ficha SIN documento, y otra ficha activa con crédito NATIVO activo del mismo
cobrador y mismo monto, cuya cédula coincide con la del cliente en el export de
Disapp (o cuyo nombre normalizado coincide, marcado como "por nombre").

  python scripts/diagnostico-fichas-dobles.py           → informe
  python scripts/diagnostico-fichas-dobles.py --csv     → + CSV con la propuesta
"""
import argparse
import csv
import datetime as dt
import io
import os
import re
import ssl
import sys
import unicodedata
from urllib.parse import unquote

import pg8000.dbapi

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import empalme_disapp as E  # noqa: E402


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


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z ]", "", s.upper()).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=r"C:\Users\Carlos\migracion")
    ap.add_argument("--env-file", default=".env.local")
    ap.add_argument("--csv", action="store_true")
    a = ap.parse_args()

    clientes_exp, _, _ = E.load_clientes(a.src)
    doc_exp = {did: (c.get("documento_original") or "").strip() for did, c in clientes_exp.items()}

    cn = conectar(a.env_file)
    cur = cn.cursor()
    cur.execute("""
        select c.id::text, c.nombre, c.documento, c.disapp_id, c.origen, c.activo
          from clientes c
    """)
    fichas = {r[0]: {"id": r[0], "nombre": r[1], "documento": (r[2] or "").strip(), "disapp_id": r[3],
                     "origen": r[4], "activo": r[5]} for r in cur.fetchall()}
    cur.execute("""
        select p.id::text, p.cliente_id::text, p.cobrador_id::text, p.disapp_credit_ref, p.creado_por::text,
               p.monto_prestado, p.pagado_acum, p.fecha_inicio, p.creado_en
          from prestamos p where p.estado = 'activo'
    """)
    activos = [{"id": r[0], "cliente": r[1], "cobrador": r[2], "ref": r[3], "creado_por": r[4],
                "monto": float(r[5] or 0), "pagado": float(r[6] or 0),
                "fecha": r[7] if isinstance(r[7], dt.date) else None, "creado_en": r[8]} for r in cur.fetchall()]
    cur.execute("select id::text, nombre from usuarios")
    nombres_u = dict(cur.fetchall())
    cur.execute("""
        select prestamo_id::text, count(*), coalesce(sum(monto),0)
          from pagos where anulado=false group by 1
    """)
    pagos_por = {r[0]: (r[1], float(r[2])) for r in cur.fetchall()}
    cur.execute("select cliente_id::text, cobrador_id::text, activo from asignaciones")
    asig = {}
    for cli, cob, act in cur.fetchall():
        asig.setdefault(cli, []).append((cob, act))
    cur.close()
    cn.close()

    # Índices: nativos activos por (documento) y por (nombre normalizado)
    por_doc, por_nombre = {}, {}
    for p in activos:
        if p["ref"] or not p["creado_por"]:
            continue
        f = fichas.get(p["cliente"])
        if not f:
            continue
        if f["documento"]:
            por_doc.setdefault(f["documento"], []).append((p, f))
        por_nombre.setdefault(norm(f["nombre"]), []).append((p, f))

    hallados = []
    for p in activos:
        if not p["ref"] or p["creado_por"]:
            continue  # solo importados
        f = fichas.get(p["cliente"])
        if not f or f["documento"]:
            continue  # la ficha importada CON documento no es el caso
        cedula = doc_exp.get(str(f["disapp_id"] or ""), "")
        candidatos = []
        via = None
        if cedula and cedula in por_doc:
            candidatos = por_doc[cedula]
            via = "cédula"
        elif norm(f["nombre"]) in por_nombre:
            candidatos = por_nombre[norm(f["nombre"])]
            via = "nombre"
        for n, fn in candidatos:
            if fn["id"] == f["id"]:
                continue
            mismo_cob = n["cobrador"] == p["cobrador"]
            mismo_monto = abs(n["monto"] - p["monto"]) < 0.5
            dias = abs((p["fecha"] - n["fecha"]).days) if (p["fecha"] and n["fecha"]) else None
            hallados.append({
                "via": via, "cobrador": nombres_u.get(p["cobrador"], "?"),
                "ref_import": p["ref"], "prestamo_import": p["id"], "ficha_import": f["id"],
                "nombre_import": f["nombre"], "monto_import": p["monto"], "pagado_import": p["pagado"],
                "pagos_import": pagos_por.get(p["id"], (0, 0.0))[0],
                "prestamo_nativo": n["id"], "ficha_nativa": fn["id"], "nombre_nativo": fn["nombre"],
                "cedula": cedula or fn["documento"], "monto_nativo": n["monto"], "pagado_nativo": n["pagado"],
                "pagos_nativo": pagos_por.get(n["id"], (0, 0.0))[0],
                "mismo_cobrador": mismo_cob, "mismo_monto": mismo_monto, "dias": dias,
                "asig_ficha_import": [(nombres_u.get(c, "?"), act) for c, act in asig.get(f["id"], [])],
                "veredicto": ("MISMO PRÉSTAMO" if via == "cédula" and mismo_cob and mismo_monto and (dias is None or dias <= 7)
                              else "probable" if mismo_cob and mismo_monto
                              else "revisar"),
            })

    print("=" * 84)
    print("  LA MISMA PERSONA CON DOS FICHAS Y DOS CRÉDITOS ACTIVOS")
    print("=" * 84)
    por_v = {}
    for h in hallados:
        por_v.setdefault(h["veredicto"], []).append(h)
    for v, lst in sorted(por_v.items()):
        print(f"  {v:16} {len(lst):>3}  capital importado {money(sum(h['monto_import'] for h in lst))}")
    print(f"\n  {'veredicto':14} {'vía':7} {'cobrador':16} {'ref import':15} {'monto':>9} {'pag.imp':>8} {'pag.nat':>8} {'días':>4}  cliente")
    print("  " + "-" * 100)
    for h in sorted(hallados, key=lambda x: (x["veredicto"], x["cobrador"])):
        print(f"  {h['veredicto']:14} {h['via']:7} {str(h['cobrador'])[:16]:16} {h['ref_import']:15} {money(h['monto_import']):>9} "
              f"{money(h['pagado_import']):>8} {money(h['pagado_nativo']):>8} {str(h['dias']):>4}  {h['nombre_import'][:28]}")

    print("\n  PROPUESTA (no ejecutada) para cada 'MISMO PRÉSTAMO':")
    print("     1. prestamos(import).estado → 'cancelado' (motivo: ficha doble del empalme 06-09, la app manda)")
    print("     2. pagos del import → anulado=true (motivo idem); el nativo conserva los suyos")
    print("     3. asignaciones de la ficha importada → activo=false; clientes(import).activo=false")
    print("     4. si el nativo NO tiene ref: PATCH disapp_credit_ref/id del import al nativo")
    print("        (así los recaudos futuros de Disapp le llegan al nativo por el camino normal)")
    print("  Nada se borra. Todo queda con rastro en auditoría.")

    if a.csv:
        ruta = os.path.join(HERE, f"_fichas_dobles_{dt.date.today():%Y%m%d}.csv")
        with open(ruta, "w", newline="", encoding="utf-8-sig") as fh:
            w = csv.writer(fh, delimiter=";")
            cols = list(hallados[0].keys()) if hallados else []
            w.writerow(cols)
            for h in hallados:
                w.writerow([h[c] for c in cols])
        print(f"\n  CSV: {ruta}")
    print("\n  ⚠️ SOLO LECTURA. No se tocó nada.\n")


if __name__ == "__main__":
    main()
