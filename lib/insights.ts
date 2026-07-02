// ─────────────────────────────────────────────────────────────────────────
//  Núcleo PURO de "insights" — lo que Aureo ve hoy SIN llamar al modelo.
//  Deriva señales accionables de la foto real del negocio (mora, cobradores,
//  recaudo) de forma determinista: instantáneo, gratis y siempre disponible.
//  El botón "Preguntá a Aureo" de cada insight abre el asesor IA para
//  profundizar. Sin IO ni React → testeable y reusable (cliente/servidor).
// ─────────────────────────────────────────────────────────────────────────
import { UYU } from "./format";

export type TonoInsight = "critico" | "alerta" | "bueno" | "neutro";

export interface Insight {
  id: string;
  tono: TonoInsight;
  icono: string;
  titulo: string;
  detalle: string;
  /** Pregunta sugerida para profundizar con el asesor IA (opcional). */
  pregunta?: string;
}

export interface EntradaInsights {
  moraPct: number; // 0..1 sobre la cartera por cobrar
  montoEnMora: number;
  morosos: number;
  criticos: number;
  carteraPorCobrar: number;
  recaudadoHoy: number;
  recaudadoMes: number;
  topRiesgo: {
    nombre: string;
    deudaVencida: number;
    diasSinPagar: number;
    nivel: string;
    cobrador: string | null;
  }[];
  cobradores: {
    nombre: string;
    recaudado: number;
    esperado: number;
    progresoPct: number;
    anomalias: number;
  }[];
  alertas: { severidad: string; titulo: string; detalle: string }[];
  /** Serie de recaudo diario: promedio de la ventana y valor de hoy. */
  serie: { promedio: number; hoy: number; tendencia: number };
}

interface Candidato extends Insight {
  /** Prioridad para ordenar (mayor = más arriba). */
  peso: number;
}

const PCT = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Genera los insights priorizados (máx. `limite`). Ordena por gravedad y
 * relevancia; si todo está sano, devuelve una lectura positiva.
 */
