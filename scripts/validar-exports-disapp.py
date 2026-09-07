# -*- coding: utf-8 -*-
"""
VALIDAR LOS EXPORTS DE DISAPP ANTES DE UN EMPALME. Solo lectura.

Responde, archivo por archivo, lo que hay que saber ANTES de correr el empalme:
  · ¿están los tres (clientes / creditos / recaudos) y son .xlsx?
  · ¿traen las columnas que el importador lee? (si falta una, el importador NO
    avisa: lee None y sigue — por eso se chequea acá)
  · ¿qué rango de fechas cubren los recaudos, y hay DÍAS SIN NINGÚN recaudo
    dentro del rango? (Disapp exporta ventanas cortas; si falta un tramo, esos
    cobros no entran nunca y quedan como mora falsa)
  · ¿hay archivos VIEJOS del mismo prefijo que puedan tapar a los nuevos?
    (load_clientes se queda con el PRIMERO por ID, y discover() ordena por
    nombre: un clientes_2026-07-20 le gana a uno de septiembre)
  · ¿cuál es el --corte que corresponde? (= fecha del export de créditos)

  python scripts/validar-exports-disapp.py                      → carpeta default
  python scripts/validar-exports-disapp.py --src C:\\ruta       → otra carpeta
  python scripts/validar-exports-disapp.py --desde 2026-08-01 --hasta 2026-09-06
"""
import argparse
import datetime as dt
import io
import os
import re
import sys

import openpyxl

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# Lo que empalme_disapp.py lee de cada archivo (col(hm, ...) con sus alias).
COLUMNAS = {
    "clientes": [("ID",), ("Documento",), ("Nombre",), ("Teléfono", "Telefono"),
                 ("Dirección", "Direccion"), ("Observación", "Observacion"),
                 ("Vendedor",), ("Estado",)],
    "creditos": [("ID Crédito", "ID Credito"), ("Crédito #", "Credito #"), ("ID Cliente",),
                 ("ID Vendedor",), ("Vendedor",), ("Modalidad",),
                 ("Valor Crédito", "Valor Credito"), ("Valor Cuota",), ("Cuotas",),
                 ("Fecha Crédito", "Fecha Credito"), ("Pagos",), ("Saldo Pendiente",),
                 ("Total c/ Intereses", "Total c/ Interes", "Total con Intereses"),
                 ("Cuotas Pend.", "Cuotas Pend"), ("Estado",)],
    "recaudos": [("ID Pago",), ("Ref. Crédito", "Ref. Credito"), ("Vendedor",), ("Documento",),
                 ("Recaudo",), ("Cuota #",), ("Total Cuotas",), ("Valor Cuota",),
                 ("Total Crédito", "Total Credito"), ("Fecha Pago",)],
}


def fecha_de(v):
    """Misma tolerancia que parse_date del importador: date, datetime o 'dd/mm/aaaa'."""
    if v in (None, ""):
        return None
    if hasattr(v, "date"):
        return v.date() if hasattr(v, "hour") else v
    s = str(v).strip()
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        d, mth, y = map(int, m.groups())
        return dt.date(y, mth, d)
    try:
        return dt.date.fromisoformat(s[:10])
    except ValueError:
        return None


def leer(ruta):
    wb = openpyxl.load_workbook(ruta, read_only=True, data_only=True)
    ws = wb.active
    filas = ws.iter_rows(values_only=True)
    cab = [str(c).strip() if c is not None else "" for c in next(filas)]
    datos = list(filas)
    wb.close()
    return cab, datos


