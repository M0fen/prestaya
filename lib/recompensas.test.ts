// Tests del núcleo de RECOMPENSAS: cada hito se desbloquea con el estado real
// del juego (racha, mes al día, crédito 100%, nivel) y reporta su progreso.
import { describe, expect, it } from "vitest";
import { evaluarRecompensas, contarDesbloqueadas, type Recompensa } from "./recompensas";
import type { JuegoCliente } from "./juegoCliente";

/** JuegoCliente completo con defaults; se sobreescribe lo que importa al test. */
function juego(over: Partial<JuegoCliente> = {}): JuegoCliente {
  return {
    nivel: { nombre: "Bronce", umbral: 0, color: "#B06A3A", etapa: 0 },
    nivelSiguiente: { nombre: "Plata", umbral: 500, color: "#8A94A6", etapa: 1 },
    xp: 0,
    xpEnNivel: 0,
    xpParaSubir: 500,
    progresoNivel: 0,
    racha: 0,
    mejorRacha: 0,
    estadoRacha: "rota",
    escudos: 0,
    boletos: 0,
    cuotasPagadas: 0,
    totalDias: 30,
    cuotasParaSubir: 10,
    logros: [],
    misiones: [],
    completo: false,
    ...over,
  };
}

const R: Recompensa[] = [
  { id: "1", titulo: "Racha 15", premio: "Descuento", hitoTipo: "racha", hitoValor: 15 },
  { id: "2", titulo: "Mes al día", premio: "Sorteo", hitoTipo: "mes_al_dia", hitoValor: 0 },
  { id: "3", titulo: "Crédito 100%", premio: "Mejor tasa", hitoTipo: "credito_completo", hitoValor: 0 },
  { id: "4", titulo: "Nivel Oro", premio: "Cupo", hitoTipo: "nivel", hitoValor: 2 },
];

describe("evaluarRecompensas", () => {
  it("cliente nuevo: todo bloqueado o en progreso, nada desbloqueado", () => {
    const r = evaluarRecompensas(R, juego());
    expect(contarDesbloqueadas(r)).toBe(0);
  });

  it("racha: se desbloquea al alcanzar la meta y muestra el progreso antes", () => {
    const antes = evaluarRecompensas(R, juego({ mejorRacha: 9 }))[0];
    expect(antes.estado).toBe("en_progreso");
    expect(antes.progreso).toBeCloseTo(9 / 15);
    const ok = evaluarRecompensas(R, juego({ mejorRacha: 15 }))[0];
    expect(ok.estado).toBe("desbloqueada");
  });

  it("mes al día: desbloqueada solo si está al día", () => {
    expect(evaluarRecompensas(R, juego({ estadoRacha: "al_dia" }))[1].estado).toBe("desbloqueada");
    expect(evaluarRecompensas(R, juego({ estadoRacha: "rota" }))[1].estado).not.toBe("desbloqueada");
  });

  it("crédito completo y nivel se desbloquean con su condición real", () => {
    const r = evaluarRecompensas(R, juego({
      completo: true, cuotasPagadas: 30,
      nivel: { nombre: "Oro", umbral: 1000, color: "#CBA14A", etapa: 2 },
    }));
    expect(r[2].estado).toBe("desbloqueada"); // crédito 100%
    expect(r[3].estado).toBe("desbloqueada"); // nivel etapa 2
  });
});
