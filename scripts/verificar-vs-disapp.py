# -*- coding: utf-8 -*-
"""
VERIFICADOR: los números de Presta Ya contra el tablero de Disapp.

Se corre DESPUÉS de recargar clientes/créditos/recaudos, para saber si el espejo
quedó fiel. Compara cada cifra bajo VARIAS definiciones, porque el tablero de
Disapp no dice cuál usa: la lección del 08-04 es que ESCONDE la cartera vencida
(créditos activos cuyo plazo ya terminó), así que su "ventas activas" puede ser
un subconjunto del nuestro. Mostrando las dos lecturas se ve cuál calza.

El cronograma (Lun–Sáb, ninguna cuota vence en domingo) se REIMPLEMENTA acá a
propósito: es una segunda opinión independiente de lib/cartones.ts. Si las dos
implementaciones dan lo mismo, la lógica de fechas está bien; si difieren, una
de las dos tiene un bug y hay que mirarlo.

Solo LECTURA. No escribe absolutamente nada.

Uso:
    python scripts/verificar-vs-disapp.py
    python scripts/verificar-vs-disapp.py --activas 2422 --clientes 12594 \
        --capital 62443536.78 --recaudo 31945455.72 --por-cobrar-hoy 1175068.81 \
        --mora 515 --con-intereses 94388992.50
"""
import argparse
import re
import ssl
from datetime import date, timedelta
from urllib.parse import unquote

import pg8000.dbapi

import os

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Cifras del tablero de Disapp que pasó Carlos el 06-08. Se pueden pisar por CLI.
DISAPP = {
    "activas": 2422,
    "clientes": 12594,
    "mora": 515,
    "capital": 62443536.78,      # "Capital en calle" == "Cartera Pendiente"
    "ventas_credito": 86394425.00,
    "con_intereses": 94388992.50,
    "recaudo": 31945455.72,
    "por_cobrar_hoy": 1175068.81,
}


