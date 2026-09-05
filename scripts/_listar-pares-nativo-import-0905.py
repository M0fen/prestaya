# -*- coding: utf-8 -*-
"""
LISTADO PARA REVISIÓN HUMANA — pares (pago nativo + pago importado) sobre la
MISMA cuota, el MISMO monto, en días distintos.

Es la firma exacta del duplicado del empalme: el cobrador cobró en la calle, lo
anotó en Disapp con la fecha de un día y lo registró en la app en otro. La
guardia por día no los veía; la guardia por cuota sí.

⚠️ ESTE SCRIPT NO ANULA NI CORRIGE NADA. Solo lee y lista, para revisar con el
cliente — igual que se hizo con los pares del 17-08.

Incluye también, al final, los pares NATIVO+NATIVO del botón «adelantar próxima»
(mismo crédito, misma cuota, mismo monto, minutos de diferencia), que son otro
caso distinto y también van a revisión humana.

  python scripts/_listar-pares-nativo-import-0905.py            → informe en pantalla
  python scripts/_listar-pares-nativo-import-0905.py --csv      → + archivo CSV
"""
import csv
import datetime as dt
import io
import os
import re
import ssl
import sys
from urllib.parse import unquote

import pg8000.dbapi

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV = "--csv" in sys.argv


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


def money(n):
    return "$" + f"{round(float(n or 0)):,}".replace(",", ".")


# Un pago NATIVO y uno IMPORTADO sobre la misma cuota del mismo crédito, por el
# mismo monto (±$0,50) y en DÍAS distintos. Los del mismo día ya los cazaba la
# guardia vieja; éstos son los que se colaban.
SQL_PARES = """
select cl.nombre                                   as cliente,
       u.nombre                                    as cobrador,
       p.disapp_credit_ref                         as credito_ref,
       p.id                                        as prestamo_id,
       nat.dia_credito                             as cuota,
       nat.monto                                   as monto,
       (nat.registrado_en at time zone 'America/Montevideo')::date as fecha_app,
       (imp.registrado_en at time zone 'America/Montevideo')::date as fecha_disapp,
       nat.id                                      as pago_app_id,
       imp.id                                      as pago_disapp_id,
       imp.disapp_pago_id                          as folio_disapp,
       p.estado                                    as estado_credito,
       p.pagado_acum                               as pagado,
       p.cuota_diaria * p.total_dias               as total,
       (p.pagado_acum - p.cuota_diaria * p.total_dias) as exceso
  from pagos nat
  join pagos imp
    on imp.prestamo_id = nat.prestamo_id
   and imp.dia_credito = nat.dia_credito
   and abs(imp.monto - nat.monto) < 0.5
   and imp.anulado = false
   and imp.origen = 'disapp_import'
   and (imp.registrado_en at time zone 'America/Montevideo')::date
     <> (nat.registrado_en at time zone 'America/Montevideo')::date
  join prestamos p on p.id = nat.prestamo_id
  join clientes  cl on cl.id = p.cliente_id
  left join usuarios u on u.id = nat.registrado_por
 where nat.anulado = false
   and nat.origen is null
 order by (p.pagado_acum - p.cuota_diaria * p.total_dias) desc, nat.monto desc
"""

# Pares NATIVO+NATIVO con minutos de diferencia: la huella del botón «adelantar
# próxima», que hoy apaga las dos guardias anti-doble-cobro.
SQL_ADELANTO = """
select cl.nombre, u.nombre, p.id, a.dia_credito, a.monto,
       a.registrado_en, b.registrado_en,
       round(extract(epoch from (b.registrado_en - a.registrado_en))::numeric, 0) as segundos,
       p.pagado_acum, p.cuota_diaria * p.total_dias
  from pagos a
  join pagos b on b.prestamo_id = a.prestamo_id and b.id > a.id
   and b.anulado = false and b.origen is null
   and b.dia_credito = a.dia_credito
   and abs(b.monto - a.monto) < 0.5
   and abs(extract(epoch from (b.registrado_en - a.registrado_en))) <= 600
  join prestamos p on p.id = a.prestamo_id
  join clientes  cl on cl.id = p.cliente_id
  left join usuarios u on u.id = a.registrado_por
 where a.anulado = false and a.origen is null
 order by a.registrado_en
"""


