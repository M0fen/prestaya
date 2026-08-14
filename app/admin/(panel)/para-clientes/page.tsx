// ─────────────────────────────────────────────────────────────────────────
//  HUB "Para tus clientes" — todo lo que el cliente ve en su cartón, en un
//  lugar, con su ESTADO real (encendido / en pantalla / apagado / en pausa) y
//  una señal viva (leads, quiniela, canjes). Pensado para que el admin ENTIENDA
//  qué es cada cosa y qué está prendido, sin entrar a cada pantalla a adivinar.
// ─────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getEstadoParaClientes } from "@/lib/data/paraClientes";
import { EtiquetaAudiencia } from "@/components/admin/EtiquetaAudiencia";
import { conTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";

const TOPE_MS = 22_000;

type Tono = "on" | "off" | "pausa" | "aviso";
const TONOS: Record<Tono, { bg: string; fg: string }> = {
  on: { bg: "#E4F5EC", fg: "#157A50" }, // encendido / en pantalla
  off: { bg: "#F3F5FB", fg: "#6B7494" }, // apagado / vacío
  pausa: { bg: "#FDF3E2", fg: "#9A6A0E" }, // en pausa / atención
  aviso: { bg: "#EAF0FF", fg: "#1E47C8" }, // señal informativa
};

export default async function ParaClientesPage() {
  await requireAdmin();
  const db = await createSupabaseServer();
  const e = await conTimeout(getEstadoParaClientes(db), TOPE_MS, "admin.para-clientes");

  return (
    <div className="mx-auto flex max-w-[880px] flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Para tus clientes</h1>
          <span className="text-[13px] font-medium text-gris">
            Todo lo que tus clientes ven en su cartón, en un lugar. Tocá cualquiera para configurarlo.
          </span>
        </div>
        <EtiquetaAudiencia audiencia="cliente" />
      </div>

      {/* ── LO QUE VEN AHORA ─────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2.5">
        <h2 className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">Lo que ven en su cartón</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Tarjeta
            href="/admin/anuncios"
            icono="📣"
            titulo="Anuncios al cliente"
            que="Avisos y publicidad que rotan arriba del cartón."
            tono={e.anuncios.enPantalla > 0 ? "on" : e.anuncios.total > 0 ? "pausa" : "off"}
            estado={
              e.anuncios.enPantalla > 0
                ? `En pantalla · ${e.anuncios.enPantalla}`
                : e.anuncios.total > 0
                  ? "Ninguno en pantalla"
                  : "Sin anuncios"
            }
            senal={
              e.anuncios.total > e.anuncios.enPantalla
                ? `${e.anuncios.total - e.anuncios.enPantalla} pausado(s) o programado(s)`
                : undefined
            }
          />
          <Tarjeta
            href="/admin/tienda"
            icono="🛍️"
            titulo="Tienda"
            que="Catálogo de productos en cuotas que el cliente puede pedir."
            tono={e.tienda.hayProductos ? "on" : "off"}
            estado={e.tienda.hayProductos ? "Abierta" : "Sin productos"}
            senal={e.tienda.leadsNuevos > 0 ? `${e.tienda.leadsNuevos} interesado(s) nuevo(s)` : undefined}
            senalTono="aviso"
          />
          <Tarjeta
            href="/admin/rifa"
            icono="🎁"
            titulo="Rifa"
            que="Un banner con la foto del premio, para tus mejores clientes."
            tono={e.rifa.activa ? "on" : "off"}
            estado={e.rifa.activa ? "Encendida" : "Apagada"}
          />
          <Tarjeta
            href="/admin/promos"
            icono="🎟️"
            titulo="Juegos y sorteos"
            que="Raspadita (premio al pagar) y quiniela (número de la suerte)."
            tono={e.juegos.activo ? "on" : "off"}
            estado={e.juegos.activo ? "Encendidos" : "Apagados"}
            senal={
              e.juegos.activo
                ? e.juegos.quinielaAbierta
                  ? "Quiniela abierta ahora"
                  : "Sin quiniela abierta"
                : undefined
            }
            senalTono={e.juegos.quinielaAbierta ? "on" : "off"}
          />
        </div>
      </section>

      {/* ── EN PAUSA ─────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2.5">
        <h2 className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">En pausa por ahora</h2>
        <p className="-mt-1 text-[12px] font-medium text-tenue">
          Estas todavía <b>no se muestran</b> en el cartón del cliente. Podés dejarlas listas para cuando las quieras encender.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Tarjeta
            href="/admin/estrellas"
            icono="⭐"
            titulo="Estrellas"
            que="Recompensa por pagar (5 pagos = 1 estrella). El canje lo hacés en persona."
            tono="pausa"
            estado="El cliente aún no ve su saldo"
            senal={e.estrellas.canjesPendientes > 0 ? `${e.estrellas.canjesPendientes} canje(s) por aprobar` : undefined}
            senalTono="aviso"
          />
          <Tarjeta
            href="/admin/juego"
            icono="🎮"
            titulo="Zona de juego"
            que="Juego arcade del mes, temporada/evento y misiones."
            tono="pausa"
            estado="En pausa"
          />
        </div>
      </section>

      <p className="text-[11px] leading-[1.6] font-medium text-tenue">
        ¿Y los avisos para tu <b>equipo</b> (cobradores)? Esos van por{" "}
        <Link href="/admin/banner-equipo" className="font-bold text-azul">Banner al equipo</Link>, no acá.
      </p>
    </div>
  );
}

function Tarjeta({
  href,
  icono,
  titulo,
  que,
  estado,
  tono,
  senal,
  senalTono = "aviso",
}: {
  href: string;
  icono: string;
  titulo: string;
  que: string;
  estado: string;
  tono: Tono;
  senal?: string;
  senalTono?: Tono;
}) {
  const t = TONOS[tono];
  const st = TONOS[senalTono];
  return (
    <Link
      href={href}
      className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-tarjeta p-4 transition-shadow hover:shadow-[0_6px_18px_rgba(19,48,140,0.10)]"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[12px] bg-[#EEF3FF] text-[22px]"
        >
          {icono}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[15px] font-extrabold text-tinta">{titulo}</span>
          <span className="text-[12px] leading-[1.45] font-medium text-gris">{que}</span>
        </div>
        <span aria-hidden="true" className="mt-1 flex-shrink-0 text-[16px] text-[#C3CBDE]">
          ›
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: t.bg, color: t.fg }}>
          {estado}
        </span>
        {senal && (
          <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: st.bg, color: st.fg }}>
            {senal}
          </span>
        )}
      </div>
    </Link>
  );
}
