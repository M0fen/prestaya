import { describe, it, expect } from "vitest";
import {
  actorDesde,
  alcanceZonas,
  filtrarPorZona,
  puedeAnularPagoDirecto,
  puedeConfirmarAnulacion,
  puedeCrearCobradorDirecto,
  puedeReasignarCliente,
  puedeReasignarEntreZonas,
  puedeSolicitarAltaCobrador,
  puedeSolicitarAnulacion,
  puedeEscribirEnZona,
  puedeVerCartera,
  puedeVerZona,
  type Actor,
} from "./permisos";

const ZA = "zona-a";
const ZB = "zona-b";

const admin: Actor = { rol: "admin", usuarioId: "u-admin" };
const supervisorAB: Actor = {
  rol: "supervisor",
  usuarioId: "u-sup",
  zonasSupervisadas: [ZA, ZB],
};
const supervisorA: Actor = {
  rol: "supervisor",
  usuarioId: "u-sup-a",
  zonasSupervisadas: [ZA],
};
const supervisorSinZonas: Actor = { rol: "supervisor", usuarioId: "u-sup0", zonasSupervisadas: [] };
const cobradorA: Actor = { rol: "cobrador", usuarioId: "u-cob-a", zonaId: ZA };
const cobradorSinZona: Actor = { rol: "cobrador", usuarioId: "u-cob0", zonaId: null };

describe("alcanceZonas", () => {
  it("admin ve todas", () => {
    expect(alcanceZonas(admin)).toEqual({ tipo: "todas" });
  });

  it("supervisor ve solo sus zonas", () => {
    const a = alcanceZonas(supervisorA);
    expect(a.tipo).toBe("algunas");
    if (a.tipo === "algunas") {
      expect(a.zonas.has(ZA)).toBe(true);
      expect(a.zonas.has(ZB)).toBe(false);
    }
  });

  it("supervisor SIN zonas no ve NADA (regla de Carlos 15-08, espejo de la 0148)", () => {
    // La transición terminó: la asignación de zona es parte del alta. Antes el
    // fallback le abría TODO el panel (lectura y escritura) al supervisor a
    // medio dar de alta — la escotilla que la 0148 cerró en la base.
    expect(alcanceZonas(supervisorSinZonas)).toEqual({ tipo: "ninguna" });
  });

  it("cobrador alcanza su propia zona", () => {
    const a = alcanceZonas(cobradorA);
    expect(a.tipo).toBe("algunas");
    if (a.tipo === "algunas") expect(a.zonas.has(ZA)).toBe(true);
  });

  it("cobrador sin zona no alcanza nada", () => {
    expect(alcanceZonas(cobradorSinZona)).toEqual({ tipo: "ninguna" });
  });
});

describe("puedeVerZona", () => {
  it("admin ve cualquier zona, incluso sin zona (null)", () => {
    expect(puedeVerZona(admin, ZA)).toBe(true);
    expect(puedeVerZona(admin, null)).toBe(true);
  });

  it("supervisor de A NO ve datos de zona B (aislamiento)", () => {
    expect(puedeVerZona(supervisorA, ZA)).toBe(true);
    expect(puedeVerZona(supervisorA, ZB)).toBe(false);
  });

  it("supervisor con zonas NO ve recursos sin zona (null)", () => {
    expect(puedeVerZona(supervisorA, null)).toBe(false);
  });

  it("cobrador solo ve su zona", () => {
    expect(puedeVerZona(cobradorA, ZA)).toBe(true);
    expect(puedeVerZona(cobradorA, ZB)).toBe(false);
  });
});

describe("filtrarPorZona", () => {
  const recursos = [
    { id: 1, zonaId: ZA },
    { id: 2, zonaId: ZB },
    { id: 3, zonaId: null },
  ];

  it("admin obtiene todos", () => {
    expect(filtrarPorZona(admin, recursos)).toHaveLength(3);
  });

  it("supervisor de A obtiene solo los de A", () => {
    const r = filtrarPorZona(supervisorA, recursos);
    expect(r.map((x) => x.id)).toEqual([1]);
  });

  it("supervisor de A y B obtiene ambos, no el sin zona", () => {
    const r = filtrarPorZona(supervisorAB, recursos);
    expect(r.map((x) => x.id)).toEqual([1, 2]);
  });

  it("cobrador de A obtiene solo A", () => {
    const r = filtrarPorZona(cobradorA, recursos);
    expect(r.map((x) => x.id)).toEqual([1]);
  });
});

describe("decisión 1 — alta de cobrador", () => {
  it("solo el admin crea directo; el supervisor solicita", () => {
    expect(puedeCrearCobradorDirecto(admin)).toBe(true);
    expect(puedeCrearCobradorDirecto(supervisorA)).toBe(false);
    expect(puedeSolicitarAltaCobrador(supervisorA)).toBe(true);
    expect(puedeSolicitarAltaCobrador(admin)).toBe(false);
    expect(puedeSolicitarAltaCobrador(cobradorA)).toBe(false);
  });
});

