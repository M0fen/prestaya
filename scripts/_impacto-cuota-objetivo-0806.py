# -*- coding: utf-8 -*-
"""
RADIO DE IMPACTO del cambio en `cuotaObjetivoHoy` (lib/data/ruta.ts).

Antes: para frecuencia 'diario' la ruta pedía SIEMPRE la cuota entera, sin mirar
el calendario. Ahora usa el cronograma (igual que semanal/quincenal): lo que falta
para estar al día, topeado a una cuota.

Este script mide, sobre la cartera REAL y para varios días, cuánto cambia:
  · el "esperado" del día (la meta de cobro),
  · cuántos créditos pasan a "hoy no toca" (cuota objetivo 0),
  · cuántos bajan de cuota por estar en el tramo final.

Se corre para HOY (día hábil) y para el DOMINGO próximo, que es donde el atajo
viejo hacía el destrozo más grande.

Solo LECTURA.
"""
import os
import re
import ssl
from datetime import date, timedelta
from urllib.parse import unquote

import pg8000.dbapi

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def fecha_de_cuota(inicio: date, i: int, frec: str) -> date:
    if frec == "diario":
        d0 = inicio + timedelta(days=1) if inicio.weekday() == 6 else inicio
        pos = d0.weekday()
        slot = pos + i
        return d0 + timedelta(days=(slot // 6) * 7 + (slot % 6) - pos)
    if frec == "mensual":
        mes = inicio.month - 1 + i
        anio, mes = inicio.year + mes // 12, mes % 12 + 1
        dia = inicio.day
        while True:
            try:
                f = date(anio, mes, dia)
                break
            except ValueError:
                dia -= 1
    else:
        f = inicio + timedelta(days=i * {"semanal": 7, "quincenal": 15}[frec])
    return f + timedelta(days=1) if f.weekday() == 6 else f


def debidas_hasta(inicio: date, total: int, frec: str, hoy: date) -> int:
    n = 0
    for i in range(total):
        if fecha_de_cuota(inicio, i, frec) <= hoy:
            n += 1
        else:
            break
    return n


def plazo_vencido(inicio: date, total: int, frec: str, hoy: date) -> bool:
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
    cn = conectar()
    cur = cn.cursor()
    cur.execute("""
        SELECT cuota_diaria, total_dias, fecha_inicio, COALESCE(frecuencia,'diario'),
               COALESCE(pagado_acum,0)
          FROM prestamos WHERE estado='activo' AND cuota_diaria > 0 AND total_dias > 0
    """)
    filas = [(float(a), int(b), c, d, float(e)) for a, b, c, d, e in cur.fetchall()]
    cur.close()
    cn.close()

    hoy = date.today()
    prox_domingo = hoy + timedelta(days=(6 - hoy.weekday()) % 7 or 7)

    for etiqueta, dia in [(f"HOY {hoy} ({'dom' if dia_dom(hoy) else 'hábil'})", hoy),
                          (f"DOMINGO {prox_domingo}", prox_domingo)]:
        antes = despues = 0.0
        n_cero = n_baja = n_diario = 0
        for cuota, dias, inicio, frec, pagado in filas:
            if plazo_vencido(inicio, dias, frec, dia):
                continue  # cartera vencida: fuera del target en ambas versiones
            # ANTES: diario = cuota fija; no-diario = cronograma.
            if frec == "diario":
                n_diario += 1
                viejo = cuota
            else:
                d0 = debidas_hasta(inicio, dias, frec, dia)
                deb0 = max(0.0, min(d0 * cuota, cuota * dias) - pagado)
                viejo = 0.0 if deb0 < 0.5 else min(cuota, deb0)
            # DESPUÉS: cronograma para todas las frecuencias.
            d1 = debidas_hasta(inicio, dias, frec, dia)
            deb1 = max(0.0, min(d1 * cuota, cuota * dias) - pagado)
            nuevo = 0.0 if deb1 < 0.5 else min(cuota, deb1)

            antes += viejo
            despues += nuevo
            if frec == "diario":
                if viejo > 0 and nuevo == 0:
                    n_cero += 1
                elif nuevo < viejo - 0.5:
                    n_baja += 1

        print(f"\n═══ {etiqueta} ═══")
        print(f"  créditos diarios en término:        {n_diario}")
        print(f"  meta del día ANTES:                 {money(antes)}")
        print(f"  meta del día DESPUÉS:               {money(despues)}")
        dif = despues - antes
        pct = (dif / antes * 100) if antes else 0
        print(f"  diferencia:                         {money(dif)} ({pct:+.1f}%)")
        print(f"  diarios que pasan a 'hoy no toca':  {n_cero}")
        print(f"  diarios que BAJAN (tramo final):    {n_baja}")


def dia_dom(d: date) -> bool:
    return d.weekday() == 6


if __name__ == "__main__":
    main()
