"use server";
// Login compartido del equipo (gestores y cobradores). Inicia sesión y redirige
// según el rol: gestores al panel, cobradores a su app. No revela qué falló.
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioPorAuthId } from "@/lib/data/usuarios";
import { rutaHome } from "@/lib/auth";
import { permitir, ipDesdeHeaders } from "@/lib/seguridad/rateLimit";

export type EstadoLogin = { error: string | null };

export async function iniciarSesion(
  _prev: EstadoLogin,
  formData: FormData,
): Promise<EstadoLogin> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Completá correo y contraseña." };

  // Anti-fuerza bruta en DOS niveles. El contador ajustado (5/min) va por
  // IP+CUENTA: con la IP sola, todo un equipo detrás del wifi de la oficina —o
  // del CGNAT de la operadora— comparte el cupo y el 6º cobrador de la mañana no
  // entra aunque su clave esté bien. El techo por IP sola queda flojo (60/min)
  // para frenar el spraying sin bloquear a gente real logueándose junta.
  const ip = ipDesdeHeaders(await headers());
  const cuenta = email.toLowerCase();
  if (!(await permitir("login", `${ip}|${cuenta}`))) {
    return { error: "Demasiados intentos con este correo. Esperá un minuto y probá de nuevo." };
  }
  if (!(await permitir("login_ip", ip))) {
    return { error: "Demasiados intentos desde esta conexión. Esperá un minuto y probá de nuevo." };
  }

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
