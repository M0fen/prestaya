# -*- coding: utf-8 -*-
"""
DIAGNÓSTICO de los pagos DUPLICADOS que dejó el empalme del 17-08. NO ESCRIBE NADA.

QUÉ PASÓ. Esa noche se importaron los recaudos de Disapp mientras 17 cobradores
ya venían usando la app. La guardia anti-duplicado comparaba por (crédito, DÍA
CALENDARIO): el cobro que el cobrador hizo en la calle, anotó en Disapp con la
fecha de ayer y registró en la app hoy, tenía días distintos y pasaba de largo.
La identidad de un cobro entre dos sistemas NO es el día en que alguien lo
tipeó: es la CUOTA que salda. (El agujero ya se cerró el 04-09 con una segunda
guardia por cuota en `import-recaudos-recientes.py`.)

QUÉ LADO SE ANULA. El IMPORTADO, nunca el nativo. Tres razones:
  1. La regla del empalme siempre fue "la app manda donde estuvo": el registro
     nativo tiene custodia, hora real y responsable.
  2. La guardia del importador se construye leyendo los pagos NATIVOS VIGENTES
     (`anulado = eq.false`, línea 121). Si anuláramos el lado nativo, la guardia
     quedaría CIEGA y el import del fin de semana lo reinsertaría.
  3. El insert del importador es `resolution=ignore-duplicates` sobre el índice
     único `pagos_disapp_pago_id_uidx`, que NO es parcial: la fila anulada sigue
     ocupando su `disapp_pago_id`, así que el sábado se saltea sola. La anulación
     SOBREVIVE al import.

Los pagos no se borran jamás: se anulan con quién y por qué. `pagado_acum` lo
corrige solo el trigger `trg_pagos_acum` (0063).

  python scripts/_diag-pagos-duplicados-0904.py
"""
import io
import os
import re
import ssl
import sys
from urllib.parse import unquote

import pg8000.dbapi

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOL = 1.0


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


def titulo(t):
    print("\n" + "=" * 92)
    print("  " + t)
    print("=" * 92)


