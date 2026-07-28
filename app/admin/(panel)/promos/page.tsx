// Juegos promocionales (admin): raspadita (premios + probabilidades) y quiniela
// (abrir/cerrar/sorteo/ganadores). ⚠️ Estrictamente promocional: los premios son
// beneficios simbólicos del préstamo, NUNCA dinero (ver migración 0021).
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getPremiosRaspa, getSegmentosRaspa, getQuinielasAdmin, getParticipaciones } from "@/lib/data/promos";
import { getAjustesJuego } from "@/lib/data/juegoConfig";
import { getZonas } from "@/lib/data/zonas";
import { ganadores as calcularGanadores } from "@/lib/quiniela";
import { PromosManager, type ResumenQuiniela } from "@/components/admin/PromosManager";
import { ToggleJuegos } from "@/components/admin/ToggleJuegos";
import { PromosPreview } from "@/components/admin/PromosPreview";
import { EtiquetaAudiencia } from "@/components/admin/EtiquetaAudiencia";

export const dynamic = "force-dynamic";

export default async function PromosPage() {
  await requireAdmin();
  const db = await createSupabaseServer();
  const [premios, segmentos, quinielas, ajustes, zonas] = await Promise.all([
    getPremiosRaspa(db, false),
    getSegmentosRaspa(db, false),
    getQuinielasAdmin(db),
    getAjustesJuego(db),
    getZonas(db),
  ]);

  // Datos para el preview "así lo ve el cliente".
  const quinielaAbierta = quinielas.find((q) => q.estado === "abierta") ?? null;
  const hayRaspa = premios.some((p) => p.activo && p.tipo === "beneficio");

  // Resumen por quiniela: cantidad de participantes + ganadores (si ya se sorteó).
  const resumen: Record<string, ResumenQuiniela> = {};
  await Promise.all(
    quinielas.map(async (q) => {
      const parts = await getParticipaciones(db, q.id);
      // Ganadores = número sorteado ∪ forzados por el admin (modalidad mixta 0090).
      const winnerIds =
        q.numeroGanador != null
          ? calcularGanadores(
              parts.map((p) => ({ clienteId: p.clienteId, numero: p.numero })),
              q.numeroGanador,
              q.ganadoresForzados,
            )
          : [];
      const winnerSet = new Set(winnerIds);
      resumen[q.id] = {
        count: parts.length,
        ganadores: parts
          .filter((p) => winnerSet.has(p.clienteId))
          .map((p) => ({ clienteId: p.clienteId, nombre: p.clienteNombre, numero: p.numero })),
        participantes: parts.map((p) => ({ clienteId: p.clienteId, nombre: p.clienteNombre, numero: p.numero })),
        ganadoresForzados: q.ganadoresForzados,
      };
    }),
  );

  return (
    <div className="mx-auto flex max-w-[680px] flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Juegos y sorteos</h1>
          <span className="text-[13px] font-medium text-gris">
            Raspaditas y quinielas <b>promocionales</b>: los premios son beneficios de tu crédito,
            nunca dinero. El resultado lo decide el servidor y queda registrado.
          </span>
        </div>
        <EtiquetaAudiencia audiencia="cliente" />
      </div>

      {/* On/off de los juegos, co-locado con lo que se configura (antes vivía en
          "Zona de juego", otra pantalla). Si está apagado, el cliente no ve nada. */}
      <ToggleJuegos inicial={ajustes.activo} />

      {/* Así lo ve el cliente (snapshot fiel; cierra el ciclo configurar→ver). */}
      <PromosPreview
        quinielaTitulo={quinielaAbierta?.titulo ?? null}
        quinielaPremio={quinielaAbierta?.premioTexto ?? null}
        hayRaspa={hayRaspa}
      />

      <PromosManager premios={premios} segmentos={segmentos} quinielas={quinielas} resumen={resumen} zonas={zonas.map((z) => ({ id: z.id, nombre: z.nombre }))} />

      <p className="text-[11px] leading-[1.5] font-medium text-tenue-2">
        Marco legal: en Uruguay el juego de azar por dinero lo regula el Estado. Estas funciones son
        estrictamente promocionales (sin apuesta ni pago en efectivo). Requiere la migración 0021.
      </p>
    </div>
  );
}
