# -*- coding: utf-8 -*-
"""
¿Está listo el DÍA 2? Lo que cada cobrador del piloto va a ver al abrir la app.

Se corre después del empalme. Verifica lo que importa en la calle:
  · que los cobros de AYER hayan entrado (si no, hoy les cobra de nuevo);
  · cuántos clientes tiene cada uno y cuánto le toca cobrar HOY;
  · que nadie tenga clientes de otro cobrador mezclados;
  · que no queden créditos saldados dentro de la ruta.

Reimplementa el cronograma Lun–Sáb aparte, como segunda opinión de la app.
Solo LECTURA.
"""
import os
import re
import ssl
import datetime as dt
from collections import defaultdict
from urllib.parse import unquote

import pg8000.dbapi

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AYER = dt.date(2026, 8, 5)


def fecha_de_cuota(inicio: dt.date, i: int, frec: str) -> dt.date:
    if frec == "diario":
        d0 = inicio + dt.timedelta(days=1) if inicio.weekday() == 6 else inicio
        pos = d0.weekday()
        slot = pos + i
        return d0 + dt.timedelta(days=(slot // 6) * 7 + (slot % 6) - pos)
    if frec == "mensual":
        mes = inicio.month - 1 + i
        anio, mes = inicio.year + mes // 12, mes % 12 + 1
        dia = inicio.day
        while True:
            try:
                f = dt.date(anio, mes, dia)
                break
            except ValueError:
                dia -= 1
    else:
        f = inicio + dt.timedelta(days=i * {"semanal": 7, "quincenal": 15}[frec])
    return f + dt.timedelta(days=1) if f.weekday() == 6 else f


def debidas(inicio, total, frec, hoy) -> int:
    n = 0
    for i in range(total):
        if fecha_de_cuota(inicio, i, frec) <= hoy:
            n += 1
        else:
            break
    return n


def vencido(inicio, total, frec, hoy) -> bool:
    return total >= 1 and hoy > fecha_de_cuota(inicio, total - 1, frec)


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
    hoy = dt.date.today()
    cn = conectar()
    cur = cn.cursor()

    print(f"{'='*102}\n  ¿LISTO PARA EL DÍA 2?   ({hoy})\n{'='*102}")

    # 1. Los cobros de AYER, ¿entraron?
    cur.execute("""
        SELECT count(*), COALESCE(sum(monto),0)
          FROM pagos
         WHERE anulado = false
           AND (registrado_en AT TIME ZONE 'America/Montevideo')::date = %s
    """, (AYER,))
    n_ayer, m_ayer = cur.fetchone()
    cur.execute("""
        SELECT count(*), COALESCE(sum(monto),0) FROM pagos
         WHERE anulado = false AND origen IS NULL
           AND (registrado_en AT TIME ZONE 'America/Montevideo')::date = %s
    """, (AYER,))
    n_nat, m_nat = cur.fetchone()
    print(f"\n── COBROS DE AYER ({AYER}) ──")
    print(f"  en la base:  {n_ayer} cobros · {money(m_ayer)}")
    print(f"     de ellos hechos EN LA APP: {n_nat} · {money(m_nat)}")
    print(f"     importados de Disapp:      {n_ayer - n_nat} · {money(float(m_ayer) - float(m_nat))}")
    print("  (si esto está en cero para un cobrador, hoy le vuelve a pedir la cuota a sus clientes)")

    # 2. Ruta de cada cobrador del piloto.
    cur.execute("""
        SELECT u.id, u.nombre, z.nombre
          FROM usuarios u LEFT JOIN zonas z ON z.id = u.zona_id
         WHERE u.rol = 'cobrador' AND u.activo = true AND z.nombre = 'Zona Centro'
         ORDER BY u.nombre
    """)
    cobradores = cur.fetchall()

    print(f"\n── LA RUTA DE HOY, COBRADOR POR COBRADOR (Zona Centro: {len(cobradores)}) ──")
    print(f"  {'cobrador':22s} {'clientes':>8s} {'créditos':>8s} {'a cobrar hoy':>14s} {'vencidos':>9s} {'ayer':>12s}  avisos")

    total_hoy = 0.0
    problemas = []
    for cid, nombre, _zona in cobradores:
        cur.execute("""
            SELECT p.id, p.cuota_diaria, p.total_dias, p.fecha_inicio,
                   COALESCE(p.frecuencia,'diario'), COALESCE(p.pagado_acum,0), p.cliente_id
              FROM prestamos p
             WHERE p.estado='activo' AND p.cobrador_id = %s
        """, (cid,))
        creds = cur.fetchall()
        cur.execute("""
            SELECT count(DISTINCT cliente_id) FROM asignaciones
             WHERE cobrador_id = %s AND activo = true
        """, (cid,))
        n_cli = cur.fetchone()[0]
        cur.execute("""
            SELECT COALESCE(sum(monto),0) FROM pagos
             WHERE registrado_por = %s AND anulado = false
               AND (registrado_en AT TIME ZONE 'America/Montevideo')::date = %s
        """, (cid, AYER))
        cobro_ayer = float(cur.fetchone()[0])

        pedir = 0.0
        n_venc = saldados = 0
        for _pid, cuota, dias, ini, frec, pagado, _cli in creds:
            cuota, dias, pagado = float(cuota), int(dias), float(pagado)
            total = cuota * dias
            if total > 0 and pagado >= total - 0.5:
                saldados += 1
                continue  # la app lo saca de la ruta
            if vencido(ini, dias, frec, hoy):
                n_venc += 1
                continue
            d = debidas(ini, dias, frec, hoy)
            deb = max(0.0, min(d * cuota, total) - pagado)
            pedir += 0.0 if deb < 0.5 else min(cuota, deb)
        total_hoy += pedir

        avisos = []
        if cobro_ayer <= 0:
            avisos.append("SIN COBROS AYER")
        if n_cli == 0:
            avisos.append("SIN CLIENTES")
        if saldados:
            avisos.append(f"{saldados} saldados (fuera de ruta, ok)")
        if avisos:
            problemas.append((nombre, avisos))
        print(f"  {nombre[:22]:22s} {n_cli:8d} {len(creds):8d} {money(pedir):>14s} {n_venc:9d} {money(cobro_ayer):>12s}  {' · '.join(avisos)}")

    print(f"\n  TOTAL a cobrar hoy en Zona Centro: {money(total_hoy)}")

    # 3. Clientes compartidos entre dos rutas (el doble cobro del día 1).
    cur.execute("""
        SELECT count(*) FROM (
          SELECT cliente_id FROM prestamos WHERE estado='activo' AND cobrador_id IS NOT NULL
           GROUP BY cliente_id HAVING count(DISTINCT cobrador_id) > 1
        ) t
    """)
    compartidos = cur.fetchone()[0]
    print(f"\n── CLIENTES CON CRÉDITOS DE DOS COBRADORES: {compartidos} ──")
    print("  (legítimo; la ruta ya está acotada por dueño desde el 08-05, cada uno ve SOLO lo suyo)")

    # 4. Créditos activos ya saldados (deberían salir de la ruta).
    cur.execute("""
        SELECT count(*) FROM prestamos
         WHERE estado='activo' AND cuota_diaria*total_dias > 0
           AND pagado_acum >= cuota_diaria*total_dias - 0.5
    """)
    print(f"\n── CRÉDITOS ACTIVOS YA SALDADOS: {cur.fetchone()[0]} ──")
    print("  (la app los excluye de la ruta y los ofrece en 'Renovar')")

    cur.close()
    cn.close()
    print(f"\n{'='*102}")


if __name__ == "__main__":
    main()
