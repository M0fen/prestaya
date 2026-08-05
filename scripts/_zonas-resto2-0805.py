# -*- coding: utf-8 -*-
# 08-05 (2ª tanda): últimos 3 sueltos con cartera a su zona por evidencia de ciudad.
# Queda SIN ZONA a propósito: "Administrador Presta Ya" (cartera de la oficina)
# y los 5 cascarones vacíos (candidatos a baja). Log de reversa al final.
import json, re, ssl, pg8000.native
env = open(r"c:\Users\Carlos\Desktop\prestaya\.env.local", encoding="utf-8").read()
url = re.search(r"SUPABASE_DB_URL=(.+)", env).group(1).strip()
m = re.match(r"postgresql://([^:]+):([^@]+)@([^:/]+):(\d+)/(.+)", url)
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
db = pg8000.native.Connection(user=m.group(1), password=m.group(2), host=m.group(3), port=int(m.group(4)), database=m.group(5), ssl_context=ctx)

zonas = {r[1]: r[0] for r in db.run("select id::text, nombre from zonas")}
MOVES = [
    ("Andres Paisa, Colonia", "Zona Sur"),   # la otra ruta de Colonia (Mauricio Torres) es Sur
    ("Edwin Brasil", "Zona Norte"),          # clúster Edwin (supervisor Norte) + frontera Brasil
    ("Fabio Jaramillo", "Zona Sur"),         # Punta del Este: continuidad de la costa de Sur
]
log = {"cuando": db.run("select now()::text")[0][0], "acciones": []}
db.run("begin")
try:
    for nombre, zona in MOVES:
        r = db.run("select id::text, zona_id, activo, rol from usuarios where nombre = :n", n=nombre)
        assert len(r) == 1 and r[0][1] is None and r[0][2] and r[0][3] == "cobrador", f"{nombre}: {r}"
        db.run("update usuarios set zona_id = :z where id = :u", z=zonas[zona], u=r[0][0])
        log["acciones"].append({"tipo": "zona", "usuario": nombre, "zona": zona})
        print(f"✓ {nombre} → {zona}")
    db.run("commit"); print("COMMIT.")
except Exception:
    db.run("rollback"); print("ROLLBACK."); raise
finally:
    db.close()
with open(r"c:\Users\Carlos\Desktop\prestaya\scripts\_zonas-resto2-0805.json", "w", encoding="utf-8") as f:
    json.dump(log, f, ensure_ascii=False, indent=2, default=str)
print("log: scripts/_zonas-resto2-0805.json")