def fecha_del_nombre(nombre):
    m = re.search(r"(\d{4}-\d{2}-\d{2})", nombre)
    return dt.date.fromisoformat(m.group(1)) if m else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=r"C:\Users\Carlos\migracion")
    ap.add_argument("--desde", default=None, help="primer día que tiene que estar cubierto")
    ap.add_argument("--hasta", default=None, help="último día que tiene que estar cubierto")
    a = ap.parse_args()

    problemas = []
    avisos = []

    print("=" * 78)
    print(f"  EXPORTS EN {a.src}")
    print("=" * 78)
    archivos = sorted(os.listdir(a.src))
    por_prefijo = {p: [f for f in archivos if f.lower().startswith(p) and f.lower().endswith(".xlsx")]
                   for p in COLUMNAS}
    otros = [f for f in archivos if f.lower().endswith((".pdf", ".csv"))
             and any(f.lower().startswith(p) for p in COLUMNAS)]
    for f in otros:
        avisos.append(f"{f}: el importador NO lee PDF/CSV, solo .xlsx — se ignora")

    for prefijo, lista in por_prefijo.items():
        print(f"\n  [{prefijo}]  {len(lista)} archivo(s)")
        if not lista:
            problemas.append(f"falta el export de {prefijo} (ningún {prefijo}*.xlsx)")
            continue
        fechas = [(fecha_del_nombre(f), f) for f in lista]
        mas_nuevo = max(fechas, key=lambda x: (x[0] or dt.date.min))
        for fch, f in fechas:
            marca = "  ← MÁS NUEVO" if f == mas_nuevo[1] else ""
            print(f"     {f}{marca}")
        # Archivos viejos que pueden tapar a los nuevos (gana el primero por orden de nombre).
        viejos = [f for fch, f in fechas if fch and mas_nuevo[0] and (mas_nuevo[0] - fch).days > 7]
        if viejos and prefijo in ("clientes", "creditos"):
            problemas.append(
                f"{prefijo}: hay {len(viejos)} export(s) viejo(s) al lado del nuevo "
                f"({', '.join(viejos[:3])}{'…' if len(viejos) > 3 else ''}). "
                f"En clientes GANA EL PRIMERO por orden de nombre → moverlos a _viejos ANTES de correr.")
        if viejos and prefijo == "recaudos":
            avisos.append(
                f"recaudos: {len(viejos)} export(s) de más de una semana antes del más nuevo. "
                f"Sus folios ya están importados (se saltean solos), pero hacen la corrida más lenta.")

    # ── Columnas ───────────────────────────────────────────────────────────
    print("\n" + "=" * 78)
    print("  COLUMNAS (lo que el importador lee)")
    print("=" * 78)
    contenido = {}
    for prefijo, lista in por_prefijo.items():
        for f in lista:
            cab, datos = leer(os.path.join(a.src, f))
            contenido[f] = (cab, datos)
            cab_l = [c.lower() for c in cab]
            faltan = [alias[0] for alias in COLUMNAS[prefijo]
                      if not any(x.lower() in cab_l for x in alias)]
            estado = "OK" if not faltan else f"FALTAN: {', '.join(faltan)}"
            print(f"  {f:44} {len(datos):>6} filas  {estado}")
            if faltan:
                problemas.append(f"{f}: faltan columnas {faltan} — el importador leería None sin avisar")

    # ── Cobertura de recaudos, día por día ─────────────────────────────────
    print("\n" + "=" * 78)
    print("  COBERTURA DE RECAUDOS, DÍA POR DÍA")
    print("=" * 78)
    por_dia = {}
    folios = set()
    dup_folios = 0
    for f in por_prefijo["recaudos"]:
        cab, datos = contenido[f]
        cab_l = [c.lower() for c in cab]
        ip = cab_l.index("id pago") if "id pago" in cab_l else None
        ifp = cab_l.index("fecha pago") if "fecha pago" in cab_l else None
        if ip is None or ifp is None:
            continue
        for r in datos:
            if r[ip] in (None, ""):
                continue
            k = str(r[ip]).strip()
            if k in folios:
                dup_folios += 1
                continue
            folios.add(k)
            d = fecha_de(r[ifp])
            if d:
                por_dia[d] = por_dia.get(d, 0) + 1
    if not por_dia:
        problemas.append("recaudos: no se pudo leer ninguna fecha de pago")
    else:
        dmin, dmax = min(por_dia), max(por_dia)
        desde = dt.date.fromisoformat(a.desde) if a.desde else dmin
        hasta = dt.date.fromisoformat(a.hasta) if a.hasta else dmax
        print(f"  folios distintos: {len(folios):,}  (repetidos entre archivos: {dup_folios:,} — se saltean solos)")
        print(f"  rango en los archivos: {dmin} → {dmax}")
        print(f"  rango exigido:         {desde} → {hasta}\n")
        d = desde
        huecos = []
        while d <= hasta:
            n = por_dia.get(d, 0)
            dow = d.weekday()  # 6 = domingo
            barra = "#" * min(n // 20, 50)
            etiqueta = "dom" if dow == 6 else "   "
            print(f"  {d} {etiqueta} {n:>5} {barra}")
            if n == 0 and dow != 6:
                huecos.append(d)
            d += dt.timedelta(days=1)
        if huecos:
            problemas.append(
                f"recaudos: {len(huecos)} día(s) HÁBIL(ES) sin ningún recaudo dentro del rango: "
                f"{', '.join(str(h) for h in huecos[:12])}{'…' if len(huecos) > 12 else ''}. "
                f"Si Disapp tuvo cobros esos días, falta un tramo del export.")
        # Días con sospechosamente pocos (un tramo cortado a la mitad).
        habiles = [n for dd, n in por_dia.items() if desde <= dd <= hasta and dd.weekday() != 6]
        if habiles:
            mediana = sorted(habiles)[len(habiles) // 2]
            flojos = [dd for dd, n in por_dia.items()
                      if desde <= dd <= hasta and dd.weekday() != 6 and 0 < n < mediana * 0.3]
            if flojos:
                avisos.append(
                    f"recaudos: día(s) hábil(es) con menos del 30% de la mediana ({mediana}): "
                    f"{', '.join(str(x) for x in sorted(flojos))}. Puede ser un tramo cortado a la mitad.")

    # ── Créditos: corte y frescura ─────────────────────────────────────────
    print("\n" + "=" * 78)
    print("  CRÉDITOS Y CLIENTES: frescura y --corte")
    print("=" * 78)
    corte = None
    if por_prefijo["creditos"]:
        f = max(por_prefijo["creditos"], key=lambda x: fecha_del_nombre(x) or dt.date.min)
        cab, datos = contenido[f]
        cab_l = [c.lower() for c in cab]
        ifc = next((i for i, c in enumerate(cab_l) if c in ("fecha crédito", "fecha credito")), None)
        iest = cab_l.index("estado") if "estado" in cab_l else None
        fechas = sorted(x for x in (fecha_de(r[ifc]) for r in datos) if x) if ifc is not None else []
        corte = fecha_del_nombre(f)
        estados = {}
        if iest is not None:
            for r in datos:
                e = str(r[iest] or "").strip() or "(vacío)"
                estados[e] = estados.get(e, 0) + 1
        print(f"  {f}: {len(datos):,} créditos")
        if fechas:
            print(f"     Fecha Crédito: {fechas[0]} → {fechas[-1]}")
        print(f"     estados: {estados}")
        print(f"     → --corte {corte}   (la columna 'Pagos' refleja cobros hasta ese día)")
        if fechas and corte and fechas[-1] > corte:
            problemas.append(f"creditos: hay 'Fecha Crédito' {fechas[-1]} POSTERIOR al corte {corte}: el empalme ABORTA")
    if por_prefijo["clientes"]:
        f = max(por_prefijo["clientes"], key=lambda x: fecha_del_nombre(x) or dt.date.min)
        cab, datos = contenido[f]
        print(f"  {f}: {len(datos):,} clientes")

    # ── Veredicto ─────────────────────────────────────────────────────────
    print("\n" + "=" * 78)
    if problemas:
        print(f"  🔴 {len(problemas)} PROBLEMA(S) — resolver ANTES de correr el empalme")
        for p in problemas:
            print(f"     · {p}")
    else:
        print("  🟢 Sin problemas bloqueantes")
    if avisos:
        print(f"\n  🟡 {len(avisos)} aviso(s)")
        for p in avisos:
            print(f"     · {p}")
    if corte and not problemas:
        print("\n  Comando (DRY-RUN primero, nunca --commit de una):")
        print(f"     python scripts/empalme-0804.py --env-file .env.local --si-produccion --corte {corte}")
    print("=" * 78)
    sys.exit(1 if problemas else 0)


if __name__ == "__main__":
    main()
