# -*- coding: utf-8 -*-
"""
Anula los 3 cobros del 05-08 que el servidor RECORTÓ al saldo entero del crédito.

⚠️ NO EJECUTAR hasta que Carlos confirme con Karent Londoño y Edward Muñoz.
Un pago real anulado es peor que un pago errado vivo.

Qué son: tres asientos que valen EXACTAMENTE el saldo pendiente del crédito.
Esa cifra exacta es la firma del tope anti-sobre-pago del servidor: cuando el
monto tipeado se pasa del saldo, se recorta al saldo. Nadie elige ese número a
mano. La evidencia (ver el informe) apunta a error de tipeo, no a plata recibida:
Disapp muestra esos créditos con $0 pagado y ACTIVOS, y los tres cayeron en
sesiones de carga desde un mismo punto GPS, no en la puerta del cliente.

Impacto de dejarlos: la caja de Karent dice $224.110 cuando cobró $50.110, y la
de Edward $164.910 cuando cobró $48.350. Se les reclamaría un faltante de
$174.000 y $116.560 que nunca tuvieron en la mano.

  Ver:      python scripts/_anular-pagos-clampeados-0805.py
  Anular:   python scripts/_anular-pagos-clampeados-0805.py --commit
"""
import json
import os
import re
import ssl
import sys
import datetime as dt
from urllib.parse import unquote

import pg8000.dbapi

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMMIT = "--commit" in sys.argv

# (ref del crédito, monto exacto, cliente) — los tres verificados uno por uno.
CASOS = [
    ("PRD0003368621", 144000, "MARCO DUFOUR", "Karent Londoño"),
    ("PRD0003272904", 30000, "SHEILA ANAHI VADCONCELLO RUIZ", "Karent Londoño"),
    ("PRD0003403765", 116560, "MATIAS SEBASTIÁN RODRÍGUEZ", "Edward Muñoz"),
]
MOTIVO = ("Monto tipeado por encima del saldo: el servidor lo recortó al saldo entero "
          "del crédito (05-08). No corresponde a efectivo recibido — confirmado con el "
          "cobrador. Se anula para que su caja refleje lo que cobró de verdad.")


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
    return "$ " + f"{round(float(n or 0)):,}".replace(",", ".")


def main() -> None:
    cn = conectar()
    cur = cn.cursor()
    encontrados = []
    print(f"{'='*96}\n  COBROS RECORTADOS AL SALDO   {'🔴 ANULANDO' if COMMIT else '🟡 SOLO MIRANDO'}\n{'='*96}")
    for ref, monto, cliente, cobrador in CASOS:
        cur.execute("""
            SELECT pg.id, pg.monto, (pg.registrado_en AT TIME ZONE 'America/Montevideo'),
                   pr.cuota_diaria, pr.pagado_acum, pr.cuota_diaria * pr.total_dias
              FROM pagos pg JOIN prestamos pr ON pr.id = pg.prestamo_id
             WHERE pr.disapp_credit_ref = %s AND pg.origen IS NULL
               AND pg.anulado = false AND pg.monto = %s
        """, (ref, monto))
        filas = cur.fetchall()
        if not filas:
            print(f"  · {cliente[:30]:30s} {ref}  → ya no está (¿anulado antes?)")
            continue
        for f in filas:
            encontrados.append({"pago_id": str(f[0]), "ref": ref, "cliente": cliente,
                                "cobrador": cobrador, "monto": float(f[1]), "cuando": str(f[2])})
            print(f"  · {cliente[:30]:30s} {ref}  {money(f[1]):>12s}  "
                  f"(cuota {money(f[3])})  {str(f[2])[:19]}  — {cobrador}")

    print(f"\n  a anular: {len(encontrados)}   {money(sum(e['monto'] for e in encontrados))}")
    if not COMMIT:
        print("\n🟡 No se tocó nada. Confirmá con los cobradores y corré con --commit.\n")
        return
    if not encontrados:
        print("\nNada que anular.\n")
        return

    cur.execute("SELECT id FROM usuarios WHERE rol='admin' AND nombre ILIKE 'Mauricio%' LIMIT 1")
    fila = cur.fetchone() or None
    if not fila:
        cur.execute("SELECT id FROM usuarios WHERE rol='admin' ORDER BY nombre LIMIT 1")
        fila = cur.fetchone()
    if not fila:
        print("🔴 No hay admin para firmar la anulación. Abortado.")
        return

    log = os.path.join(RAIZ, "scripts", f"_revert_clampeados_{dt.date.today():%Y%m%d}.json")
    with open(log, "w", encoding="utf-8") as fh:
        json.dump(encontrados, fh, ensure_ascii=False, indent=1)

    cur.execute("""
        UPDATE pagos
           SET anulado = true, anulado_en = now(), anulado_por = %s, motivo_anulacion = %s
         WHERE id = ANY(%s) AND anulado = false
    """, (fila[0], MOTIVO, [e["pago_id"] for e in encontrados]))
    cn.commit()
    print(f"\n  ✓ anulados: {cur.rowcount}    log de reversa: {log}")

    for quien in ("Karent Londo", "Edward"):
        cur.execute("""
            SELECT COALESCE(sum(pg.monto), 0), count(*)
              FROM pagos pg JOIN usuarios u ON u.id = pg.registrado_por
             WHERE u.nombre ILIKE %s AND pg.origen IS NULL AND pg.anulado = false
               AND (pg.registrado_en AT TIME ZONE 'America/Montevideo')::date = '2026-08-05'
        """, ("%" + quien + "%",))
        t, n = cur.fetchone()
        print(f"  caja del 05-08 de {quien}: {money(t)} en {n} cobros")

    cur.close()
    cn.close()


if __name__ == "__main__":
    main()
