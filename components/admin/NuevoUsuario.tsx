"use client";
// Alta de usuarios (solo admin). Crea el login + el usuario del sistema. El rol
// "Desarrollador" = admin con herramientas extra. Para cobrador se puede elegir
// zona y % de comisión. La contraseña se puede autogenerar.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { crearUsuarioAction } from "@/lib/acciones/usuarios";
import type { Zona } from "@/types/db";

type RolForm = "admin" | "supervisor" | "cobrador" | "desarrollador";

const ROLES: { id: RolForm; label: string; desc: string }[] = [
  { id: "cobrador", label: "Cobrador", desc: "App de calle; ve solo sus clientes" },
  { id: "supervisor", label: "Supervisor", desc: "Ve y controla su(s) zona(s)" },
  { id: "admin", label: "Administrador", desc: "Poder total sobre el sistema" },
  { id: "desarrollador", label: "Desarrollador", desc: "Admin + herramientas de diagnóstico" },
];

function passwordAleatoria(): string {
  const abc = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  const arr = new Uint32Array(12);
  crypto.getRandomValues(arr);
  for (const n of arr) s += abc[n % abc.length];
  return s;
}

export function NuevoUsuario({ zonas }: { zonas: Zona[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rol, setRol] = useState<RolForm>("cobrador");
  const [zonaId, setZonaId] = useState("");
  const [comision, setComision] = useState("0");
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const esCobrador = rol === "cobrador";

  function crear() {
    setMsg(null);
    startTransition(async () => {
      const r = await crearUsuarioAction({
        nombre,
        email,
        password,
        rol,
        zonaId: esCobrador && zonaId ? zonaId : null,
        comisionPct: esCobrador ? Number(comision) || 0 : 0,
      });
      if (r.ok) {
        setMsg({ ok: true, texto: `✓ Usuario creado. Anotá la contraseña: ${password}` });
        setNombre("");
        setEmail("");
        setPassword("");
        router.refresh();
      } else {
        setMsg({ ok: false, texto: r.error });
      }
    });
  }

  const inputCls =
    "rounded-[12px] border border-[#DCE3F1] px-3 py-2 text-[13.5px] font-medium text-tinta outline-none focus:border-azul";

  return (
    <section className="flex flex-col gap-3 rounded-[16px] border border-borde bg-tarjeta p-5">
      <span className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">Nuevo usuario</span>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-bold text-gris">Nombre</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre y apellido" className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-bold text-gris">Email (para entrar)</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@prestaya.uy" className={inputCls} autoComplete="off" />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-bold text-gris">Contraseña temporal</span>
        <div className="flex gap-2">
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mínimo 8 caracteres"
            className={`${inputCls} flex-1`}
            autoComplete="new-password"
          />
          <button
            type="button"
            onClick={() => setPassword(passwordAleatoria())}
            className="rounded-[12px] border border-[#DCE3F1] px-3 py-2 text-[12px] font-bold text-azul hover:bg-suave"
          >
            Generar
          </button>
        </div>
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11.5px] font-bold text-gris">Rol</span>
        <div className="grid gap-2 sm:grid-cols-2">
          {ROLES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRol(r.id)}
              className={`flex flex-col items-start gap-0.5 rounded-[12px] border px-3 py-2 text-left transition-colors ${
                rol === r.id ? "border-azul bg-[#EAF0FF]" : "border-borde bg-tarjeta hover:bg-suave"
              }`}
            >
              <span className="text-[13px] font-bold text-tinta">{r.label}</span>
              <span className="text-[11px] font-medium text-gris">{r.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {esCobrador && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11.5px] font-bold text-gris">Zona</span>
            <select value={zonaId} onChange={(e) => setZonaId(e.target.value)} className={inputCls}>
              <option value="">Sin zona</option>
              {zonas.map((z) => (
                <option key={z.id} value={z.id}>{z.nombre}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11.5px] font-bold text-gris">Comisión %</span>
            <input type="number" min={0} max={100} value={comision} onChange={(e) => setComision(e.target.value)} className={inputCls} />
          </label>
        </div>
      )}

      {msg && (
        <div
          className={`rounded-[12px] px-3 py-2 text-[12.5px] font-bold ${
            msg.ok ? "bg-[#E4F5EC] text-[#157A50]" : "bg-[#FDECEA] text-[#C0392B]"
          }`}
        >
          {msg.texto}
        </div>
      )}

      <button
        type="button"
        disabled={pending || nombre.trim().length < 2 || !email.includes("@") || password.length < 8}
        onClick={crear}
        className="self-start rounded-[12px] bg-azul px-4 py-2 text-[13px] font-bold text-white disabled:opacity-40"
      >
        {pending ? "Creando…" : "Crear usuario"}
      </button>
    </section>
  );
}
