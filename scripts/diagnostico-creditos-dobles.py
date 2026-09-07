# -*- coding: utf-8 -*-
"""
DIAGNÓSTICO: ¿cuántos de los créditos que el empalme va a CREAR ya existen en la
app como crédito NATIVO del mismo cliente? Solo lectura.

El empalme crea todo crédito activo del export que no matchea ni por
disapp_credit_id ni por ref. Un crédito colocado desde la app no tiene ninguno de
los dos, así que si el cobrador lo anotó TAMBIÉN en Disapp (doble libro durante
la transición), el empalme lo crea de nuevo: el cliente queda con dos créditos
por la misma plata. Ya pasó (ALBERTO SARI SOSA).

  python scripts/diagnostico-creditos-dobles.py            → informe
  python scripts/diagnostico-creditos-dobles.py --csv      → + CSV para revisar
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=r"C:\Users\Carlos\migracion")
    ap.add_argument("--env-file", default=".env.local")
    ap.add_argument("--csv", action="store_true")
    a = ap.parse_args()

    print("  leyendo export de créditos…")
    creditos, vendedores, _ = E.load_creditos(a.src)
    activos_exp = {cid: c for cid, c in creditos.items()
                   if (c.get("estado_disapp") or "").lower() in ("activo", "")}
    print(f"  {len(activos_exp):,} créditos activos en el export")

    cn = conectar(a.env_file)
    cur = cn.cursor()
    cur.execute("select id::text, disapp_id from clientes where disapp_id is not null")
    cli_de = {str(d): cid for cid, d in cur.fetchall()}
    cur.execute("""
        select id::text, cliente_id::text, cobrador_id::text, disapp_credit_id, disapp_credit_ref,
               estado, monto_prestado, cuota_diaria, total_dias, fecha_inicio, creado_por::text, creado_en
          from prestamos
    """)
    pres = cur.fetchall()
    ids_db = {str(p[3]) for p in pres if p[3]}
    refs_db = {str(p[4]) for p in pres if p[4]}
    # Créditos NATIVOS activos por cliente (sin ref ni id de Disapp).
    nativos_por_cli = defaultdict(list)
    for p in pres:
        if p[5] == "activo" and not p[3] and not p[4]:
            nativos_por_cli[p[1]].append(p)
    cur.execute("select id::text, nombre from clientes")
    nombres_cli = dict(cur.fetchall())
    cur.execute("select id::text, nombre, disapp_vendedor_id from usuarios")
    usuarios = cur.fetchall()
    nombres_u = {u[0]: u[1] for u in usuarios}
    vend_map = {str(u[2]): u[0] for u in usuarios if u[2]}
    cur.close()
    cn.close()

    # Los que el empalme va a CREAR (misma condición que faltan_creds).
    a_crear = [c for c in activos_exp.values()
               if c["ref"] not in refs_db and c["disapp_credit_id"] not in ids_db]
    print(f"  a crear (no matchean ni ref ni id): {len(a_crear):,}")

    dobles, sin_cliente, sin_vendedor = [], [], defaultdict(lambda: [0, 0.0])
    for c in a_crear:
        if c["id_vendedor"] and c["id_vendedor"] not in vend_map:
            sin_vendedor[(c["id_vendedor"], c.get("vendedor"))][0] += 1
            sin_vendedor[(c["id_vendedor"], c.get("vendedor"))][1] += float(c["monto_prestado"] or 0)
        cid = cli_de.get(str(c["id_cliente"] or ""))
        if not cid:
            sin_cliente.append(c)
            continue
        nat = nativos_por_cli.get(cid)
        if not nat:
            continue
        for n in nat:
            monto_n = float(n[6] or 0)
            monto_e = float(c["monto_prestado"] or 0)
            fecha_n = n[9] if isinstance(n[9], dt.date) else (dt.date.fromisoformat(str(n[9])[:10]) if n[9] else None)
            dias = abs((c["fecha"] - fecha_n).days) if (c["fecha"] and fecha_n) else None
            mismo_monto = abs(monto_n - monto_e) < 0.5
            dobles.append({
                "cliente": nombres_cli.get(cid, "?"), "cliente_id": cid,
                "ref_disapp": c["ref"], "monto_disapp": monto_e, "fecha_disapp": c["fecha"],
                "vendedor_disapp": c.get("vendedor"),
                "prestamo_app": n[0], "monto_app": monto_n, "fecha_app": fecha_n,
                "cobrador_app": nombres_u.get(n[2], "?"),
                "mismo_monto": mismo_monto, "dias": dias,
                "veredicto": ("MISMO CRÉDITO (monto igual, ≤7 días)" if mismo_monto and dias is not None and dias <= 7
                              else "probable (monto igual)" if mismo_monto
                              else "dudoso (otro monto)"),
            })

    print("\n" + "=" * 80)
    print("  CRÉDITOS A CREAR cuyo cliente YA tiene un crédito NATIVO activo en la app")
    print("=" * 80)
    por_v = defaultdict(lambda: [0, 0.0])
    for d in dobles:
        por_v[d["veredicto"]][0] += 1
        por_v[d["veredicto"]][1] += d["monto_disapp"]
    for v, (n, s) in sorted(por_v.items(), key=lambda kv: -kv[1][0]):
        print(f"  {v:40} {n:>5}  {money(s):>13}")
    print(f"  TOTAL con crédito nativo activo del mismo cliente: {len(dobles)} de {len(a_crear)}")
    print(f"  a crear sin cliente en la app (irán como cliente nuevo): {len(sin_cliente)}")

    if dobles:
        print("\n  por cobrador de la app (los que llevan doble libro):")
        pc = defaultdict(lambda: [0, 0.0])
        for d in dobles:
            pc[d["cobrador_app"]][0] += 1
            pc[d["cobrador_app"]][1] += d["monto_disapp"]
        for cob, (n, s) in sorted(pc.items(), key=lambda kv: -kv[1][0]):
            print(f"     {str(cob)[:24]:24} {n:>4}  {money(s):>12}")
        print("\n  primeros 15:")
        print(f"  {'cliente':26} {'app':>9} {'fecha app':10} {'disapp':>9} {'fecha dis':10} {'días':>4}  veredicto")
        for d in sorted(dobles, key=lambda x: (x['dias'] if x['dias'] is not None else 999))[:15]:
            print(f"  {str(d['cliente'])[:26]:26} {money(d['monto_app']):>9} {str(d['fecha_app']):10} "
                  f"{money(d['monto_disapp']):>9} {str(d['fecha_disapp']):10} {str(d['dias']):>4}  {d['veredicto']}")

    print("\n" + "=" * 80)
    print("  VENDEDORES DE DISAPP SIN USUARIO EN LA APP (sus créditos NO se crean)")
    print("=" * 80)
    for (idv, nom), (n, s) in sorted(sin_vendedor.items(), key=lambda kv: -kv[1][0]):
        print(f"  {str(idv):8} {str(nom)[:36]:36} {n:>4} créditos  {money(s):>12}")
    print(f"  total: {sum(v[0] for v in sin_vendedor.values())} créditos, "
          f"{money(sum(v[1] for v in sin_vendedor.values()))}")

    if a.csv and dobles:
        ruta = os.path.join(HERE, f"_creditos_dobles_{dt.date.today():%Y%m%d}.csv")
        with open(ruta, "w", newline="", encoding="utf-8-sig") as fh:
            w = csv.writer(fh, delimiter=";")
            w.writerow(list(dobles[0].keys()))
            for d in dobles:
                w.writerow([d[k] for k in dobles[0].keys()])
        print(f"\n  CSV: {ruta}")
    print("\n  ⚠️ SOLO LECTURA. No se tocó nada.\n")


if __name__ == "__main__":
    main()
