// 08-05: Carlos confirmó que "María Inocencia" de su lista = María Curbelo.
// Entra al piloto → Zona Centro. Log con antes/después para poder revertir.
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const ZONA_CENTRO = "764c2556-4e2d-410a-b39a-63c6dbf984c3";
const { data: antes, error: e1 } = await db
  .from("usuarios").select("id, nombre, rol, zona_id, activo").eq("nombre", "María Curbelo");
if (e1) throw e1;
if ((antes ?? []).length !== 1) throw new Error(`Esperaba 1 usuaria, hallé ${antes?.length}`);
const u = antes[0];
if (u.zona_id !== null || u.rol !== "cobrador" || !u.activo) throw new Error(`María Curbelo no está como esperaba (zona=${u.zona_id}, rol=${u.rol}, activo=${u.activo}) — no toco nada`);

const { data: despues, error: e2 } = await db
  .from("usuarios").update({ zona_id: ZONA_CENTRO }).eq("id", u.id).select("id, nombre, zona_id");
if (e2) throw e2;
writeFileSync("scripts/_alta-maria-curbelo-0805.json", JSON.stringify({ cuando: new Date().toISOString(), motivo: "Carlos confirmó: 'María Inocencia' de su lista = María Curbelo", antes, despues }, null, 2), "utf-8");
console.log(`✓ ${despues?.[0]?.nombre} → Zona Centro`);
