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

🔴 NO CORRER sobre fechas en que la zona YA ESTÁ VIVA en Presta Ya. El `ignore=True`
deduplica contra lo ya importado (disapp_pago_id), pero NO contra los pagos que el
cobrador registró en la app (esos tienen disapp_pago_id = NULL): el mismo cobro
físico entraría dos veces y el saldo del cliente bajaría de más. Desde 2026-08-03
el script CHEQUEA eso y aborta solo; `--forzar` lo saltea a sabiendas.

  Dry-run:  python scripts/import-recaudos-recientes.py
  Escribir: python scripts/import-recaudos-recientes.py --commit
  Opcional: --src PATH (default C:\\Users\\Carlos\\migracion)
            --desde YYYY-MM-DD (default 2026-07-01: solo pagos de esa fecha en adelante)
            --env-file PATH (default .env.prueba)
            --forzar (saltea la guardia anti doble-conteo; usar sólo con criterio)
"""
import sys, os
import datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import empalme_disapp as E
from guardia_duplicados import dia_uy, indices_nativos, es_duplicado, dudoso_por_cuota  # reusa consolidar/get_rows/upsert/iso_ts/load_env

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

# ── GUARDIA ANTI DOBLE-CONTEO (zona ya viva en la app) ─────────────────────
# `ignore=True` deduplica contra lo YA IMPORTADO (por disapp_pago_id), pero NO
# contra los pagos que el cobrador registró en Presta Ya: esos tienen
# disapp_pago_id = NULL, así que no colisionan con nada. Si una zona ya está
# operando en la app y alguien corre este importador sobre esas fechas, el MISMO
# cobro físico entra dos veces -> el saldo del cliente baja de más = plata perdida
# de verdad, y encima queda grabada (los pagos no se borran, se anulan).
# Se chequea crédito+día contra los pagos NATIVOS de la app y se corta.
dias_import = sorted(por_dia.keys())
if dias_import:
    # ⚠️ Nativo = origen IS NULL, filtrado EN PYTHON: `neq.disapp_import` EXCLUYE
    # los NULL (SQL trivalente) → la guardia quedaba CIEGA a los pagos de la app,
    # exactamente los que debía proteger (hallazgo auditoría 08-04).
    nativos = E.get_rows(
        db, "pagos", "id,prestamo_id,dia_credito,registrado_en,monto,origen",
        {"anulado": "eq.false", "registrado_en": f"gte.{dias_import[0]}"},
    )
    nativos = [n for n in nativos if n.get("origen") is None]
    # Clave (crédito, día UY). PostgREST devuelve el timestamptz en UTC: cortar el
    # string a 10 daría el día UTC, y un cobro de la tarde-noche uruguaya cae al día
    # UTC SIGUIENTE (UY = UTC−3) → la guardia no vería el choque justo en los cobros
    # tardíos. Se pasa a hora de Uruguay antes de sacar la fecha.
    # ⚠️ LA REGLA VIVE EN `guardia_duplicados.py`, no acá. Estaba inline y por eso
    # `empalme-0804.py` —que también importa recaudos— nunca la tuvo: sigue con la
    # guardia por día, que es justo la que dejó pasar $997.474 el 17-08. Una sola
    # fuente, importada por los dos, y con prueba propia
    # (`scripts/test_guardia_duplicados.py`).
    # ⚠️ Nombres propios: `por_dia` ya existe arriba con otro significado (el
    # conteo de filas por día del import) y pisarlo sería una bomba de tiempo.
    nativo_en, nativo_cuota = indices_nativos(nativos)

    choques = [f for f in filas if es_duplicado(f, nativo_en, nativo_cuota)]
    if choques:
        monto_choque = round(sum(x["monto"] for x in choques))
        print(f"\n🔴 ABORTA: {len(choques)} recaudos (${monto_choque:,}) caen en créditos+días que YA")
        print("   tienen un pago registrado EN LA APP. Importarlos contaría la misma plata dos")
        print("   veces y le bajaría el saldo al cliente sin que nadie haya pagado de más.")
        print("   Esa zona ya está viva en Presta Ya: no se importa, se deja que la app mande.")
        print("   Si de verdad hace falta, acotá con --desde a fechas ANTERIORES al arranque")
        print("   de la zona, o pasá --forzar (a sabiendas) para saltear esta guardia.")
        for f in choques[:10]:
            print(f"     · crédito {f['prestamo_id'][:8]}… {str(f['registrado_en'])[:10]} ${round(f['monto']):,}")
        if "--omitir-choques" in sys.argv:
            # ⚠️ EL CRUCE POR (crédito, día) — empalme 17-08 tras la pausa del piloto:
            # 17 cobradores usaron la APP en el hueco y Disapp siguió recibiendo TODO.
            # Regla: donde la app ya tiene el pago de ese crédito ese día, MANDA LA
            # APP (es el registro nativo, con custodia y hora real); Disapp entra solo
            # donde la app no estuvo. Se descartan los choques y se importa el resto.
            omitidas = set(id(f) for f in choques)
            filas = [f for f in filas if id(f) not in omitidas]
            print(f"   ✂ --omitir-choques: se DESCARTAN los {len(choques)} choques (${monto_choque:,}); "
                  f"entran {len(filas)} recaudos que la app NO tenía.")
            # Los que caen en una cuota ya tocada por la app pero con OTRO monto:
            # ENTRAN (no son el mismo apunte) y se listan para revisión. Con la
            # guardia vieja —que solo miraba la cuota— estos se descartaban en
            # silencio y era ~60% de lo frenado: plata real que se perdía.
            dudosos = [f for f in filas if dudoso_por_cuota(f, nativo_cuota)]
            if dudosos:
                monto_dud = round(sum(x["monto"] for x in dudosos))
                print(f"   ⚠ {len(dudosos)} recaudos (${monto_dud:,}) caen en una cuota que la app YA tocó")
                print("     pero por OTRO monto: ENTRAN (no son el mismo apunte). Revisar a mano:")
                for f in dudosos[:15]:
                    nat = nativo_cuota.get((f["prestamo_id"], int(f["dia_credito"])), 0)
                    print(f"       · {f['prestamo_id'][:8]}… cuota {f['dia_credito']}: "
                          f"Disapp ${round(f['monto']):,} vs app ${round(nat):,}")
            # Transparencia del descarte: cuando Disapp trae MÁS plata que la app en
            # ese (crédito, día) — dos cuotas juntas vs una en la app —, el excedente
            # se pierde con el descarte. Se lista para revisarlo a mano (no se inventa
            # nada: la app es la verdad de custodia; esto es solo el mapa).
            por_clave = {}
            for f in choques:
                k = (f["prestamo_id"], dia_uy(f["registrado_en"]))
                por_clave[k] = por_clave.get(k, 0) + float(f["monto"] or 0)
            exced = [(k, v, nativo_en.get(k, 0)) for k, v in por_clave.items() if v > nativo_en.get(k, 0) + 0.5]
            if exced:
                tot = round(sum(v - a for _, v, a in exced))
                print(f"   ⚠ en {len(exced)} (crédito,día) Disapp trae MÁS que la app: ${tot:,} de diferencia total (revisar a mano):")
                for (pid, d), v, a in sorted(exced, key=lambda x: -(x[1]-x[2]))[:15]:
                    print(f"       · {pid[:8]}… {d}: Disapp ${round(v):,} vs app ${round(a):,}")
            else:
                print("   ✓ en todos los choques la app tiene igual o más que Disapp: no se pierde plata al descartar.")
        elif "--forzar" not in sys.argv:
            sys.exit(1)
        else:
            print("   ⚠ --forzar activo: se importan igual (bajo tu responsabilidad).")
    else:
        print(f"  ✓ sin choques con pagos nativos de la app ({len(nativos)} revisados)")

if not COMMIT:
    print("\nDRY-RUN: no se escribió nada. Volvé a correr con --commit para insertar.")
    sys.exit(0)

antes = E.count_rows(db, "pagos")
E.upsert(db, "pagos", filas, "disapp_pago_id", ignore=True, rep=False)
despues = E.count_rows(db, "pagos")
print(f"\nOK. pagos antes: {antes}  ->  después: {despues}  (nuevos insertados: {despues - antes})")
print("Los ya existentes se saltaron por disapp_pago_id (ignore=True). Reconstrucción NO tocada.")
