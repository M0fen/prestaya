# -*- coding: utf-8 -*-
"""
UNIFICAR la misma persona con dos fichas y dos créditos por el mismo préstamo.

El incidente (06-09): el empalme creó una ficha de oficina (documento NULL) para
un cliente que ya existía como ficha de censo con un crédito NATIVO activo del
mismo cobrador, mismo monto, a 1-2 días. Dos deudas por una plata, las dos en ruta.
Regla: LA APP MANDA. Queda el nativo con la ref; el importado se cancela.

REGLA DEL CORTE (07-09, medida en los 7 pares): el cobrador usó la app hasta una
fecha (su último pago nativo = `corte`) y de ahí en más la oficina siguió el libro
en Disapp. En TODOS los pares limpios, Σ(importados hasta el corte) == Σ(nativos)
al peso — son las mismas cuotas, a veces cargadas en la app como un solo bulto.
  · importados con fecha ≤ corte → se ANULAN ("ya está en el nativo")
  · importados con fecha > corte → se REPONEN sobre el nativo (origen
    'disapp_import', folio + ':mov'): son la continuación del cobro
  · el nativo debe terminar EXACTO en el `Pagos` de Disapp para esa ref; si no
    cierra al peso, el par NO se toca (queda para un humano)
  · si el importado tiene pagos NATIVOS encima (alguien cobró sobre la ficha
    doble), el par NO se toca: eso lo decide una persona.
Después, la ficha doble se vacía: TODOS sus créditos (activos o no) pasan a la
ficha nativa, el `disapp_id` se muda a la nativa (así el próximo empalme resuelve a
la ficha correcta) y la doble se baja con sus asignaciones. Nada se borra.

  python scripts/unificar-fichas-dobles.py                      → DRY-RUN (default)
  python scripts/unificar-fichas-dobles.py --commit             → aplica, en UNA transacción
  python scripts/unificar-fichas-dobles.py --incluir PRD... --solo PRD...
        → --incluir suma refs "probables" (misma cédula + cobrador + monto, a más de
          7 días); --solo procesa únicamente esas refs.

Verificación DENTRO de la transacción (una diferencia = rollback). Deja un JSON de
revert con todos los ids tocados.
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
from zoneinfo import ZoneInfo

import pg8000.dbapi

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import empalme_disapp as E  # noqa: E402

UY = ZoneInfo("America/Montevideo")
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


def dia_uy(ts):
    return ts.astimezone(UY).date() if ts.tzinfo else ts.date()


def detectar(cur, src, incluir):
    """Los pares (import, nativo). Mismo criterio que diagnostico-fichas-dobles."""
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
    ap.add_argument("--incluir", action="append", default=[], help="ref de Disapp a unificar aunque esté a más de 7 días")
    ap.add_argument("--solo", action="append", default=[],
                    help="procesar SOLO estas refs (para aplicar primero los pares sin ambigüedad)")
    a = ap.parse_args()

    creditos_exp, _, _ = E.load_creditos(a.src)
    target_exp = {c["ref"]: float(c.get("pagos_disapp") or 0) for c in creditos_exp.values()
                  if c["ref"] and (c.get("estado_disapp") or "").lower() in ("activo", "")}

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
    print("=" * 96)
    print(f"  {'DRY-RUN' if not a.commit else '🔴 COMMIT'} — unificar {len(pares)} pares ficha doble → nativo")
    print("=" * 96)
    if not pares:
        print("  nada que unificar")
        return

    plan, saltados = [], []
    for par in pares:
        I, N = par["imp"], par["nat"]
        nombre = par["ficha_imp"]["nombre"][:26]
        cur.execute("""
            select id::text, dia_credito, monto, registrado_en, registrado_por::text, disapp_pago_id, gps_lat, gps_lng, origen
              from pagos where prestamo_id = %s and anulado = false order by registrado_en
        """, (I["id"],))
        pagos_I = [{"id": r[0], "dia_credito": r[1], "monto": float(r[2]), "registrado_en": r[3],
                    "registrado_por": r[4], "folio": r[5], "gps_lat": r[6], "gps_lng": r[7], "origen": r[8]}
                   for r in cur.fetchall()]
        if any(p["origen"] is None for p in pagos_I):
            saltados.append((I["ref"], nombre, f"el importado tiene {sum(1 for p in pagos_I if p['origen'] is None)} pagos NATIVOS encima "
                             f"({money(sum(p['monto'] for p in pagos_I if p['origen'] is None))}): lo decide una persona"))
            continue
        cur.execute("""select monto, registrado_en, origen from pagos where prestamo_id = %s and anulado = false""", (N["id"],))
        pagos_N = [{"monto": float(r[0]), "registrado_en": r[1], "origen": r[2]} for r in cur.fetchall()]
        nativos_N = [p for p in pagos_N if p["origen"] is None]
        corte = max((dia_uy(p["registrado_en"]) for p in nativos_N), default=None)
        cubiertos = [p for p in pagos_I if corte and dia_uy(p["registrado_en"]) <= corte]
        mover = [p for p in pagos_I if not corte or dia_uy(p["registrado_en"]) > corte]
        suma_cub = sum(p["monto"] for p in cubiertos)
        suma_nat = sum(p["monto"] for p in nativos_N)
        if abs(suma_cub - suma_nat) > 0.5:
            saltados.append((I["ref"], nombre, f"hasta el corte {corte} el importado suma {money(suma_cub)} y el nativo {money(suma_nat)}: no es el mismo libro"))
            continue
        # El nativo debe terminar EXACTO en el libro de Disapp para esa ref.
        target = target_exp.get(I["ref"])
        origen_target = "Pagos de Disapp (export)"
        if target is None:  # la ref ya no está activa en Disapp (se pagó): el importado ES el libro completo
            target = I["pagado"]
            origen_target = "pagado del importado (ref ya cerrada en Disapp)"
        esperado = N["pagado"] + sum(p["monto"] for p in mover)
        if abs(esperado - target) > 0.5:
            saltados.append((I["ref"], nombre, f"el nativo terminaría en {money(esperado)} y Disapp dice {money(target)} ({origen_target})"))
            continue
        # Todo lo que cuelga de la ficha doble pasa a la nativa.
        cur.execute("select id::text, disapp_credit_ref, estado from prestamos where cliente_id = %s and id <> %s",
                    (par["ficha_imp"]["id"], I["id"]))
        otros = [{"id": r[0], "ref": r[1], "estado": r[2]} for r in cur.fetchall()]
        plan.append({"par": par, "pagos_I": pagos_I, "mover": mover, "cubiertos": cubiertos, "corte": corte,
                     "target": target, "origen_target": origen_target, "esperado": esperado, "otros": otros})

    if saltados:
        print("\n  NO se tocan (para Mauricio):")
        for ref, nombre, why in saltados:
            print(f"    · {ref} {nombre}: {why}")

    print(f"\n  {'ref import':15} {'cobrador':16} {'monto':>8} {'pag.imp':>8} {'pag.nat':>8} {'corte':10} {'anulan':>7} {'mueven':>7} {'termina':>8} {'Disapp':>8} otros  cliente")
    print("  " + "-" * 120)
    for x in plan:
        I, N = x["par"]["imp"], x["par"]["nat"]
        print(f"  {I['ref']:15} {str(nombres_u.get(I['cobrador'],'?'))[:16]:16} {money(I['monto']):>8} {money(I['pagado']):>8} "
              f"{money(N['pagado']):>8} {str(x['corte'] or '-'):10} {money(sum(p['monto'] for p in x['cubiertos'])):>7} "
              f"{money(sum(p['monto'] for p in x['mover'])):>7} {money(x['esperado']):>8} {money(x['target']):>8} {len(x['otros']):5}  "
              f"{x['par']['ficha_imp']['nombre'][:26]}{' (forzado)' if x['par']['forzado'] else ''}")
        for o in x["otros"]:
            print(f"        ↳ también pasa a la ficha nativa: {o['ref'] or o['id'][:8]} ({o['estado']})")
    print(f"\n  pagos que se ANULAN por estar ya en el nativo (hasta el corte): {sum(len(x['cubiertos']) for x in plan)} "
          f"({money(sum(p['monto'] for x in plan for p in x['cubiertos']))})")
    print(f"  pagos que SE MUEVEN al nativo (después del corte): {sum(len(x['mover']) for x in plan)} "
          f"({money(sum(p['monto'] for x in plan for p in x['mover']))})")
    print(f"  créditos importados que se CANCELAN: {len(plan)} · fichas dobles que se bajan: {len(plan)} · "
          f"créditos que cambian de ficha: {sum(len(x['otros']) for x in plan)}")

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
            fI, fN = x["par"]["ficha_imp"], x["par"]["ficha_nat"]
            antes = sum(p["monto"] for p in x["pagos_I"]) + N["pagado"]
            r = {"imp": I["id"], "nat": N["id"], "ficha_imp": fI["id"], "ficha_nat": fN["id"], "anulados": [],
                 "insertados": [], "ref": I["ref"], "cid": I["cid"], "asig_bajadas": [], "disapp_id": fI["disapp_id"],
                 "creditos_movidos": [o["id"] for o in x["otros"]]}
            # 1) anular los pagos del importado: cubiertos (ya en el nativo) y movidos (se reponen)
            for pg in x["cubiertos"]:
                cur.execute("""update pagos set anulado=true, anulado_por=%s, anulado_en=now(),
                               motivo_anulacion=%s where id=%s and anulado=false""",
                            (actor_id, MOTIVO + f" — ya estaba en el nativo (cobrado en la app hasta el {x['corte']})", pg["id"]))
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
            cur.execute("""update prestamos set estado='cancelado', finalizado_en=now(),
                           disapp_credit_ref = disapp_credit_ref || ':doble-' || %s, disapp_credit_id = null
                           where id=%s and estado='activo'""", (SELLO, I["id"]))
            if cur.rowcount != 1:
                raise RuntimeError(f"{I['ref']}: el importado ya no estaba activo")
            if not N["ref"]:
                cur.execute("update prestamos set disapp_credit_ref=%s, disapp_credit_id=%s where id=%s",
                            (I["ref"], I["cid"], N["id"]))
            # 3) vaciar la ficha doble hacia la nativa: créditos, disapp_id, asignaciones, baja
            cur.execute("update prestamos set cliente_id=%s where cliente_id=%s returning id::text", (fN["id"], fI["id"]))
            movidos = [row[0] for row in cur.fetchall()]
            cur.execute("update clientes set disapp_id=null, activo=false where id=%s", (fI["id"],))
            if fI["disapp_id"] and not fN["disapp_id"]:
                cur.execute("update clientes set disapp_id=%s where id=%s", (fI["disapp_id"], fN["id"]))
            cur.execute("update asignaciones set activo=false where cliente_id=%s and activo=true returning id::text", (fI["id"],))
            r["asig_bajadas"] = [row[0] for row in cur.fetchall()]
            # 4) rastro
            cur.execute("""insert into auditoria (actor_id, actor_nombre, accion, entidad, entidad_id, detalle)
                           values (%s, 'Carlos', 'Unificó ficha doble del empalme (06-09)', 'cliente', %s, %s)""",
                        (actor_id, fN["id"],
                         f"{I['ref']} ({money(I['monto'])}) → nativo {N['id'][:8]}: {len(x['cubiertos'])} pagos anulados por estar ya en el nativo "
                         f"({money(sum(p['monto'] for p in x['cubiertos']))}, cobrados en la app hasta el {x['corte']}), {len(x['mover'])} movidos "
                         f"({money(sum(p['monto'] for p in x['mover']))}); el nativo queda en {money(x['esperado'])} = Disapp; "
                         f"ficha doble {fI['id'][:8]} bajada, {len(movidos) - 1} créditos más pasaron a esta ficha"))
            # 5) VERIFICAR (los triggers recalculan pagado_acum)
            cur.execute("select estado, pagado_acum, cliente_id::text from prestamos where id=%s", (I["id"],))
            eI, pI, cI = cur.fetchone()
            cur.execute("select pagado_acum, disapp_credit_ref, cliente_id::text from prestamos where id=%s", (N["id"],))
            pN, refN, cN = cur.fetchone()
            if eI != "cancelado" or float(pI) > 0.5 or abs(float(pN) - x["esperado"]) > 0.5 or refN != I["ref"] or cI != fN["id"] or cN != fN["id"]:
                raise RuntimeError(f"verificación falló en {I['ref']}: estado={eI} pag_imp={pI} pag_nat={pN} esperado={x['esperado']} ref={refN}")
            despues = float(pN) + float(pI)
            if abs(antes - (despues + sum(p["monto"] for p in x["cubiertos"]))) > 0.5:
                raise RuntimeError(f"balance no cierra en {I['ref']}: antes {antes} vs después {despues} + cubiertos")
            cur.execute("select count(*) from prestamos where cliente_id=%s", (fI["id"],))
            if cur.fetchone()[0] != 0:
                raise RuntimeError(f"la ficha doble {fI['id'][:8]} sigue con créditos")
            cur.execute("select disapp_id, activo from clientes where id=%s", (fN["id"],))
            dN, aN = cur.fetchone()
            if not aN or (fI["disapp_id"] and str(dN) != str(fI["disapp_id"]) and fN["disapp_id"]):
                raise RuntimeError(f"la ficha nativa {fN['id'][:8]} quedó mal: disapp_id={dN} activo={aN}")
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
