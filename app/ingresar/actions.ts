"use server";
// Login compartido del equipo (gestores y cobradores). Inicia sesión y redirige
// según el rol: gestores al panel, cobradores a su app. No revela qué falló.
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioPorAuthId } from "@/lib/data/usuarios";
import { rutaHome } from "@/lib/auth";

export type EstadoLogin = { error: string | null };

export async function iniciarSesion(
  _prev: EstadoLogin,
  formData: FormData,
): Promise<EstadoLogin> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Completá correo y contraseña." };

  const db = await createSupabaseServer();
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: "Correo o contraseña incorrectos." };

  // Solo usuarios del sistema (y activos) pueden entrar.
  const usuario = await getUsuarioPorAuthId(db, data.user.id);
  if (!usuario || !usuario.activo) {
    await db.auth.signOut();
    return { error: "Tu usuario no está habilitado. Hablá con la oficina." };
  }

  redirect(rutaHome(usuario.rol));
}
