# -*- coding: utf-8 -*-
"""
ANULA los pagos que el empalme del 17-08 duplicó contra los cobros de la app.

QUÉ PASÓ. Esa noche se importaron los recaudos de Disapp mientras 17 cobradores
ya venían usando la app. La guardia anti-duplicado comparaba por (crédito, DÍA
CALENDARIO): el cobro que el cobrador hizo en la calle, anotó en Disapp con la
fecha de ayer y registró en la app hoy tenía días distintos y pasaba de largo. La
identidad de un cobro entre dos sistemas NO es el día en que alguien lo tipeó:
es la CUOTA que salda. El agujero ya se cerró (segunda guardia por cuota,
04-09); esto limpia lo que quedó.

QUÉ LADO SE ANULA: el IMPORTADO, nunca el nativo.
  1. La regla del empalme siempre fue "la app manda donde estuvo": el registro
     nativo tiene custodia, hora real y responsable.
  2. La guardia del importador se arma leyendo los pagos NATIVOS VIGENTES
     (`anulado: eq.false`, línea 121). Anular el lado nativo la dejaría ciega y
     el próximo import lo reinsertaría.
  3. El insert usa `resolution=ignore-duplicates` sobre el índice único
     `pagos_disapp_pago_id_uidx`, que NO es parcial: la fila anulada sigue
     ocupando su `disapp_pago_id`, así que el próximo import la saltea sola.
     LA ANULACIÓN SOBREVIVE al export fresco del fin de semana.

LAS CUATRO CONDICIONES (todas, o no se toca):
  a) mismo crédito, MISMA CUOTA y mismo monto (±$0,50), un pago importado y uno
     nativo;
  b) la cuota NO está saturada en el tope. El importador clampea
     (`if dc > td: dc = td`, línea 87): en un crédito vencido, todos los pagos
     que exceden el plazo caen en la última cuota, y ahí "misma cuota" ya no
     identifica el mismo cobro;
  c) los dos registros están a 7 días o menos — es el mismo cobro tipeado dos
     veces, no dos cobros iguales con semanas de diferencia;
  d) emparejamiento 1:1 (un importado con un solo nativo candidato).

Y sobre todo eso, LA REGLA DE ORO: **la corrección nunca deja a un cliente
debiendo**. Solo se anula mientras la quita quepa en el exceso del crédito. Si un
crédito tiene $550 de más y hay dos candidatos de $350, se anula UNO. Corregir un
sobre-cobro no puede fabricar una deuda.

Los pagos NO se borran jamás: se anulan con quién y por qué. `pagado_acum` lo
corrige solo el trigger `trg_pagos_acum` (0063). Queda log de reversa en JSON y
asiento en `auditoria` por cada crédito tocado.

  Dry-run:  python scripts/_anular-duplicados-empalme-0904.py
  Aplicar:  python scripts/_anular-duplicados-empalme-0904.py --commit --responsable "Nombre"
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
TOL = 1.0
VENTANA_DIAS = 7
MOTIVO = ("Duplicado del empalme del 17-08: el mismo cobro quedó registrado en la app y "
          "además se importó de Disapp con otra fecha (la guardia comparaba por día "
          "calendario, no por cuota). Se anula el lado importado; manda el registro nativo.")


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


# Candidatos: las cuatro condiciones (a)–(d) ya aplicadas en SQL.
SQL_CANDIDATOS = f"""
WITH imp AS (
  SELECT id, prestamo_id, dia_credito, monto, registrado_en
    FROM pagos WHERE anulado = false AND origen = 'disapp_import' AND dia_credito IS NOT NULL
), nat AS (
  SELECT id, prestamo_id, dia_credito, monto, registrado_en
    FROM pagos WHERE anulado = false AND origen IS NULL AND dia_credito IS NOT NULL
), par AS (
  SELECT imp.id pago_imp, nat.id pago_nat, p.id prestamo, cl.nombre cliente,
         u.nombre cobrador, imp.dia_credito cuota, p.total_dias, imp.monto,
         p.pagado_acum pagado, p.cuota_diaria * p.total_dias total, p.estado,
         abs(extract(epoch from (imp.registrado_en - nat.registrado_en)) / 86400.0) dias
    FROM imp
    JOIN nat ON nat.prestamo_id = imp.prestamo_id
            AND nat.dia_credito = imp.dia_credito
            AND abs(nat.monto - imp.monto) < 0.5
    JOIN prestamos p  ON p.id  = imp.prestamo_id
    JOIN clientes  cl ON cl.id = p.cliente_id
    LEFT JOIN usuarios u ON u.id = p.cobrador_id
   WHERE p.pagado_acum > p.cuota_diaria * p.total_dias + {TOL}   -- (evidencia dura)
     AND imp.dia_credito < p.total_dias                          -- (b) cuota no saturada
     AND abs(extract(epoch from (imp.registrado_en - nat.registrado_en)) / 86400.0) <= {VENTANA_DIAS}
), unicos AS (
  SELECT pago_imp FROM par GROUP BY pago_imp HAVING count(*) = 1  -- (d) 1:1
)
SELECT DISTINCT par.pago_imp, par.prestamo, par.cliente, par.cobrador, par.cuota,
       par.total_dias, par.monto, par.pagado, par.total, par.estado, par.dias
  FROM par JOIN unicos ON unicos.pago_imp = par.pago_imp
 ORDER BY par.monto DESC
