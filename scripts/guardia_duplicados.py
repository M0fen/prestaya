# -*- coding: utf-8 -*-
"""
LA GUARDIA ANTI DOBLE-CONTEO, en un solo lugar.

QUÉ PROBLEMA RESUELVE. Cuando Disapp y la app conviven, el MISMO cobro físico
puede quedar anotado en los dos sistemas. Si el importador no lo detecta, entra
dos veces: el saldo del cliente baja de más y el negocio pierde plata de verdad.

⚠️ POR QUÉ NO ALCANZA CON EL DÍA. Ésa era la guardia original y el 17-08 dejó
pasar $997.474: el cobrador cobró en la calle, lo anotó en Disapp con la fecha de
ayer y lo registró en la app hoy. Mismo crédito, MISMA CUOTA, mismo monto, días
distintos — y la guardia por (crédito, día) no lo veía.

**La identidad de un cobro entre dos sistemas es la CUOTA que salda, no el día en
que alguien lo tipeó.**

⚠️ Y POR QUÉ TAMPOCO ALCANZA CON LA CUOTA SOLA. Comparando únicamente
(crédito, cuota) se descarta cualquier recaudo cuya cuota ya tenga algún pago en
la app, aunque sea plata distinta: medido sobre el lote del 17-08 daba ~60% de
falsos positivos — cobros REALES tirados en silencio. El caso típico es un abono
parcial de $200 en la app y los $500 completos de esa cuota en Disapp: no es el
mismo apunte.

Dos cobros son EL MISMO cuando coinciden crédito, cuota Y monto.

Este módulo existe para que la regla sea UNA y se pueda probar. Antes vivía
inline dentro de `import-recaudos-recientes.py` y NO estaba en `empalme-0804.py`,
que también importa recaudos con la guardia vieja por día.
"""
import datetime as dt

UY = dt.timezone(dt.timedelta(hours=-3))

#: Tolerancia al comparar montos: cubre el redondeo de las cuotas fraccionarias
#: heredadas de Disapp, no una diferencia de plata de verdad.
TOLERANCIA_ABS = 1.0
TOLERANCIA_PCT = 0.02


def dia_uy(ts):
    """Fecha del día URUGUAYO de un timestamp.

    PostgREST devuelve el timestamptz en UTC: cortar el string a 10 daría el día
    UTC, y un cobro de la tarde-noche uruguaya cae al día UTC SIGUIENTE (UY =
    UTC−3). Con eso, la guardia no veía el choque justo en los cobros tardíos —
    que son la mayoría: el 49% se registra entre las 19:00 y las 06:00.
    """
    if not ts:
        return None
    try:
        return dt.datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone(UY).date().isoformat()
    except ValueError:
        return str(ts)[:10]


def indices_nativos(nativos):
    """Arma los dos índices con los pagos NATIVOS de la app.

    `nativos` = filas con prestamo_id, dia_credito, monto, registrado_en, ya
    filtradas a `origen IS NULL` y `anulado = false` (un pago anulado no defiende
    de nada, y uno importado no es el registro de la app).

    Devuelve (por_dia, por_cuota):
      · por_dia   {(prestamo, 'YYYY-MM-DD'): monto sumado}
      · por_cuota {(prestamo, nro_cuota):    monto sumado}
    """
    por_dia, por_cuota = {}, {}
    for n in nativos:
        pid = n.get("prestamo_id")
        if not pid:
            continue
        monto = float(n.get("monto") or 0)
        d = dia_uy(n.get("registrado_en"))
        if d:
            por_dia[(pid, d)] = por_dia.get((pid, d), 0.0) + monto
        dc = n.get("dia_credito")
        if dc is not None:
            k = (pid, int(dc))
            por_cuota[k] = por_cuota.get(k, 0.0) + monto
    return por_dia, por_cuota


def _montos_coinciden(a, b):
    return abs(a - b) <= max(TOLERANCIA_ABS, b * TOLERANCIA_PCT)


def choca_por_dia(fila, por_dia):
    """La guardia HISTÓRICA: el mismo crédito ya tiene un pago de la app ESE día."""
    return (fila.get("prestamo_id"), dia_uy(fila.get("registrado_en"))) in por_dia


def choca_por_cuota(fila, por_cuota):
    """La guardia que faltaba: misma CUOTA y mismo MONTO, sin importar el día.

    Es la que caza el caso del 17-08 — anotado en Disapp un día, en la app al
    siguiente — y la que NO tira los abonos parciales legítimos.
    """
    dc = fila.get("dia_credito")
    if dc is None:
        return False
    nativo = por_cuota.get((fila.get("prestamo_id"), int(dc)))
    if nativo is None:
        return False
    return _montos_coinciden(nativo, float(fila.get("monto") or 0))


