#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Import INCREMENTAL y SEGURO de recaudos diarios recientes (Disapp -> Presta Ya).

Por qué NO usar el empalme completo para un incremental: `commit_import` re-corre
la RECONSTRUCCIÓN de pagos no-diarios (paso 6). Sobre una base que YA la tiene
aplicada, re-correrla con un creditos.xlsx distinto puede sembrar ajustes que se
suman a los viejos (los ajustes son pagos inmutables, `ignore=True` no borra) ->
riesgo de doble-conteo de plata.

Este script reutiliza el PARSEO del empalme (misma conversión de plata x1000, mismo
mapeo de pago) pero SOLO inserta los recaudos como pagos con `ignore=True`
(insert-only por disapp_pago_id). Los pagos ya importados se saltan; solo entran
los nuevos. NO toca usuarios/clientes/créditos ni la reconstrucción. El total queda
correcto: existente (= Pagos_Disapp del último corte) + nuevos recaudos.

  Dry-run:  python scripts/import-recaudos-recientes.py
  Escribir: python scripts/import-recaudos-recientes.py --commit
  Opcional: --src PATH (default C:\\Users\\Carlos\\migracion)
            --desde YYYY-MM-DD (default 2026-07-01: solo pagos de esa fecha en adelante)
            --env-file PATH (default .env.prueba)
"""
import sys, os
import datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import empalme_disapp as E  # reusa consolidar/get_rows/upsert/iso_ts/load_env

def arg(flag, default=None):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default

COMMIT = "--commit" in sys.argv
SRC = arg("--src", r"C:\Users\Carlos\migracion")
ENVF = arg("--env-file", ".env.prueba")
DESDE_S = arg("--desde", "2026-07-01")
DESDE = dt.date.fromisoformat(DESDE_S)

env = E.load_env(ENVF)
url = env.get("SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL")
key = env.get("SUPABASE_SERVICE_ROLE_KEY")
if not url or not key:
    sys.exit(f"Faltan SUPABASE_URL/SERVICE_ROLE_KEY en {ENVF}")
import urllib.parse
db = {"url": url.rstrip("/"), "key": key, "host": urllib.parse.urlparse(url).netloc}
print(f"Destino: {db['host']}  | modo: {'COMMIT (escribe)' if COMMIT else 'DRY-RUN'} | desde: {DESDE}")

# Parseo de los xlsx (incluye conversión de plata correcta)
d = E.consolidar(SRC)
print(f"pagos parseados en xlsx: {len(d['pagos'])}")

# Mapas desde la BASE (no del import): ref -> prestamo, vendedor -> usuario
prest = E.get_rows(db, "prestamos", "id,disapp_credit_ref,total_dias")
ref_to_uuid, ref_total_dias = {}, {}
for r in prest:
    ref = r.get("disapp_credit_ref")
    if ref:
        ref_to_uuid[ref] = r["id"]
        ref_total_dias[ref] = r.get("total_dias") or 10**6
print(f"prestamos con disapp_credit_ref en la base: {len(ref_to_uuid)}")

us = E.get_rows(db, "usuarios", "id,disapp_vendedor_id")
idvend_to_uuid = {str(u["disapp_vendedor_id"]): u["id"] for u in us if u.get("disapp_vendedor_id") is not None}
vtexto_to_uuid = {t: idvend_to_uuid.get(str(i)) for t, i in d["vend_por_texto"].items()}

# Filas de pago (solo fecha>=DESDE y con préstamo en la base), MISMO mapeo que el empalme
filas, sin_prestamo, sin_fecha, por_dia = [], 0, 0, {}
for p in d["pagos"].values():
    f = p["fecha"]
    if not f:
        sin_fecha += 1; continue
    if f < DESDE:
        continue
    pid = ref_to_uuid.get(p["ref"])
    if not pid:
        sin_prestamo += 1; continue
    td = ref_total_dias.get(p["ref"], 10**6)
    dc = p["cuota_num"] or 1
    if dc > td: dc = td
    if dc < 1: dc = 1
    filas.append({
        "prestamo_id": pid, "dia_credito": dc, "monto": p["monto"] or 0.01,
        "registrado_por": vtexto_to_uuid.get(p["vendedor"]),
        "registrado_en": E.iso_ts(f), "origen": "disapp_import",
        "importado_en": dt.datetime.now().isoformat(),
        "disapp_pago_id": p["id_pago"], "disapp_credit_ref": p["ref"],
    })
    por_dia[str(f)] = por_dia.get(str(f), 0) + 1

print(f"\nfilas candidatas (fecha>={DESDE}, con préstamo): {len(filas)}")
print(f"  descartadas: sin préstamo en base={sin_prestamo}, sin fecha={sin_fecha}")
print("  por día (candidatas, incluye ya-existentes; ignore=True deduplica al insertar):")
for k in sorted(por_dia):
    print(f"    {k}: {por_dia[k]}")
suma = round(sum(x["monto"] for x in filas))
print(f"  suma $ candidatas: {suma:,}")

if not COMMIT:
    print("\nDRY-RUN: no se escribió nada. Volvé a correr con --commit para insertar.")
    sys.exit(0)

antes = E.count_rows(db, "pagos")
E.upsert(db, "pagos", filas, "disapp_pago_id", ignore=True, rep=False)
despues = E.count_rows(db, "pagos")
print(f"\nOK. pagos antes: {antes}  ->  después: {despues}  (nuevos insertados: {despues - antes})")
print("Los ya existentes se saltaron por disapp_pago_id (ignore=True). Reconstrucción NO tocada.")
