// DEMO de la vista de cliente con datos mock (forma real de la BD).
// Sirve para MOSTRAR el producto sin una cuenta real. La vista real por link
// vive en app/c/[token]; la misma pantalla, distinto origen de datos.
import {
  clienteMock,
  prestamoMock,
  pagosMock,
  HOY_DEMO,
} from "@/lib/mock/loanData";
import { NEGOCIO } from "@/lib/negocio";
import { construirVistaCliente } from "@/lib/vistaCliente";
import { calcularJuegoCliente } from "@/lib/juegoCliente";
import { AJUSTES_JUEGO_DEFAULT, juegoArcadeDe } from "@/lib/juegoAjustes";
import { calcularEstrellas } from "@/lib/estrellas";
import { cicloUY } from "@/lib/fecha";
import { VistaClienteScreen } from "@/components/VistaClienteScreen";
import type { Anuncio } from "@/types/db";

// Anuncios de ejemplo para el demo (en producción vienen de Supabase).
// Muestran cómo el admin carga eventos y avisos para sus clientes.
function anuncioDemo(
  id: string,
  titulo: string,
  cuerpo: string,
  tema: Anuncio["tema"],
  prioridad: number,
  cta_texto: string | null = null,
): Anuncio {
  return {
    id,
    titulo,
    cuerpo,
    cta_texto,
    cta_url: cta_texto ? "#" : null,
    imagen_url: null,
    etiqueta: null,
    tema,
    prioridad,
    activo: true,
    segmento: "todos",
    fecha_inicio: "2026-06-01T00:00:00Z",
    fecha_fin: null,
    creado_por: null,
    creado_en: "2026-06-01T00:00:00Z",
    actualizado_en: "2026-06-01T00:00:00Z",
  };
}

const anunciosDemo: Anuncio[] = [
  anuncioDemo(
    "a1",
    "¡Sumá estrellas pagando! ⭐",
    "Cada pago suma. Cada 5 pagos ganás una estrella para canjear beneficios.",
    "azul",
    30,
    "Ver beneficios",
  ),
  anuncioDemo(
    "a2",
    "Feriado: cerramos el jueves 18/6 📅",
    "Ese día no pasa el cobrador. Podés adelantar tu cuota el miércoles.",
    "ambar",
    20,
  ),
  anuncioDemo(
    "a3",
    "Premio a tu constancia 🎁",
    "Pagá 10 días seguidos sin atrasos y accedé a un descuento en tu próximo crédito.",
    "verde",
    10,
    "Ver beneficios",
  ),
];

export default function DemoVistaCliente() {
  const v = construirVistaCliente({
    cliente: clienteMock,
    prestamo: prestamoMock,
    pagos: pagosMock,
    negocio: NEGOCIO,
    hoy: HOY_DEMO,
  });
  const ajustes = AJUSTES_JUEGO_DEFAULT;
  const juego = calcularJuegoCliente(prestamoMock, pagosMock, HOY_DEMO, {
    metaRacha: ajustes.metaRacha,
  });
  // Estrellas demo: 1 fragmento por pago vigente del mock.
  const estrellas = calcularEstrellas({
    pagosVigentes: pagosMock.length,
    redenciones: [],
    cicloActual: cicloUY(HOY_DEMO),
  });

  return (
    <VistaClienteScreen
      v={v}
      anuncios={anunciosDemo}
      reputacion={{ calificacion: clienteMock.calificacion, creditosPagados: 2 }}
      juego={juego}
      estrellas={estrellas}
      promo={{
        raspaDisponibles: 1,
        quiniela: {
          id: "demo", titulo: "Quiniela de julio", premioTexto: "1 día de gracia",
          rangoMin: 0, rangoMax: 99,
        },
        participacionNumero: null,
      }}
      juegoAjustes={{
        mensajeBienvenida: ajustes.mensajeBienvenida,
        premioMeta: ajustes.premioMeta,
        mostrarMisiones: ajustes.mostrarMisiones,
      }}
      juegoArcade={juegoArcadeDe(ajustes)}
      temporada={null}
    />
  );
}
