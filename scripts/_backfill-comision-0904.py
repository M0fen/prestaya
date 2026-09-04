# -*- coding: utf-8 -*-
"""
BACKFILL de `pagos.comision_cobrador_id` — la foto de a quién le corresponde la
comisión de cada cobro, para los pagos anteriores a la migración 0152.

CRITERIO (aprobado por Carlos el 04-09): comision_cobrador_id = prestamos.cobrador_id.
No es una aproximación, es reconstrucción exacta, y la evidencia es:
  · CERO reasignaciones registradas en `auditoria` en toda la vida de la app;
  · las 33 asignaciones dadas de baja son todas del 8-9 de julio (setup inicial);
  · 99,9% de los pagos tienen `registrado_por` = dueño actual del crédito.
    Difieren 3 pagos ($4.000) y también van al dueño: la comisión es del dueño de
    la ruta aunque haya cobrado otro (regla del negocio, 06-08).

ALCANCE: pagos con `origen IS NULL` (nativos), anulados incluidos, para que la
columna quede consistente. Los importados de Disapp NO se tocan: nunca fueron base
de comisión.

SEGURIDAD:
  · Snapshot PREVIO persistido en JSON antes de tocar nada.
  · Todo el backfill en UNA transacción, con el asiento de `auditoria` adentro.
  · La verificación corre DENTRO de la transacción: si aparece UNA sola diferencia
    contra el snapshot, hace ROLLBACK y no commitea nada.
  · No toca ninguna columna protegida por el trigger de inmutabilidad (0126):
    `comision_cobrador_id` no está en su lista, y `pagado_acum` no se mueve porque
    no se toca `anulado`.

  Dry-run:  python scripts/_backfill-comision-0904.py
  Aplicar:  python scripts/_backfill-comision-0904.py --commit --responsable "Nombre"
"""
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
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMMIT = "--commit" in sys.argv


def responsable() -> str:
    if "--responsable" in sys.argv:
        i = sys.argv.index("--responsable")
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1].strip()
    return ""


def conectar():
    with open(os.path.join(RAIZ, ".env.local"), encoding="utf-8") as fh:
        url = next(l.split("=", 1)[1].strip().strip('"').strip("'")
                   for l in fh if l.startswith("SUPABASE_DB_URL="))
    m = re.match(r"postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+):(\d+)/(.+)", url)
    usr, pw, host, port, base = m.groups()
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return pg8000.dbapi.connect(user=unquote(usr), password=unquote(pw), host=host,
                                port=int(port), database=base.split("?")[0], ssl_context=ctx)


def money(n) -> str:
    return "$" + f"{round(float(n or 0)):,}".replace(",", ".")


# La fórmula VIEJA: agrupa por el dueño ACTUAL del crédito.
SQL_VIEJA = """
  select pp.cobrador_id::text, coalesce(sum(p.monto),0)::numeric, count(*)::bigint
    from pagos p join prestamos pp on pp.id = p.prestamo_id
   where p.anulado = false and p.origen is null and pp.cobrador_id is not null
   group by 1
"""

# La fórmula NUEVA: agrupa por la foto congelada, cayendo al dueño si no hay foto.
SQL_NUEVA = """
  select coalesce(p.comision_cobrador_id, pp.cobrador_id)::text,
         coalesce(sum(p.monto),0)::numeric, count(*)::bigint
    from pagos p join prestamos pp on pp.id = p.prestamo_id
   where p.anulado = false and p.origen is null
     and coalesce(p.comision_cobrador_id, pp.cobrador_id) is not null
   group by 1
"""


def leer(cur, sql):
    cur.execute(sql)
    return {r[0]: {"recaudado": float(r[1]), "cobros": int(r[2])} for r in cur.fetchall()}


