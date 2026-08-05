# -*- coding: utf-8 -*-
# 08-05: acomodo del RESTO de los usuarios (fuera del piloto) para estar listos.
#  1) Traspaso de la ruta "FABIO, PUNTA DEL ESTE." (vid 6024): la tenía el
#     cascarón "Daniela, Punta Del Este" → pasa a Fabio Jaramillo (misma mecánica
#     que el traspaso de las 4 del piloto: prestamos + asignaciones + vendedor + comisión).
#  2) Zonas para los sueltos con evidencia clara (ciudad de la ruta en Disapp):
#     Marcela Londoño (Montevideo) → Zona Sur · Edwin Campo, Tacuarembo → Zona Norte
#     Brayan Toro (Durazno) → Zona Sur · Cartera Zona Centro → Zona Centro
#     Cartera Zona Sur → Zona Sur · Cartera Edwin → Zona Norte (Edwin supervisa Norte)
# Todo en UNA transacción con log de reversa. Los PAGOS no se tocan.
import json, re, ssl, pg8000.native

env = open(r"c:\Users\Carlos\Desktop\prestaya\.env.local", encoding="utf-8").read()
url = re.search(r"SUPABASE_DB_URL=(.+)", env).group(1).strip()
m = re.match(r"postgresql://([^:]+):([^@]+)@([^:/]+):(\d+)/(.+)", url)
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
db = pg8000.native.Connection(user=m.group(1), password=m.group(2), host=m.group(3), port=int(m.group(4)), database=m.group(5), ssl_context=ctx)

def uno(sql, **kw):
    r = db.run(sql, **kw)
    assert len(r) == 1, f"esperaba 1 fila: {sql[:90]} → {len(r)}"
    return r[0]

zonas = {r[1]: r[0] for r in db.run("select id::text, nombre from zonas")}
log = {"cuando": db.run("select now()::text")[0][0], "motivo": "Carlos 08-05: 'acomoda el resto de los usuarios para estar listos'", "acciones": []}

# dato informativo: ¿las carteras de supervisor están marcadas es_float_supervisor?
flo = db.run("""
  select u.nombre, count(*) filter (where p.es_float_supervisor), count(*)
  from usuarios u join prestamos p on p.cobrador_id = u.id and p.estado = 'activo'
  where u.nombre like 'Cartera%' group by u.nombre
""")
for f in flo:
    print(f"  info: {f[0]} — {f[1]}/{f[2]} créditos activos marcados float-supervisor")

db.run("begin")
try:
    # ── 1) Traspaso FABIO ──
    viejo = uno("select id::text, nombre, comision_pct::text from usuarios where disapp_vendedor_id = '6024' and nombre = 'Daniela, Punta Del Este'")
    nuevo = uno("select id::text, nombre, rol, activo, disapp_vendedor_id from usuarios where nombre = 'Fabio Jaramillo'")
    assert nuevo[2] == "cobrador" and nuevo[3] and nuevo[4] is None
    nat = uno("select count(*) from pagos where registrado_por = :u and origen is null", u=viejo[0])[0]
    assert nat == 0, f"el cascarón tiene {nat} pagos nativos — revisar a mano"
    antes = {
        "cartera_viejo": uno("select count(*) from asignaciones where cobrador_id = :u and activo", u=viejo[0])[0],
        "prestamos_activos_viejo": uno("select count(*) from prestamos where cobrador_id = :u and estado='activo'", u=viejo[0])[0],
        "cartera_nuevo": uno("select count(*) from asignaciones where cobrador_id = :u", u=nuevo[0])[0],
    }
    assert antes["cartera_viejo"] > 0 and antes["cartera_nuevo"] == 0
    db.run("update usuarios set disapp_vendedor_id = null where id = :u", u=viejo[0])
    db.run("update usuarios set disapp_vendedor_id = '6024', comision_pct = :c where id = :u", c=viejo[2], u=nuevo[0])
    db.run("update prestamos set cobrador_id = :n where cobrador_id = :o", n=nuevo[0], o=viejo[0])
    db.run("update asignaciones set cobrador_id = :n where cobrador_id = :o and activo", n=nuevo[0], o=viejo[0])
    despues = {
        "cartera_nuevo": uno("select count(*) from asignaciones where cobrador_id = :u and activo", u=nuevo[0])[0],
        "prestamos_activos_nuevo": uno("select count(*) from prestamos where cobrador_id = :u and estado='activo'", u=nuevo[0])[0],
    }
    assert despues["cartera_nuevo"] == antes["cartera_viejo"]
    assert despues["prestamos_activos_nuevo"] == antes["prestamos_activos_viejo"]
    sin_ruta = uno("""select count(*) from prestamos p where p.cobrador_id = :u and p.estado='activo'
      and not exists (select 1 from asignaciones a where a.cliente_id=p.cliente_id and a.cobrador_id=p.cobrador_id and a.activo)""", u=nuevo[0])[0]
    assert sin_ruta == 0, f"INV10 rota: {sin_ruta}"
    log["acciones"].append({"tipo": "traspaso_ruta", "vendedor": "6024", "de": viejo[1], "a": nuevo[1], "antes": antes, "despues": despues})
    print(f"✓ ruta FABIO: {viejo[1]} → {nuevo[1]} ({despues['cartera_nuevo']} clientes, {despues['prestamos_activos_nuevo']} créditos activos, comisión {viejo[2]}%)")

    # ── 2) Zonas con evidencia clara ──
    MOVES = [
        ("Marcela Londoño, Montevideo", "Zona Sur"),
        ("Edwin Campo, Tacuarembo", "Zona Norte"),
        ("Brayan Toro, Durazno 2", "Zona Sur"),
        ("Cartera Zona Centro, Boso", "Zona Centro"),
        ("Cartera Zona Sur, Cesar", "Zona Sur"),
        ("Cartera Edwin, Uruguay", "Zona Norte"),
    ]
    for nombre, zona in MOVES:
        u = uno("select id::text, zona_id, activo, rol from usuarios where nombre = :n", n=nombre)
        assert u[1] is None and u[2] and u[3] == "cobrador", f"{nombre} no está como esperaba: {u}"
        db.run("update usuarios set zona_id = :z where id = :u", z=zonas[zona], u=u[0])
        log["acciones"].append({"tipo": "zona", "usuario": nombre, "zona": zona})
        print(f"✓ zona: {nombre} → {zona}")

    db.run("commit")
    print("COMMIT.")
except Exception:
    db.run("rollback")
    print("ROLLBACK — no se tocó nada.")
    raise
finally:
    db.close()

with open(r"c:\Users\Carlos\Desktop\prestaya\scripts\_acomodo-resto-0805.json", "w", encoding="utf-8") as f:
    json.dump(log, f, ensure_ascii=False, indent=2, default=str)
print("log: scripts/_acomodo-resto-0805.json")
