// Verifica que el lookup por token encuentre al cliente demo y su préstamo.
// node --env-file=.env.local scripts/check-token.mjs
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const TOKEN = "demo-maria-fernanda";

const { data: cliente, error: e1 } = await db
  .from("clientes")
  .select("*")
  .eq("token_acceso", TOKEN)
  .eq("activo", true)
  .maybeSingle();
console.log("cliente:", e1 ? `ERROR ${e1.message}` : cliente?.nombre ?? "null");

if (cliente) {
  const { data: prestamo, error: e2 } = await db
    .from("prestamos")
    .select("*")
    .eq("cliente_id", cliente.id)
    .eq("estado", "activo")
    .maybeSingle();
  console.log(
    "préstamo:",
    e2 ? `ERROR ${e2.message}` : prestamo ? `${prestamo.id} inicio=${prestamo.fecha_inicio}` : "null",
  );

  if (prestamo) {
    const { data: pagos, error: e3 } = await db
      .from("pagos")
      .select("*")
      .eq("prestamo_id", prestamo.id)
      .eq("anulado", false);
    console.log("pagos:", e3 ? `ERROR ${e3.message}` : `${pagos.length} registros`);
  }
}
