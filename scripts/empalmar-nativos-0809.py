# -*- coding: utf-8 -*-
"""
EMPALMAR los créditos que nacieron en NUESTRA app con su gemelo de Disapp.

EL PROBLEMA
-----------
Durante el piloto en paralelo, el mismo préstamo se carga en los DOS sistemas: el
cobrador lo coloca en la app y la oficina lo registra en Disapp. Hoy hay 100
créditos nativos activos y 89 tienen un gemelo en Disapp con el MISMO documento y
el MISMO monto. Si el empalme corre así, importa esos 89 y quedan 178 créditos
para 89 préstamos reales — el capital en la calle se duplica en los reportes.

LA SOLUCIÓN
-----------
Pegarle a cada crédito nativo la `disapp_credit_ref` de su gemelo. A partir de ahí
el empalme lo reconoce como YA IMPORTADO y no lo vuelve a crear; y los recaudos
que Disapp registre contra esa referencia caen sobre NUESTRO crédito, que es lo
que se quiere.

CRITERIO — deliberadamente ESTRICTO. Solo se empalma cuando NO hay ambigüedad:
  1. El crédito es nativo y está activo (`disapp_credit_ref` NULL, `creado_por`
     no nulo, estado 'activo').
  2. El documento del cliente matchea exacto (comparado solo por dígitos: la base
     tiene cédulas con y sin puntos conviviendo).
  3. El monto matchea. ⚠️ El PDF TRUNCA el valor por ancho de columna ($20.0 es
     $20.000), así que se compara por PREFIJO sobre el monto formateado con punto
     de miles — y se exige que el prefijo identifique a UN SOLO crédito de ese
     cliente en Disapp.
  4. Hay EXACTAMENTE UN candidato. Si el cliente tiene dos créditos en Disapp que
     matchean, se deja para revisión humana: adivinar acá es plata.
  5. Esa referencia NO está ya usada por otro crédito nuestro (ni activo ni
     histórico). Duplicar la referencia rompería el empalme en la otra dirección.

Sin `--commit` NO escribe nada: imprime el informe y sale.
Con `--commit` escribe y deja la reversa en `_revert_empalme_nativos_0809.json`.
Es IDEMPOTENTE: la segunda corrida no encuentra nada que hacer.
"""
import json
import os
import re
import ssl
import sys
from urllib.parse import unquote

import pdfplumber
import pg8000.dbapi

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = r"C:\Users\Carlos\migracion\Lista de Créditos de ADMINISTRADOR PRESTA YA. - DISAPP VENTAS.pdf"
REVERT = os.path.join(RAIZ, "scripts", "_revert_empalme_nativos_0809.json")
COMMIT = "--commit" in sys.argv

LINEA = re.compile(r"^(PRD\d+)\s+(.+?)\s+(Diaria|Semanal|Quincenal|Mensual)\s+\$([\d.,]+)$")


def dig(s):
    """Solo los dígitos: la base tiene cédulas con puntos, guiones y sin nada."""
    return re.sub(r"\D", "", s or "")


def money(n):
    return "$ " + f"{round(float(n or 0)):,}".replace(",", ".")


def miles(n):
    """20000 -> '20.000'. Es el formato en el que Disapp imprime (y trunca)."""
    return f"{int(round(n)):,}".replace(",", ".")


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


def leer_pdf():
    """Los créditos ACTIVOS de Disapp, indexados por documento."""
    por_doc = {}
    total = 0
    with pdfplumber.open(PDF) as pdf:
        for pag in pdf.pages:
            for linea in (pag.extract_text() or "").split("\n"):
                m = LINEA.match(linea.strip())
                if not m:
                    continue
                ref, resto, modal, val = m.groups()
                total += 1
                doc = next((dig(t) for t in resto.split() if len(dig(t)) >= 5), "")
                if doc:
                    por_doc.setdefault(doc, []).append({"ref": ref, "val": val.rstrip(".")})
    return por_doc, total