# ── Cronograma: segunda implementación, independiente de lib/cartones.ts ──────
def fecha_de_cuota(inicio: date, i: int, frecuencia: str) -> date:
    """Fecha de la cuota número `i` (0-based). Ninguna vence en domingo."""
    if frecuencia == "diario":
        d0 = inicio + timedelta(days=1) if inicio.weekday() == 6 else inicio
        pos = d0.weekday()  # Lun=0 … Sáb=5 (d0 nunca es domingo acá)
        slot = pos + i
        f = d0 + timedelta(days=(slot // 6) * 7 + (slot % 6) - pos)
        return f
    if frecuencia == "mensual":
        mes = inicio.month - 1 + i
        anio = inicio.year + mes // 12
        mes = mes % 12 + 1
        dia = inicio.day
        while True:  # 31-ene + 1 mes → último día real de febrero
            try:
                f = date(anio, mes, dia)
                break
            except ValueError:
                dia -= 1
    else:
        paso = {"semanal": 7, "quincenal": 15}[frecuencia]
        f = inicio + timedelta(days=i * paso)
    return f + timedelta(days=1) if f.weekday() == 6 else f


def cuotas_debidas_hasta(inicio: date, total: int, frecuencia: str, hoy: date) -> int:
    n = 0
    for i in range(total):
        if fecha_de_cuota(inicio, i, frecuencia) <= hoy:
            n += 1
        else:
            break
    return n


def plazo_vencido(inicio: date, total: int, frecuencia: str, hoy: date) -> bool:
    if total < 1:
        return False
    return hoy > fecha_de_cuota(inicio, total - 1, frecuencia)


def cuota_objetivo_hoy(cuota: float, total: int, inicio: date, frecuencia: str,
                       pagado: float, hoy: date) -> float:
    """Lo que habría que cobrarle HOY (espejo de cuotaObjetivoHoy de la app)."""
    if frecuencia == "diario":
        return cuota
    debidas = cuotas_debidas_hasta(inicio, total, frecuencia, hoy)
    debido = max(0.0, min(debidas * cuota, cuota * total) - pagado)
    return 0.0 if debido < 0.5 else min(cuota, debido)


# ── Conexión ─────────────────────────────────────────────────────────────────
def conectar():
    with open(os.path.join(RAIZ, ".env.local"), encoding="utf-8") as fh:
        url = next(l.split("=", 1)[1].strip().strip('"').strip("'")
                   for l in fh if l.startswith("SUPABASE_DB_URL="))
    m = re.match(r"postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+):(\d+)/(.+)", url)
    if not m:
        raise SystemExit("No pude parsear SUPABASE_DB_URL")
    usr, pw, host, port, base = m.groups()
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return pg8000.dbapi.connect(user=unquote(usr), password=unquote(pw), host=host,
                                port=int(port), database=base.split("?")[0], ssl_context=ctx)


def money(n) -> str:
    return "$ " + f"{float(n or 0):,.2f}".replace(",", "@").replace(".", ",").replace("@", ".")


def linea(etiqueta: str, nuestro, disapp, entero=False) -> None:
    d = float(disapp)
    n = float(nuestro)
    delta = n - d
    pct = (delta / d * 100) if d else float("inf")
    fmt = (lambda v: f"{int(round(v)):,}".replace(",", ".")) if entero else money
    señal = "OK " if abs(pct) < 0.5 else ("~  " if abs(pct) < 5 else "!! ")
    print(f"  {señal}{etiqueta:26s} nuestro {fmt(n):>18s}   disapp {fmt(d):>18s}   "
          f"dif {fmt(delta):>16s} ({pct:+6.1f}%)")


def main() -> None:
    ap = argparse.ArgumentParser()
    for k, v in DISAPP.items():
        ap.add_argument(f"--{k.replace('_', '-')}", type=float, default=v)
    args = vars(ap.parse_args())
    meta = {k: args[k] for k in DISAPP}

    hoy = date.today()
    cn = conectar()
    cur = cn.cursor()

    cur.execute("""
        SELECT cuota_diaria, total_dias, fecha_inicio, COALESCE(frecuencia,'diario'),
               COALESCE(pagado_acum,0), COALESCE(monto_prestado,0)
          FROM prestamos WHERE estado = 'activo'
    """)
    filas = cur.fetchall()

    vigentes = vencidos = en_mora = 0
    total_con_int = pagado_tot = saldo_tot = capital_tot = 0.0
    por_cobrar_hoy = 0.0
    saldo_vigente = 0.0

    for cuota, dias, inicio, frec, pagado, monto in filas:
        cuota, dias, pagado, monto = float(cuota), int(dias), float(pagado), float(monto)
        total = cuota * dias
        saldo = max(0.0, total - pagado)
        total_con_int += total
        pagado_tot += pagado
        saldo_tot += saldo
        capital_tot += monto
        if plazo_vencido(inicio, dias, frec, hoy):
            vencidos += 1
            continue
        vigentes += 1
        saldo_vigente += saldo
        por_cobrar_hoy += cuota_objetivo_hoy(cuota, dias, inicio, frec, pagado, hoy)
        # En mora = debería tener más cuotas pagas de las que tiene.
        debidas = cuotas_debidas_hasta(inicio, dias, frec, hoy)
        if pagado + 0.5 < (debidas - 1) * cuota:
            en_mora += 1

    cur.execute("SELECT count(*) FROM clientes")
    clientes_tot = cur.fetchone()[0]
    cur.execute("SELECT count(DISTINCT cliente_id) FROM prestamos WHERE estado='activo'")
    clientes_con_credito = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM clientes WHERE activo = true")
    clientes_activos = cur.fetchone()[0]

    print(f"\n{'='*100}\n  PRESTA YA  vs  DISAPP     ({hoy.isoformat()})\n{'='*100}")
    print("  OK = dentro del 0,5%   ~ = hasta 5%   !! = divergencia grande\n")

    print("── CONTEOS ──")
    linea("Ventas activas (todas)", len(filas), meta["activas"], entero=True)
    linea("  ↳ solo plazo VIGENTE", vigentes, meta["activas"], entero=True)
    linea("Clientes (todos)", clientes_tot, meta["clientes"], entero=True)
    linea("  ↳ solo activos", clientes_activos, meta["clientes"], entero=True)
    linea("Ventas en mora", en_mora, meta["mora"], entero=True)

    print("\n── PLATA ──")
    linea("Con intereses (Σ cuota×n)", total_con_int, meta["con_intereses"])
    linea("Recaudo (Σ pagado)", pagado_tot, meta["recaudo"])
    linea("Cartera pendiente", saldo_tot, meta["capital"])
    linea("  ↳ solo plazo vigente", saldo_vigente, meta["capital"])
    linea("Capital (Σ monto_prestado)", capital_tot, meta["ventas_credito"])
    linea("Por cobrar HOY", por_cobrar_hoy, meta["por_cobrar_hoy"])

    pct_nuestro = (pagado_tot / total_con_int * 100) if total_con_int else 0
    pct_disapp = (meta["recaudo"] / meta["con_intereses"] * 100) if meta["con_intereses"] else 0
    print(f"\n  % Recaudo                  nuestro {pct_nuestro:17.1f}%   "
          f"disapp {pct_disapp:17.1f}%")

    print("\n── COHERENCIA INTERNA ──")
    print(f"  créditos con plazo VENCIDO (cartera vencida): {vencidos}")
    print(f"  clientes con crédito activo:                  {clientes_con_credito}")
    ident = sum(1 for c, d, _i, _f, _p, m in filas
                if abs(float(c) * int(d) - float(m)) < 1)
    print(f"  créditos SIN interés cargado (monto=cuota×n): {ident}"
          f"   ← renovarían al 0%: revisar")
    grandes = sum(1 for *_x, m in filas if float(m) > 100000)
    print(f"  créditos por encima del tope de $100.000:     {grandes}"
          f"   ← no se pueden renovar desde la calle")

    print(f"\n{'='*100}\n")
    cur.close()
    cn.close()


if __name__ == "__main__":
    main()
