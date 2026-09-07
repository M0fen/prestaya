# -*- coding: utf-8 -*-
"""
ESPEJO DE ACTIVOS: lo que Disapp ya no lista como activo, acá tampoco.

El empalme (paso 6) NUNCA cierra un crédito de un cobrador que opera en la app
("la app manda": el export podía venir sin esa zona), y tampoco cierra deuda viva
por ausencia (candado 08-05). Con un export COMPLETO (todas las zonas, 2.881
activos el 06-09) esos dos candados dejan vivos, en las rutas del piloto, cientos
de créditos que Disapp ya cerró. Este script los clasifica y —con --aplicar— los
cierra como Disapp los cerró, en UNA transacción con verificación adentro:

  saldado      falta < $1 y sin sobre-pago       → finalizado (no debe un peso; Disapp no lo lista)
  sobrepagado  pagado > total                    → finalizado (ídem; el EXCESO no se toca: queda listado
                                                   para conciliar — es plata registrada dos veces o de más)
  con deuda    → refinanciado  si Disapp tiene un crédito ACTIVO más nuevo del mismo cliente
                                (misma ficha o ficha gemela: misma cédula / mismo nombre)
               → finalizado    si Disapp lo cerró sin renovar y la app no lo cobra desde el 17-08
               → dejar         si el cliente fue BORRADO en Disapp (regla 08-04: se sigue cobrando)
                                o la app lo sigue cobrando (pago nativo desde el 17-08)

Nunca se toca un pago. Nunca se borra nada. Cada crédito cerrado deja su fila en
auditoría (con lo que faltaba o sobraba) y el JSON de revert lista los ids.

  python scripts/espejo-activos-disapp.py              → informe (solo lectura)
  python scripts/espejo-activos-disapp.py --csv        → + CSV con todas las filas
  python scripts/espejo-activos-disapp.py --aplicar    → cierra (transacción + verificación + revert JSON)
"""
import argparse
import csv
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
PILOTO_DESDE = dt.date(2026, 8, 17)  # desde acá un pago nativo dice "la app lo cobra"
ACCION = "Cerró un crédito que Disapp ya no lista como activo (espejo 07-09)"


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