describe("decisión 2 — anular pagos (doble registro)", () => {
  it("solo el admin anula directo", () => {
    expect(puedeAnularPagoDirecto(admin)).toBe(true);
    expect(puedeAnularPagoDirecto(supervisorA)).toBe(false);
    expect(puedeAnularPagoDirecto(cobradorA)).toBe(false);
  });

  it("el supervisor pide anular pagos de SU zona, no de otra", () => {
    expect(puedeSolicitarAnulacion(supervisorA, ZA)).toBe(true);
    expect(puedeSolicitarAnulacion(supervisorA, ZB)).toBe(false);
    expect(puedeSolicitarAnulacion(cobradorA, ZA)).toBe(false);
  });

  it("la confirmación exige OTRA persona distinta al que la pidió", () => {
    // el admin confirma la solicitud del supervisor
    expect(puedeConfirmarAnulacion(admin, supervisorA.usuarioId)).toBe(true);
    // nadie confirma su propia solicitud (aunque sea gestor)
    expect(puedeConfirmarAnulacion(supervisorA, supervisorA.usuarioId)).toBe(false);
    expect(puedeConfirmarAnulacion(admin, admin.usuarioId)).toBe(false);
    // un cobrador nunca confirma
    expect(puedeConfirmarAnulacion(cobradorA, supervisorA.usuarioId)).toBe(false);
  });
});

describe("decisión 4 — reasignar clientes", () => {
  it("cruzar zonas es solo del admin", () => {
    expect(puedeReasignarEntreZonas(admin)).toBe(true);
    expect(puedeReasignarEntreZonas(supervisorAB)).toBe(false);

    // admin puede mover A→B; el supervisor de A y B NO puede cruzar
    expect(puedeReasignarCliente(admin, ZA, ZB)).toBe(true);
    expect(puedeReasignarCliente(supervisorAB, ZA, ZB)).toBe(false);
  });

  it("el supervisor reasigna DENTRO de su zona (entre sus cobradores)", () => {
    expect(puedeReasignarCliente(supervisorA, ZA, ZA)).toBe(true);
    // dentro de una zona que NO supervisa: no
    expect(puedeReasignarCliente(supervisorA, ZB, ZB)).toBe(false);
    // el cobrador nunca reasigna
    expect(puedeReasignarCliente(cobradorA, ZA, ZA)).toBe(false);
  });
});

describe("aislamiento de ESCRITURA por zona (espejo RLS 0035)", () => {
  it("admin escribe en cualquier zona, incluso sin zona (null)", () => {
    expect(puedeEscribirEnZona(admin, ZA)).toBe(true);
    expect(puedeEscribirEnZona(admin, ZB)).toBe(true);
    expect(puedeEscribirEnZona(admin, null)).toBe(true);
  });

  it("supervisor de A escribe en A, NO en B (separación de deberes sobre dinero)", () => {
    expect(puedeEscribirEnZona(supervisorA, ZA)).toBe(true);
    expect(puedeEscribirEnZona(supervisorA, ZB)).toBe(false);
  });

  it("supervisor de A puede escribir sobre recurso sin zona (transición: cliente sin cobrador)", () => {
    expect(puedeEscribirEnZona(supervisorA, null)).toBe(true);
  });

  it("supervisor sin zonas NO escribe en ninguna (0148); supervisor AB en A y B", () => {
    expect(puedeEscribirEnZona(supervisorSinZonas, ZA)).toBe(false);
    expect(puedeEscribirEnZona(supervisorSinZonas, ZB)).toBe(false);
    expect(puedeEscribirEnZona(supervisorAB, ZA)).toBe(true);
    expect(puedeEscribirEnZona(supervisorAB, ZB)).toBe(true);
  });

  it("el cobrador NO pasa por la regla de zona (su escritura va por asignación)", () => {
    expect(puedeEscribirEnZona(cobradorA, ZA)).toBe(false);
    expect(puedeEscribirEnZona(cobradorA, null)).toBe(false);
  });
});

describe("capacidades varias", () => {
  it("la cartera la ven los gestores, no el cobrador", () => {
    expect(puedeVerCartera(admin)).toBe(true);
    expect(puedeVerCartera(supervisorA)).toBe(true);
    expect(puedeVerCartera(cobradorA)).toBe(false);
  });
});

describe("actorDesde", () => {
  it("mapea el usuario del sistema al actor puro", () => {
    const a = actorDesde({ rol: "cobrador", id: "x", zona_id: ZA });
    expect(a).toEqual({ rol: "cobrador", usuarioId: "x", zonaId: ZA, zonasSupervisadas: [] });

    const s = actorDesde({ rol: "supervisor", id: "s", zona_id: null }, [ZA, ZB]);
    expect(s.zonasSupervisadas).toEqual([ZA, ZB]);
  });
});
