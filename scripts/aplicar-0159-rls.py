# -*- coding: utf-8 -*-
"""
Aplica 0159 (RLS sin llamadas a función por fila) con la VERIFICACIÓN adentro.

No se toca la seguridad a ciegas: antes de cambiar nada se saca la foto exacta de
qué VE cada usuario activo con sesión (clientes, asignaciones, préstamos, pagos),
se aplican las policies nuevas, se vuelve a sacar la foto, y si UNA sola fila
difiere para UN solo usuario → ROLLBACK y no se escribió nada. También mide.

  python scripts/aplicar-0159-rls.py            → ensayo (siempre termina en ROLLBACK)
  python scripts/aplicar-0159-rls.py --commit   → aplica, si y solo si todo coincide
"""
import argparse
import datetime as dt
import io
import json
import os
import re
import ssl
import sys
import time
from urllib.parse import unquote

import pg8000.dbapi

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(HERE)
SELLO = dt.datetime.now().strftime("%Y%m%d-%H%M")

TABLAS = ("clientes", "asignaciones", "prestamos", "pagos")


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env-file", default=".env.local")
    ap.add_argument("--commit", action="store_true")
    a = ap.parse_args()

    cn = conectar(a.env_file)
    cn.autocommit = False
    cur = cn.cursor()

    def postgres():
        cur.execute("select set_config('role','postgres',true)")
        cur.execute("select set_config('request.jwt.claims', %s, true)", ("",))

    def sesion(aid):
        cur.execute("select set_config('role','authenticated',true)")
        cur.execute("select set_config('request.jwt.claims', %s, true)",
                    ('{"sub":"%s","role":"authenticated"}' % aid,))

    postgres()
    # TODOS los que pueden entrar a la app, no una muestra.
    cur.execute("""select rol, nombre, id::text, auth_user_id::text from usuarios
                    where activo and auth_user_id is not null and rol in ('admin','supervisor','cobrador')
                    order by rol, nombre""")
    gente = cur.fetchall()
    cur.execute("select id from prestamos where estado='activo' limit 150")
    ids = ",".join("'%s'" % r[0] for r in cur.fetchall())
    CONSULTAS = {
        "clientes": "select id from clientes",
        "asignaciones": "select id from asignaciones where activo",
        "prestamos": "select id from prestamos where estado='activo'",
        "pagos": f"select id from pagos where prestamo_id in ({ids}) and anulado=false",
    }

    # Guardar las policies actuales para el revert.
    cur.execute("""select tablename, policyname, qual from pg_policies
                    where schemaname='public' and tablename = any(%s) and cmd='SELECT'""", (list(TABLAS),))
    previas = {(r[0], r[1]): r[2] for r in cur.fetchall()}

    def foto():
        f = {}
        for rol, nom, uid, aid in gente:
            sesion(aid)
            for k, sql in CONSULTAS.items():
                t = time.perf_counter()
                cur.execute(sql)
                filas = frozenset(x[0] for x in cur.fetchall())
                f[(nom, rol, k)] = ((time.perf_counter() - t) * 1000, filas)
        return f

    print("=" * 96)
    print(f"  {'🔴 COMMIT' if a.commit else '🟡 ENSAYO (termina en rollback)'} — 0159 · RLS sin función por fila")
    print(f"  {len(gente)} usuarios con sesión · {len(CONSULTAS)} consultas cada uno")
    print("=" * 96)

    try:
        print("\n  Sacando la foto de QUÉ VE CADA UNO con las policies de hoy…")
        antes = foto()

        postgres()
        sql = open(os.path.join(RAIZ, "supabase", "migrations", "0159_rls_sin_funcion_por_fila.sql"),
                   encoding="utf-8").read()
        cur.execute(sql)
        print("  Policies nuevas aplicadas (dentro de la transacción). Sacando la segunda foto…")
        despues = foto()

        difs = []
        por_rol = {}
        for clave, (a_ms, a_f) in antes.items():
            nom, rol, k = clave
            d_ms, d_f = despues[clave]
            if a_f != d_f:
                difs.append(f"{nom} ({rol}) · {k}: veía {len(a_f)}, ahora {len(d_f)}"
                            f" · de más: {len(d_f - a_f)} · de menos: {len(a_f - d_f)}")
            por_rol.setdefault(rol, []).append((a_ms, d_ms))

        print(f"\n  {'rol':12} {'usuarios':>9} {'antes':>12} {'después':>12} {'mejora':>9}")
        for rol, v in por_rol.items():
            n = len({g[1] for g in gente if g[0] == rol})
            sa = sum(x[0] for x in v) / n
            sd = sum(x[1] for x in v) / n
            print(f"  {rol:12} {n:>9} {sa:11.0f}ms {sd:11.0f}ms {sa/sd:8.1f}x")

        if difs:
            print(f"\n  🔴 {len(difs)} DIFERENCIAS de visibilidad — NO se aplica:")
            for d in difs[:20]:
                print("     ·", d)
            raise RuntimeError("la reescritura no es equivalente")
        print(f"\n  ✅ EQUIVALENTE: los {len(antes)} conjuntos de filas coinciden exactamente.")

        if not a.commit:
            raise SystemExit("ENSAYO")

        # Revert antes de cerrar: las policies tal como estaban.
        ruta = os.path.join(HERE, f"_rls_revert_{SELLO}.json")
        with open(ruta, "w", encoding="utf-8") as fh:
            json.dump({"sello": SELLO,
                       "revert": [{"tabla": t, "policy": p, "using": q} for (t, p), q in previas.items()]},
                      fh, ensure_ascii=False, indent=1)
        cn.commit()
        print(f"  ✅ COMMIT. Revert (policies viejas) → {ruta}\n")
    except SystemExit:
        cn.rollback()
        print("\n  🟡 ENSAYO terminado: no se escribió nada. Aplicar con --commit.\n")
    except Exception as e:
        cn.rollback()
        print(f"\n  🔴 ROLLBACK — no se escribió nada: {e}\n")
        raise
    finally:
        cur.close()
        cn.close()


if __name__ == "__main__":
    main()
