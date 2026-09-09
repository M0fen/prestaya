# -*- coding: utf-8 -*-
"""
SALUD DE LA BASE — solo lectura, contra la base viva.

Doce familias de chequeos, cada uno con el número real al lado. No opina: mide.
  1. Integridad referencial (huérfanos)
  2. Invariantes de dinero (el libro manda)
  3. Estados imposibles del crédito
  4. RLS: tablas expuestas, tablas tapiadas, policies permisivas
  5. Funciones SECURITY DEFINER sin search_path fijo
  6. Índices: FK sin índice, índices que nadie usa, duplicados
  7. Migraciones: lo que el repo dice que existe vs lo que existe
  8. Triggers y constraints: los candados de plata siguen puestos
  9. Datos sucios (duplicados, nulos, fechas absurdas)
 10. Peso y mantenimiento (bloat, autovacuum, filas muertas)
 11. Cola de trabajo pendiente (lo que la operación dejó a medias)
 12. Coherencia app ↔ Disapp

  python scripts/salud-base.py            → informe
  python scripts/salud-base.py --json     → además, JSON para alimentar otra cosa
"""
import argparse
import io
import json
import os
import re
import ssl
import sys
from urllib.parse import unquote

import pg8000.dbapi

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

HALLAZGOS = []


def conectar(envf=".env.local"):
    with open(os.path.join(RAIZ, envf), encoding="utf-8") as fh:
        url = next(l.split("=", 1)[1].strip().strip('"').strip("'")
                   for l in fh if l.startswith("SUPABASE_DB_URL="))
    m = re.match(r"postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+):(\d+)/(.+)", url)
    usr, pw, host, port, base = m.groups()
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return pg8000.dbapi.connect(user=unquote(usr), password=unquote(pw), host=host,
                                port=int(port), database=base.split("?")[0], ssl_context=ctx)


def seccion(t):
    print("\n" + "═" * 100)
    print(f"  {t}")
    print("═" * 100)


