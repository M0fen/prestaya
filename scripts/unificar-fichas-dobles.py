# -*- coding: utf-8 -*-
"""
UNIFICAR la misma persona con dos fichas y dos créditos por el mismo préstamo.

El incidente (06-09): el empalme creó una ficha de oficina (documento NULL) para
un cliente que ya existía como ficha de censo con un crédito NATIVO activo del
mismo cobrador, mismo monto, a 1-2 días. Dos deudas por una plata, las dos en ruta.
Regla: LA APP MANDA. Queda el nativo; el importado se cancela; sus pagos se
anulan y —los que NO estén ya en el nativo— se REPONEN sobre el nativo con rastro
(origen 'disapp_import', folio original + ':mov'). Nada se borra ni se edita.

  python scripts/unificar-fichas-dobles.py                      → DRY-RUN (default)
  python scripts/unificar-fichas-dobles.py --commit             → aplica, en UNA transacción
  python scripts/unificar-fichas-dobles.py --incluir PRD... --incluir PRD...
        → suma refs "probables" a mano (la detección automática solo toma los
          MISMO PRÉSTAMO: cédula + mismo cobrador + mismo monto + ≤7 días)

Verificación DENTRO de la transacción (una diferencia = rollback): ningún peso
se pierde (Σ pagos vivos de los dos créditos antes = Σ después + duplicados
anulados), el importado queda en 0 y cancelado, el nativo queda con la ref.
Deja un JSON de revert con todos los ids tocados.
"""
import argparse
import datetime as dt
import io
import json
import os
import re
import ssl
import sys
import unicodedata
import uuid
from urllib.parse import unquote

import pg8000.dbapi

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import empalme_disapp as E  # noqa: E402
import guardia_duplicados as G  # noqa: E402

SELLO = dt.datetime.now().strftime("%Y%m%d-%H%M")
MOTIVO = "Ficha doble del empalme 06-09: el mismo préstamo ya vive en el crédito nativo (la app manda)"


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


