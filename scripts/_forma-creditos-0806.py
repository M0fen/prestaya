# -*- coding: utf-8 -*-
"""
¿Qué guarda `prestamos.monto_prestado`: el CAPITAL o el TOTAL con intereses?

Importa para la regla del +20%: si el monto que ve la oficina ya trae el interés
adentro, renovar "+20%" sube el TOTAL, no el capital, y el préstamo nuevo sale
con otra tasa de la que Carlos cree. Se mide la tasa implícita de cada crédito
(cuota × cuotas / monto): 1,00 = el monto ES el total; 1,20 = el monto es capital
y el crédito cobra 20% de interés.

Solo LECTURA. No escribe nada.
"""
import os
import re
import ssl
from collections import Counter

import pg8000.dbapi

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def url_bd() -> str:
    with open(os.path.join(RAIZ, ".env.local"), encoding="utf-8") as fh:
        for linea in fh:
            if linea.startswith("SUPABASE_DB_URL="):
                return linea.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("Falta SUPABASE_DB_URL en .env.local")


def conectar():
    u = url_bd()
    m = re.match(r"postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+):(\d+)/(.+)", u)
    if not m:
        raise SystemExit("No pude parsear SUPABASE_DB_URL")
    usuario, clave, host, puerto, base = m.groups()
    base = base.split("?")[0]
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    from urllib.parse import unquote

    return pg8000.dbapi.connect(
        user=unquote(usuario), password=unquote(clave), host=host,
        port=int(puerto), database=base, ssl_context=ctx,
    )


def money(n) -> str:
    return "$ " + f"{round(float(n or 0)):,}".replace(",", ".")


def main() -> None:
    cn = conectar()
    cur = cn.cursor()

    cur.execute("""
        SELECT estado, count(*), sum(monto_prestado), sum(cuota_diaria * total_dias)
          FROM prestamos GROUP BY estado ORDER BY 2 DESC
    """)
    print("== CRÉDITOS POR ESTADO ==")
    for estado, n, monto, total in cur.fetchall():
        print(f"  {estado:12s} {n:6d}   monto {money(monto):>16s}   cuota×días {money(total):>16s}")

    # Tasa implícita = (cuota × cuotas) / monto_prestado, redondeada a 2 decimales.
    cur.execute("""
        SELECT round((cuota_diaria * total_dias / NULLIF(monto_prestado,0))::numeric, 2) AS tasa,
               count(*),
               count(*) FILTER (WHERE disapp_credit_id IS NULL) AS nativos
          FROM prestamos
         WHERE estado = 'activo' AND monto_prestado > 0
         GROUP BY 1 ORDER BY 2 DESC LIMIT 15
    """)
    print("\n== TASA IMPLÍCITA DE LOS CRÉDITOS ACTIVOS ==")
    print("   (1,00 = monto_prestado YA incluye el interés · 1,20 = capital + 20%)")
    filas = cur.fetchall()
    tot = sum(n for _, n, _ in filas)
    for tasa, n, nativos in filas:
        pct = 100.0 * n / tot if tot else 0
        print(f"  tasa {float(tasa):5.2f}  →  {n:6d} créditos ({pct:5.1f}%)   nativos: {nativos}")

    # Lo mismo separando importados de Disapp vs nacidos en Presta Ya.
    cur.execute("""
        SELECT (disapp_credit_id IS NULL) AS nativo,
               count(*),
               round(avg(cuota_diaria * total_dias / NULLIF(monto_prestado,0))::numeric, 4)
          FROM prestamos
         WHERE estado='activo' AND monto_prestado > 0
         GROUP BY 1
    """)
    print("\n== ORIGEN vs TASA PROMEDIO ==")
    for nativo, n, tasa in cur.fetchall():
        etiqueta = "nativos (Presta Ya)" if nativo else "importados (Disapp)"
        print(f"  {etiqueta:22s} {n:6d}   tasa media {float(tasa or 0):.4f}")

    # Totales de cartera, para contrastar con el tablero de Disapp.
    cur.execute("""
        SELECT count(*),
               sum(monto_prestado),
               sum(cuota_diaria * total_dias),
               sum(pagado_acum),
               sum(GREATEST(0, cuota_diaria * total_dias - pagado_acum))
          FROM prestamos WHERE estado='activo'
    """)
    n, capital, total, pagado, saldo = cur.fetchone()
    print("\n== CARTERA ACTIVA (Presta Ya, ahora) ==")
    print(f"  créditos activos     {n}")
    print(f"  Σ monto_prestado     {money(capital)}")
    print(f"  Σ cuota × cuotas     {money(total)}")
    print(f"  Σ pagado_acum        {money(pagado)}")
    print(f"  saldo por cobrar     {money(saldo)}")

    cur.execute("SELECT count(*) FROM clientes")
    print(f"  clientes (todos)     {cur.fetchone()[0]}")
    cur.execute("SELECT count(*) FROM pagos WHERE anulado = false")
    print(f"  pagos vigentes       {cur.fetchone()[0]}")

    cur.close()
    cn.close()


if __name__ == "__main__":
    main()
