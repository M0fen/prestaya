# -*- coding: utf-8 -*-
"""
VERIFICACIÓN POST-EMPALME: ¿la base quedó como dice Disapp? Solo lectura.

Compara, crédito por crédito, el `pagado_acum` de la app contra la columna
'Pagos' del export de créditos más nuevo de la carpeta, y resume:
  · exactos / cortos / pasados (y cuánta plata en cada grupo)
  · créditos activos acá vs activos en el export
  · recaudos importados por día en la ventana (que no haya huecos)
  · créditos con pagos posteriores al último import (la app siguió sola)

  python scripts/verificar-post-empalme.py
  python scripts/verificar-post-empalme.py --desde 2026-08-16 --hasta 2026-09-06
"""
import argparse
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
    ap.add_argument("--desde", default="2026-08-16")
    ap.add_argument("--hasta", default=dt.date.today().isoformat())
    a = ap.parse_args()

    creditos, _, _ = E.load_creditos(a.src)
    activos_exp = {c["ref"]: c for c in creditos.values()
                   if c["ref"] and (c.get("estado_disapp") or "").lower() in ("activo", "")}
    print(f"  export de créditos: {len(creditos):,} filas · {len(activos_exp):,} activos con ref")

    cn = conectar(a.env_file)
    cur = cn.cursor()

    print("\n" + "=" * 78)
    print("  1. ESPEJO crédito por crédito: pagado_acum (app) vs 'Pagos' (Disapp)")
    print("=" * 78)
    cur.execute("""
        select disapp_credit_ref, pagado_acum, estado, cobrador_id::text
          from prestamos where disapp_credit_ref is not null
    """)
    app = {}
    for ref, pag, est, cob in cur.fetchall():
        app[str(ref)] = (float(pag or 0), est, cob)
    exactos, cortos, pasados, faltan = [], [], [], []
    for ref, c in activos_exp.items():
        objetivo = float(c.get("pagos_disapp") or 0)
        if ref not in app:
            faltan.append((ref, c))
            continue
        pag, est, _ = app[ref]
        d = round(pag - objetivo, 2)
        if abs(d) <= 1:
            exactos.append(ref)
        elif d < 0:
            cortos.append((ref, c, pag, objetivo))
        else:
            pasados.append((ref, c, pag, objetivo))
    tot = len(activos_exp)
    print(f"  exactos: {len(exactos):>5} ({100.0*len(exactos)/tot:.1f}%)")
    print(f"  cortos : {len(cortos):>5}  la app tiene MENOS: {money(sum(o - p for _, _, p, o in cortos))}")
    print(f"  pasados: {len(pasados):>5}  la app tiene MÁS:   {money(sum(p - o for _, _, p, o in pasados))}")
    print(f"  no están en la app: {len(faltan):>5}  (saldo Disapp {money(sum(float(c.get('saldo_pendiente') or 0) for _, c in faltan))})")
    if cortos:
        print("\n  los 10 más cortos (posible plata real que no entró):")
        for ref, c, p, o in sorted(cortos, key=lambda x: -(x[3] - x[2]))[:10]:
            print(f"     {ref:16} {str(c.get('vendedor'))[:22]:22} app {money(p):>11}  disapp {money(o):>11}  falta {money(o - p):>10}")
    if pasados:
        print("\n  los 10 más pasados (posible doble conteo):")
        for ref, c, p, o in sorted(pasados, key=lambda x: -(x[2] - x[3]))[:10]:
            print(f"     {ref:16} {str(c.get('vendedor'))[:22]:22} app {money(p):>11}  disapp {money(o):>11}  sobra {money(p - o):>10}")

    print("\n" + "=" * 78)
    print("  2. ACTIVOS: app vs export")
    print("=" * 78)
    cur.execute("select count(*), sum(monto_prestado) from prestamos where estado='activo'")
    n_act, s_act = cur.fetchone()
    print(f"  activos en la app: {n_act:,}  (capital {money(s_act)})")
    print(f"  activos en el export: {len(activos_exp):,}")
    cur.execute("select count(*) from prestamos where estado='activo' and disapp_credit_ref is null")
    print(f"  de los activos de la app, nacidos EN la app (sin ref Disapp): {cur.fetchone()[0]:,}")

    print("\n" + "=" * 78)
    print(f"  3. RECAUDOS IMPORTADOS POR DÍA ({a.desde} → {a.hasta}) — que no haya huecos")
    print("=" * 78)
    cur.execute("""
        select (registrado_en at time zone 'America/Montevideo')::date, count(*), sum(monto)
          from pagos where origen='disapp_import' and anulado=false
           and disapp_pago_id not like 'recon-%%'
           and (registrado_en at time zone 'America/Montevideo')::date between %s and %s
         group by 1 order by 1
    """, (a.desde, a.hasta))
    por_dia = {f: (n, float(s)) for f, n, s in cur.fetchall()}
    d = dt.date.fromisoformat(a.desde)
    fin = dt.date.fromisoformat(a.hasta)
    huecos = []
    while d <= fin:
        n, s = por_dia.get(d, (0, 0.0))
        tag = "dom" if d.weekday() == 6 else "   "
        print(f"  {d} {tag} {n:>5}  {money(s):>12}")
        if n == 0 and d.weekday() != 6:
            huecos.append(d)
        d += dt.timedelta(days=1)
    if huecos:
        print(f"  ⚠️ días hábiles SIN recaudos importados: {', '.join(str(h) for h in huecos)}")

    print("\n" + "=" * 78)
    print("  3b. INV10 — crédito ACTIVO cuyo dueño NO tiene al cliente en su ruta")
    print("      (exactamente lo que dejó la corrida que murió entre créditos y")
    print("       asignaciones el 06-09: créditos invisibles para todo cobrador)")
    print("=" * 78)
    cur.execute("""
        select count(*), coalesce(sum(p.cuota_diaria*p.total_dias - p.pagado_acum),0)
          from prestamos p
         where p.estado='activo' and p.cobrador_id is not null
           and not exists (select 1 from asignaciones a
                            where a.cliente_id = p.cliente_id and a.cobrador_id = p.cobrador_id
                              and a.activo = true)
    """)
    n_inv, s_inv = cur.fetchone()
    print(f"  créditos activos sin ruta de su dueño: {n_inv}   (saldo {money(s_inv)})")
    if n_inv:
        cur.execute("""
            select u.nombre, count(*) from prestamos p left join usuarios u on u.id = p.cobrador_id
             where p.estado='activo' and p.cobrador_id is not null
               and not exists (select 1 from asignaciones a
                                where a.cliente_id = p.cliente_id and a.cobrador_id = p.cobrador_id
                                  and a.activo = true)
             group by 1 order by 2 desc limit 10
        """)
        for nom, k in cur.fetchall():
            print(f"     {str(nom)[:26]:26} {k}")
        print("  ⚠️ INV10 ROTA: re-correr el empalme (la red de seguridad del paso 3 lo repara).")
    else:
        print("  ✓ INV10 en paz")

    print("\n" + "=" * 78)
    print("  4. AJUSTES recon- sembrados HOY (top-ups)")
    print("=" * 78)
    cur.execute("""
        select count(*), coalesce(sum(monto),0) from pagos
         where disapp_pago_id like 'recon-%%' and anulado=false
           and importado_en >= (now() at time zone 'utc')::date
    """)
    n, s = cur.fetchone()
    print(f"  {n} ajustes por {money(s)}")

    print("\n" + "=" * 78)
    print("  5. CONTRA EL TABLERO DE DISAPP (los números que pasó Carlos)")
    print("=" * 78)
    cur.execute("""
        select coalesce(sum(cuota_diaria*total_dias - pagado_acum),0), count(*)
          from prestamos where estado='activo' and disapp_credit_ref is not null
    """)
    cartera, n_ref = cur.fetchone()
    print(f"  cartera pendiente (activos con ref, total − pagado): {money(cartera)}  en {n_ref:,} créditos")
    print(f"  Disapp decía: Cartera Pendiente $56.981.789 · Total ventas activas 2.446 · Ventas en mora 553")
    print("  (Disapp esconde los vencidos del tablero: el export es la verdad, no el tablero)")
    cur.execute("select count(*) from clientes")
    print(f"  clientes en la app: {cur.fetchone()[0]:,}   (Disapp: 12.739)")

    cur.close()
    cn.close()
    print("\n  ⚠️ SOLO LECTURA.\n")


if __name__ == "__main__":
    main()
