# -*- coding: utf-8 -*-
"""
CERRAR los pedidos de renovación que YA se colocaron por fuera de la app.

EL PROBLEMA
-----------
El 09-08 quedaron TRES solicitudes de renovación pendientes por $48.000:

    PATRICIA POSSE GIMENEZ   $25.000   pidió Yuli Toro
    BETINA NARTINES          $15.000   pidió Daniela Millán
    CLAUDIA ZUCARET           $8.000   pidió Fernando Castro

Contra el export fresco de Disapp (09-08 21:13) los tres créditos YA EXISTEN, con
el monto EXACTO que se pidió, y los tres clientes ya pagaron su primera cuota el
08-08 — o sea, un día ANTES de que el pedido entrara a nuestra app:

    PRD0003614338  $25.000  PATRICIA  · cuota 1/30 cobrada el 08/08
    PRD0003614673  $15.000  BETINA    · cuota 1/30 cobrada el 08/08 ($600)
    PRD0003615314   $8.000  CLAUDIA   · cuota 1/30 cobrada el 08/08 ($320)

La secuencia real fue: el cliente terminó el 07-08 · el cobrador colocó el crédito
nuevo el 08-08 y la oficina lo registró en Disapp · el 09-08 el cobrador ADEMÁS lo
pidió por la app, para algo que ya estaba hecho.

POR QUÉ NO SE APRUEBAN
----------------------
Aprobarlos crearía un crédito nuevo en NUESTRA base por un préstamo que ya existe
en Disapp. El empalme importa esos tres créditos con su referencia PRD real, así
que el cliente terminaría con DOS créditos por el mismo préstamo — exactamente el
caso ROSMARIE que hubo que limpiar el 09-08. Son $48.000 de capital fantasma.

Aprobar también fecharía el crédito HOY y le descontaría ese capital de la caja del
día al cobrador, cuando la plata salió de su bolsillo el 08-08.

QUÉ HACE ESTE SCRIPT
--------------------
Cierra las tres como `rechazada` con el motivo nombrando la referencia de Disapp.
No toca plata: `solicitudes_renovacion` es una cola de pedidos. El crédito real
entra por el empalme, con su ref, su fecha y sus pagos.

El cobrador NO se queda sin saber: desde el 09-08 el home muestra "Tus pedidos" con
el estado y el motivo (lib/data/misPedidos.ts), así que los tres van a leer por qué
se cerró y que el crédito ya está corriendo.

Sin `--commit` NO escribe nada. Con `--commit` escribe, deja la reversa en
`_revert_pedidos_0809.json` y registra en `auditoria`. Es idempotente.
"""
import json
import os
import re
import ssl
import sys
from urllib.parse import unquote

import pg8000.dbapi

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REVERT = os.path.join(RAIZ, "scripts", "_revert_pedidos_0809.json")
COMMIT = "--commit" in sys.argv

# Pedido → referencia del crédito que YA existe en Disapp (verificado contra el
# export de créditos y contra los recaudos del 08-08).
YA_EN_DISAPP = {
    "PATRICIA POSSE GIMENEZ": "PRD0003614338",
    "BETINA NARTINES": "PRD0003614673",
    "CLAUDIA ZUCARET": "PRD0003615314",
}


def conectar():
    with open(os.path.join(RAIZ, ".env.local"), encoding="utf-8") as fh:
        url = next(
            l.split("=", 1)[1].strip().strip('"').strip("'")
            for l in fh
            if l.startswith("SUPABASE_DB_URL=")
        )
    m = re.match(r"postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+):(\d+)/(.+)", url)
    usr, pw, host, port, base = m.groups()
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return pg8000.dbapi.connect(
        user=unquote(usr), password=unquote(pw), host=host,
        port=int(port), database=base.split("?")[0], ssl_context=ctx,
    )


def money(n):
    return "$" + f"{round(float(n or 0)):,}".replace(",", ".")