def chk(cur, etiqueta, sql, umbral=0, gravedad="alto", detalle_sql=None, pinta=None):
    """Corre un chequeo que devuelve UN número. Si supera el umbral, es hallazgo."""
    try:
        cur.execute(sql)
        r = cur.fetchone()
        n = r[0] if r else 0
        extra = " · ".join(str(x) for x in r[1:]) if r and len(r) > 1 else ""
    except Exception as e:
        print(f"  ⚠️  {etiqueta}: no se pudo medir ({str(e)[:90]})")
        return None
    mal = (n or 0) > umbral
    icono = ("🔴" if gravedad == "alto" else "🟡") if mal else "✅"
    txt = pinta(n) if pinta else f"{n:,}"
    print(f"  {icono} {etiqueta}: {txt}{('  · ' + extra) if extra else ''}")
    if mal:
        HALLAZGOS.append({"que": etiqueta, "n": n, "gravedad": gravedad, "extra": extra})
        if detalle_sql:
            try:
                cur.execute(detalle_sql)
                for f in cur.fetchall()[:6]:
                    print(f"        · {' · '.join('' if x is None else str(x)[:60] for x in f)}")
            except Exception:
                pass
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--env-file", default=".env.local")
    a = ap.parse_args()
    cn = conectar(a.env_file)
    cur = cn.cursor()

    # ═══ 1 · INTEGRIDAD REFERENCIAL ═══════════════════════════════════════
    seccion("1 · INTEGRIDAD REFERENCIAL — filas que apuntan a algo que no existe")
    chk(cur, "pagos cuyo préstamo no existe",
        "select count(*) from pagos g left join prestamos p on p.id=g.prestamo_id where p.id is null")
    chk(cur, "préstamos cuyo cliente no existe",
        "select count(*) from prestamos p left join clientes c on c.id=p.cliente_id where c.id is null")
    chk(cur, "préstamos con cobrador inexistente",
        "select count(*) from prestamos p left join usuarios u on u.id=p.cobrador_id where p.cobrador_id is not null and u.id is null")
    chk(cur, "asignaciones a un cliente que no existe",
        "select count(*) from asignaciones a left join clientes c on c.id=a.cliente_id where c.id is null")
    chk(cur, "asignaciones a un cobrador que no existe",
        "select count(*) from asignaciones a left join usuarios u on u.id=a.cobrador_id where u.id is null")
    chk(cur, "pagos registrados por un usuario inexistente",
        "select count(*) from pagos g left join usuarios u on u.id=g.registrado_por where g.registrado_por is not null and u.id is null")
    chk(cur, "usuarios sin cuenta de acceso (auth_user_id nulo) que igual están activos",
        "select count(*) from usuarios where activo and auth_user_id is null and rol in ('admin','supervisor','cobrador')",
        gravedad="medio",
        detalle_sql="select nombre, rol from usuarios where activo and auth_user_id is null and rol in ('admin','supervisor','cobrador') limit 6")

    # ═══ 2 · DINERO ═══════════════════════════════════════════════════════
    seccion("2 · DINERO — el libro de pagos es la verdad; todo lo demás se deriva")
    chk(cur, "créditos donde pagado_acum ≠ Σ pagos vivos (drift del saldo)",
        """select count(*) from (
             select p.id, p.pagado_acum, coalesce((select sum(g.monto) from pagos g
                     where g.prestamo_id=p.id and g.anulado=false),0) real
               from prestamos p) t where abs(pagado_acum - real) > 0.5""",
        detalle_sql="""select p.id::text, round(p.pagado_acum), round(coalesce((select sum(g.monto) from pagos g
                        where g.prestamo_id=p.id and g.anulado=false),0)), p.estado
                        from prestamos p where abs(p.pagado_acum - coalesce((select sum(g.monto) from pagos g
                        where g.prestamo_id=p.id and g.anulado=false),0)) > 0.5 limit 6""")
    chk(cur, "créditos ACTIVOS que ya cobraron de más",
        "select count(*), 'exceso $' || round(sum(pagado_acum - cuota_diaria*total_dias)) from prestamos where estado='activo' and pagado_acum > cuota_diaria*total_dias + 1",
        gravedad="medio")
    chk(cur, "créditos ACTIVOS ya saldados (deberían estar finalizados)",
        "select count(*), 'de ellos importados: ' || count(*) filter (where creado_por is null) from prestamos where estado='activo' and pagado_acum >= cuota_diaria*total_dias - 0.5",
        gravedad="medio")
    chk(cur, "pagos con monto ≤ 0 (vivos)",
        "select count(*) from pagos where anulado=false and monto <= 0")
    chk(cur, "pagos anulados SIN motivo (el libro exige por qué)",
        "select count(*) from pagos where anulado=true and (motivo_anulacion is null or btrim(motivo_anulacion)='')")
    chk(cur, "pagos anulados sin quién los anuló",
        "select count(*) from pagos where anulado=true and anulado_por is null", gravedad="medio")
    chk(cur, "créditos con cuota o plazo en cero (cartón imposible)",
        "select count(*) from prestamos where estado='activo' and (cuota_diaria is null or cuota_diaria<=0 or total_dias is null or total_dias<=0)")
    chk(cur, "créditos activos con interés fuera de rango (<1% o >200%)",
        "select count(*) from prestamos where estado='activo' and (interes_pct < 1 or interes_pct > 200)",
        gravedad="medio")
    chk(cur, "pagos con dia_credito fuera del plazo del crédito",
        """select count(*) from pagos g join prestamos p on p.id=g.prestamo_id
            where g.anulado=false and (g.dia_credito < 1 or g.dia_credito > p.total_dias)""", gravedad="medio")
    chk(cur, "movimientos de caja duplicados por op_id",
        "select count(*) from (select op_id from movimientos_caja where op_id is not null group by 1 having count(*)>1) t")

    # ═══ 3 · ESTADOS IMPOSIBLES ═══════════════════════════════════════════
    seccion("3 · CICLO DE VIDA DEL CRÉDITO — estados que no deberían existir")
    chk(cur, "créditos finalizados que todavía deben plata",
        "select count(*), '$' || round(sum(cuota_diaria*total_dias - pagado_acum)) from prestamos where estado='finalizado' and cuota_diaria*total_dias - pagado_acum > 1",
        gravedad="medio")
    chk(cur, "créditos CANCELADOS con pagos vivos",
        "select count(*) from prestamos p where p.estado='cancelado' and exists (select 1 from pagos g where g.prestamo_id=p.id and g.anulado=false)",
        gravedad="medio")
    chk(cur, "créditos activos que empiezan en el FUTURO",
        "select count(*) from prestamos where estado='activo' and fecha_inicio > (now() at time zone 'America/Montevideo')::date")
    chk(cur, "créditos activos sin fecha de inicio",
        "select count(*) from prestamos where estado='activo' and fecha_inicio is null")
    chk(cur, "clientes con más de 2 créditos ACTIVOS",
        "select count(*) from (select cliente_id from prestamos where estado='activo' group by 1 having count(*)>2) t",
        gravedad="medio")
    chk(cur, "créditos activos de un cliente INACTIVO",
        "select count(*) from prestamos p join clientes c on c.id=p.cliente_id where p.estado='activo' and not c.activo",
        gravedad="medio")
    chk(cur, "créditos activos de un cobrador dado de BAJA",
        "select count(*), '$' || round(sum(p.cuota_diaria*p.total_dias-p.pagado_acum)) from prestamos p join usuarios u on u.id=p.cobrador_id where p.estado='activo' and not u.activo",
        gravedad="medio")
    chk(cur, "créditos activos SIN cobrador",
        "select count(*) from prestamos where estado='activo' and cobrador_id is null")

    # ═══ 4 · RLS ══════════════════════════════════════════════════════════
    seccion("4 · SEGURIDAD (RLS) — quién puede ver qué")
    chk(cur, "tablas públicas SIN RLS habilitada (las ve cualquier logueado)",
        """select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
            where n.nspname='public' and c.relkind='r' and not c.relrowsecurity""",
        detalle_sql="""select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
            where n.nspname='public' and c.relkind='r' and not c.relrowsecurity order by 1 limit 8""")
    chk(cur, "tablas con RLS y CERO policies (nadie las lee, ni la app)",
        """select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
            where n.nspname='public' and c.relkind='r' and c.relrowsecurity
              and not exists (select 1 from pg_policies p where p.tablename=c.relname and p.schemaname='public')""",
        gravedad="medio",
        detalle_sql="""select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
            where n.nspname='public' and c.relkind='r' and c.relrowsecurity
              and not exists (select 1 from pg_policies p where p.tablename=c.relname and p.schemaname='public') order by 1 limit 8""")
    chk(cur, "policies que dejan pasar TODO (using true) sobre tablas con datos de clientes",
        """select count(*) from pg_policies where schemaname='public' and cmd='SELECT'
            and btrim(coalesce(qual,'')) = 'true'
            and tablename in ('clientes','prestamos','pagos','asignaciones','movimientos_caja','rendiciones','aperturas_caja')""")
    chk(cur, "policies concedidas al rol anon (usuario sin loguear)",
        """select count(*) from pg_policies where schemaname='public' and 'anon' = any(roles)""",
        detalle_sql="select tablename, policyname from pg_policies where schemaname='public' and 'anon' = any(roles) limit 8")
    chk(cur, "funciones EXECUTE abiertas a public/anon",
        """select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname like 'app%'
              and (has_function_privilege('anon', p.oid, 'execute'))""",
        gravedad="medio",
        detalle_sql="""select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname like 'app%' and has_function_privilege('anon', p.oid,'execute') limit 8""")

    # ═══ 5 · FUNCIONES ════════════════════════════════════════════════════
    seccion("5 · FUNCIONES — SECURITY DEFINER es poder total: exige search_path fijo")
    chk(cur, "funciones SECURITY DEFINER sin search_path fijo (riesgo de secuestro)",
        """select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.prosecdef
              and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')""",
        detalle_sql="""select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.prosecdef
              and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%') order by 1 limit 10""")
    chk(cur, "funciones de LECTURA marcadas VOLATILE (Postgres no puede optimizarlas)",
        """select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname like 'app_%' and p.provolatile='v'
              and p.proname not like '%guardar%' and p.proname not like '%reparar%' and p.proname not like '%crear%'""",
        gravedad="medio",
        detalle_sql="""select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname like 'app_%' and p.provolatile='v'
              and p.proname not like '%guardar%' and p.proname not like '%reparar%' and p.proname not like '%crear%' limit 8""")

    # ═══ 6 · ÍNDICES ══════════════════════════════════════════════════════
    seccion("6 · ÍNDICES — lo que hace la diferencia entre 80 ms y 8 s")
    chk(cur, "claves foráneas SIN índice (cada borrado o join las recorre entera)",
        """select count(*) from (
            select c.conrelid::regclass t, a.attname col
              from pg_constraint c
              join lateral unnest(c.conkey) k(attnum) on true
              join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
             where c.contype='f' and c.connamespace='public'::regnamespace
               and not exists (select 1 from pg_index i where i.indrelid=c.conrelid
                                and a.attnum = i.indkey[0])) t""",
        gravedad="medio",
        detalle_sql="""select c.conrelid::regclass::text || '.' || a.attname
              from pg_constraint c
              join lateral unnest(c.conkey) k(attnum) on true
              join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
             where c.contype='f' and c.connamespace='public'::regnamespace
               and not exists (select 1 from pg_index i where i.indrelid=c.conrelid and a.attnum=i.indkey[0])
             limit 10""")
    chk(cur, "índices que NUNCA se usaron y ocupan >1 MB",
        """select count(*) from pg_stat_user_indexes s join pg_index i on i.indexrelid=s.indexrelid
            where s.idx_scan=0 and not i.indisunique and not i.indisprimary
              and pg_relation_size(s.indexrelid) > 1024*1024""",
        gravedad="medio",
        detalle_sql="""select s.relname||'.'||s.indexrelname, pg_size_pretty(pg_relation_size(s.indexrelid))
            from pg_stat_user_indexes s join pg_index i on i.indexrelid=s.indexrelid
            where s.idx_scan=0 and not i.indisunique and not i.indisprimary
              and pg_relation_size(s.indexrelid) > 1024*1024 order by pg_relation_size(s.indexrelid) desc limit 8""")

    # ═══ 7 · MIGRACIONES ══════════════════════════════════════════════════
    seccion("7 · MIGRACIONES — lo que el repo dice que existe, ¿existe?")
    tablas_repo = set()
    funcs_repo = set()
    for f in sorted(os.listdir(os.path.join(RAIZ, "supabase", "migrations"))):
        if not f.endswith(".sql"):
            continue
        txt = open(os.path.join(RAIZ, "supabase", "migrations", f), encoding="utf-8", errors="replace").read()
        tablas_repo |= set(re.findall(r"create table if not exists\s+(\w+)", txt, re.I))
        tablas_repo |= set(re.findall(r"create table\s+(?!if)(\w+)", txt, re.I))
        funcs_repo |= set(re.findall(r"create or replace function\s+(?:public\.)?(\w+)", txt, re.I))
    cur.execute("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'")
    tablas_db = {r[0] for r in cur.fetchall()}
    cur.execute("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")
    funcs_db = {r[0] for r in cur.fetchall()}
    faltan_t = sorted(tablas_repo - tablas_db)
    faltan_f = sorted(funcs_repo - funcs_db)
    print(f"  {'🔴' if faltan_t else '✅'} tablas que el repo crea y NO están en la base: {len(faltan_t)}"
          + (f"  → {', '.join(faltan_t[:8])}" if faltan_t else ""))
    print(f"  {'🔴' if faltan_f else '✅'} funciones que el repo crea y NO están en la base: {len(faltan_f)}"
          + (f"  → {', '.join(faltan_f[:8])}" if faltan_f else ""))
    if faltan_t:
        HALLAZGOS.append({"que": "migraciones sin correr (tablas)", "n": len(faltan_t), "gravedad": "alto", "extra": ", ".join(faltan_t[:10])})
    if faltan_f:
        HALLAZGOS.append({"que": "migraciones sin correr (funciones)", "n": len(faltan_f), "gravedad": "alto", "extra": ", ".join(faltan_f[:10])})
    huerfanas = sorted(tablas_db - tablas_repo - {"schema_migrations"})
    print(f"  {'🟡' if huerfanas else '✅'} tablas en la base que ninguna migración crea: {len(huerfanas)}"
          + (f"  → {', '.join(huerfanas[:8])}" if huerfanas else ""))

    # ═══ 8 · CANDADOS ═════════════════════════════════════════════════════
    seccion("8 · CANDADOS — los triggers y constraints que protegen la plata")
    for etq, sql in [
        ("trigger que mantiene pagado_acum",
         "select count(*) from pg_trigger where not tgisinternal and tgrelid='pagos'::regclass"),
        ("triggers sobre prestamos (guardia de estado / inmutabilidad)",
         "select count(*) from pg_trigger where not tgisinternal and tgrelid='prestamos'::regclass"),
        ("CHECK de estados válidos en prestamos",
         "select count(*) from pg_constraint where conrelid='prestamos'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%estado%'"),
        ("CHECK que impide pagado_acum negativo",
         "select count(*) from pg_constraint where conrelid='prestamos'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%pagado_acum%'"),
        ("unicidad de op_id en pagos (idempotencia del cobro)",
         "select count(*) from pg_indexes where tablename='pagos' and indexdef ilike '%unique%op_id%'"),
        ("unicidad de disapp_pago_id (no importar dos veces el mismo recaudo)",
         "select count(*) from pg_indexes where tablename='pagos' and indexdef ilike '%unique%disapp_pago_id%'"),
        ("una rendición por cobrador y día",
         "select count(*) from pg_constraint where conrelid='rendiciones'::regclass and contype='u'"),
        ("una base de caja por cobrador y día",
         "select count(*) from pg_constraint where conrelid='aperturas_caja'::regclass and contype='u'"),
    ]:
        try:
            cur.execute(sql)
            n = cur.fetchone()[0]
            print(f"  {'✅' if n > 0 else '🔴'} {etq}: {n}")
            if n == 0:
                HALLAZGOS.append({"que": "candado ausente: " + etq, "n": 0, "gravedad": "alto", "extra": ""})
        except Exception as e:
            print(f"  ⚠️  {etq}: {str(e)[:70]}")

    # ═══ 9 · DATOS SUCIOS ═════════════════════════════════════════════════
    seccion("9 · DATOS — lo que ensucia las pantallas")
    chk(cur, "clientes duplicados por documento (mismo doc, dos fichas)",
        "select count(*) from (select documento from clientes where documento is not null and btrim(documento)<>'' group by 1 having count(*)>1) t",
        gravedad="medio")
    chk(cur, "clientes activos sin nombre usable",
        "select count(*) from clientes where activo and (nombre is null or length(btrim(nombre))<3)", gravedad="medio")
    chk(cur, "nombres con casing roto del import (ADRIáN)",
        "select count(*) from clientes where nombre ~ '[A-ZÁÉÍÓÚÑ]{2,}[a-záéíóúñ]' and nombre ~ '[a-z]'", gravedad="medio")
    chk(cur, "teléfonos imposibles en clientes activos",
        "select count(*) from clientes where activo and telefono is not null and length(regexp_replace(telefono,'[^0-9]','','g')) not between 8 and 13",
        gravedad="medio")
    chk(cur, "usuarios activos sin zona (invisibles para todo supervisor)",
        "select count(*) from usuarios where activo and rol='cobrador' and zona_id is null", gravedad="medio")
    chk(cur, "supervisores sin ninguna zona asignada (no ven nada)",
        "select count(*) from usuarios u where u.activo and u.rol='supervisor' and not exists (select 1 from supervisor_zonas s where s.supervisor_id=u.id)")
    chk(cur, "clientes con crédito activo que no están en ninguna ruta",
        """select count(*) from prestamos p where p.estado='activo'
            and not exists (select 1 from asignaciones a where a.cliente_id=p.cliente_id and a.activo)""")

    # ═══ 10 · MANTENIMIENTO ═══════════════════════════════════════════════
    seccion("10 · PESO Y MANTENIMIENTO")
    cur.execute("select pg_size_pretty(pg_database_size(current_database()))")
    print(f"  ℹ️  tamaño de la base: {cur.fetchone()[0]}")
    cur.execute("""select s.relname, s.n_dead_tup, s.n_live_tup,
                     case when s.n_live_tup>0 then round(100.0*s.n_dead_tup/s.n_live_tup,1) else 0 end
                   from pg_stat_user_tables s where s.n_dead_tup > 1000 order by s.n_dead_tup desc limit 6""")
    muertas = cur.fetchall()
    if muertas:
        print("  🟡 tablas con muchas filas muertas (autovacuum atrasado):")
        for r in muertas:
            print(f"        · {r[0]:22} {r[1]:>8,} muertas / {r[2]:>9,} vivas  ({r[3]}%)")
    else:
        print("  ✅ sin acumulación de filas muertas")
    cur.execute("select count(*), count(*) filter (where state='idle in transaction') from pg_stat_activity")
    r = cur.fetchone()
    print(f"  ℹ️  conexiones abiertas: {r[0]} (idle in transaction: {r[1]})")

    # ═══ 11 · TRABAJO PENDIENTE ═══════════════════════════════════════════
    seccion("11 · LO QUE LA OPERACIÓN DEJÓ A MEDIAS")
    for etq, sql in [
        ("solicitudes de gasto pendientes", "select count(*) from solicitudes_gasto where estado='pendiente'"),
        ("correcciones de cobro esperando aval", "select count(*) from solicitudes_anulacion where estado='abierto'"),
        ("pedidos de renovación sin resolver", "select count(*) from solicitudes_renovacion where estado='pendiente'"),
        ("incidencias abiertas", "select count(*) from incidencias where estado='abierto'"),
        ("reportes de clientes sin atender", "select count(*) from reportes where estado='abierto'"),
        ("mensajes de chat sin leer (total)", "select count(*) from mensajes"),
    ]:
        try:
            cur.execute(sql)
            n = cur.fetchone()[0]
            print(f"  {'🟡' if n > 0 else '✅'} {etq}: {n:,}")
        except Exception as e:
            print(f"  ⚠️  {etq}: {str(e)[:60]}")

    # ═══ 12 · APP ↔ DISAPP ════════════════════════════════════════════════
    seccion("12 · COHERENCIA CON DISAPP")
    chk(cur, "refs de Disapp con MÁS DE UN crédito en la app",
        "select count(*) from (select disapp_credit_ref from prestamos where disapp_credit_ref is not null group by 1 having count(*)>1) t",
        gravedad="medio")
    chk(cur, "de esas, cuántas tienen algún crédito ACTIVO (riesgo vivo)",
        """select count(*) from (select disapp_credit_ref r from prestamos where disapp_credit_ref is not null
             group by 1 having count(*)>1) d
            where exists (select 1 from prestamos p where p.disapp_credit_ref=d.r and p.estado='activo')""")
    chk(cur, "pagos importados con el mismo folio de Disapp",
        "select count(*) from (select disapp_pago_id from pagos where disapp_pago_id is not null group by 1 having count(*)>1) t")
    cur.execute("select count(*) from prestamos where estado='activo'")
    act = cur.fetchone()[0]
    cur.execute("select count(*) from prestamos where estado='activo' and creado_por is not null")
    nat = cur.fetchone()[0]
    print(f"  ℹ️  créditos activos: {act:,}  (nacidos en la app: {nat:,} · {round(100*nat/max(act,1))}%)")

    # ═══ RESUMEN ══════════════════════════════════════════════════════════
    seccion("RESUMEN")
    altos = [h for h in HALLAZGOS if h["gravedad"] == "alto"]
    medios = [h for h in HALLAZGOS if h["gravedad"] != "alto"]
    print(f"  🔴 {len(altos)} hallazgos de gravedad ALTA")
    for h in altos:
        print(f"        · {h['que']}: {h['n']:,}{('  ' + h['extra']) if h['extra'] else ''}")
    print(f"  🟡 {len(medios)} de gravedad media")
    for h in medios:
        print(f"        · {h['que']}: {h['n']:,}{('  ' + h['extra']) if h['extra'] else ''}")
    if not HALLAZGOS:
        print("  ✅ sin hallazgos")

    if a.json:
        ruta = os.path.join(RAIZ, "scripts", "_salud_base.json")
        with open(ruta, "w", encoding="utf-8") as fh:
            json.dump(HALLAZGOS, fh, ensure_ascii=False, indent=1)
        print(f"\n  JSON → {ruta}")
    cur.close()
    cn.close()


if __name__ == "__main__":
    main()