def main():
    por_doc, total_pdf = leer_pdf()
    print(f"Disapp (PDF): {total_pdf} créditos activos · {len(por_doc)} documentos\n")

    cn = conectar()
    cur = cn.cursor()

    # Referencias YA usadas en nuestra base (cualquier estado): no se puede repetir.
    cur.execute("select disapp_credit_ref from prestamos where disapp_credit_ref is not null")
    usadas = {(r[0] or "").strip() for r in cur.fetchall()}

    cur.execute(
        """select p.id, cl.nombre, cl.documento, p.monto_prestado,
                  coalesce(u.nombre,'?'),
                  (p.creado_en at time zone 'America/Montevideo')::date
             from prestamos p
             join clientes cl on cl.id = p.cliente_id
             left join usuarios u on u.id = p.creado_por
            where p.estado = 'activo'
              and p.disapp_credit_ref is null
              and p.creado_por is not null
            order by 6, 2"""
    )
    nativos = cur.fetchall()

    empalmar, ambiguos, sin_gemelo, ref_ocupada = [], [], [], []
    for pid, nombre, doc, monto, cobrador, dia in nativos:
        dd = dig(doc)
        mp = miles(float(monto))
        # El gemelo tiene que ser un crédito de Disapp que TODAVÍA NO TENGAMOS.
        # Sin este filtro, la truncación del PDF ("$10.0" matchea cualquier crédito
        # de $10.000 del cliente) volvía ambiguo un caso que no lo es: el crédito
        # viejo del mismo monto ya está en nuestra base con su referencia, así que
        # no puede ser el gemelo del que acabamos de colocar.
        cands = [
            c for c in por_doc.get(dd, [])
            if mp.startswith(c["val"]) and c["ref"] not in usadas
        ]
        fila = {
            "prestamoId": str(pid), "cliente": nombre, "documento": dd,
            "monto": float(monto), "cobrador": cobrador, "dia": str(dia),
        }
        if not cands:
            sin_gemelo.append(fila)
        elif len(cands) > 1:
            fila["candidatos"] = [c["ref"] for c in cands]
            ambiguos.append(fila)
        elif cands[0]["ref"] in usadas:
            fila["ref"] = cands[0]["ref"]
            ref_ocupada.append(fila)
        else:
            fila["ref"] = cands[0]["ref"]
            empalmar.append(fila)

    # Dos créditos nuestros no pueden reclamar la MISMA referencia.
    vistos = {}
    choque = []
    for f in list(empalmar):
        if f["ref"] in vistos:
            empalmar.remove(f)
            choque.append(f)
            otro = vistos[f["ref"]]
            if otro in empalmar:
                empalmar.remove(otro)
                choque.append(otro)
        else:
            vistos[f["ref"]] = f

    print(f"Créditos nativos activos sin referencia: {len(nativos)}\n")
    print(f"  ✅ A EMPALMAR (match único y limpio) : {len(empalmar):>3}  {money(sum(f['monto'] for f in empalmar))}")
    print(f"  ⚠️  Ambiguos (2+ candidatos)          : {len(ambiguos):>3}  {money(sum(f['monto'] for f in ambiguos))}")
    print(f"  ⚠️  Dos nuestros a la misma referencia: {len(choque):>3}  {money(sum(f['monto'] for f in choque))}")
    print(f"  ⚠️  Referencia ya usada por otro      : {len(ref_ocupada):>3}  {money(sum(f['monto'] for f in ref_ocupada))}")
    print(f"  ·  Sin gemelo (solo viven en la app) : {len(sin_gemelo):>3}  {money(sum(f['monto'] for f in sin_gemelo))}")

    for etiqueta, lista in (
        ("AMBIGUOS — los resuelve una persona", ambiguos),
        ("CHOQUE de referencia — casi seguro un duplicado NUESTRO", choque),
        ("REFERENCIA YA USADA", ref_ocupada),
    ):
        if not lista:
            continue
        print(f"\n  {etiqueta}:")
        for f in lista:
            extra = f.get("candidatos") or f.get("ref") or ""
            print(f"    {f['dia']}  {f['cliente'][:30]:<31} {money(f['monto']):>10}  {f['cobrador'][:18]:<19} {extra}")

    if not COMMIT:
        print("\n(DRY-RUN: no se escribió nada. Volver a correr con --commit para aplicar.)")
        cn.close()
        return

    for f in empalmar:
        cur.execute(
            "update prestamos set disapp_credit_ref = %s, actualizado_en = now() "
            "where id = %s and disapp_credit_ref is null",
            (f["ref"], f["prestamoId"]),
        )
    cn.commit()
    json.dump(
        {
            "que": "se pegó la disapp_credit_ref del gemelo a créditos nacidos en la app",
            "porque": "el piloto corre en paralelo y el mismo préstamo se carga en los dos sistemas; sin esto el empalme los duplicaba",
            "cuando": "2026-08-09",
            "revertir": "update prestamos set disapp_credit_ref = null where id in (...)",
            "creditos": empalmar,
        },
        open(REVERT, "w", encoding="utf-8"), ensure_ascii=False, indent=1,
    )
    print(f"\n✅ {len(empalmar)} créditos empalmados · reversa en {os.path.basename(REVERT)}")

    cur.execute(
        """select count(*) from prestamos
            where estado='activo' and disapp_credit_ref is null and creado_por is not null"""
    )
    print(f"Nativos activos que siguen sin referencia: {cur.fetchone()[0]}")
    cn.close()


if __name__ == "__main__":
    main()
