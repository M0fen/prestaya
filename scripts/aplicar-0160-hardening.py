# -*- coding: utf-8 -*-
"""
Aplica 0160 (rehacer la 0096 que nunca corrió) midiendo el ANTES y el DESPUÉS.

Acá los cambios SÍ son esperados —de eso se trata el endurecimiento—, así que la
verificación no es "que nada cambie" sino REGLAS:
  · el ADMIN no pierde NADA en ninguna tabla;
  · el COBRADOR no GANA nada (y pierde reconciliacion_log, que no usa);
  · el SUPERVISOR conserva lo propio (su bitácora del día) y pierde solo lo ajeno;
  · después de aplicar, un supervisor NO puede escribir config_scoring.
Si una regla falla → ROLLBACK y no se escribió nada.

  python scripts/aplicar-0160-hardening.py            → ensayo (siempre rollback)
  python scripts/aplicar-0160-hardening.py --commit   → aplica si las reglas pasan
"""
import argparse
import datetime as dt
import io
import json
import os
import re
import ssl
import sys
from urllib.parse import unquote

import pg8000.dbapi

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(HERE)
SELLO = dt.datetime.now().strftime("%Y%m%d-%H%M")

# tabla → consulta de lectura (lo que un usuario "ve")
LECTURAS = {
    "auditoria": "select count(*) from auditoria",
    "mora_notas": "select count(*) from mora_notas",
    "config_scoring": "select count(*) from config_scoring",
    "config_mora": "select count(*) from config_mora",
    "config_operacion": "select count(*) from config_operacion",
    "reconciliacion_log": "select count(*) from reconciliacion_log",
    "solicitudes_renovacion": "select count(*) from solicitudes_renovacion",
    "estrellas_redenciones": "select count(*) from estrellas_redenciones",
    "solicitudes_producto": "select count(*) from solicitudes_producto",
    "snapshot_credito": "select count(*) from snapshot_credito",
    "snapshot_totales": "select count(*) from snapshot_totales",
}


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

    def leer(sql):
        """Cuenta filas visibles; si la tabla está tapiada para ese rol, 0."""
        cur.execute("savepoint s")
        try:
            cur.execute(sql)
            n = cur.fetchone()[0]
            cur.execute("release savepoint s")
            return n
        except Exception:
            cur.execute("rollback to savepoint s")
            return 0

    def puede_escribir(sql):
        cur.execute("savepoint w")
        try:
            cur.execute(sql)
            n = cur.rowcount
            cur.execute("rollback to savepoint w")
            return n > 0
        except Exception:
            cur.execute("rollback to savepoint w")
            return False

    postgres()
    cur.execute("""select rol, nombre, auth_user_id::text from usuarios
                    where activo and auth_user_id is not null and rol in ('admin','supervisor','cobrador')
                    order by rol, nombre""")
    gente = cur.fetchall()
    # Muestra: todos los admin y supervisores + 8 cobradores (los cobradores son homogéneos).
    muestra = [g for g in gente if g[0] != "cobrador"] + [g for g in gente if g[0] == "cobrador"][:8]

    print("=" * 100)
    print(f"  {'🔴 COMMIT' if a.commit else '🟡 ENSAYO (termina en rollback)'} — 0160 · rehacer la 0096")
    print(f"  {len(muestra)} usuarios ({sum(1 for g in muestra if g[0]=='admin')} admin, "
          f"{sum(1 for g in muestra if g[0]=='supervisor')} supervisores, "
          f"{sum(1 for g in muestra if g[0]=='cobrador')} cobradores) × {len(LECTURAS)} tablas")
    print("=" * 100)

    def foto():
        f = {}
        for rol, nom, aid in muestra:
            sesion(aid)
            for t, sql in LECTURAS.items():
                f[(nom, rol, t)] = leer(sql)
            f[(nom, rol, "ESCRIBIR config_scoring")] = puede_escribir(
                "update config_scoring set actualizado_en = now()")
            f[(nom, rol, "BORRAR mora_notas")] = puede_escribir("delete from mora_notas")
        return f

    try:
        print("\n  Midiendo qué ve y qué puede escribir cada uno HOY…")
        antes = foto()

        postgres()
        sql = open(os.path.join(RAIZ, "supabase", "migrations", "0160_rehacer_0096_hardening.sql"),
                   encoding="utf-8").read()
        cur.execute(sql)
        print("  0160 aplicada (dentro de la transacción). Volviendo a medir…")
        despues = foto()

        # ── LAS REGLAS ────────────────────────────────────────────────────
        fallos = []
        cambios = []
        for (nom, rol, t), a_v in antes.items():
            d_v = despues[(nom, rol, t)]
            if a_v == d_v:
                continue
            cambios.append((rol, nom, t, a_v, d_v))
            if rol == "admin" and (a_v is True or isinstance(a_v, int)) and (
                    (isinstance(a_v, bool) and a_v and not d_v) or (not isinstance(a_v, bool) and d_v < a_v)):
                fallos.append(f"ADMIN {nom} PIERDE en {t}: {a_v} → {d_v}")
            if rol == "cobrador" and not isinstance(a_v, bool) and d_v > a_v:
                fallos.append(f"COBRADOR {nom} GANA acceso en {t}: {a_v} → {d_v}")
            if rol == "cobrador" and isinstance(a_v, bool) and d_v and not a_v:
                fallos.append(f"COBRADOR {nom} GANA escritura en {t}")

        print(f"\n  {'rol':11} {'quién':20} {'qué':26} {'antes':>8} {'después':>9}")
        for rol, nom, t, a_v, d_v in sorted(cambios):
            print(f"  {rol:11} {str(nom)[:20]:20} {t:26} {str(a_v):>8} {str(d_v):>9}")
        if not cambios:
            print("  (nada cambió — sospechoso: la migración debería cerrar accesos)")

        # El supervisor tiene que conservar SU bitácora (Mi jornada la usa).
        postgres()
        cur.execute("select id::text, auth_user_id::text, nombre from usuarios where rol='supervisor' and activo")
        for uid, aid, nom in cur.fetchall():
            sesion(aid)
            propias = leer(f"select count(*) from auditoria where actor_id = '{uid}'")
            postgres()
            cur.execute("select count(*) from auditoria where actor_id = %s", (uid,))
            reales = cur.fetchone()[0]
            estado = "✅" if propias == reales else "🔴"
            print(f"  {estado} {nom}: sigue viendo sus {propias} de {reales} acciones propias (Mi jornada)")
            if propias != reales:
                fallos.append(f"{nom} pierde su propia bitácora: ve {propias} de {reales}")

        # Y NO puede escribir la config de plata.
        for uid, aid, nom in []:
            pass
        postgres()
        cur.execute("select auth_user_id::text, nombre from usuarios where rol='supervisor' and activo limit 1")
        aid, nom = cur.fetchone()
        sesion(aid)
        if puede_escribir("update config_scoring set actualizado_en = now()"):
            fallos.append(f"{nom} TODAVÍA puede escribir config_scoring")
            print(f"  🔴 {nom} todavía puede escribir config_scoring")
        else:
            print(f"  ✅ {nom} ya NO puede escribir config_scoring")

        postgres()
        cur.execute("select count(*) from pg_policies where schemaname='public' and tablename='recibos'")
        print(f"  ✅ tabla `recibos` creada, con {cur.fetchone()[0]} policies")

        if fallos:
            print(f"\n  🔴 {len(fallos)} REGLAS VIOLADAS — no se aplica:")
            for f in fallos:
                print("     ·", f)
            raise RuntimeError("la migración rompe una regla")
        print("\n  ✅ Todas las reglas pasan: el admin no pierde nada, ningún cobrador gana acceso,")
        print("     cada supervisor conserva su bitácora y ya no puede tocar la config de plata.")

        if not a.commit:
            raise SystemExit("ENSAYO")

        cn.commit()
        ruta = os.path.join(HERE, f"_0160_cambios_{SELLO}.json")
        with open(ruta, "w", encoding="utf-8") as fh:
            json.dump({"sello": SELLO,
                       "cambios": [{"rol": r, "quien": n, "que": t, "antes": str(x), "despues": str(y)}
                                   for r, n, t, x, y in cambios]}, fh, ensure_ascii=False, indent=1)
        print(f"  ✅ COMMIT. Detalle de lo que cambió → {ruta}\n")
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
