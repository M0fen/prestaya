"use client";
// Command Palette del panel (Ctrl/Cmd + K). Un buscador único para:
//   · Saltar a cualquier sección (según el rol).
//   · Encontrar un cliente por nombre o documento e ir a su ficha.
// Teclado completo: ↑/↓ para moverse, Enter para ir, Esc para cerrar. Cero
// dependencias. Pensado para operar el panel rápido sin soltar el teclado.
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Rol } from "@/types/db";
import { navVisible, type NavItem } from "@/lib/admin/nav";

type ClienteHit = { id: string; nombre: string; documento: string | null };

// Normaliza (minúsculas + sin acentos) para buscar sin tildes.
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

export function CommandPalette({ rol, esDev = false }: { rol: Rol; esDev?: boolean }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [clientes, setClientes] = useState<ClienteHit[]>([]);
  const [cargando, setCargando] = useState(false);
  const [esMac, setEsMac] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const secciones = useMemo(
    () => navVisible(rol, esDev).filter((i) => !i.pronto),
    [rol, esDev],
  );

  // Secciones que matchean el texto (por label o alias).
  const navHits = useMemo<NavItem[]>(() => {
    const t = norm(q.trim());
    if (!t) return secciones;
    return secciones.filter(
      (i) =>
        norm(i.label).includes(t) ||
        (i.alias ?? []).some((a) => norm(a).includes(t)),
    );
  }, [q, secciones]);

  // Lista plana navegable (para ↑/↓ y Enter): primero secciones, luego clientes.
  const filas = useMemo(
    () => [
      ...navHits.map((i) => ({ tipo: "nav" as const, href: i.href, item: i })),
      ...clientes.map((c) => ({
        tipo: "cliente" as const,
        href: `/admin/clientes/${c.id}`,
        cliente: c,
      })),
    ],
    [navHits, clientes],
  );

  const abrir = useCallback(() => {
    setAbierto(true);
    setQ("");
    setSel(0);
    setClientes([]);
  }, []);
  const cerrar = useCallback(() => setAbierto(false), []);

  // Detectar Mac (para mostrar ⌘ vs Ctrl) al montar.
  useEffect(() => {
    setEsMac(/mac|iphone|ipad/i.test(navigator.userAgent));
  }, []);

  // Atajo global Ctrl/Cmd + K para abrir/cerrar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAbierto((v) => !v);
        setQ("");
        setSel(0);
        setClientes([]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Enfocar el input al abrir.
  useEffect(() => {
    if (abierto) requestAnimationFrame(() => inputRef.current?.focus());
  }, [abierto]);

  // Mantener el índice seleccionado dentro de rango.
  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(0, filas.length - 1)));
  }, [filas.length]);

  // Buscar clientes (debounced) cuando hay 2+ caracteres.
  useEffect(() => {
    if (!abierto) return;
    const t = q.trim();
    if (t.length < 2) {
      setClientes([]);
      setCargando(false);
      return;
    }
    setCargando(true);
    const ctrl = new AbortController();
    const id = window.setTimeout(async () => {
      try {
        const r = await fetch(`/api/buscar-clientes?q=${encodeURIComponent(t)}`, {
          signal: ctrl.signal,
        });
        const data = await r.json();
        setClientes(Array.isArray(data.clientes) ? data.clientes : []);
      } catch {
        /* abortada o error: dejamos lo que había */
      } finally {
        setCargando(false);
      }
    }, 200);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [q, abierto]);

  const ir = useCallback(
    (href: string) => {
      cerrar();
      router.push(href);
    },
    [cerrar, router],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, filas.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const fila = filas[sel];
      if (fila) ir(fila.href);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cerrar();
    }
  };

  return (
    <>
      {/* Disparador en la barra superior */}
      <button
        onClick={abrir}
        className="flex items-center gap-2 rounded-full border border-borde bg-suave px-3 py-1.5 text-[12.5px] font-semibold text-gris hover:border-[#C7D2ED] hover:text-tinta"
        aria-label="Buscar (Ctrl/Cmd + K)"
      >
        <span aria-hidden="true">🔎</span>
        <span className="hidden sm:inline">Buscar…</span>
        <kbd className="hidden rounded-[6px] border border-borde bg-tarjeta px-1.5 py-0.5 text-[10px] font-bold text-gris sm:inline">
          {esMac ? "⌘" : "Ctrl"} K
        </kbd>
      </button>

      {!abierto ? null : (
        <div
          className="fixed inset-0 z-[80] flex items-start justify-center bg-[#0F1B3D]/40 p-4 pt-[12vh] backdrop-blur-[2px]"
          onClick={cerrar}
        >
          <div
            className="toast-in flex w-full max-w-[560px] flex-col overflow-hidden rounded-[18px] border border-borde bg-tarjeta shadow-[0_24px_60px_rgba(19,48,140,0.28)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Buscador */}
            <div className="flex items-center gap-2.5 border-b border-linea px-4 py-3">
              <span aria-hidden="true" className="text-[16px] text-gris">
                🔎
              </span>
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setSel(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Buscar sección o cliente…"
                className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-tinta outline-none placeholder:text-tenue-2"
              />
              <kbd className="rounded-[6px] border border-borde bg-suave px-1.5 py-0.5 text-[10px] font-bold text-gris">
                Esc
              </kbd>
            </div>

            {/* Resultados */}
            <div className="max-h-[52vh] overflow-y-auto py-2">
              {navHits.length > 0 && (
                <Grupo titulo="Ir a">
                  {navHits.map((i) => {
                    const idx = filas.findIndex(
                      (f) => f.tipo === "nav" && f.href === i.href,
                    );
                    return (
                      <FilaBtn
                        key={i.href}
                        activo={idx === sel}
                        onMouseEnter={() => setSel(idx)}
                        onClick={() => ir(i.href)}
                        icono={i.icon}
                        titulo={i.label}
                      />
                    );
                  })}
                </Grupo>
              )}

              {q.trim().length >= 2 && (
                <Grupo titulo="Clientes">
                  {clientes.map((c) => {
                    const idx = filas.findIndex(
                      (f) => f.tipo === "cliente" && f.href.endsWith(c.id),
                    );
                    return (
                      <FilaBtn
                        key={c.id}
                        activo={idx === sel}
                        onMouseEnter={() => setSel(idx)}
                        onClick={() => ir(`/admin/clientes/${c.id}`)}
                        icono="👤"
                        titulo={c.nombre}
                        sub={c.documento ?? undefined}
                      />
                    );
                  })}
                  {clientes.length === 0 && (
                    <p className="px-4 py-2 text-[12.5px] font-medium text-tenue-2">
                      {cargando ? "Buscando…" : "Sin clientes que coincidan."}
                    </p>
                  )}
                </Grupo>
              )}

              {filas.length === 0 && q.trim().length < 2 && (
                <p className="px-4 py-6 text-center text-[13px] font-medium text-tenue-2">
                  Escribí para buscar una sección o un cliente.
                </p>
              )}
            </div>

            {/* Pie con ayuda de teclado */}
            <div className="flex items-center gap-3 border-t border-linea px-4 py-2 text-[11px] font-semibold text-tenue-2">
              <span>↑ ↓ moverse</span>
              <span>↵ abrir</span>
              <span>esc cerrar</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <p className="px-4 pt-1.5 pb-1 text-[10.5px] font-bold tracking-wide text-tenue-2 uppercase">
        {titulo}
      </p>
      {children}
    </div>
  );
}

function FilaBtn({
  activo,
  onClick,
  onMouseEnter,
  icono,
  titulo,
  sub,
}: {
  activo: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  icono: string;
  titulo: string;
  sub?: string;
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${
        activo ? "bg-[#EEF3FF]" : "hover:bg-suave"
      }`}
    >
      <span aria-hidden="true" className="text-[16px]">
        {icono}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-tinta">{titulo}</span>
        {sub && <span className="block truncate text-[12px] text-gris">{sub}</span>}
      </span>
      {activo && <span className="text-[12px] font-bold text-azul">↵</span>}
    </button>
  );
}
