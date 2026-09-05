# -*- coding: utf-8 -*-
"""
LA PRUEBA DEL ESCENARIO DEL EMPALME.

El caso que costó $997.474 el 17-08, escrito como prueba para que no vuelva a
pasar sin que alguien se entere:

    El cobrador cobra en la calle el lunes.
    Lo anota en Disapp con la fecha del lunes.
    Lo registra en la app el martes.
    → Mismo crédito, MISMA CUOTA, mismo monto, DÍAS DISTINTOS.

La guardia vieja comparaba por (crédito, día) y no lo veía. La nueva compara por
cuota + monto y sí.

  python scripts/test_guardia_duplicados.py
"""
import io
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

from guardia_duplicados import (  # noqa: E402
    choca_por_cuota,
    choca_por_dia,
    clasificar,
    dia_uy,
    es_duplicado,
    indices_nativos,
)

fallas = []


def check(nombre, condicion, detalle=""):
    print(f"  {'✓' if condicion else '🔴'} {nombre}")
    if detalle:
        print(f"      {detalle}")
    if not condicion:
        fallas.append(nombre)


CRED = "cred-1"

print("=" * 84)
print("  EL ESCENARIO DEL EMPALME 17-08")
print("=" * 84)

# La app registró el cobro el MARTES; Disapp lo trae con fecha del LUNES.
nativos = [
    {"prestamo_id": CRED, "dia_credito": 12, "monto": 500,
     "registrado_en": "2026-08-18T14:00:00-03:00"},  # martes
]
disapp = {"prestamo_id": CRED, "dia_credito": 12, "monto": 500,
          "registrado_en": "2026-08-17T00:00:00-03:00"}  # lunes

por_dia, por_cuota = indices_nativos(nativos)

check("la guardia VIEJA (por día) NO lo detecta — así se colaron los $997.474",
      not choca_por_dia(disapp, por_dia),
      "app 18-08 vs Disapp 17-08: días distintos, no matchea")
check("la guardia NUEVA (por cuota + monto) SÍ lo detecta",
      choca_por_cuota(disapp, por_cuota),
      "misma cuota 12, mismo monto $500 → es el mismo cobro")
check("es_duplicado (las dos juntas) lo frena",
      es_duplicado(disapp, por_dia, por_cuota))

print("\n" + "=" * 84)
print("  LO QUE **NO** DEBE FRENAR (si no, se tira plata real)")
print("=" * 84)

# Abono parcial en la app + cuota completa en Disapp: NO es el mismo apunte.
nativos_parcial = [
    {"prestamo_id": CRED, "dia_credito": 12, "monto": 200,
     "registrado_en": "2026-08-18T14:00:00-03:00"},
]
pd2, pc2 = indices_nativos(nativos_parcial)
disapp_completo = {"prestamo_id": CRED, "dia_credito": 12, "monto": 500,
                   "registrado_en": "2026-08-17T00:00:00-03:00"}
check("abono parcial ($200 en la app) vs cuota completa ($500 en Disapp): NO frena",
      not choca_por_cuota(disapp_completo, pc2),
      "montos distintos = apuntes distintos; con la guardia solo-por-cuota daba ~60% de falsos positivos")

# Otra cuota del mismo crédito: es plata nueva.
otra_cuota = {"prestamo_id": CRED, "dia_credito": 13, "monto": 500,
              "registrado_en": "2026-08-19T00:00:00-03:00"}
check("otra CUOTA del mismo crédito: NO frena (es un cobro nuevo)",
      not es_duplicado(otra_cuota, por_dia, por_cuota))

# Otro crédito, misma cuota y monto: no tiene nada que ver.
otro_credito = {"prestamo_id": "cred-2", "dia_credito": 12, "monto": 500,
                "registrado_en": "2026-08-17T00:00:00-03:00"}
check("otro CRÉDITO con la misma cuota y monto: NO frena",
      not es_duplicado(otro_credito, por_dia, por_cuota))

print("\n" + "=" * 84)
print("  EL DÍA URUGUAYO (cobro de la tarde-noche)")
print("=" * 84)
# El 49% de los cobros se registra entre 19:00 y 06:00. En UTC, un cobro de las
# 22:00 UY cae al día SIGUIENTE: cortar el string a 10 rompía la guardia por día
# justo en la mayoría de los cobros.
check("un cobro de las 22:00 UY sigue siendo del MISMO día uruguayo",
      dia_uy("2026-08-17T01:00:00+00:00") == "2026-08-16",
      "01:00 UTC = 22:00 UY del día anterior")

print("\n" + "=" * 84)
print("  UN LOTE COMPLETO, COMO EL DEL DOMINGO")
print("=" * 84)
nativos_lote = [
    {"prestamo_id": "A", "dia_credito": 5, "monto": 500, "registrado_en": "2026-09-07T14:00:00-03:00"},
    {"prestamo_id": "B", "dia_credito": 3, "monto": 200, "registrado_en": "2026-09-07T14:00:00-03:00"},
]
lote = [
    # duplicado: mismo crédito+cuota+monto, día anterior
    {"prestamo_id": "A", "dia_credito": 5, "monto": 500, "registrado_en": "2026-09-06T10:00:00-03:00"},
    # dudoso: misma cuota, OTRO monto
    {"prestamo_id": "B", "dia_credito": 3, "monto": 500, "registrado_en": "2026-09-06T10:00:00-03:00"},
    # limpio: crédito que la app no tocó
    {"prestamo_id": "C", "dia_credito": 1, "monto": 700, "registrado_en": "2026-09-06T10:00:00-03:00"},
]
dup, dud, ok = clasificar(lote, nativos_lote)
check("clasifica bien: 1 duplicado, 1 dudoso, 1 limpio",
      len(dup) == 1 and len(dud) == 1 and len(ok) == 1,
      f"duplicados={len(dup)} dudosos={len(dud)} limpios={len(ok)}")
check("el duplicado es el del crédito A", dup and dup[0]["prestamo_id"] == "A")
check("el dudoso es el del crédito B (entra, pero se lista)", dud and dud[0]["prestamo_id"] == "B")

print("\n" + "=" * 84)
if fallas:
    print(f"  🔴 {len(fallas)} FALLA(S): " + " · ".join(fallas))
    sys.exit(1)
print("  ✅ TODO EN VERDE — la guardia detecta el caso del 17-08 y no tira plata legítima.")
print("=" * 84)