"""


def main() -> None:
    quien_txt = responsable()
    if COMMIT and not quien_txt:
        print("\n🔴 Para aplicar hace falta --responsable \"Nombre\": el libro no admite "
              "una anulación anónima.\n")
        return

    cn = conectar()
    cur = cn.cursor()
    cur.execute(SQL_CANDIDATOS)
    cand = cur.fetchall()

    # ── LA REGLA DE ORO: no dejar debiendo a nadie ─────────────────────────
    # Se recorre por crédito, de mayor a menor monto, anulando solo mientras la
    # quita quepa en el exceso. Corregir un sobre-cobro no puede fabricar deuda.
    sobra = {}
    anular, frenados = [], []
    for (pid, prestamo, cliente, cobrador, cuota, td, monto, pagado, total, estado, dias) in cand:
        monto, pagado, total = float(monto), float(pagado), float(total)
        if prestamo not in sobra:
            sobra[prestamo] = pagado - total
        fila = {"pago_id": str(pid), "prestamo_id": str(prestamo), "cliente": cliente,
                "cobrador": cobrador, "cuota": f"{cuota}/{td}", "monto": monto,
                "pagado": pagado, "total": total, "estado": estado, "dias": round(float(dias), 1)}
        if monto <= sobra[prestamo] + TOL:
            sobra[prestamo] -= monto
            anular.append(fila)
        else:
            fila["por_que"] = (f"anularlo dejaría a {cliente} debiendo "
                               f"{money(monto - sobra[prestamo])}: solo sobran {money(sobra[prestamo])}")
            frenados.append(fila)

    print("=" * 96)
    print(f"  DUPLICADOS DEL EMPALME 17-08   {'🔴 APLICANDO' if COMMIT else '🟡 DRY-RUN'}")
    print("=" * 96)
    print(f"  candidatos que pasan las 4 condiciones : {len(cand)}")
    print(f"  ✅ SE ANULAN                           : {len(anular)}   {money(sum(a['monto'] for a in anular))}")
    print(f"  ⏸️  frenados por la regla de oro        : {len(frenados)}")
    print(f"  créditos tocados                       : {len({a['prestamo_id'] for a in anular})}")
    print()
    for a in anular:
        print(f"   {a['cliente'][:28]:28s} {str(a['cobrador'] or '—')[:16]:16s} cuota {a['cuota']:>7s} "
              f"{money(a['monto']):>9s}  pagó {money(a['pagado']):>10s}/{money(a['total']):<10s} "
              f"{a['estado']:11s} {a['dias']}d")
    if frenados:
        print("\n  Frenados (no se tocan):")
        for f in frenados:
            print(f"   {f['cliente'][:28]:28s} {money(f['monto']):>9s} — {f['por_que']}")

    if not COMMIT:
        print("\n🟡 DRY-RUN: no se escribió nada.")
        print('   Aplicar con: --commit --responsable "Tu nombre"\n')
        cur.close(); cn.close()
        return
    if not anular:
        print("\nNada que anular.\n")
        cur.close(); cn.close()
        return

    # Log de reversa ANTES de escribir: si algo sale mal, esta es la lista exacta.
    log = os.path.join(RAIZ, "scripts", f"_revert_duplicados_empalme_{dt.date.today():%Y%m%d}.json")
    with open(log, "w", encoding="utf-8") as fh:
        json.dump({"motivo": MOTIVO, "responsable": quien_txt, "pagos": anular},
                  fh, ensure_ascii=False, indent=1)

    # La base exige registrar QUIÉN anula (chk_pago_anulacion_completa).
    cur.execute("SELECT id, nombre FROM usuarios WHERE rol='admin' AND activo ORDER BY nombre LIMIT 1")
    fila = cur.fetchone()
    if not fila:
        print("\n🔴 No hay un admin activo para firmar la anulación. Abortado.")
        cur.close(); cn.close()
        return
    admin_id, admin_nombre = fila[0], fila[1]

    ids = [a["pago_id"] for a in anular]
    cur.execute("""
        UPDATE pagos
           SET anulado = true, anulado_en = now(), anulado_por = %s, motivo_anulacion = %s
         WHERE id = ANY(%s) AND anulado = false
    """, (admin_id, MOTIVO, ids))
    tocados = cur.rowcount

    # Asiento en el libro de eventos, uno por CRÉDITO (es la entidad que cambió
    # de saldo). Sin esto sería un UPDATE silencioso sobre plata de clientes.
    por_credito = {}
    for a in anular:
        por_credito.setdefault(a["prestamo_id"], []).append(a)
    for prestamo_id, pagos in por_credito.items():
        detalle = (f"{len(pagos)} pago(s) duplicado(s) del empalme 17-08 anulados por "
                   f"{money(sum(p['monto'] for p in pagos))} "
                   f"(cuotas {', '.join(p['cuota'] for p in pagos)}). "
                   f"Responsable: {quien_txt}.")
        cur.execute("""
            INSERT INTO auditoria (actor_id, actor_nombre, accion, entidad, entidad_id, detalle)
            VALUES (%s, %s, %s, 'prestamo', %s, %s)
        """, (admin_id, f"{admin_nombre} (por {quien_txt})",
              "Corrección administrativa: pago duplicado del empalme", prestamo_id, detalle[:500]))

    cn.commit()
    print(f"\n  ✓ pagos anulados      : {tocados}")
    print(f"  ✓ asientos en auditoría: {len(por_credito)}")
    print(f"  ✓ log de reversa       : {log}")

    cur.execute(f"""
        SELECT count(*), coalesce(sum(pagado_acum - cuota_diaria*total_dias), 0)
          FROM prestamos WHERE pagado_acum > cuota_diaria*total_dias + {TOL}
    """)
    n, m = cur.fetchone()
    print(f"\n  sobre-cobrados que quedan: {n}  ({money(m)})")
    cur.execute(f"""
        SELECT count(*) FROM prestamos
         WHERE estado = 'finalizado' AND pagado_acum < cuota_diaria*total_dias - {TOL}
           AND id = ANY(%s)
    """, ([a["prestamo_id"] for a in anular],))
    print(f"  finalizados que quedaron debiendo: {cur.fetchone()[0]}  (tiene que ser 0)")
    cur.close()
    cn.close()
    print()


if __name__ == "__main__":
    main()