export function generarInsights(e: EntradaInsights, limite = 4): Insight[] {
  const c: Candidato[] = [];

  // ── 1. Anomalías de cobranza (fuera de zona) — lo más grave (fuga) ──
  const fueraZona = e.alertas.filter((a) => a.titulo.includes("fuera de zona"));
  if (fueraZona.length > 0) {
    c.push({
      id: "fuera-zona",
      tono: "critico",
      icono: "📍",
      peso: 100,
      titulo: `${fueraZona.length} cobro(s) fuera de zona hoy`,
      detalle:
        "Hay pagos registrados lejos del domicilio del cliente. Revisá el GPS antes de que se vuelva costumbre.",
      pregunta: "¿Qué cobros se registraron fuera de zona hoy y qué hago?",
    });
  }

  // ── 2. Mora en estado crítico ──
  if (e.criticos > 0) {
    c.push({
      id: "mora-critica",
      tono: "critico",
      icono: "🔴",
      peso: 95,
      titulo: `${e.criticos} crédito(s) en estado crítico`,
      detalle: `Son los de mayor riesgo de incobrable. En total la mora suma ${UYU(e.montoEnMora)} (${PCT(e.moraPct)} de la cartera).`,
      pregunta: "¿Cómo bajo la mora y qué hago con los créditos críticos?",
    });
  } else if (e.moraPct >= 0.15) {
    c.push({
      id: "mora-alta",
      tono: "alerta",
      icono: "⏰",
      peso: 80,
      titulo: `Mora en ${PCT(e.moraPct)} de la cartera`,
      detalle: `${UYU(e.montoEnMora)} vencidos en ${e.morosos} crédito(s). Conviene apretar la cobranza esta semana.`,
      pregunta: "¿Cómo bajo la mora?",
    });
  }

  // ── 3. Float alto sin rendir ──
  const float = e.alertas.filter((a) => a.titulo.includes("Float alto"));
  if (float.length > 0) {
    c.push({
      id: "float-alto",
      tono: "alerta",
      icono: "💵",
      peso: 78,
      titulo: `${float.length} cobrador(es) con efectivo sin rendir`,
      detalle: float[0].detalle,
      pregunta: "¿Qué cobradores tienen float alto y cuándo deberían rendir?",
    });
  }

  // ── 4. Cliente puntual de mayor deuda vencida ──
  const peor = [...e.topRiesgo].sort((a, b) => b.deudaVencida - a.deudaVencida)[0];
  if (peor && peor.deudaVencida > 0) {
    c.push({
      id: "cliente-riesgo",
      tono: peor.nivel === "crítico" ? "critico" : "alerta",
      icono: "👤",
      peso: 70,
      titulo: `${peor.nombre} arrastra ${UYU(peor.deudaVencida)}`,
      detalle: `${peor.diasSinPagar} día(s) sin pagar${peor.cobrador ? `, en la ruta de ${peor.cobrador}` : ""}. Vale una llamada hoy.`,
      pregunta: `Contame el detalle de ${peor.nombre} y qué le digo.`,
    });
  }

  // ── 5. Cobrador rezagado (bajo avance) ──
  const rezagado = e.cobradores
    .filter((x) => x.esperado > 0 && x.progresoPct < 45)
    .sort((a, b) => a.progresoPct - b.progresoPct)[0];
  if (rezagado) {
    c.push({
      id: "cobrador-rezagado",
      tono: "alerta",
      icono: "🐢",
      peso: 60,
      titulo: `${rezagado.nombre} va al ${rezagado.progresoPct}% de su ruta`,
      detalle: `Recaudó ${UYU(rezagado.recaudado)} de ${UYU(rezagado.esperado)} esperado. Puede ser tarde en el día o un problema real.`,
      pregunta: `¿Cómo viene la ruta de ${rezagado.nombre} hoy?`,
    });
  }

  // ── 6. Ritmo de recaudo vs promedio (positivo o negativo) ──
  const { hoy, promedio } = e.serie;
  if (promedio > 0) {
    if (hoy >= promedio * 1.1) {
      c.push({
        id: "recaudo-bueno",
        tono: "bueno",
        icono: "📈",
        peso: 40,
        titulo: `Buen día: ${UYU(hoy)} recaudados`,
        detalle: `Por encima del promedio de ${UYU(promedio)} de los últimos días. Buen ritmo del equipo.`,
      });
    } else if (hoy > 0 && hoy <= promedio * 0.55) {
      c.push({
        id: "recaudo-flojo",
        tono: "alerta",
        icono: "📉",
        peso: 55,
        titulo: `Recaudo flojo: ${UYU(hoy)} hoy`,
        detalle: `Vas por debajo del promedio de ${UYU(promedio)}. Si el día ya está avanzado, conviene empujar.`,
        pregunta: "¿Por qué el recaudo de hoy viene bajo el promedio?",
      });
    }
  }

  // ── 7. Mejor cobrador del día (reconocimiento) ──
  const lider = [...e.cobradores]
    .filter((x) => x.recaudado > 0)
    .sort((a, b) => b.recaudado - a.recaudado)[0];
  if (lider && lider.progresoPct >= 80) {
    c.push({
      id: "cobrador-lider",
      tono: "bueno",
      icono: "🏅",
      peso: 30,
      titulo: `${lider.nombre} lidera hoy`,
      detalle: `Va al ${lider.progresoPct}% de su ruta con ${UYU(lider.recaudado)} recaudados. Buen trabajo.`,
    });
  }

  // ── Nada que reportar → lectura sana ──
  if (c.length === 0) {
    c.push({
      id: "todo-ok",
      tono: "bueno",
      icono: "✅",
      peso: 10,
      titulo: "Operación en orden",
      detalle: `Sin mora crítica ni anomalías. Recaudado hoy: ${UYU(e.recaudadoHoy)} · mes: ${UYU(e.recaudadoMes)}.`,
      pregunta: "¿Dónde puedo mejorar el negocio esta semana?",
    });
  }

  return c
    .sort((a, b) => b.peso - a.peso)
    .slice(0, limite)
    .map(({ peso: _peso, ...rest }) => rest);
}
