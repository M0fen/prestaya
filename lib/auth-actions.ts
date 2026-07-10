"use server";
// Cierre de sesión compartido (panel admin y app del cobrador).
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function cerrarSesion() {
  const db = await createSupabaseServer();
  // scope 'local': limpia la sesión del navegador (cookies) SIN llamar al
  // endpoint global de logout, que puede fallar si el token ya venció y tumbar
  // el "salir". Envolvemos por las dudas; el redirect va FUERA del try (redirect
  // funciona lanzando NEXT_REDIRECT: dentro de un catch se lo tragaría → crash).
  try {
    await db.auth.signOut({ scope: "local" });
  } catch {
    /* pase lo que pase, igual cerramos: se limpian cookies y vamos al login */
  }
  redirect("/ingresar");
}
