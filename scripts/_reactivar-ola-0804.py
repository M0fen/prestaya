# -*- coding: utf-8 -*-
# REPARACIÓN 08-05: revertir la ola de finalizaciones erróneas del 08-04 05:41 UTC.
#
# QUÉ PASÓ: una corrida del empalme cerró 375 créditos por estar ausentes del
# export de Disapp. La guardia "la app manda, jamás finalizar por ausencia" se
# apoyaba en `cobradores_vivos` (cobradores con pagos nativos desde el 08-05) y
# ese día el piloto todavía no había arrancado → el set estaba VACÍO → la guardia
# fue inerte. 370 de esos créditos NO estaban saldados: $1.382.159 de deuda viva
# cerrada de golpe, y 84 clientes del piloto quedaron sin crédito activo (siguen
# asignados a su cobrador, pero el cobrador ya no los ve con nada que cobrar).
#
# QUÉ HACE: devuelve a 'activo' los créditos de esa ola que NO estaban saldados.
# NO toca el libro de pagos (los pagos cuelgan del crédito y quedaron intactos),
# no crea ni borra nada, y deja log completo para revertir.
#
#   --alcance centro|todos   (default: centro = solo Zona Centro, el piloto)
#   --commit                 (sin esto: DRY-RUN, no escribe nada)
import argparse, json, re, ssl, sys, pg8000.native

OLA = "2026-08-04 05:41:06.446903+00"
ZONA_CENTRO = "764c2556-4e2d-410a-b39a-63c6dbf984c3"

ap = argparse.ArgumentParser()
ap.add_argument("--alcance", choices=["centro", "todos"], default="centro")
ap.add_argument("--commit", action="store_true")
a = ap.parse_args()

env = open(r"c:\Users\Carlos\Desktop\prestaya\.env.local", encoding="utf-8").read()
m = re.match(r"postgresql://([^:]+):([^@]+)@([^:/]+):(\d+)/(.+)", re.search(r"SUPABASE_DB_URL=(.+)", env).group(1).strip())
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
db = pg8000.native.Connection(user=m.group(1), password=m.group(2), host=m.group(3),
                              port=int(m.group(4)), database=m.group(5), ssl_context=ctx)

filtro_zona = "and u.zona_id = :z" if a.alcance == "centro" else ""
sql = f"""
select p.id::text, p.disapp_credit_ref, c.nombre, u.nombre,
       (p.cuota_diaria*p.total_dias - p.pagado_acum)::int as debe,
       coalesce((select max(g.registrado_en::date)::text from pagos g
                 where g.prestamo_id = p.id and not g.anulado), 'nunca') as ultimo_pago
from prestamos p
join clientes c on c.id = p.cliente_id
left join usuarios u on u.id = p.cobrador_id
where p.finalizado_en = timestamptz '{OLA}'
  and p.estado = 'finalizado'
  and p.pagado_acum < p.cuota_diaria*p.total_dias - 0.5
  {filtro_zona}
order by debe desc
"""
filas = db.run(sql, z=ZONA_CENTRO) if a.alcance == "centro" else db.run(sql)
ids = [r[0] for r in filas]
total = sum(r[4] for r in filas)
clientes = len({r[2] for r in filas})

print(f"OLA {OLA} · alcance: {a.alcance.upper()} · modo: {'🔴 COMMIT' if a.commit else '🟡 DRY-RUN'}")
print(f"  créditos a reactivar: {len(ids)} · clientes: {clientes} · deuda que vuelve: ${total:,}")
print(f"\n  {'cliente':32} {'cobrador':24} {'debe':>9}  último pago")
for r in filas[:25]:
    print(f"  {(r[2] or '')[:32]:32} {(r[3] or '—')[:24]:24} ${r[4]:>8,}  {r[5]}")
if len(filas) > 25:
    print(f"  … y {len(filas)-25} más")

with open(rf"c:\Users\Carlos\Desktop\prestaya\scripts\_reactivar-ola-0804_{a.alcance}.json", "w", encoding="utf-8") as f:
    json.dump({"ola": OLA, "alcance": a.alcance, "commit": a.commit,
               "creditos": [{"id": r[0], "ref": r[1], "cliente": r[2], "cobrador": r[3], "debe": r[4], "ultimo_pago": r[5]} for r in filas]},
              f, ensure_ascii=False, indent=2)
print(f"\n  log: scripts/_reactivar-ola-0804_{a.alcance}.json")

if not a.commit:
    print("\n🟡 DRY-RUN: no se escribió nada. Aplicar con --commit.")
    db.close(); sys.exit(0)

if not ids:
    print("Nada que reactivar."); db.close(); sys.exit(0)

db.run("begin")
try:
    # Solo estas filas exactas, y solo si siguen finalizadas y con saldo (idempotente).
    db.run("""update prestamos set estado='activo', finalizado_en=null
              where id = any(:ids::uuid[]) and estado='finalizado'
                and pagado_acum < cuota_diaria*total_dias - 0.5""", ids=ids)
    n = db.run("select count(*) from prestamos where id = any(:ids::uuid[]) and estado='activo'", ids=ids)[0][0]
    assert n == len(ids), f"esperaba {len(ids)} activos, quedaron {n}"
    # INV10: todo crédito activo tiene que estar en la ruta de su cobrador.
    sin_ruta = db.run("""select count(*) from prestamos p where p.id = any(:ids::uuid[])
        and not exists (select 1 from asignaciones x
                        where x.cliente_id=p.cliente_id and x.cobrador_id=p.cobrador_id and x.activo)""", ids=ids)[0][0]
    print(f"  créditos reactivados sin par (cliente,cobrador) en ruta: {sin_ruta}")
    if sin_ruta:
        db.run("""insert into asignaciones (cobrador_id, cliente_id, activo)
                  select distinct p.cobrador_id, p.cliente_id, true from prestamos p
                  where p.id = any(:ids::uuid[]) and p.cobrador_id is not null
                  on conflict (cobrador_id, cliente_id) do update set activo = true""", ids=ids)
        print("  → asignaciones restauradas")
    db.run("commit")
    print(f"\n✅ COMMIT — {len(ids)} créditos vueltos a 'activo' (${total:,} de cartera recuperada).")
except Exception:
    db.run("rollback"); print("\n❌ ROLLBACK — no se tocó nada."); raise
finally:
    db.close()
