"use client";
// Formulario de ingreso del equipo (gestores y cobradores). Pensado para el
// celular del cobrador en la calle: campos grandes, mostrar/ocultar contraseña,
// estados de foco y carga claros, y un error legible sin culpa.
import { useActionState, useState } from "react";
import { iniciarSesion, type EstadoLogin } from "@/app/ingresar/actions";

const estadoInicial: EstadoLogin = { error: null };

const campoCls =
  "w-full rounded-[12px] border border-[#DCE3F4] bg-[#FBFCFF] px-3.5 py-3 text-[15px] text-tinta outline-none transition-colors placeholder:text-[#AEB6CC] focus:border-azul focus:bg-white focus:ring-4 focus:ring-[#1E47C8]/10";

export function FormIngreso() {
  const [estado, formAction, pending] = useActionState(iniciarSesion, estadoInicial);
  const [verPass, setVerPass] = useState(false);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-[20px] bg-white p-6 shadow-[0_24px_60px_rgba(9,20,60,0.28)]"
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold text-gris">Correo</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          required
          className={campoCls}
          placeholder="vos@prestaya.uy"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold text-gris">Contraseña</span>
        <div className="relative">
          <input
            name="password"
            type={verPass ? "text" : "password"}
            autoComplete="current-password"
            required
            className={`${campoCls} pr-12`}
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setVerPass((v) => !v)}
            aria-label={verPass ? "Ocultar contraseña" : "Mostrar contraseña"}
            className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-[9px] p-2 text-gris transition-colors hover:text-azul"
          >
            {verPass ? <OjoTachado /> : <Ojo />}
          </button>
        </div>
      </label>

      {estado.error && (
        <div className="flex items-start gap-2 rounded-[12px] bg-[#FDECEC] px-3 py-2.5">
          <span aria-hidden="true" className="text-[13px] leading-[1.2]">⚠️</span>
          <span className="text-[12.5px] font-semibold text-[#C0392B]">{estado.error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 flex items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#2453DC,#1E47C8)] px-4 py-3 text-[15px] font-extrabold text-white shadow-[0_10px_24px_rgba(30,71,200,0.4)] transition active:scale-[0.99] disabled:opacity-60"
      >
        {pending ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            Ingresando…
          </>
        ) : (
          "Ingresar"
        )}
      </button>

      <p className="text-center text-[11.5px] font-medium text-tenue">
        ¿No podés entrar? Pedile tus datos de acceso al administrador.
      </p>
    </form>
  );
}

// Íconos inline (sin dependencias): ojo abierto / tachado para ver la contraseña.
function Ojo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function OjoTachado() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88" />
      <path d="m2 2 20 20" />
    </svg>
  );
}