def main():
    cn = conectar()
    cur = cn.cursor()

    print("=" * 108)
    print("  PARES NATIVO + IMPORTADO — misma cuota, mismo monto, DÍAS DISTINTOS")
    print("  (la firma del duplicado del empalme · SOLO LECTURA, no se anula nada)")
    print("=" * 108)
    cur.execute(SQL_PARES)
    pares = cur.fetchall()

    creditos = {p[3] for p in pares}
    total = sum(float(p[5] or 0) for p in pares)
    con_exceso = {p[3] for p in pares if float(p[14] or 0) > 1}
    print(f"\n  pares: {len(pares)} · créditos: {len(creditos)} · plata de UN lado: {money(total)}")
    print(f"  créditos que HOY están sobre-cobrados: {len(con_exceso)}\n")

    print(f"  {'cliente':26} {'cobrador':16} {'cuota':>6} {'monto':>10} {'app':>11} {'disapp':>11} {'exceso':>11}")
    print("  " + "─" * 100)
    for (cliente, cobrador, ref, pid, cuota, monto, f_app, f_dis,
         _pa, _pd, _folio, estado, _pag, _tot, exceso) in pares:
        exc = money(exceso) if float(exceso or 0) > 1 else "—"
        print(f"  {str(cliente)[:26]:26} {str(cobrador or '—')[:16]:16} {cuota:>6} "
              f"{money(monto):>10} {str(f_app):>11} {str(f_dis):>11} {exc:>11}")

    print("\n" + "=" * 108)
    print("  PARES NATIVO + NATIVO en ≤10 min — la huella del botón «adelantar próxima»")
    print("=" * 108)
    cur.execute(SQL_ADELANTO)
    adel = cur.fetchall()
    print(f"\n  pares: {len(adel)} · plata del pago repetido: "
          f"{money(sum(float(a[4] or 0) for a in adel))}\n")
    print(f"  {'cliente':26} {'cobrador':16} {'cuota':>6} {'monto':>10} {'seg':>6}  cuándo")
    print("  " + "─" * 100)
    for cliente, cobrador, _pid, cuota, monto, ra, _rb, seg, _pag, _tot in adel:
        print(f"  {str(cliente)[:26]:26} {str(cobrador or '—')[:16]:16} {cuota:>6} "
              f"{money(monto):>10} {int(seg):>6}  {str(ra)[:16]}")

    if CSV:
        ruta = os.path.join(RAIZ, "scripts", f"_pares_revision_{dt.date.today():%Y%m%d}.csv")
        with open(ruta, "w", newline="", encoding="utf-8-sig") as fh:
            w = csv.writer(fh, delimiter=";")
            w.writerow(["tipo", "cliente", "cobrador", "credito_ref", "prestamo_id", "cuota",
                        "monto", "fecha_app", "fecha_disapp", "pago_app_id", "pago_disapp_id",
                        "folio_disapp", "estado_credito", "pagado", "total", "exceso"])
            for (cliente, cobrador, ref, pid, cuota, monto, f_app, f_dis,
                 pa, pd, folio, estado, pag, tot, exceso) in pares:
                w.writerow(["nativo+importado", cliente, cobrador, ref, pid, cuota,
                            round(float(monto)), f_app, f_dis, pa, pd, folio, estado,
                            round(float(pag)), round(float(tot)), round(float(exceso))])
            for cliente, cobrador, pid, cuota, monto, ra, rb, seg, pag, tot in adel:
                w.writerow(["adelanto (nativo+nativo)", cliente, cobrador, "", pid, cuota,
                            round(float(monto)), str(ra)[:19], str(rb)[:19], "", "", "",
                            f"{int(seg)}s de diferencia", round(float(pag)), round(float(tot)),
                            round(float(pag) - float(tot))])
        print(f"\n  CSV: {ruta}")

    print("\n  ⚠️ NO SE TOCÓ NADA. Este listado es para revisar con el cliente.\n")
    cur.close()
    cn.close()


if __name__ == "__main__":
    main()
