// 08-05: los 3 nuevos de la lista del piloto de Carlos entran a Zona Centro
// (estaban SIN ZONA → invisibles para el supervisor y su caja fuera del cierre).
// Deja log con el antes/después para poder revertir.
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const ZONA_CENTRO = "764c2556-4e2d-410a-b39a-63c6dbf984c3";
const NOMBRES = ["Daniela Millán", "Alejandro Cardona", "John Albert Hernández"];

const { data: antes, error: e1 } = await db
  .from("usuarios").select("id, nombre, rol, zona_id, activo")
  .in("nombre", NOMBRES);
if (e1) throw e1;
if ((antes ?? []).length !== 3) throw new Error(`Esperaba 3 usuarios, hallé ${antes?.length}: ${(antes ?? []).map((u) => u.nombre).join(", ")}`);
const raro = (antes ?? []).find((u) => u.zona_id !== null || u.rol !== "cobrador" || !u.activo);
if (raro) throw new Error(`${raro.nombre} no está como esperaba (zona=${raro.zona_id}, rol=${raro.rol}, activo=${raro.activo}) — no toco nada`);

const { data: despues, error: e2 } = await db
  .from("usuarios").update({ zona_id: ZONA_CENTRO })
  .in("id", (antes ?? []).map((u) => u.id))
  .select("id, nombre, zona_id");
if (e2) throw e2;

writeFileSync("scripts/_altas-zona-centro-0805.json", JSON.stringify({ cuando: new Date().toISOString(), motivo: "Lista piloto de Carlos 08-05", antes, despues }, null, 2), "utf-8");
for (const u of despues ?? []) console.log(`✓ ${u.nombre} → Zona Centro`);
