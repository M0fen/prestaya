// ─────────────────────────────────────────────────────────────────────────
//  Registro de juegos del "espacio de juegos". Cada juego es un bundle HTML5
//  autocontenido servido como estático desde /public/juegos/<id>/.
//  Cambiar el juego del mes = cambiar JUEGO_ACTUAL (o, a futuro, leerlo de
//  Supabase / un anuncio). El resto de la app no se entera.
// ─────────────────────────────────────────────────────────────────────────

export interface Juego {
  id: string;
  titulo: string;
  descripcion: string;
  /** Ruta estática del bundle del juego (origen mismo, cacheable). */
  ruta: string;
  /** Alto del lienzo del juego en px (mobile-first). */
  alto: number;
}

export const JUEGOS: Record<string, Juego> = {
  "penales-mundial": {
    id: "penales-mundial",
    titulo: "Penales del Mundial 2026 ⚽",
    descripcion:
      "Tirá por la celeste: apuntá, cargá potencia y vencé al arquero. Meté 4 de 5 y clasificá.",
    ruta: "/juegos/penales-mundial/index.html",
    alto: 470,
  },
  "atrapa-monedas": {
    id: "atrapa-monedas",
    titulo: "Atrapa tus monedas",
    descripcion: "Atrapa 12 monedas y desbloquea el premio del mes.",
    ruta: "/juegos/atrapa-monedas/index.html",
    alto: 440,
  },
};

/** Juego que se muestra este mes (Mundial 2026). */
export const JUEGO_ACTUAL: Juego = JUEGOS["penales-mundial"];
