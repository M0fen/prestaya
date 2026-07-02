// ─────────────────────────────────────────────────────────────────────────
//  Núcleo PURO de la MASCOTA (tamagotchi) de la vista de cliente. Client-safe
//  y testeable: catálogo de especies/accesorios + lógica del "cariño" (un
//  vínculo afectivo que sube al interactuar y decae suave con el tiempo).
//
//  IMPORTANTE (tono amable): el cariño NO es una barra de deuda ni de culpa.
//  El CRECIMIENTO de la mascota (etapa) viene de los pagos reales (ver
//  lib/juegoCliente). El cariño es solo el vínculo emocional del cuidado
//  (acariciar/peinar/jugar). Nunca castiga: si baja, la mascota "te extraña".
// ─────────────────────────────────────────────────────────────────────────

export type OrejaEspecie = "brote" | "gato" | "conejo" | "ave";

export interface Especie {
  id: string;
  nombre: string;
  /** Emoji para el selector (accesible, sin imágenes). */
  emoji: string;
  paleta: {
    cuerpo: string;
    sombra: string;
    panza: string;
    mejilla: string;
  };
  orejas: OrejaEspecie;
  cola: boolean;
}

/** Especies elegibles. Comparten el mismo "plan corporal" (blob) para que
 *  todas sean expresivas y livianas; cambian color, orejas y cola. */
export const ESPECIES: Especie[] = [
  {
    id: "kiwi",
    nombre: "Kiwi",
    emoji: "🥝",
    paleta: { cuerpo: "#4FB89A", sombra: "#3F9D80", panza: "#7FD3BB", mejilla: "#EF9A9A" },
    orejas: "brote",
    cola: false,
  },
  {
    id: "michi",
    nombre: "Michi",
    emoji: "🐱",
    paleta: { cuerpo: "#F2A65A", sombra: "#DB8A3C", panza: "#FBD4A8", mejilla: "#E97A7A" },
    orejas: "gato",
    cola: true,
  },
  {
    id: "uva",
    nombre: "Uva",
    emoji: "🐰",
    paleta: { cuerpo: "#9B7EDE", sombra: "#7E5FC6", panza: "#C9B8F0", mejilla: "#EF9A9A" },
    orejas: "conejo",
    cola: true,
  },
  {
    id: "solcito",
    nombre: "Solcito",
    emoji: "🐤",
    paleta: { cuerpo: "#F4CE52", sombra: "#E0B33C", panza: "#FBE9A8", mejilla: "#F0A05A" },
    orejas: "ave",
    cola: false,
  },
];

export const ESPECIE_DEFAULT = ESPECIES[0];

export function especiePorId(id: string | null | undefined): Especie {
  return ESPECIES.find((e) => e.id === id) ?? ESPECIE_DEFAULT;
}

// ── Accesorios (cosméticos, se desbloquean por nivel de la mascota) ─────────

export interface Accesorio {
  id: string;
  nombre: string;
  emoji: string;
  /** Etapa mínima de la mascota (0..4) para poder usarlo. */
  etapaMin: number;
}

export const ACCESORIOS: Accesorio[] = [
  { id: "ninguno", nombre: "Sin accesorio", emoji: "🚫", etapaMin: 0 },
  { id: "moño", nombre: "Moño", emoji: "🎀", etapaMin: 0 },
  { id: "gorro", nombre: "Gorrito", emoji: "🧢", etapaMin: 1 },
  { id: "flor", nombre: "Flor", emoji: "🌸", etapaMin: 2 },
  { id: "corona", nombre: "Corona", emoji: "👑", etapaMin: 3 },
  { id: "lentes", nombre: "Lentes", emoji: "🕶️", etapaMin: 4 },
];

// ── Escenario (fondo) que evoluciona con el nivel (por pagos) ───────────────

export interface Escenario {
  nombre: string;
  cielo: string;
  suelo: string;
}

