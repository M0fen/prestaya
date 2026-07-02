"use server";
// Cierre de sesión compartido (panel admin y app del cobrador).
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function cerrarSesion() {
  const db = await createSupabaseServer();
  await db.auth.signOut();
  redirect("/ingresar");
}
