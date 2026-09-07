# -*- coding: utf-8 -*-
"""
LOS 11 "DOBLES" QUE EL EMPALME SALTÓ EL 06-09 (`_creditos_dobles_saltados_20260906.csv`),
mirados uno por uno contra el libro de Disapp y contra los pagos de la app:

  ADOPTAR (pegar la ref de Disapp al nativo que ES ese préstamo):
    · el cliente tenía DOS nativos del mismo monto y Disapp DOS créditos: se
      emparejan por fecha (a 1 día) o por frecuencia (diario ↔ semanal).
    · con la ref puesta, la próxima corrida del empalme le trae al nativo los
      recaudos de Disapp que le faltan (guardia por día+cuota mediante).
  CANCELAR (nativo con $0 en 4 semanas, creado dos veces el mismo día por el
    mismo cobrador, y Disapp con UN solo préstamo de esa fecha): no es plata, es
    un dedazo de alta. Reversible (JSON).
  Los 5 préstamos que Disapp tiene y la app no (distinto monto: son préstamos
  nuevos de verdad) los crea el empalme con --crear-dobles DESPUÉS de esto, cuando
  ya no queden nativos sin ref que los hagan parecer dobles.

  python scripts/sanear-dobles-0907.py            → DRY-RUN
  python scripts/sanear-dobles-0907.py --commit   → aplica (una transacción, verificación adentro)
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
sys.path.insert(0, HERE)
import empalme_disapp as E  # noqa: E402

SELLO = dt.datetime.now().strftime("%Y%m%d-%H%M")

# (ref Disapp, prestamo nativo, por qué)
ADOPTAR = [
    ("PRD0003640059", "905e716c-89d2-4c9f-b0d4-ca1de3b51859", "GUSTAVO DORNELLS: $15.000 del 18-08 ↔ nativo del 19-08 (renovación de PRD0003558331)"),
    ("PRD0003655527", "86777426-783f-433b-a0df-803a968326c1", "GUSTAVO DORNELLS: $15.000 del 24-08 ↔ nativo del 25-08 (renovación de PRD0003581248)"),
    ("PRD0003637775", "a6049f5a-b0f0-4d82-9d96-f2b32f738dde", "VALERIA OLIVERA: $5.000 semanal del 17-08 ↔ el nativo del 18-08 que tiene el pago del 27-08"),
    ("PRD0003628827", "9735f0ee-cbed-4d7b-80be-44b448661692", "JOSE MONTERO: $5.000 del 13-08 ↔ nativo del 10-08 (renovación de PRD0003561867)"),
    ("PRD0003620226", "e0f768cd-e585-469d-b931-3fe2b4b30ebb", "NANCY PEREZ: $6.000 DIARIO 240×30 ↔ el nativo diario 240×30"),
    ("PRD0003620228", "dd82e0c9-ad9f-4aee-bd07-5068b8597235", "NANCY PEREZ: $6.000 SEMANAL 1440×5 ↔ el nativo semanal 1440×5"),
]
CANCELAR = [
    ("8f251ff9-2ae1-442a-9128-1cf04c63b293", "VALERIA OLIVERA: $5.000 semanal creado el 17-08 16:06 y otra vez 18:48 por la misma cobradora; $0 en 4 semanas; Disapp tiene UN préstamo de esa fecha (queda el que tiene pagos)"),
    ("fec248ce-c12c-4716-b819-b982ae5280fc", "JOSE MONTERO: segundo $5.000 creado el 08-08 17:30 (el primero 17:29); $0 en 4 semanas; Disapp no tiene ese préstamo (tiene el de $15.000 del 18-08)"),
]


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
    ap.add_argument("--commit", action="store_true")
    a = ap.parse_args()

    creditos_exp, _, _ = E.load_creditos(a.src)
    por_ref = {c["ref"]: c for c in creditos_exp.values() if c["ref"]}

    cn = conectar(a.env_file)
    cur = cn.cursor()
    cur.execute("select id::text from usuarios where rol='admin' and nombre ilike 'Carlos%%' limit 1")
    actor = cur.fetchone()
    actor_id = actor[0] if actor else None

    print("=" * 96)
    print(f"  {'DRY-RUN' if not a.commit else '🔴 COMMIT'} — sanear los dobles saltados del 06-09")
    print("=" * 96)
    ok = True
    plan_adoptar = []
    for ref, pid, why in ADOPTAR:
        c = por_ref.get(ref)
        cur.execute("""select p.disapp_credit_ref, p.estado, p.monto_prestado, p.frecuencia, p.fecha_inicio, p.pagado_acum, cl.nombre, p.creado_por is not null
                       from prestamos p join clientes cl on cl.id=p.cliente_id where p.id=%s""", (pid,))
        r = cur.fetchone()
        cur.execute("select id::text from prestamos where disapp_credit_ref=%s", (ref,))
        ya = cur.fetchone()
        problema = None
        if not c or (c.get("estado_disapp") or "").lower() not in ("activo", ""):
            problema = "la ref no está activa en el export"
        elif not r:
            problema = "el nativo no existe"
        elif r[0]:
            problema = f"el nativo ya tiene ref {r[0]}"
        elif r[1] != "activo":
            problema = f"el nativo está {r[1]}"
        elif not r[7]:
            problema = "no es nativo (sin creado_por)"
        elif abs(float(r[2]) - float(c["monto_prestado"] or 0)) > 0.5:
            problema = f"monto distinto: nativo {money(r[2])} vs Disapp {money(c['monto_prestado'])}"
        elif r[3] != c["frecuencia"]:
            problema = f"frecuencia distinta: nativo {r[3]} vs Disapp {c['frecuencia']}"
        elif ya:
            problema = f"la ref ya vive en el crédito {ya[0][:8]}"
        estado = "OK" if not problema else f"⛔ {problema}"
        ok = ok and not problema
        print(f"  ADOPTAR {ref} → {pid[:8]} {str(r[6] if r else '?')[:24]:24} nativo {money(r[2]) if r else '-'} {r[3] if r else '-'} ini {r[4] if r else '-'} "
              f"pag {money(r[5]) if r else '-'} | Disapp {money(c['monto_prestado']) if c else '-'} {c['fecha'] if c else '-'} Pagos {money(c['pagos_disapp']) if c else '-'}  {estado}")
        print(f"          {why}")
        if not problema:
            plan_adoptar.append((ref, c["disapp_credit_id"], pid, why))
    plan_cancelar = []
    for pid, why in CANCELAR:
        cur.execute("""select p.estado, p.pagado_acum, p.monto_prestado, p.fecha_inicio, cl.nombre, p.disapp_credit_ref, p.cliente_id::text,
                              (select count(*) from pagos g where g.prestamo_id=p.id and g.anulado=false)
                       from prestamos p join clientes cl on cl.id=p.cliente_id where p.id=%s""", (pid,))
        r = cur.fetchone()
        problema = None
        if not r:
            problema = "no existe"
        elif r[0] != "activo":
            problema = f"está {r[0]}"
        elif float(r[1]) > 0.5 or r[7] > 0:
            problema = f"tiene pagos ({money(r[1])}, {r[7]} filas): NO se cancela"
        elif r[5]:
            problema = f"tiene ref {r[5]}"
        estado = "OK" if not problema else f"⛔ {problema}"
        ok = ok and not problema
        print(f"  CANCELAR {pid[:8]} {str(r[4] if r else '?')[:24]:24} {money(r[2]) if r else '-'} ini {r[3] if r else '-'} pag {money(r[1]) if r else '-'}  {estado}")
        print(f"          {why}")
        if not problema:
            plan_cancelar.append((pid, r[6], why))

    if not ok:
        print("\n  ⛔ hay un problema en el plan: no se escribe nada.\n")
        cur.close(); cn.close()
        sys.exit(1)
    if not a.commit:
        print(f"\n  🟡 DRY-RUN: {len(plan_adoptar)} adopciones y {len(plan_cancelar)} cancelaciones. Aplicar con --commit.\n")
        cur.close(); cn.close()
        return

    revert = {"sello": SELLO, "adoptados": [], "cancelados": []}
    try:
        cn.autocommit = False
        for ref, cid, pid, why in plan_adoptar:
            cur.execute("update prestamos set disapp_credit_ref=%s, disapp_credit_id=%s where id=%s and disapp_credit_ref is null and estado='activo'",
                        (ref, cid, pid))
            if cur.rowcount != 1:
                raise RuntimeError(f"adoptar {ref}: no se pudo")
            cur.execute("select cliente_id::text from prestamos where id=%s", (pid,))
            cli = cur.fetchone()[0]
            cur.execute("""insert into auditoria (actor_id, actor_nombre, accion, entidad, entidad_id, detalle)
                           values (%s, 'Carlos', 'Adoptó un crédito de Disapp sobre el nativo que ya lo tenía (dobles del 06-09)', 'cliente', %s, %s)""",
                        (actor_id, cli, f"{ref} → crédito {pid[:8]}: {why}"))
            revert["adoptados"].append({"id": pid, "ref": ref, "cid": cid})
        for pid, cli, why in plan_cancelar:
            cur.execute("update prestamos set estado='cancelado', finalizado_en=now() where id=%s and estado='activo' and pagado_acum=0", (pid,))
            if cur.rowcount != 1:
                raise RuntimeError(f"cancelar {pid[:8]}: no se pudo")
            cur.execute("""insert into auditoria (actor_id, actor_nombre, accion, entidad, entidad_id, detalle)
                           values (%s, 'Carlos', 'Canceló un crédito nativo creado dos veces, sin un solo pago (dobles del 06-09)', 'cliente', %s, %s)""",
                        (actor_id, cli, f"crédito {pid[:8]}: {why}"))
            revert["cancelados"].append({"id": pid})
        # verificación
        for ref, cid, pid, why in plan_adoptar:
            cur.execute("select count(*) from prestamos where disapp_credit_ref=%s", (ref,))
            if cur.fetchone()[0] != 1:
                raise RuntimeError(f"{ref}: la ref no quedó única")
        for pid, cli, why in plan_cancelar:
            cur.execute("select estado, pagado_acum from prestamos where id=%s", (pid,))
            e, p = cur.fetchone()
            if e != "cancelado" or float(p) != 0:
                raise RuntimeError(f"{pid[:8]}: no quedó cancelado en 0")
        cn.commit()
        ruta = os.path.join(HERE, f"_sanear_dobles_revert_{SELLO}.json")
        with open(ruta, "w", encoding="utf-8") as fh:
            json.dump(revert, fh, ensure_ascii=False, indent=1)
        print(f"\n  ✅ COMMIT: {len(plan_adoptar)} adoptados, {len(plan_cancelar)} cancelados. Revert → {ruta}\n")
    except Exception as e:
        cn.rollback()
        print(f"\n  🔴 ROLLBACK — no se escribió nada: {e}\n")
        raise
    finally:
        cur.close()
        cn.close()


if __name__ == "__main__":
    main()