const ESCENARIOS: Escenario[] = [
  { nombre: "Pradera", cielo: "#EAF6FF", suelo: "#DCEFDA" }, // etapa 0
  { nombre: "Jardín", cielo: "#EAF1FF", suelo: "#D6EAD0" }, // 1
  { nombre: "Atardecer", cielo: "#FFF1E6", suelo: "#F3E4C8" }, // 2
  { nombre: "Costa", cielo: "#E6F7FF", suelo: "#F5ECC6" }, // 3
  { nombre: "Cielo estrellado", cielo: "#ECE7FF", suelo: "#DAD4F2" }, // 4
];

/** Escenario según la etapa (0..4). Crece con los pagos. */
export function escenarioPorEtapa(etapa: number): Escenario {
  return ESCENARIOS[Math.max(0, Math.min(4, Math.floor(etapa)))];
}

export function accesorioPorId(id: string | null | undefined): Accesorio {
  return ACCESORIOS.find((a) => a.id === id) ?? ACCESORIOS[0];
}

/** Accesorios disponibles según la etapa alcanzada (por pagos). */
export function accesoriosDisponibles(etapa: number): Accesorio[] {
  return ACCESORIOS.filter((a) => a.etapaMin <= etapa);
}

// ── Cariño (vínculo afectivo) ──────────────────────────────────────────────

export type AnimoMascota = "feliz" | "contento" | "normal" | "extrana" | "dormido";
export type Expresion = "feliz" | "contento" | "normal" | "triste" | "dormido";

export const CARINO_MAX = 100;
/** Cuánto sube el cariño por interacción. */
export const CARINO_ACCION: Record<"acariciar" | "peinar" | "jugar" | "alimentar", number> = {
  acariciar: 8,
  peinar: 6,
  jugar: 11,
  alimentar: 9,
};
/** Puntos de cariño que se pierden por hora de ausencia (decaimiento suave). */
const DECAIMIENTO_POR_HORA = 1.4;

/** Cariño efectivo ahora: parte del guardado y le resta el decaimiento por el
 *  tiempo transcurrido desde la última interacción. Nunca baja de 0. */
export function carinoActual(
  carinoGuardado: number,
  ultimaInteraccionISO: string | null,
  ahora: Date = new Date(),
): number {
  const base = clamp(carinoGuardado, 0, CARINO_MAX);
  if (!ultimaInteraccionISO) return base;
  const ms = ahora.getTime() - new Date(ultimaInteraccionISO).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return base;
  const horas = ms / 3_600_000;
  return clamp(Math.round(base - horas * DECAIMIENTO_POR_HORA), 0, CARINO_MAX);
}

export interface EstadoAnimo {
  animo: AnimoMascota;
  expresion: Expresion;
  /** Mensaje cálido para el cliente (nunca culpa). */
  mensaje: string;
}

/** Traduce el cariño a un ánimo + expresión + mensaje amable. */
export function estadoAnimo(carino: number, nombre: string): EstadoAnimo {
  const n = nombre?.trim() || "tu mascota";
  if (carino >= 75)
    return { animo: "feliz", expresion: "feliz", mensaje: `¡${n} está feliz de verte! 💛` };
  if (carino >= 45)
    return { animo: "contento", expresion: "contento", mensaje: `${n} está de buen ánimo.` };
  if (carino >= 20)
    return { animo: "normal", expresion: "normal", mensaje: `${n} quiere jugar un rato.` };
  if (carino >= 8)
    return { animo: "extrana", expresion: "triste", mensaje: `${n} te extrañó. Dale un mimo 🤍` };
  return { animo: "dormido", expresion: "dormido", mensaje: `${n} está descansando. Acariciá para saludar.` };
}

/** Aplica una interacción al cariño y devuelve el nuevo valor (0..100). */
export function aplicarInteraccion(
  carino: number,
  accion: keyof typeof CARINO_ACCION,
): number {
  return clamp(carino + CARINO_ACCION[accion], 0, CARINO_MAX);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

// ── Estado persistido de la mascota (DB o localStorage) ─────────────────────

export interface EstadoMascota {
  especie: string;
  nombre: string;
  accesorio: string;
  carino: number;
  ultimaInteraccion: string | null;
}

export function estadoMascotaInicial(): EstadoMascota {
  return {
    especie: ESPECIE_DEFAULT.id,
    nombre: "",
    accesorio: "ninguno",
    carino: 60,
    ultimaInteraccion: null,
  };
}
