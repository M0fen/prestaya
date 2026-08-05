# -*- coding: utf-8 -*-
# 08-05 (madrugada previa al arranque): TRASPASO DE 4 RUTAS a los cobradores
# nuevos del piloto. Disapp ya renombró estas rutas (export fresco 08-04); acá
# el libro (prestamos), la ruta (asignaciones), el mapeo del empalme
# (usuarios.disapp_vendedor_id) y la comisión pasan del cascarón viejo al
# cobrador real. Los PAGOS no se tocan (libro inmutable, la historia queda).
# Todo en UNA transacción; si un chequeo falla, rollback y no pasó nada.
import json, re, ssl, pg8000.native

env = open(r"c:\Users\Carlos\Desktop\prestaya\.env.local", encoding="utf-8").read()
url = re.search(r"SUPABASE_DB_URL=(.+)", env).group(1).strip()
m = re.match(r"postgresql://([^:]+):([^@]+)@([^:/]+):(\d+)/(.+)", url)
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
db = pg8000.native.Connection(user=m.group(1), password=m.group(2), host=m.group(3), port=int(m.group(4)), database=m.group(5), ssl_context=ctx)

ZONA_CENTRO = "764c2556-4e2d-410a-b39a-63c6dbf984c3"
# (vendedor Disapp fresco, cuenta vieja que lo tiene, cobrador nuevo del piloto)
TRASPASOS = [
    ("6761",  "Manuela Vera, Salto",        "John Albert Hernández"),
    ("6261",  "María, Dolores",             "María Curbelo"),
    ("10367", "Alejo, Paysandu",            "Alejandro Cardona"),
    ("9194",  "Harrison Morales, Mercedes", "Daniela Millán"),
]

def uno(sql, **kw):
    r = db.run(sql, **kw)
    assert len(r) == 1, f"esperaba 1 fila, hallé {len(r)}: {sql[:80]}"
    return r[0]

log = {"cuando": None, "motivo": "Carlos 08-05: 'ponele los clientes que les corresponden' — Disapp renombró estas rutas a los cobradores nuevos", "traspasos": []}
log["cuando"] = db.run("select now()::text")[0][0]

db.run("begin")
try:
    for vid, viejo_nombre, nuevo_nombre in TRASPASOS:
        viejo = uno("select id::text, nombre, comision_pct::text, activo from usuarios where disapp_vendedor_id = :v and nombre = :n", v=int(vid), n=viejo_nombre)
        nuevo = uno("select id::text, nombre, rol, activo, zona_id::text, disapp_vendedor_id from usuarios where nombre = :n", n=nuevo_nombre)
        assert nuevo[2] == "cobrador" and nuevo[3] and nuevo[4] == ZONA_CENTRO and nuevo[5] is None, f"{nuevo_nombre} no está listo: {nuevo}"
        antes = {
            "cartera_viejo": uno("select count(*) from asignaciones where cobrador_id = :u and activo", u=viejo[0])[0],
            "prestamos_viejo": uno("select count(*) from prestamos where cobrador_id = :u", u=viejo[0])[0],
            "prestamos_activos_viejo": uno("select count(*) from prestamos where cobrador_id = :u and estado = 'activo'", u=viejo[0])[0],
            "cartera_nuevo": uno("select count(*) from asignaciones where cobrador_id = :u", u=nuevo[0])[0],
            "prestamos_nuevo": uno("select count(*) from prestamos where cobrador_id = :u", u=nuevo[0])[0],
        }
        assert antes["cartera_viejo"] > 0 and antes["cartera_nuevo"] == 0 and antes["prestamos_nuevo"] == 0, f"estado inesperado: {antes}"

        # 1) mapeo del empalme: el vendedor Disapp pasa a la persona real
        db.run("update usuarios set disapp_vendedor_id = null where id = :u", u=viejo[0])
        db.run("update usuarios set disapp_vendedor_id = :v, comision_pct = :c where id = :u", v=int(vid), c=viejo[2], u=nuevo[0])
        # 2) el libro de créditos completo (activos + historia): la ruta cambió de manos
        db.run("update prestamos set cobrador_id = :n where cobrador_id = :o", n=nuevo[0], o=viejo[0])
        # 3) la ruta activa (asignaciones); las inactivas quedan como historia del viejo
        db.run("update asignaciones set cobrador_id = :n where cobrador_id = :o and activo", n=nuevo[0], o=viejo[0])

        despues = {
            "cartera_viejo": uno("select count(*) from asignaciones where cobrador_id = :u and activo", u=viejo[0])[0],
            "prestamos_viejo": uno("select count(*) from prestamos where cobrador_id = :u", u=viejo[0])[0],
            "cartera_nuevo": uno("select count(*) from asignaciones where cobrador_id = :u and activo", u=nuevo[0])[0],
            "prestamos_activos_nuevo": uno("select count(*) from prestamos where cobrador_id = :u and estado = 'activo'", u=nuevo[0])[0],
            "comision_nuevo": uno("select comision_pct::text from usuarios where id = :u", u=nuevo[0])[0],
        }
        assert despues["cartera_viejo"] == 0 and despues["prestamos_viejo"] == 0
        assert despues["cartera_nuevo"] == antes["cartera_viejo"]
        assert despues["prestamos_activos_nuevo"] == antes["prestamos_activos_viejo"]
        # INV10: todo crédito activo del nuevo con su par (cliente, cobrador) en ruta activa
        sin_ruta = uno("""
          select count(*) from prestamos p
          where p.cobrador_id = :u and p.estado = 'activo'
            and not exists (select 1 from asignaciones a where a.cliente_id = p.cliente_id and a.cobrador_id = p.cobrador_id and a.activo)
        """, u=nuevo[0])[0]
        assert sin_ruta == 0, f"INV10 rota para {nuevo_nombre}: {sin_ruta} créditos activos sin ruta"
        log["traspasos"].append({"vendedor": vid, "de": {"id": viejo[0], "nombre": viejo[1]}, "a": {"id": nuevo[0], "nombre": nuevo[1]}, "antes": antes, "despues": despues})
        print(f"✓ {viejo_nombre} → {nuevo_nombre}: {despues['cartera_nuevo']} clientes, {despues['prestamos_activos_nuevo']} créditos activos, comisión {despues['comision_nuevo']}%")
    db.run("commit")
    print("COMMIT — las 4 rutas traspasadas.")
except Exception:
    db.run("rollback")
    print("ROLLBACK — no se tocó nada.")
    raise
finally:
    db.close()

with open(r"c:\Users\Carlos\Desktop\prestaya\scripts\_traspaso-rutas-0805.json", "w", encoding="utf-8") as f:
    json.dump(log, f, ensure_ascii=False, indent=2, default=str)
print("log: scripts/_traspaso-rutas-0805.json")
