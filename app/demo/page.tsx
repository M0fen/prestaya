// DEMO de la vista de cliente con datos mock (forma real de la BD).
// Sirve para MOSTRAR el producto sin una cuenta real. La vista real por link
// vive en app/c/[token]; la misma pantalla, distinto origen de datos.
//
// La TIENDA sí es real: trae productos vivos (con su foto) del catálogo público
// para que se vea el banner de producto + el link a la tienda tal cual el cliente.
import {
  clienteMock,
  prestamoMock,
  pagosMock,
  HOY_DEMO,
} from "@/lib/mock/loanData";
import { NEGOCIO } from "@/lib/negocio";
import { construirVistaCliente } from "@/lib/vistaCliente";
import { VistaClienteScreen } from "@/components/VistaClienteScreen";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getProductosPublicos } from "@/lib/data/tienda";
import { conTimeout } from "@/lib/timeout";
import type { Anuncio } from "@/types/db";

// Trae productos reales → siempre datos frescos (no se prerenderiza estático).
export const dynamic = "force-dynamic";

// Anuncios de ejemplo para el demo (en producción vienen de Supabase). Son
// mensajes HONESTOS sobre lo nuestro (programa de puntos, la tienda, renovación).
// La tienda con imágenes de producto se muestra abajo con datos REALES.
function anuncioDemo(
  id: string,
  titulo: string,
  cuerpo: string,
  tema: Anuncio["tema"],
  prioridad: number,
  cta_texto: string | null = null,
  etiqueta: string | null = null,
): Anuncio {
  return {
    id,
    titulo,
    cuerpo,
    cta_texto,
    cta_url: cta_texto ? "#" : null,
    imagen_url: null,
    etiqueta,
    tema,
    prioridad,
    activo: true,
    segmento: "todos",
    segmento_def: null,
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
    "Todo en cuotas cómodas 🛍️",
    "Electrodomésticos, tecnología y más en tu tienda Presta Ya. Mirá el catálogo abajo.",
    "verde",
    20,
  ),
  anuncioDemo(
    "a3",
    "Renová y accedé a más 📈",
    "Al terminar tu crédito estando al día, podés pedir un monto mayor.",
    "oscuro",
    10,
  ),
];

export default async function DemoVistaCliente() {
  // Productos REALES de la tienda (con su foto) para mostrar la tienda de verdad
  // — nada inventado. Degrada a sin-tienda si la consulta falla (el demo igual anda).
  let productos: Awaited<ReturnType<typeof getProductosPublicos>> = [];
  try {
    const db = createSupabaseAdmin();
    productos = await conTimeout(getProductosPublicos(db), 8_000, "demo.tienda");
  } catch {
    productos = [];
  }
  // Destacamos un electro PROPIO con foto (o el primero con foto que haya).
  const destacado =
    productos.find((p) => !p.proveedor && p.destacado && p.fotos[0]) ??
    productos.find((p) => p.fotos[0]) ??
    null;

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
      hayTienda={productos.length > 0}
      productoDestacado={destacado}
      reputacion={{ calificacion: clienteMock.calificacion, creditosPagados: 2 }}
      promo={{
        raspaDisponibles: 1,
        quiniela: {
          id: "demo", titulo: "Quiniela de julio", premioTexto: "1 día de gracia",
          miNumero: 42, alDia: true, participando: false,
        },
      }}
    />
  );
}