def nombre_norm(s):
    s = re.sub(r"\s+", " ", (s or "").strip().upper())
    return re.sub(r"[^A-Z0-9 ]", "", s.translate(str.maketrans("ÁÉÍÓÚÜÑ", "AEIOUUN")))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=r"C:\Users\Carlos\migracion")
    ap.add_argument("--env-file", default=".env.local")
    ap.add_argument("--csv", action="store_true")
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--ignorar", action="append", default=[], help="ref que NO se toca (decisión humana pendiente)")
    a = ap.parse_args()
    refs_ignoradas = set(a.ignorar)

    clientes_exp, _, _ = E.load_clientes(a.src)
    creditos_exp, _, _ = E.load_creditos(a.src)
    estados = {}
    activos_por_cli, refs_activas = {}, set()
    for c in creditos_exp.values():
        est = (c.get("estado_disapp") or "").strip()
        estados[est] = estados.get(est, 0) + 1
        if c["ref"] and est.lower() in ("activo", ""):
            refs_activas.add(c["ref"])
            activos_por_cli.setdefault(str(c.get("id_cliente")), []).append(c)
    if len(refs_activas) < 2000:
        # Un export chico es un export PARCIAL (una zona): con ése, "ausente" no dice nada.
        raise SystemExit(f"  ⛔ el export trae solo {len(refs_activas)} activos: parece parcial. No se cierra nada.")
    print(f"  export de créditos: {estados} · activos con ref {len(refs_activas)} · clientes {len(clientes_exp)}")

    # La misma persona con dos fichas en Disapp (243 cédulas repetidas): la renovación
    # puede vivir bajo la otra. Se agrupan por cédula y por nombre normalizado.
    fichas_de = {}
    for did, c in clientes_exp.items():
        for k in (("doc", c.get("documento_original")), ("nom", nombre_norm(c.get("nombre")))):
            if k[1]:
                fichas_de.setdefault(k, set()).add(did)

    def gemelas(did):
        c = clientes_exp.get(did)
        if not c:
            return set()
        out = set()
        for k in (("doc", c.get("documento_original")), ("nom", nombre_norm(c.get("nombre")))):
            if k[1]:
                out |= fichas_de.get(k, set())
        out.discard(did)
        return out

    cn = conectar(a.env_file)
    cur = cn.cursor()
    cur.execute("select id::text from usuarios where rol='admin' and nombre ilike 'Carlos%%' limit 1")
    actor = cur.fetchone()
    actor_id = actor[0] if actor else None
    cur.execute("""
        select p.id::text, p.disapp_credit_ref, p.cliente_id::text, cl.nombre, cl.disapp_id, u.nombre,
               p.monto_prestado, p.cuota_diaria, p.total_dias, p.pagado_acum, p.fecha_inicio, p.frecuencia,
               (select max(registrado_en) from pagos g where g.prestamo_id = p.id and g.anulado=false and g.origen is null) as ult_nativo,
               (select max(registrado_en) from pagos g where g.prestamo_id = p.id and g.anulado=false and g.origen='disapp_import') as ult_import,
               (select string_agg(coalesce(q.disapp_credit_ref, 'nativo:' || left(q.id::text, 8)) || ' ' || round(q.monto_prestado)
                                  || ' pag ' || round(q.pagado_acum) || ' ini ' || q.fecha_inicio, ' | ' order by q.fecha_inicio)
                  from prestamos q where q.cliente_id = p.cliente_id and q.id <> p.id and q.estado = 'activo') as otros_app
          from prestamos p join clientes cl on cl.id = p.cliente_id left join usuarios u on u.id = p.cobrador_id
         where p.estado='activo' and p.disapp_credit_ref is not null
    """)
    filas = []
    for r in cur.fetchall():
        ref = str(r[1])
        if ref in refs_activas:
            continue
        if ref in refs_ignoradas:
            continue
        total = round(float(r[7] or 0) * int(r[8] or 0), 2)
        pagado = round(float(r[9] or 0), 2)
        falta = max(0.0, total - pagado)
        exceso = max(0.0, pagado - total)
        did = str(r[4] or "")
        inicio = r[10]
        ult_nat = r[12]
        ult_imp = r[13]
        cobra_app = bool(ult_nat and ult_nat.date() >= PILOTO_DESDE)
        fila = {
            "prestamo_id": r[0], "ref": ref, "cliente_id": r[2], "cliente": r[3], "cobrador": r[5] or "?",
            "frecuencia": r[11], "monto": float(r[6] or 0), "pagado": pagado, "total": total,
            "falta": falta, "exceso": exceso, "inicio": inicio,
            "ult_nativo": ult_nat.date() if ult_nat else None, "ult_import": ult_imp.date() if ult_imp else None,
            "otros_activos_app": r[14] or "", "renovado_en_disapp": "",
        }
        if falta < 1:
            fila["clase"] = "sobrepagado" if exceso > 1 else "saldado"
            fila["nuevo_estado"] = "finalizado"
            fila["motivo"] = ("no debe un peso y Disapp ya no lo lista" +
                              (f"; sobra {money(exceso)} registrado (a conciliar, no se toca)" if exceso > 1 else ""))
        else:
            fila["clase"] = "con deuda"
            nuevos = sorted((c for c in activos_por_cli.get(did, []) if c["fecha"] and inicio and c["fecha"] > inicio),
                            key=lambda c: c["fecha"])
            nuevos_gem = sorted((c for g in gemelas(did) for c in activos_por_cli.get(g, [])
                                 if c["fecha"] and inicio and c["fecha"] > inicio), key=lambda c: c["fecha"])
            if did not in clientes_exp:
                fila["nuevo_estado"], fila["motivo"] = None, "cliente BORRADO en Disapp: se sigue cobrando (regla 08-04)"
            elif nuevos or nuevos_gem:
                n = (nuevos or nuevos_gem)[0]
                fila["renovado_en_disapp"] = n["ref"]
                fila["nuevo_estado"] = "refinanciado"
                fila["motivo"] = (f"Disapp lo renovó{'' if nuevos else ' bajo otra ficha (' + str(n['id_cliente']) + ')'}: "
                                  f"{n['ref']} {money(n['monto_prestado'])} del {n['fecha']}; faltaban {money(falta)}")
            elif cobra_app:
                fila["nuevo_estado"], fila["motivo"] = None, f"la app lo sigue cobrando (último pago nativo {ult_nat.date()})"
            else:
                fila["nuevo_estado"] = "finalizado"
                fila["motivo"] = (f"Disapp lo cerró sin renovar y la app no lo cobra desde el {PILOTO_DESDE:%d-%m}; "
                                  f"faltaban {money(falta)}" + (f"; otro activo acá: {fila['otros_activos_app']}" if fila["otros_activos_app"] else ""))
        filas.append(fila)

    cerrar = [f for f in filas if f["nuevo_estado"]]
    dejar = [f for f in filas if not f["nuevo_estado"]]
    print("=" * 100)
    print(f"  {len(filas)} créditos ACTIVOS acá con ref que Disapp ya NO lista como activo")
    print("=" * 100)
    for clase in ("saldado", "sobrepagado", "con deuda"):
        lst = [f for f in filas if f["clase"] == clase]
        print(f"  {clase:12} {len(lst):>4}   falta {money(sum(f['falta'] for f in lst)):>12}   exceso {money(sum(f['exceso'] for f in lst)):>12}")
    print(f"\n  → cerrar {len(cerrar)}: " + ", ".join(f"{k} {sum(1 for f in cerrar if f['nuevo_estado']==k)}" for k in ("finalizado", "refinanciado"))
          + f" · dejar {len(dejar)} (deuda {money(sum(f['falta'] for f in dejar))})")

    def tabla(titulo, lst):
        if not lst:
            return
        print(f"\n  ── {titulo} ({len(lst)}) ──")
        print(f"  {'estado':12} {'ref':15} {'cobrador':16} {'frec':8} {'inicio':10} {'monto':>8} {'pagado':>8} {'total':>8} {'ult.nat':10} {'ult.imp':10}  cliente · motivo")
        for f in sorted(lst, key=lambda x: (-x["falta"], -x["exceso"])):
            print(f"  {str(f['nuevo_estado'] or 'DEJAR'):12} {f['ref']:15} {str(f['cobrador'])[:16]:16} {str(f['frecuencia'])[:8]:8} {str(f['inicio'] or '-'):10} "
                  f"{money(f['monto']):>8} {money(f['pagado']):>8} {money(f['total']):>8} {str(f['ult_nativo'] or '-'):10} {str(f['ult_import'] or '-'):10}  "
                  f"{str(f['cliente'])[:24]} · {f['motivo']}")

    tabla("CON DEUDA", [f for f in filas if f["clase"] == "con deuda"])
    sob = sorted([f for f in filas if f["clase"] == "sobrepagado"], key=lambda x: -x["exceso"])
    tabla("SOBREPAGADOS — los 25 con más exceso (todos en el CSV)", sob[:25])
    print(f"\n  saldados exactos: {sum(1 for f in filas if f['clase']=='saldado')} (todos en el CSV)")

    if a.csv:
        ruta = os.path.join(HERE, f"_espejo_activos_{SELLO}.csv")
        cols = ["clase", "nuevo_estado", "ref", "cliente", "cobrador", "frecuencia", "inicio", "monto", "pagado", "total",
                "falta", "exceso", "ult_nativo", "ult_import", "renovado_en_disapp", "otros_activos_app", "motivo",
                "prestamo_id", "cliente_id"]
        with open(ruta, "w", newline="", encoding="utf-8-sig") as fh:
            w = csv.writer(fh, delimiter=";")
            w.writerow(cols)
            for f in sorted(filas, key=lambda x: (x["clase"], -x["falta"], -x["exceso"])):
                w.writerow([f.get(c) for c in cols])
        print(f"\n  CSV: {ruta}")

    if not a.aplicar:
        print(f"\n  🟡 DRY-RUN: se cerrarían {len(cerrar)}. Aplicar con --aplicar.\n")
        cur.close(); cn.close()
        return

    # ── APLICAR: una transacción, verificación adentro, revert JSON ──────────
    ids = [f["prestamo_id"] for f in cerrar]
    try:
        cn.autocommit = False
        cur.execute("select count(*) from prestamos where estado='activo'")
        activos_antes = cur.fetchone()[0]
        cur.execute("select coalesce(sum(pagado_acum),0) from prestamos where id = any(%s::uuid[])", (ids,))
        pagado_antes = float(cur.fetchone()[0])
        for f in cerrar:
            if f["nuevo_estado"] == "refinanciado":
                cur.execute("""update prestamos set estado='refinanciado', refinanciado_en=now(), finalizado_en=now()
                               where id=%s and estado='activo'""", (f["prestamo_id"],))
            else:
                cur.execute("""update prestamos set estado='finalizado', finalizado_en=now()
                               where id=%s and estado='activo'""", (f["prestamo_id"],))
            if cur.rowcount != 1:
                raise RuntimeError(f"{f['ref']}: no se pudo cerrar (¿ya no estaba activo?)")
            cur.execute("""insert into auditoria (actor_id, actor_nombre, accion, entidad, entidad_id, detalle)
                           values (%s, 'Carlos', %s, 'cliente', %s, %s)""",
                        (actor_id, ACCION, f["cliente_id"],
                         f"{f['ref']} ({money(f['monto'])}, pagado {money(f['pagado'])} de {money(f['total'])}) → {f['nuevo_estado']}: {f['motivo']}"))
        # Verificación: exactamente esos, ninguno más; los pagos no se tocaron.
        cur.execute("select count(*) from prestamos where id = any(%s::uuid[]) and estado='activo'", (ids,))
        if cur.fetchone()[0] != 0:
            raise RuntimeError("quedó alguno activo")
        cur.execute("select count(*) from prestamos where estado='activo'")
        if cur.fetchone()[0] != activos_antes - len(ids):
            raise RuntimeError("cambió un activo fuera del plan")
        cur.execute("select coalesce(sum(pagado_acum),0) from prestamos where id = any(%s::uuid[])", (ids,))
        if abs(float(cur.fetchone()[0]) - pagado_antes) > 0.5:
            raise RuntimeError("cambió pagado_acum: un pago se tocó")
        cur.execute("select count(*) from prestamos where id = any(%s::uuid[]) and estado='activo'",
                    ([f["prestamo_id"] for f in dejar] or ["00000000-0000-0000-0000-000000000000"],))
        if cur.fetchone()[0] != len(dejar):
            raise RuntimeError("se tocó uno de los 'dejar'")
        cn.commit()
        ruta = os.path.join(HERE, f"_espejo_activos_revert_{SELLO}.json")
        with open(ruta, "w", encoding="utf-8") as fh:
            json.dump({"sello": SELLO, "accion": ACCION,
                       "revert_sql": "update prestamos set estado='activo', finalizado_en=null, refinanciado_en=null where id = any(:ids)",
                       "cerrados": [{"id": f["prestamo_id"], "ref": f["ref"], "estado": f["nuevo_estado"], "clase": f["clase"]} for f in cerrar]},
                      fh, ensure_ascii=False, indent=1)
        print(f"\n  ✅ COMMIT: {len(cerrar)} créditos cerrados como Disapp los cerró (activos {activos_antes} → {activos_antes - len(ids)}). "
              f"Rastro en auditoría. Revert → {ruta}\n")
    except Exception as e:
        cn.rollback()
        print(f"\n  🔴 ROLLBACK — no se escribió nada: {e}\n")
        raise
    finally:
        cur.close()
        cn.close()


if __name__ == "__main__":
    main()
