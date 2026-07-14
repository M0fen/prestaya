// Entregable: credenciales agrupadas por ZONA (supervisor + cobradores con su login).
// node --env-file=.env.local scripts/credenciales-por-zona.mjs
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PASS = "PrestaYa2026!";

const { data: us } = await db.from("usuarios").select("id, nombre, rol, zona_id, auth_user_id");
const { data: zonas } = await db.from("zonas").select("id, nombre");
const { data: supZonas } = await db.from("supervisor_zonas").select("supervisor_id, zona_id");
const emailPorAuth = new Map();
for(let p=1;p<=15;p++){ const {data}=await db.auth.admin.listUsers({page:p,perPage:200}); for(const u of data.users) if(u.email) emailPorAuth.set(u.id,u.email); if(data.users.length<200) break; }
const email=(u)=>emailPorAuth.get(u.auth_user_id)??"(sin login)";
const zonaNombre=new Map((zonas??[]).map(z=>[z.id,z.nombre]));
const supDeZona=new Map(); for(const s of supZonas??[]){ if(!supDeZona.has(s.zona_id)) supDeZona.set(s.zona_id,[]); supDeZona.get(s.zona_id).push(s.supervisor_id); }

let out = `PRESTA YA — Equipo por zona (acercamiento)\nLogin = email + contraseña.  Contraseña: ${PASS}  (salvo el admin Carlos)\n`;
out += "=".repeat(72) + "\n";

// Admins
out += `\n### ADMINISTRADORES\n`;
for(const u of (us??[]).filter(u=>u.rol==="admin").sort((a,b)=>a.nombre.localeCompare(b.nombre)))
  out += `  ${u.nombre.padEnd(26)}  ${email(u)}\n`;

// Zonas con contenido
const zonasConCob = (zonas??[]).filter(z=>(us??[]).some(u=>u.rol==="cobrador"&&u.zona_id===z.id));
for(const z of zonasConCob){
  const sups=(supDeZona.get(z.id)??[]).map(id=>(us??[]).find(u=>u.id===id)).filter(Boolean);
  const cobs=(us??[]).filter(u=>u.rol==="cobrador"&&u.zona_id===z.id).sort((a,b)=>a.nombre.localeCompare(b.nombre));
  out += `\n### ${z.nombre.toUpperCase()}  (supervisor: ${sups.map(s=>s.nombre).join(", ")||"—"} · ${cobs.length} cobradores)\n`;
  for(const s of sups) out += `  [sup] ${s.nombre.padEnd(24)}  ${email(s)}\n`;
  for(const c of cobs) out += `        ${c.nombre.padEnd(24)}  ${email(c)}\n`;
}

// Cobradores sin zona (pool)
const pool=(us??[]).filter(u=>u.rol==="cobrador"&&!u.zona_id).sort((a,b)=>a.nombre.localeCompare(b.nombre));
if(pool.length){ out += `\n### SIN ZONA (pool, ${pool.length})\n`; for(const c of pool) out += `        ${c.nombre.padEnd(24)}  ${email(c)}\n`; }

writeFileSync("C:/Users/Carlos/Desktop/credenciales-prestaya.txt", out, "utf-8");
console.log(out);
console.log("→ C:/Users/Carlos/Desktop/credenciales-prestaya.txt");
