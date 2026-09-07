# -*- coding: utf-8 -*-
"""
CREAR en la app UN crédito ACTIVO de Disapp (con sus recaudos) que el empalme saltó.

Cuándo: el empalme deja afuera un crédito de Disapp cuando el cliente tiene DOS
nativos del mismo monto sin ref ("2 nativos posibles — se saltea"), aunque se le
pase --crear-dobles. Si una persona ya miró el caso y decidió que el crédito de
Disapp es un préstamo REAL que la app no tiene, este script lo crea exactamente
como lo haría el empalme (mismas columnas, mismo origen de los pagos, mismo
disapp_pago_id → idempotente con las corridas futuras) y verifica adentro de la
transacción que el crédito termina en el `Pagos` de Disapp.

  python scripts/crear-credito-disapp.py --ref PRD0003668219 --motivo "..."          → DRY-RUN
  python scripts/crear-credito-disapp.py --ref PRD0003668219 --motivo "..." --commit
"""
import argparse
import datetime as dt
import io
import json
import os
import re
import ssl
import sys
import uuid
from urllib.parse import unquote

import pg8000.dbapi

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import empalme_disapp as E  # noqa: E402

SELLO = dt.datetime.now().strftime("%Y%m%d-%H%M")


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
    ap.add_argument("--ref", required=True)
    ap.add_argument("--motivo", required=True, help="por qué una persona decidió que es un préstamo real")
    ap.add_argument("--src", default=r"C:\Users\Carlos\migracion")
    ap.add_argument("--env-file", default=".env.local")
    ap.add_argument("--commit", action="store_true")
    a = ap.parse_args()

    creditos, _, _ = E.load_creditos(a.src)
    c = next((x for x in creditos.values() if x["ref"] == a.ref), None)
    if not c or (c.get("estado_disapp") or "").lower() not in ("activo", ""):
        raise SystemExit(f"  ⛔ {a.ref} no está ACTIVO en el export de créditos")
    pagos_all, _ = E.load_pagos(a.src)
    pagos = sorted((p for p in pagos_all.values() if p["ref"] == a.ref and p["monto"]), key=lambda p: (p["fecha"] or dt.date.min, p["id_pago"]))
    td = c["cuotas"] or 1

    cn = conectar(a.env_file)
    cur = cn.cursor()
    cur.execute("select id::text from usuarios where rol='admin' and nombre ilike 'Carlos%%' limit 1")
    actor = cur.fetchone()
    actor_id = actor[0] if actor else None
    cur.execute("select id::text, nombre, activo from clientes where disapp_id = %s", (c["id_cliente"],))
    cli = cur.fetchone()
    cur.execute("select id::text, nombre from usuarios where disapp_vendedor_id = %s", (c["id_vendedor"],))
    cob = cur.fetchone()
    cur.execute("select id::text, estado from prestamos where disapp_credit_ref = %s or disapp_credit_id = %s", (a.ref, c["disapp_credit_id"]))
    ya = cur.fetchall()
    cur.execute("select disapp_pago_id from pagos where disapp_pago_id = any(%s::text[])", ([p["id_pago"] for p in pagos],))
    ya_pagos = {r[0] for r in cur.fetchall()}

    print("=" * 90)
    print(f"  {'DRY-RUN' if not a.commit else '🔴 COMMIT'} — crear {a.ref} en la app")
    print("=" * 90)
    print(f"  Disapp: {money(c['monto_prestado'])} cuota {money(c['cuota'])} × {td} {c['frecuencia']} desde {c['fecha']} · "
          f"Pagos {money(c['pagos_disapp'])} · saldo {money(c['saldo_pendiente'])} · vendedor {c['vendedor']} ({c['id_vendedor']})")
    print(f"  cliente Disapp {c['id_cliente']} → app {cli[0][:8] + ' ' + cli[1] + (' (ACTIVO)' if cli[2] else ' (INACTIVO)') if cli else '⛔ NO EXISTE'}")
    print(f"  cobrador → {cob[0][:8] + ' ' + cob[1] if cob else '⛔ SIN USUARIO'}")
    print(f"  recaudos de Disapp para la ref: {len(pagos)} ({money(sum(p['monto'] for p in pagos))}); ya en la app: {len(ya_pagos)}")
    for p in pagos:
        print(f"      {p['fecha']} cuota {p['cuota_num']} {money(p['monto']):>8} folio {p['id_pago']}{'  (ya existe)' if p['id_pago'] in ya_pagos else ''}")
    if ya:
        print(f"  ⛔ la ref/id ya vive en la app: {ya}")
    problemas = [x for x, ok in (("cliente", cli and cli[2]), ("cobrador", cob), ("ref libre", not ya)) if not ok]
    if abs(sum(p["monto"] for p in pagos) - float(c["pagos_disapp"] or 0)) > 0.5:
        problemas.append(f"los recaudos ({money(sum(p['monto'] for p in pagos))}) no suman el Pagos de Disapp ({money(c['pagos_disapp'])})")
    if problemas:
        print(f"\n  ⛔ no se puede: {problemas}\n")
        cur.close(); cn.close()
        sys.exit(1)
    if not a.commit:
        print("\n  🟡 DRY-RUN: no se escribió nada. Aplicar con --commit.\n")
        cur.close(); cn.close()
        return

    pid = str(uuid.uuid4())
    revert = {"sello": SELLO, "ref": a.ref, "prestamo": pid, "pagos": [], "asignacion": None}
    try:
        cn.autocommit = False
        cur.execute("""insert into prestamos (id, cliente_id, cobrador_id, monto_prestado, cuota_diaria, total_dias, frecuencia,
                                              estado, fecha_inicio, disapp_credit_id, disapp_credit_ref)
                       values (%s, %s, %s, %s, %s, %s, %s, 'activo', %s, %s, %s)""",
                    (pid, cli[0], cob[0], c["monto_prestado"] or 1, c["cuota"] or 1, td, c["frecuencia"],
                     c["fecha"].isoformat() if c["fecha"] else None, c["disapp_credit_id"], a.ref))
        ahora = dt.datetime.now().isoformat()
        for p in pagos:
            if p["id_pago"] in ya_pagos:
                continue
            dc = max(1, min(p["cuota_num"] or 1, td))
            gid = str(uuid.uuid4())
            cur.execute("""insert into pagos (id, prestamo_id, dia_credito, monto, registrado_por, registrado_en, origen,
                                              importado_en, disapp_pago_id, disapp_credit_ref, op_id)
                           values (%s, %s, %s, %s, %s, %s, 'disapp_import', %s, %s, %s, %s)""",
                        (gid, pid, dc, p["monto"], cob[0], E.iso_ts(p["fecha"]) or E.iso_ts(dt.date.today()),
                         ahora, p["id_pago"], a.ref, str(uuid.uuid4())))
            revert["pagos"].append(gid)
        cur.execute("select id::text, activo from asignaciones where cobrador_id=%s and cliente_id=%s", (cob[0], cli[0]))
        asig = cur.fetchone()
        if not asig:
            cur.execute("insert into asignaciones (cobrador_id, cliente_id, activo) values (%s, %s, true) returning id::text", (cob[0], cli[0]))
            revert["asignacion"] = ("insertada", cur.fetchone()[0])
        elif not asig[1]:
            cur.execute("update asignaciones set activo=true where id=%s", (asig[0],))
            revert["asignacion"] = ("reactivada", asig[0])
        cur.execute("""insert into auditoria (actor_id, actor_nombre, accion, entidad, entidad_id, detalle)
                       values (%s, 'Carlos', 'Creó a mano un crédito de Disapp que el empalme saltó por ambigüedad', 'cliente', %s, %s)""",
                    (actor_id, cli[0], f"{a.ref} {money(c['monto_prestado'])} del {c['fecha']} con {len(revert['pagos'])} recaudos "
                                       f"({money(c['pagos_disapp'])}) → crédito {pid[:8]}. {a.motivo}"))
        # verificación: el crédito quedó activo con el Pagos de Disapp, la ref única
        cur.execute("select estado, pagado_acum from prestamos where id=%s", (pid,))
        est, pag = cur.fetchone()
        cur.execute("select count(*) from prestamos where disapp_credit_ref=%s", (a.ref,))
        n_ref = cur.fetchone()[0]
        if est != "activo" or abs(float(pag) - float(c["pagos_disapp"] or 0)) > 0.5 or n_ref != 1:
            raise RuntimeError(f"verificación falló: estado={est} pagado={pag} esperado={c['pagos_disapp']} refs={n_ref}")
        cn.commit()
        ruta = os.path.join(HERE, f"_crear_credito_revert_{a.ref}_{SELLO}.json")
        with open(ruta, "w", encoding="utf-8") as fh:
            json.dump(revert, fh, ensure_ascii=False, indent=1)
        print(f"\n  ✅ COMMIT: {a.ref} creado ({pid[:8]}) con {len(revert['pagos'])} recaudos = {money(pag)} (Disapp {money(c['pagos_disapp'])}). Revert → {ruta}\n")
    except Exception as e:
        cn.rollback()
        print(f"\n  🔴 ROLLBACK — no se escribió nada: {e}\n")
        raise
    finally:
        cur.close()
        cn.close()


if __name__ == "__main__":
    main()
