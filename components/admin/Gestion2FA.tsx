"use client";
// Activar / desactivar el 2FA (TOTP) de la PROPIA cuenta. Todo pasa por el
// cliente de Supabase (sesión del usuario). Al activar: enroll → mostrar QR →
// ingresar el código para verificar. Al desactivar: unenroll de sus factores.
import { useEffect, useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";

type Estado = "cargando" | "sin" | "enrolando" | "activo";

export function Gestion2FA() {
  const [estado, setEstado] = useState<Estado>("cargando");
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refrescar() {
    const supabase = createSupabaseBrowser();
    const { data } = await supabase.auth.mfa.listFactors();
    const verificado = (data?.totp ?? []).some((f) => f.status === "verified");
    setEstado(verificado ? "activo" : "sin");
  }

  useEffect(() => {
    refrescar();
  }, []);

  async function activar() {
    setError(null);
    setBusy(true);
    const supabase = createSupabaseBrowser();
    // Limpiar intentos previos sin verificar (evita acumular factores).
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of list?.totp ?? [])
      if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Presta Ya ${Date.now()}`,
    });
    setBusy(false);
    if (error || !data) {
      setError("No se pudo iniciar el 2FA. Probá de nuevo.");
      return;
    }
    setFactorId(data.id);
    setQr(data.totp.qr_code);
    setSecret(data.totp.secret);
    setEstado("enrolando");
  }

  async function confirmar() {
    if (!factorId || busy) return;
    setError(null);
    setBusy(true);
    const supabase = createSupabaseBrowser();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setBusy(false);
    if (error) {
      setError("Código incorrecto o vencido. Probá con el nuevo código.");
      setCode("");
      return;
    }
    setCode("");
    setQr(null);
    setSecret(null);
    setEstado("activo");
  }

  async function desactivar() {
    if (!confirm("¿Desactivar el 2FA de tu cuenta? Vas a entrar solo con contraseña.")) return;
    setBusy(true);
    const supabase = createSupabaseBrowser();
    const { data } = await supabase.auth.mfa.listFactors();
    for (const f of data?.totp ?? []) await supabase.auth.mfa.unenroll({ factorId: f.id });
    setBusy(false);
    refrescar();
  }

  if (estado === "cargando")
    return <p className="text-[13px] font-medium text-gris">Cargando…</p>;

  if (estado === "activo")
    return (
      <div className="flex items-center justify-between gap-3 rounded-[14px] bg-[#E4F5EC] px-4 py-3">
        <div className="flex flex-col">
          <span className="text-[13.5px] font-bold text-[#157A50]">2FA activo ✓</span>
          <span className="text-[12px] font-medium text-[#3B7A5A]">
            Tu cuenta pide un código además de la contraseña.
          </span>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={desactivar}
          className="rounded-[12px] border border-[#B8DEC8] px-3 py-1.5 text-[12px] font-bold text-[#157A50] disabled:opacity-40"
        >
          Desactivar
        </button>
      </div>
    );

  if (estado === "enrolando")
    return (
      <div className="flex flex-col gap-3 rounded-[16px] border border-borde bg-tarjeta p-4">
        <p className="text-[13px] font-medium text-tinta">
          1) Escaneá este código con Google Authenticator, Authy o similar:
        </p>
        {qr && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="QR de 2FA" className="mx-auto h-44 w-44 rounded-[12px] bg-tarjeta" />
        )}
        {secret && (
          <p className="text-center text-[11.5px] font-medium text-gris">
            o cargá esta clave: <code className="font-bold text-tinta">{secret}</code>
          </p>
        )}
        <p className="text-[13px] font-medium text-tinta">2) Ingresá el código de 6 dígitos:</p>
        <input
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          placeholder="000000"
          className="rounded-[12px] border border-borde px-4 py-2.5 text-center text-[20px] font-extrabold tracking-[0.3em] text-tinta outline-none focus:border-azul"
        />
        {error && <p className="text-[12px] font-bold text-[#C0392B]">{error}</p>}
        <button
          type="button"
          disabled={busy || code.length !== 6}
          onClick={confirmar}
          className="rounded-[12px] bg-azul py-2.5 text-[14px] font-bold text-white disabled:opacity-40"
        >
          {busy ? "Verificando…" : "Confirmar y activar"}
        </button>
      </div>
    );

  // estado === "sin"
  return (
    <div className="flex items-center justify-between gap-3 rounded-[14px] border border-borde bg-tarjeta px-4 py-3">
      <div className="flex flex-col">
        <span className="text-[13.5px] font-bold text-tinta">2FA desactivado</span>
        <span className="text-[12px] font-medium text-gris">
          Sumá una capa: un código de tu teléfono además de la contraseña.
        </span>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={activar}
        className="rounded-[12px] bg-azul px-3.5 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-40"
      >
        {busy ? "…" : "Activar 2FA"}
      </button>
      {error && <p className="text-[12px] font-bold text-[#C0392B]">{error}</p>}
    </div>
  );
}
