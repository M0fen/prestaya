"use client";
// Formulario de ingreso del equipo (gestores y cobradores).
import { useActionState } from "react";
import { iniciarSesion, type EstadoLogin } from "@/app/ingresar/actions";

const estadoInicial: EstadoLogin = { error: null };

export function FormIngreso() {
  const [estado, formAction, pending] = useActionState(
    iniciarSesion,
    estadoInicial,
  );

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-[18px] bg-white p-5 shadow-[0_20px_50px_rgba(0,0,0,0.35)]"
    >
      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-semibold text-gris">Correo</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="rounded-[10px] border border-[#DCE3F4] px-3 py-2.5 text-[14px] outline-none focus:border-azul"
          placeholder="vos@prestaya.uy"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-semibold text-gris">Contraseña</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded-[10px] border border-[#DCE3F4] px-3 py-2.5 text-[14px] outline-none focus:border-azul"
          placeholder="••••••••"
        />
      </label>

      {estado.error && (
        <span className="text-[12.5px] font-semibold text-[#D64545]">
          {estado.error}
        </span>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-full bg-azul px-4 py-2.5 text-[14px] font-bold text-white disabled:opacity-60"
      >
        {pending ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}
