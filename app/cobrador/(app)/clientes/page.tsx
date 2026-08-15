// ─────────────────────────────────────────────────────────────────────────
//  CLIENTES del cobrador (pedido de Carlos, 08-13): el padrón vivo de la ruta,
//  "muy dinámico y práctico" — activos, sin crédito, y la info útil de cada uno
//  (dirección, teléfono, cuota, estado de hoy). La ruta de HOY es para cobrar;
//  esta pestaña es para ENCONTRAR a una persona y actuar sobre ella.
//
//  Reusa `getRutaCobrador` (misma consulta que la home, mismos estados): acá no
//  se inventa ningún cálculo — solo se muestra distinto.
// ─────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { requireUsuario } from "@/lib/auth";
import { getRutaCobrador } from "@/lib/data/ruta";
import { traerTodo } from "@/lib/data/paginado";
import { ListaClientes, type ClienteVista } from "@/components/cobrador/ListaClientes";
import { conTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";
const TOPE_MS = 22_000;

export default async function ClientesPage() {
  const usuario = await requireUsuario();
  // Solo COBRADOR: con la sesión de un gestor, `getRutaCobrador` devuelve las
  // asignaciones de TODA la empresa (la RLS no filtra) — miles de fichas contra
  // el tope de 22 s. El gestor tiene su padrón en /admin/clientes.
  if (usuario.rol !== "cobrador") redirect("/admin/clientes");
  const db = await createSupabaseServer();
  const { items } = await conTimeout(
    getRutaCobrador(db, new Date(), usuario.id),
    TOPE_MS,
    "cobrador.clientes",
  );

  const clientes: ClienteVista[] = items.map((it) => ({
    id: it.cliente.id,
    // `??` no cubre la cadena vacía — y hay fichas heredadas con nombre "".
    nombre: (it.cliente.nombre ?? "").trim() || "Sin nombre",
    documento: it.cliente.documento ?? null,
    direccion: it.cliente.direccion ?? null,
    telefono: it.cliente.telefono ?? null,
    calificacion: (it.cliente.calificacion as string | null) ?? null,
    conCredito: it.estadoHoy !== "sin_credito",
    cuota: it.cuotaCredito > 0 ? it.cuotaCredito : Math.round(it.cuota),
    plazoVencido: it.plazoVencido,
    esDeCenso: (it.cliente.origen as string | null) === "censo",
  }));

  // ⚠️ El COMPARTIDO cuyo único crédito activo es del COMPAÑERO no viene en la
  // ruta del día (no es parada suya) — pero SÍ es de su padrón (59 clientes en
  // dos rutas hoy). Sin esto, el cobrador lo buscaba acá, no lo encontraba, y el
  // vacío lo invitaba a RE-CENSAR a alguien que ya está en su ruta (auditoría
  // 08-14). Se completa desde sus asignaciones (la RLS ya recorta a las propias).
  const enLista = new Set(clientes.map((c) => c.id));
  const asig = await traerTodo<{ cliente_id: string }>((d, h) =>
    db.from("asignaciones").select("cliente_id").eq("activo", true).order("id", { ascending: true }).range(d, h),
  );
  const faltantes = [...new Set(asig.map((a) => a.cliente_id))].filter((id) => !enLista.has(id));
  if (faltantes.length > 0) {
    const { data: extra } = await db
      .from("clientes")
      .select("id, nombre, documento, direccion, telefono, calificacion, activo, origen")
      .in("id", faltantes)
      .eq("activo", true);
    for (const c of extra ?? []) {
      clientes.push({
        id: c.id as string,
        nombre: (c.nombre as string | null) ?? "Sin nombre",
        documento: (c.documento as string | null) ?? null,
        direccion: (c.direccion as string | null) ?? null,
        telefono: (c.telefono as string | null) ?? null,
        calificacion: (c.calificacion as string | null) ?? null,
        conCredito: true,
        cuota: 0,
        plazoVencido: false,
        esDeCenso: (c.origen as string | null) === "censo",
        creditoAjeno: true,
      });
    }
    clientes.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }

  return <ListaClientes clientes={clientes} />;
}
