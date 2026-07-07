"use client";
// Paso de verificación 2FA (step-up): el usuario ya puso su contraseña y ahora
// ingresa el código de 6 dígitos de su app de autenticación. Al verificar, la
// sesión sube a aal2 y puede entrar. Corre en el navegador (sesión del usuario).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { cerrarSesion } from "@/lib/auth-actions";

export function DesafioMfa({ destino }: { destino: string }) {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const supabase = createSupabaseBrowser();
    supabase.auth.mfa
      .listFactors()
      .then(({ data }) => {
        const totp = data?.totp ?? [];
        const f = totp.find((x) => x.status === "verified") ?? totp[0];
        setFactorId(f?.id ?? null);
      })
      .finally(() => setCargando(false));
  }, []);

  async function verificar() {
    if (!factorId || verificando) return;
    setVerificando(true);
    setError(null);
    const supabase = createSupabaseBrowser();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setVerificando(false);
    if (error) {
      setError("Código incorrecto o vencido. Probá con el nuevo código.");
      setCode("");
      return;
    }
    router.replace(destino);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0F1B3D] px-5">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-[linear-gradient(135deg,#2453DC,#13308C)] text-[20px] font-black text-white">
            🔐
          </div>
          <h1 className="text-[20px] font-extrabold text-white">Verificación en dos pasos</h1>
          <p className="text-[13px] font-medium text-white/55">
            Ingresá el código de 6 dígitos de tu app de autenticación.
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-[16px] bg-white p-5">
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && verificar()}
            placeholder="000000"
            autoFocus
            disabled={cargando || !factorId}
            className="rounded-[12px] border border-[#DCE3F4] px-4 py-3 text-center text-[22px] font-extrabold tracking-[0.4em] text-tinta outline-none focus:border-azul"
          />
          {error && <p className="text-[12px] font-bold text-[#C0392B]">{error}</p>}
          {!cargando && !factorId && (
            <p className="text-[12px] font-bold text-[#C0392B]">
              No encontramos tu 2FA. Pedile a otro administrador que lo resetee.
            </p>
          )}
          <button
            type="button"
            onClick={verificar}
            disabled={verificando || code.length !== 6 || !factorId}
            className="rounded-[12px] bg-[#2453DC] py-3 text-[14px] font-bold text-white disabled:opacity-40"
          >
            {verificando ? "Verificando…" : "Verificar y entrar"}
          </button>
          <form action={cerrarSesion}>
            <button type="submit" className="w-full text-center text-[12px] font-semibold text-gris">
              Salir
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