def es_duplicado(fila, por_dia, por_cuota):
    """¿Este recaudo de Disapp YA está en la app? Las dos guardias juntas."""
    return choca_por_dia(fila, por_dia) or choca_por_cuota(fila, por_cuota)


def dudoso_por_cuota(fila, por_cuota):
    """Cae en una cuota que la app ya tocó, pero por OTRO monto.

    NO es duplicado (entra), pero se lista: es la zona donde puede esconderse
    tanto un cobro legítimo como un duplicado parcial.
    """
    dc = fila.get("dia_credito")
    if dc is None:
        return False
    return (fila.get("prestamo_id"), int(dc)) in por_cuota and not choca_por_cuota(fila, por_cuota)


def clasificar(filas, nativos):
    """Parte un lote de recaudos de Disapp en (duplicados, dudosos, limpios)."""
    por_dia, por_cuota = indices_nativos(nativos)
    dup, dud, ok = [], [], []
    for f in filas:
        if es_duplicado(f, por_dia, por_cuota):
            dup.append(f)
        elif dudoso_por_cuota(f, por_cuota):
            dud.append(f)
        else:
            ok.append(f)
    return dup, dud, ok


def traer_nativos(get_rows, db, desde_iso):
    """Los pagos NATIVOS vigentes desde una fecha, listos para la guardia.

    ⚠️ El filtro `origen IS NULL` se hace EN PYTHON a propósito: un `neq` o un
    `not.in` de PostgREST EXCLUYE los NULL (SQL trivalente), y los NULL son
    justamente los pagos de la app — la guardia quedaba ciega a lo que debía
    proteger. Es un hallazgo de la auditoría del 08-04 que ya costó una vez.
    """
    filas = get_rows(
        db, "pagos", "id,prestamo_id,dia_credito,registrado_en,monto,origen",
        {"anulado": "eq.false", "registrado_en": f"gte.{desde_iso}"},
    )
    return [n for n in filas if n.get("origen") is None]


def revisar_lote(filas_pago, get_rows, db, etiqueta="recaudos"):
    """LA PUERTA ÚNICA para cualquier importador. Devuelve (limpios, dup, dud).

    Trae los nativos, clasifica e IMPRIME el informe. Que sea una sola llamada es
    deliberado: cada script que arme su propia versión es un script que un día se
    queda con la guardia vieja — que es exactamente lo que pasó con
    `empalme-0804.py` y los $997.474 del 17-08.

    NO decide qué hacer con los duplicados: eso lo decide cada script según su
    flag (`--omitir-choques`, `--forzar`). Acá solo se dice la verdad.
    """
    if not filas_pago:
        return [], [], []
    desde = min(str(f.get("registrado_en") or "")[:10] for f in filas_pago if f.get("registrado_en"))
    nativos = traer_nativos(get_rows, db, desde or "1970-01-01")
    dup, dud, ok = clasificar(filas_pago, nativos)

    print(f"\n  ── guardia anti doble-conteo ({etiqueta}, desde {desde}) ──")
    print(f"     nativos de la app en la ventana : {len(nativos)}")
    print(f"     candidatos                      : {len(filas_pago)}")
    if dup:
        monto = round(sum(float(f.get("monto") or 0) for f in dup))
        print(f"     🔴 DUPLICADOS (mismo crédito+cuota+monto, o mismo día): {len(dup)}  ${monto:,}")
        for f in dup[:10]:
            print(f"        · crédito {str(f['prestamo_id'])[:8]}… cuota {f.get('dia_credito')} "
                  f"{str(f.get('registrado_en'))[:10]} ${round(float(f.get('monto') or 0)):,}")
        if len(dup) > 10:
            print(f"        … y {len(dup) - 10} más")
    else:
        print("     ✓ sin duplicados")
    if dud:
        monto = round(sum(float(f.get("monto") or 0) for f in dud))
        print(f"     ⚠ DUDOSOS (misma cuota, OTRO monto — ENTRAN, revisar a mano): {len(dud)}  ${monto:,}")
        for f in dud[:10]:
            print(f"        · crédito {str(f['prestamo_id'])[:8]}… cuota {f.get('dia_credito')} "
                  f"${round(float(f.get('monto') or 0)):,}")
    return ok, dup, dud