def detectar(cur, src, incluir):
    """Los pares (import, nativo) a unificar. Mismo criterio que diagnostico-fichas-dobles."""
    clientes_exp, _, _ = E.load_clientes(src)
    doc_exp = {did: (c.get("documento_original") or "").strip() for did, c in clientes_exp.items()}
    cur.execute("select id::text, nombre, documento, disapp_id, origen, activo from clientes")
    fichas = {r[0]: {"id": r[0], "nombre": r[1], "documento": (r[2] or "").strip(), "disapp_id": r[3],
                     "origen": r[4], "activo": r[5]} for r in cur.fetchall()}
    cur.execute("""
        select id::text, cliente_id::text, cobrador_id::text, disapp_credit_ref, disapp_credit_id, creado_por::text,
               monto_prestado, pagado_acum, fecha_inicio, cuota_diaria, total_dias
          from prestamos where estado = 'activo'
    """)
    activos = [{"id": r[0], "cliente": r[1], "cobrador": r[2], "ref": r[3], "cid": r[4], "creado_por": r[5],
                "monto": float(r[6] or 0), "pagado": float(r[7] or 0), "fecha": r[8],
                "cuota": float(r[9] or 0), "dias": int(r[10] or 0)} for r in cur.fetchall()]
    por_doc = {}
    for p in activos:
        if p["ref"] or not p["creado_por"]:
            continue
        f = fichas.get(p["cliente"])
        if f and f["documento"]:
            por_doc.setdefault(f["documento"], []).append((p, f))
    pares = []
    for p in activos:
        if not p["ref"] or p["creado_por"]:
            continue
        f = fichas.get(p["cliente"])
        if not f:
            continue
        cedula = doc_exp.get(str(f["disapp_id"] or ""), "")
        cands = [(n, fn) for n, fn in por_doc.get(cedula, []) if fn["id"] != f["id"]] if cedula else []
        exactos = [(n, fn) for n, fn in cands
                   if n["cobrador"] == p["cobrador"] and abs(n["monto"] - p["monto"]) < 0.5
                   and (not (p["fecha"] and n["fecha"]) or abs((p["fecha"] - n["fecha"]).days) <= 7)]
        forzado = p["ref"] in incluir
        if forzado and not exactos and cands:
            exactos = [max(cands, key=lambda x: (x[0]["cobrador"] == p["cobrador"], -abs(x[0]["monto"] - p["monto"])))]
        if len(exactos) == 1:
            n, fn = exactos[0]
            pares.append({"imp": p, "nat": n, "ficha_imp": f, "ficha_nat": fn, "cedula": cedula,
                          "forzado": forzado})
        elif len(exactos) > 1:
            print(f"  ⚠ {p['ref']} {f['nombre']}: {len(exactos)} nativos candidatos → NO se toca (revisar a mano)")
    return pares


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=r"C:\Users\Carlos\migracion")
    ap.add_argument("--env-file", default=".env.local")
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--incluir", action="append", default=[], help="ref de Disapp a unificar aunque no sea exacto")
    ap.add_argument("--solo", action="append", default=[],
                    help="procesar SOLO estas refs (para aplicar primero los pares sin ambigüedad)")
    a = ap.parse_args()

    cn = conectar(a.env_file)
    cur = cn.cursor()
    cur.execute("select id::text from usuarios where rol='admin' and nombre ilike 'Carlos%%' limit 1")
    actor = cur.fetchone()
    actor_id = actor[0] if actor else None
    cur.execute("select id::text, nombre from usuarios")
    nombres_u = dict(cur.fetchall())

    pares = detectar(cur, a.src, set(a.incluir))
    if a.solo:
        pares = [p for p in pares if p["imp"]["ref"] in set(a.solo)]
    print("=" * 84)
    print(f"  {'DRY-RUN' if not a.commit else '🔴 COMMIT'} — unificar {len(pares)} pares ficha doble → nativo")
    print("=" * 84)
    if not pares:
        print("  nada que unificar")
        return

    plan = []
    for par in pares:
        I, N = par["imp"], par["nat"]
        cur.execute("""
            select id::text, dia_credito, monto, registrado_en, registrado_por::text, disapp_pago_id, gps_lat, gps_lng
              from pagos where prestamo_id = %s and anulado = false order by registrado_en
        """, (I["id"],))
        pagos_I = [{"id": r[0], "dia_credito": r[1], "monto": float(r[2]), "registrado_en": r[3],
                    "registrado_por": r[4], "folio": r[5], "gps_lat": r[6], "gps_lng": r[7]} for r in cur.fetchall()]
        cur.execute("""
            select id::text, dia_credito, monto, registrado_en, origen, disapp_pago_id
              from pagos where prestamo_id = %s and anulado = false
        """, (N["id"],))
        pagos_N = [{"prestamo_id": N["id"], "dia_credito": r[1], "monto": float(r[2]),
                    "registrado_en": r[3].isoformat() if r[3] else None, "origen": r[4], "disapp_pago_id": r[5]}
                   for r in cur.fetchall()]
        # La guardia de siempre, contra TODOS los pagos vivos del nativo (nativos e importados).
        por_dia, por_cuota = G.indices_nativos(pagos_N)
        mover, dup = [], []
        total_N = N["cuota"] * N["dias"]
        acum = N["pagado"]
        for pg in pagos_I:
            fila = {"prestamo_id": N["id"], "dia_credito": pg["dia_credito"], "monto": pg["monto"],
                    "registrado_en": pg["registrado_en"].isoformat() if pg["registrado_en"] else None}
            if G.es_duplicado(fila, por_dia, por_cuota):
                dup.append(pg)
            elif acum + pg["monto"] > total_N + 1:
                dup.append(pg | {"_motivo": "no cabe en el total del nativo"})
            else:
                mover.append(pg)
                acum += pg["monto"]
        # ¿La ficha importada queda sin créditos activos? → se baja con sus asignaciones.
        cur.execute("select count(*) from prestamos where cliente_id = %s and estado='activo' and id <> %s",
                    (par["ficha_imp"]["id"], I["id"]))
        otros = cur.fetchone()[0]
        plan.append({"par": par, "pagos_I": pagos_I, "mover": mover, "dup": dup, "bajar_ficha": otros == 0})

    tot_mov = sum(p["monto"] for x in plan for p in x["mover"])
    tot_dup = sum(p["monto"] for x in plan for p in x["dup"])
    print(f"\n  {'ref import':15} {'cobrador':16} {'monto':>8} {'pag.imp':>8} {'pag.nat':>8} {'mueven':>7} {'anulan':>7} ficha  cliente")
    print("  " + "-" * 100)
    for x in plan:
        I, N = x["par"]["imp"], x["par"]["nat"]
        print(f"  {I['ref']:15} {str(nombres_u.get(I['cobrador'],'?'))[:16]:16} {money(I['monto']):>8} {money(I['pagado']):>8} "
              f"{money(N['pagado']):>8} {money(sum(p['monto'] for p in x['mover'])):>7} {money(sum(p['monto'] for p in x['dup'])):>7} "
              f"{'baja' if x['bajar_ficha'] else 'queda':5}  {x['par']['ficha_imp']['nombre'][:26]}{' (forzado)' if x['par']['forzado'] else ''}")
    print(f"\n  pagos que SE MUEVEN al nativo: {sum(len(x['mover']) for x in plan)} ({money(tot_mov)})")
    print(f"  pagos que se ANULAN por ya estar en el nativo: {sum(len(x['dup']) for x in plan)} ({money(tot_dup)})")
    print(f"  créditos importados que se CANCELAN: {len(plan)} · fichas que se bajan: {sum(1 for x in plan if x['bajar_ficha'])}")

    if not a.commit:
        print("\n  🟡 DRY-RUN: no se escribió nada. Aplicar con --commit.\n")
        cur.close(); cn.close()
        return

    # ── COMMIT: una transacción, verificación adentro ──────────────────────
    revert = {"sello": SELLO, "pares": []}
    try:
        cn.autocommit = False
        for x in plan:
            I, N = x["par"]["imp"], x["par"]["nat"]
            fI = x["par"]["ficha_imp"]
            antes = sum(p["monto"] for p in x["pagos_I"]) + N["pagado"]
            r = {"imp": I["id"], "nat": N["id"], "ficha_imp": fI["id"], "anulados": [], "insertados": [],
                 "ref": I["ref"], "cid": I["cid"], "asig_bajadas": [], "ficha_bajada": False}
            # 1) anular TODOS los pagos del importado (los movidos y los duplicados), con motivo distinto
            for pg in x["dup"]:
                cur.execute("""update pagos set anulado=true, anulado_por=%s, anulado_en=now(),
                               motivo_anulacion=%s where id=%s and anulado=false""",
                            (actor_id, MOTIVO + " — ya estaba en el nativo", pg["id"]))
                r["anulados"].append(pg["id"])
            for pg in x["mover"]:
                cur.execute("""update pagos set anulado=true, anulado_por=%s, anulado_en=now(),
                               motivo_anulacion=%s where id=%s and anulado=false""",
                            (actor_id, MOTIVO + f" — movido al nativo {N['id'][:8]}", pg["id"]))
                r["anulados"].append(pg["id"])
                nuevo = str(uuid.uuid4())
                cur.execute("""insert into pagos (id, prestamo_id, dia_credito, monto, registrado_por, registrado_en,
                                                  gps_lat, gps_lng, origen, disapp_pago_id, disapp_credit_ref, op_id)
                               values (%s, %s, %s, %s, %s, %s, %s, %s, 'disapp_import', %s, %s, %s)""",
                            (nuevo, N["id"], pg["dia_credito"], pg["monto"], pg["registrado_por"], pg["registrado_en"],
                             pg["gps_lat"], pg["gps_lng"], f"{pg['folio']}:mov", I["ref"], str(uuid.uuid4())))
                r["insertados"].append(nuevo)
            # 2) cancelar el importado y liberar su ref; pegar la ref al nativo si no tiene
            cur.execute("""update prestamos set estado='cancelado', disapp_credit_ref = disapp_credit_ref || ':doble-' || %s,
                           disapp_credit_id = null where id=%s""", (SELLO, I["id"]))
            if not N["ref"]:
                cur.execute("update prestamos set disapp_credit_ref=%s, disapp_credit_id=%s where id=%s",
                            (I["ref"], I["cid"], N["id"]))
            # 3) bajar la ficha doble y sus asignaciones si no le queda nada activo
            if x["bajar_ficha"]:
                cur.execute("update asignaciones set activo=false where cliente_id=%s and activo=true returning id::text", (fI["id"],))
                r["asig_bajadas"] = [row[0] for row in cur.fetchall()]
                cur.execute("update clientes set activo=false where id=%s", (fI["id"],))
                r["ficha_bajada"] = True
            # 4) rastro
            cur.execute("""insert into auditoria (actor_id, actor_nombre, accion, entidad, entidad_id, detalle)
                           values (%s, 'Carlos', 'Unificó ficha doble del empalme (06-09)', 'cliente', %s, %s)""",
                        (actor_id, x["par"]["ficha_nat"]["id"],
                         f"{I['ref']} ({money(I['monto'])}) → nativo {N['id'][:8]}: {len(x['mover'])} pagos movidos "
                         f"({money(sum(p['monto'] for p in x['mover']))}), {len(x['dup'])} anulados por duplicados; "
                         f"ficha doble {fI['id'][:8]} {'bajada' if x['bajar_ficha'] else 'sigue (tiene otro crédito)'}"))
            # 5) VERIFICAR (los triggers recalculan pagado_acum)
            cur.execute("select estado, pagado_acum from prestamos where id=%s", (I["id"],))
            eI, pI = cur.fetchone()
            cur.execute("select pagado_acum, disapp_credit_ref from prestamos where id=%s", (N["id"],))
            pN, refN = cur.fetchone()
            esperado_N = N["pagado"] + sum(p["monto"] for p in x["mover"])
            if eI != "cancelado" or float(pI) > 0.5 or abs(float(pN) - esperado_N) > 0.5 or refN is None:
                raise RuntimeError(f"verificación falló en {I['ref']}: estado={eI} pag_imp={pI} pag_nat={pN} esperado={esperado_N} ref={refN}")
            # ningún peso perdido: antes = después + duplicados
            despues = float(pN) + float(pI)
            if abs(antes - (despues + sum(p["monto"] for p in x["dup"]))) > 0.5:
                raise RuntimeError(f"balance no cierra en {I['ref']}: antes {antes} vs después {despues} + dup")
            revert["pares"].append(r)
        cn.commit()
        ruta = os.path.join(HERE, f"_unificar_fichas_revert_{SELLO}.json")
        with open(ruta, "w", encoding="utf-8") as fh:
            json.dump(revert, fh, ensure_ascii=False, indent=1)
        print(f"\n  ✅ COMMIT: {len(plan)} pares unificados, verificados dentro de la transacción. Revert → {ruta}\n")
    except Exception as e:
        cn.rollback()
        print(f"\n  🔴 ROLLBACK — no se escribió nada: {e}\n")
        raise
    finally:
        cur.close()
        cn.close()


if __name__ == "__main__":
    main()