def main() -> None:
    cn = conectar()
    cur = cn.cursor()

    # ── 1. El daño de hoy ──────────────────────────────────────────────────
    titulo("1. SOBRE-COBRO VIVO (suma de pagos vigentes > total del crédito)")
    cur.execute("""
        SELECT count(*), coalesce(sum(p.pagado_acum - p.cuota_diaria*p.total_dias), 0)
          FROM prestamos p
         WHERE p.pagado_acum > p.cuota_diaria*p.total_dias + %s
    """, (TOL,))
    n_exc, monto_exc = cur.fetchone()
    print(f"  créditos con pagado > total : {n_exc}")
    print(f"  exceso total                : {money(monto_exc)}")

    cur.execute("""
        SELECT p.estado, count(*)
          FROM prestamos p
         WHERE p.pagado_acum > p.cuota_diaria*p.total_dias + %s
         GROUP BY p.estado ORDER BY 2 DESC
    """, (TOL,))
    for estado, c in cur.fetchall():
        print(f"     · {estado:12s} {c}")

    # ── 2. Los pares, por la CUOTA (la identidad correcta) ─────────────────
    titulo("2. PARES EXACTOS — mismo crédito + MISMA CUOTA + mismo monto, uno importado y otro nativo")
    PARES = """
        WITH imp AS (
          SELECT id, prestamo_id, dia_credito, monto, registrado_en
            FROM pagos WHERE anulado = false AND origen = 'disapp_import'
                             AND dia_credito IS NOT NULL
        ), nat AS (
          SELECT id, prestamo_id, dia_credito, monto, registrado_en
            FROM pagos WHERE anulado = false AND origen IS NULL
                             AND dia_credito IS NOT NULL
        )
        SELECT imp.id                AS pago_importado,
               nat.id                AS pago_nativo,
               p.id                  AS prestamo,
               cl.nombre             AS cliente,
               imp.dia_credito       AS cuota,
               imp.monto             AS monto,
               p.pagado_acum         AS pagado,
               p.cuota_diaria*p.total_dias AS total,
               p.estado              AS estado,
               abs(extract(epoch from (imp.registrado_en - nat.registrado_en))/86400.0) AS dias_aparte
          FROM imp
          JOIN nat ON nat.prestamo_id = imp.prestamo_id
                  AND nat.dia_credito = imp.dia_credito
                  AND abs(nat.monto - imp.monto) < 0.5
          JOIN prestamos p ON p.id = imp.prestamo_id
          JOIN clientes  cl ON cl.id = p.cliente_id
    """
    cur.execute(f"SELECT count(*), coalesce(sum(monto),0) FROM ({PARES}) x")
    n_par, monto_par = cur.fetchone()
    print(f"  pares encontrados : {n_par}")
    print(f"  plata del lado importado : {money(monto_par)}")

    # ¿Cuántos de esos pares están en créditos SOBRE-COBRADOS (evidencia dura)?
    cur.execute(f"""
        SELECT count(*), coalesce(sum(monto),0)
          FROM ({PARES}) x WHERE x.pagado > x.total + {TOL}
    """)
    n_ev, monto_ev = cur.fetchone()
    print(f"  …de los cuales en créditos SOBRE-COBRADOS (evidencia dura): {n_ev}  ({money(monto_ev)})")
    print(f"  …sin sobre-cobro (NO se tocan, podrían ser cobros legítimos): {n_par - n_ev}")

    # ── 3. ¿El par cae dentro de la ventana del empalme? ───────────────────
    titulo("3. DISTANCIA EN DÍAS entre el registro nativo y el importado")
    cur.execute(f"""
        SELECT width_bucket(dias_aparte, 0, 30, 6) b, count(*), min(dias_aparte), max(dias_aparte)
          FROM ({PARES}) x WHERE x.pagado > x.total + {TOL}
         GROUP BY b ORDER BY b
    """)
    for b, c, mn, mx in cur.fetchall():
        print(f"     tramo {b}: {c:4d} pares   ({mn:.1f} a {mx:.1f} días de diferencia)")

    # ── 4. Simulación: qué queda si se anula el lado importado ─────────────
    titulo("4. SIMULACIÓN — anular el lado IMPORTADO de los pares con evidencia")
    cur.execute(f"""
        WITH cand AS (
          SELECT DISTINCT ON (pago_importado) pago_importado, prestamo, monto
            FROM ({PARES}) x WHERE x.pagado > x.total + {TOL}
        ), porpres AS (
          SELECT prestamo, sum(monto) quita, count(*) n FROM cand GROUP BY prestamo
        )
        SELECT count(*)                                              AS creditos_tocados,
               sum(pp.n)                                             AS pagos_a_anular,
               sum(pp.quita)                                         AS plata_anulada,
               count(*) FILTER (WHERE p.pagado_acum - pp.quita > p.cuota_diaria*p.total_dias + {TOL}) AS siguen_excedidos,
               count(*) FILTER (WHERE p.pagado_acum - pp.quita < p.cuota_diaria*p.total_dias - {TOL}) AS quedan_debiendo,
               count(*) FILTER (WHERE p.estado = 'finalizado'
                                  AND p.pagado_acum - pp.quita < p.cuota_diaria*p.total_dias - {TOL}) AS finalizados_que_reabren
          FROM porpres pp JOIN prestamos p ON p.id = pp.prestamo
    """)
    row = cur.fetchone()
    etiquetas = ["créditos tocados", "pagos a anular", "plata anulada",
                 "siguen sobre-cobrados después", "quedan DEBIENDO después",
                 "⚠️ FINALIZADOS que volverían a deber"]
    for et, v in zip(etiquetas, row):
        v = money(v) if et == "plata anulada" else v
        print(f"  {et:38s}: {v}")

    # ── 5. Los casos delicados, con nombre ─────────────────────────────────
    titulo("5. CASOS DELICADOS — créditos FINALIZADOS que volverían a tener saldo")
    cur.execute(f"""
        WITH cand AS (
          SELECT DISTINCT ON (pago_importado) pago_importado, prestamo, monto
            FROM ({PARES}) x WHERE x.pagado > x.total + {TOL}
        ), porpres AS (
          SELECT prestamo, sum(monto) quita FROM cand GROUP BY prestamo
        )
        SELECT cl.nombre, u.nombre, p.pagado_acum, p.cuota_diaria*p.total_dias, pp.quita,
               p.cuota_diaria*p.total_dias - (p.pagado_acum - pp.quita) AS quedaria_debiendo
          FROM porpres pp
          JOIN prestamos p ON p.id = pp.prestamo
          JOIN clientes  cl ON cl.id = p.cliente_id
          LEFT JOIN usuarios u ON u.id = p.cobrador_id
         WHERE p.estado = 'finalizado'
           AND p.pagado_acum - pp.quita < p.cuota_diaria*p.total_dias - {TOL}
         ORDER BY 6 DESC LIMIT 25
    """)
    delicados = cur.fetchall()
    if not delicados:
        print("  ninguno: todos los tocados siguen saldados o eran activos. ✅")
    for nom, cob, pagado, total, quita, debe in delicados:
        print(f"     {str(nom)[:30]:30s} {str(cob or '—')[:16]:16s} "
              f"pagó {money(pagado):>11s} de {money(total):>11s} · se quita {money(quita):>10s} "
              f"→ debería {money(debe)}")

    # ── 6. Lo que NO explica el par (queda para el import fresco) ──────────
    titulo("6. SOBRE-COBRO QUE EL PAR **NO** EXPLICA (queda para el export fresco del finde)")
    cur.execute(f"""
        WITH cand AS (
          SELECT DISTINCT ON (pago_importado) pago_importado, prestamo, monto
            FROM ({PARES}) x WHERE x.pagado > x.total + {TOL}
        ), porpres AS (
          SELECT prestamo, sum(monto) quita FROM cand GROUP BY prestamo
        )
        SELECT count(*), coalesce(sum(p.pagado_acum - p.cuota_diaria*p.total_dias
                                      - coalesce(pp.quita,0)), 0)
          FROM prestamos p
          LEFT JOIN porpres pp ON pp.prestamo = p.id
         WHERE p.pagado_acum - coalesce(pp.quita,0) > p.cuota_diaria*p.total_dias + {TOL}
    """)
    n_resto, monto_resto = cur.fetchone()
    print(f"  créditos que seguirían sobre-cobrados : {n_resto}")
    print(f"  exceso que queda sin explicar         : {money(monto_resto)}")
    print("  → ese resto NO se toca a ciegas: se resuelve contra el export fresco de Disapp.")

    cur.close()
    cn.close()
    print()


if __name__ == "__main__":
    main()
