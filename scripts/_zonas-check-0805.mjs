// Diagnóstico: zona de las cuentas nuevas del piloto + supervisores de Zona Centro.
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: zonas } = await db.from("zonas").select("id, nombre");
const zonaDe = new Map((zonas ?? []).map((z) => [z.id, z.nombre]));
const centro = (zonas ?? []).find((z) => z.nombre === "Zona Centro");

const { data: us } = await db
  .from("usuarios")
  .select("id, nombre, rol, zona_id, activo, comision_pct, creado_en")
  .in("nombre", ["Daniela Millán", "Alejandro Cardona", "John Albert Hernández", "María Curbelo", "Fabio Jaramillo", "Juan José Castro"]);
for (const u of us ?? []) {
  console.log(`${u.nombre.padEnd(24)} rol=${u.rol.padEnd(10)} zona=${(zonaDe.get(u.zona_id) ?? "SIN ZONA").padEnd(12)} comision=${u.comision_pct}% activo=${u.activo} creado=${String(u.creado_en).slice(0, 10)}`);
}

const { data: supZ } = await db.from("supervisor_zonas").select("supervisor_id, zona_id");
const { data: sups } = await db.from("usuarios").select("id, nombre, activo").eq("rol", "supervisor");
console.log("\nSupervisores por zona:");
for (const s of supZ ?? []) {
  const u = (sups ?? []).find((x) => x.id === s.supervisor_id);
  console.log(`  ${zonaDe.get(s.zona_id)?.padEnd(14)} → ${u?.nombre ?? s.supervisor_id} ${u?.activo ? "" : "(DE BAJA)"}`);
}
console.log(`\nid Zona Centro: ${centro?.id}`);