def main():
    cn = conectar()
    cur = cn.cursor()

    cur.execute(
        """select s.id, c.nombre, s.monto, s.total_dias, s.solicitado_por,
                  s.solicitado_por_nombre, s.solicitado_en, s.cliente_id
             from solicitudes_renovacion s
             join clientes c on c.id = s.cliente_id
            where s.estado = 'pendiente'
            order by s.solicitado_en"""
    )
    pendientes = cur.fetchall()
    print(f"Solicitudes PENDIENTES: {len(pendientes)}\n")

    aCerrar, aDejar = [], []
    for sid, nombre, monto, dias, quien_id, quien, cuando, cliente_id in pendientes:
        ref = YA_EN_DISAPP.get((nombre or "").strip().upper())
        fila = {
            "solicitudId": str(sid), "cliente": nombre, "clienteId": str(cliente_id),
            "monto": float(monto), "totalDias": dias, "pidio": quien,
            "solicitadoPor": str(quien_id) if quien_id else None,
            "solicitadoEn": str(cuando), "refDisapp": ref,
        }
        (aCerrar if ref else aDejar).append(fila)

    print(f"  ✅ A CERRAR (ya están en Disapp): {len(aCerrar)}  "
          f"{money(sum(f['monto'] for f in aCerrar))}")
    for f in aCerrar:
        print(f"     {f['cliente'][:30]:<31} {money(f['monto']):>9}  ← {f['refDisapp']}  ({f['pidio']})")
    if aDejar:
        print(f"\n  ·  SE DEJAN pendientes (sin gemelo en Disapp): {len(aDejar)}")
        for f in aDejar:
            print(f"     {f['cliente'][:30]:<31} {money(f['monto']):>9}  ({f['pidio']})")

    if not COMMIT:
        print("\n(DRY-RUN: no se escribió nada. Correr con --commit para aplicar.)")
        cn.close()
        return
    if not aCerrar:
        print("\nNada que cerrar.")
        cn.close()
        return

    # El que resuelve es el ADMIN (dueño): es su cola y su decisión de negocio.
    cur.execute("select id, nombre from usuarios where rol = 'admin' and activo order by creado_en limit 1")
    fila = cur.fetchone()
    if not fila:
        print("No hay un admin activo para firmar la resolución. Abortado.")
        cn.close()
        return
    admin_id, admin_nombre = fila

    json.dump(
        {
            "que": "se cerraron como RECHAZADAS solicitudes de renovación cuyo crédito YA existe en Disapp",
            "porque": "aprobarlas habría creado un SEGUNDO crédito por el mismo préstamo (el empalme importa el de Disapp con su ref)",
            "cuando": "2026-08-09",
            "revertir": "update solicitudes_renovacion set estado='pendiente', resuelto_por=null, resuelto_en=null, motivo_rechazo=null where id in (...)",
            "solicitudes": aCerrar,
        },
        open(REVERT, "w", encoding="utf-8"), ensure_ascii=False, indent=1,
    )

    for f in aCerrar:
        motivo = (
            f"Ya está colocado: el crédito de {money(f['monto'])} figura en Disapp como "
            f"{f['refDisapp']} y el cliente empezó a pagarlo el 08-08. No se aprueba acá porque "
            f"quedarían DOS créditos por el mismo préstamo."
        )
        cur.execute(
            """update solicitudes_renovacion
                  set estado = 'rechazada', resuelto_por = %s, resuelto_en = now(),
                      motivo_rechazo = %s
                where id = %s and estado = 'pendiente'""",
            (admin_id, motivo[:300], f["solicitudId"]),
        )
        cur.execute(
            """insert into auditoria (actor_id, actor_nombre, accion, entidad, entidad_id, detalle)
               values (%s, %s, %s, 'cliente', %s, %s)""",
            (
                admin_id, admin_nombre,
                "Cerró un pedido de renovación YA COLOCADO (evita duplicado con Disapp)",
                f["clienteId"],
                f"{money(f['monto'])} × {f['totalDias']} pedido por {f['pidio']} — "
                f"el crédito ya existe en Disapp como {f['refDisapp']}",
            ),
        )
    cn.commit()
    print(f"\n✅ {len(aCerrar)} pedidos cerrados · firmado por {admin_nombre} · "
          f"reversa en {os.path.basename(REVERT)}")

    cur.execute("select count(*) from solicitudes_renovacion where estado='pendiente'")
    print(f"Pedidos que siguen pendientes: {cur.fetchone()[0]}")
    cn.close()


if __name__ == "__main__":
    main()