def comparar(a, b):
    """Diferencias entre dos fotos por cobrador. Lista vacía = idénticas."""
    difs = []
    for cid in sorted(set(a) | set(b)):
        x, y = a.get(cid), b.get(cid)
        if x is None or y is None:
            difs.append(f"{cid[:8]}…: {'falta en NUEVA' if y is None else 'aparece en NUEVA'}")
        elif abs(x["recaudado"] - y["recaudado"]) > 0.005 or x["cobros"] != y["cobros"]:
            difs.append(f"{cid[:8]}…: {money(x['recaudado'])}/{x['cobros']} → {money(y['recaudado'])}/{y['cobros']}")
    return difs


def main() -> None:
    quien = responsable()
    if COMMIT and not quien:
        print('\n🔴 Para aplicar hace falta --responsable "Nombre".\n')
        return

    cn = conectar()
    cur = cn.cursor()

    print("=" * 92)
    print(f"  BACKFILL comision_cobrador_id   {'🔴 APLICANDO' if COMMIT else '🟡 DRY-RUN'}")
    print("=" * 92)

    # ── 1. SNAPSHOT PREVIO, persistido ANTES de tocar nada ────────────────
    previa = leer(cur, SQL_VIEJA)
    cur.execute("""select count(*), coalesce(sum(monto),0) from pagos
                    where anulado=false and origen is null and comision_cobrador_id is null""")
    n_sin, monto_sin = cur.fetchone()
    cur.execute("""select count(*) from pagos where origen is null and comision_cobrador_id is null""")
    n_universo = cur.fetchone()[0]

    snap = {
        "tomado_en": dt.datetime.now().isoformat(),
        "criterio": "comision_cobrador_id = prestamos.cobrador_id (pagos origen IS NULL)",
        "formula": "VIEJA: group by prestamos.cobrador_id, pagos vigentes origen IS NULL",
        "por_cobrador": previa,
        "totales": {
            "cobradores": len(previa),
            "recaudado": round(sum(v["recaudado"] for v in previa.values()), 2),
            "cobros": sum(v["cobros"] for v in previa.values()),
        },
        "a_tocar": {"vigentes_sin_foto": n_sin, "universo_incluye_anulados": n_universo},
    }
    ruta_snap = os.path.join(RAIZ, "scripts", f"_snapshot_comision_{dt.date.today():%Y%m%d}.json")
    with open(ruta_snap, "w", encoding="utf-8") as fh:
        json.dump(snap, fh, ensure_ascii=False, indent=1)

    print(f"\n  SNAPSHOT PREVIO (grabado en {os.path.basename(ruta_snap)})")
    print(f"    cobradores      : {snap['totales']['cobradores']}")
    print(f"    base total      : {money(snap['totales']['recaudado'])}")
    print(f"    cobros          : {snap['totales']['cobros']}")
    print(f"\n  A TOCAR")
    print(f"    pagos vigentes sin foto        : {n_sin}  ({money(monto_sin)})")
    print(f"    universo (incluye anulados)    : {n_universo}")

    if not COMMIT:
        print("\n🟡 DRY-RUN: no se escribió nada. El snapshot SÍ quedó grabado.")
        print('   Aplicar con: --commit --responsable "Tu nombre"\n')
        cur.close(); cn.close()
        return

    # ── 2. BACKFILL, TODO EN UNA TRANSACCIÓN ──────────────────────────────
    # pg8000 no autocommitea: la transacción está abierta desde el primer execute.
    try:
        cur.execute("""
            update pagos p
               set comision_cobrador_id = pp.cobrador_id
              from prestamos pp
             where pp.id = p.prestamo_id
               and p.origen is null
               and p.comision_cobrador_id is null
               and pp.cobrador_id is not null
        """)
        tocadas = cur.rowcount
        print(f"\n  filas actualizadas: {tocadas}")

        # El asiento va DENTRO de la misma transacción: si el backfill se revierte,
        # el asiento también. Nunca un registro de algo que no pasó.
        cur.execute("select id, nombre from usuarios where rol='admin' and activo order by nombre limit 1")
        fila = cur.fetchone()
        if not fila:
            raise RuntimeError("no hay un admin activo para firmar el backfill")
        admin_id, admin_nombre = fila
        detalle = (
            f"Backfill 0152: se congeló la atribución de comisión de {tocadas} pago(s) nativos "
            f"con el dueño del crédito (criterio aprobado; 0 reasignaciones en la historia, "
            f"99,9% de coincidencia con registrado_por). Snapshot previo: "
            f"{snap['totales']['cobradores']} cobradores, {money(snap['totales']['recaudado'])}. "
            f"Responsable: {quien}."
        )
        cur.execute("""
            insert into auditoria (actor_id, actor_nombre, accion, entidad, entidad_id, detalle)
            values (%s, %s, %s, 'sistema', %s, %s)
        """, (admin_id, f"{admin_nombre} (por {quien})",
              "Corrección administrativa: atribución de comisión congelada",
              admin_id, detalle[:500]))

        # ── 3. VERIFICACIÓN **DENTRO** DE LA TRANSACCIÓN ──────────────────
        # Si una sola cifra se movió, esto no se commitea. La reversión no depende
        # de que alguien la ejecute después: es el rollback de esta transacción.
        posterior = leer(cur, SQL_NUEVA)
        difs = comparar(previa, posterior)

        print("\n  VERIFICACIÓN (snapshot previo vs fórmula nueva, dentro de la transacción)")
        print(f"    cobradores : {len(previa)} → {len(posterior)}")
        print(f"    base total : {money(sum(v['recaudado'] for v in previa.values()))} → "
              f"{money(sum(v['recaudado'] for v in posterior.values()))}")
        print(f"    DIFERENCIAS: {len(difs)}")

        if difs:
            for d in difs[:10]:
                print(f"      · {d}")
            cn.rollback()
            print("\n🔴 SE REVIRTIÓ TODO. No se commiteó nada. Nada que deshacer a mano.\n")
            cur.close(); cn.close()
            return

        cn.commit()
        print("\n  ✓ commit")
    except Exception as e:
        cn.rollback()
        print(f"\n🔴 ERROR — se revirtió todo: {e}\n")
        cur.close(); cn.close()
        return

    # ── 4. VERIFICACIÓN POSTERIOR, ya commiteada e independiente ──────────
    posterior2 = leer(cur, SQL_NUEVA)
    difs2 = comparar(previa, posterior2)
    print("\n  VERIFICACIÓN POSTERIOR (ya commiteada, lectura nueva)")
    print(f"    cobradores : {len(posterior2)}")
    print(f"    base total : {money(sum(v['recaudado'] for v in posterior2.values()))}")
    print(f"    cobros     : {sum(v['cobros'] for v in posterior2.values())}")
    print(f"    DIFERENCIAS contra el snapshot: {len(difs2)}")
    for d in difs2[:10]:
        print(f"      · {d}")

    # ── 5. ¿SE APAGÓ LA GUARDIA DE TRANSICIÓN? ────────────────────────────
    cur.execute("""select count(*) from pagos
                    where anulado=false and origen is null and comision_cobrador_id is null""")
    quedan = cur.fetchone()[0]
    print("\n  GUARDIA DE TRANSICIÓN (anti doble-pago entre cobradores)")
    print(f"    pagos vigentes SIN foto que quedan: {quedan}")
    print(f"    → la guardia {'SE APAGÓ ✔ (ya no se activa)' if quedan == 0 else 'SIGUE ACTIVA ⚠'}")
    if quedan:
        cur.execute("""select coalesce(pp.cobrador_id::text,'(sin dueño)'), count(*)
                        from pagos p join prestamos pp on pp.id=p.prestamo_id
                       where p.anulado=false and p.origen is null and p.comision_cobrador_id is null
                       group by 1 order by 2 desc limit 10""")
        print("    quiénes son:")
        for cid, n in cur.fetchall():
            print(f"      · {cid[:8]}… → {n} pago(s)")

    cur.close()
    cn.close()
    print()


if __name__ == "__main__":
    main()
