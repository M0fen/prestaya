// DEMO de la vista de cliente con datos mock (forma real de la BD).
// La vista real por link vive en app/c/[token]. Misma pantalla, distinto origen.
import {
  clienteMock,
  prestamoMock,
  pagosMock,
  HOY_DEMO,
} from "@/lib/mock/loanData";
import { NEGOCIO } from "@/lib/negocio";
import { construirVistaCliente } from "@/lib/vistaCliente";
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
    "¡Vamos al Mundial 2026! 🏆",
    "Jugá la tanda de penales y, si estás al día, participás del sorteo del mes.",
    "azul",
    30,
    "Jugar penales",
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

export default function Home() {
  const v = construirVistaCliente({
    cliente: clienteMock,
    prestamo: prestamoMock,
    pagos: pagosMock,
    negocio: NEGOCIO,
    hoy: HOY_DEMO,
  });

  return (
    <VistaClienteScreen
      v={v}
      anuncios={anunciosDemo}
      reputacion={{ calificacion: clienteMock.calificacion, creditosPagados: 2 }}
    />
  );
}
