// Motivos de "no pago" (visita sin cobro). VIVE APARTE del archivo de acciones
// porque un archivo "use server" SOLO puede exportar funciones async; exportar
// esta constante desde allí rompía en runtime al importarla un client component
// (RegistroCobro) → "A 'use server' file can only export async functions".
export const MOTIVOS_NOPAGO = [
  { id: "no_estaba", label: "No estaba", emoji: "🚪", resultado: "no_estaba" },
  { id: "no_tenia", label: "No tenía", emoji: "💸", resultado: "no_pago" },
  { id: "se_nego", label: "Se negó", emoji: "🙅", resultado: "no_pago" },
  { id: "reagendado", label: "Reagendado", emoji: "📅", resultado: "otro" },
] as const;

export type MotivoNoPago = (typeof MOTIVOS_NOPAGO)[number]["id"];
