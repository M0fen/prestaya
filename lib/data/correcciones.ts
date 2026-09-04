import "server-only";
// ─────────────────────────────────────────────────────────────────────────
//  ¿A ESTE CRÉDITO LE TOCARON LOS TÉRMINOS? — la marca que el cobrador necesita.
//
//  El 04-09 se corrigieron ocho créditos que habían nacido 'diario' siendo
//  SEMANALES (la "Nueva venta" no tenía selector de formato). La corrección
//  quedó asentada en el libro inmutable, como corresponde… y en ningún lado
//  visible. El cobrador que abre la ficha de uno de esos clientes ve un cartón
//  que hoy dice una cosa y la semana pasada decía otra, sin una línea que se lo
//  explique. Los ocho son semanales activos: son exactamente las fichas que se
//  abren en la calle.
//
//  ⚠️ LA TRAMPA, y por qué este módulo existe en vez de una consulta suelta en
//  la página: la policy de `auditoria` es `using (app_es_gestor())`. Leerla con
//  la sesión del COBRADOR devuelve CERO FILAS **sin error** — la consulta obvia
//  "funciona", no rompe ningún test, y en la calle no se ve nada nunca. Por eso
//  se lee con `createSupabaseAdmin()` (service_role), acotado a los créditos que
//  la página ya está mostrando.
//
//  Es solo LECTURA de metadatos (qué se corrigió y cuándo), no expone el libro:
//  se devuelve un texto corto por crédito, nada más.
// ─────────────────────────────────────────────────────────────────────────
import { createSupabaseAdmin } from "@/lib/supabase/admin";

/** Prefijo con el que los scripts de corrección firman en el libro. */
export const ACCION_CORRECCION = "Corrección administrativa";

export interface CorreccionCredito {
  /** Qué se corrigió, en criollo y corto (para un chip). */
  que: string;
  /** "YYYY-MM-DD" del día en que se hizo. */
  cuando: string;
}

/**
 * Devuelve, por crédito, la ÚLTIMA corrección administrativa que se le hizo.
 * `Map` vacío si no hubo ninguna (que es el caso normal).
 *
 * Una sola consulta para todos los créditos de la ficha: la página ya tuvo el
 * problema de las 250-370 consultas en serie y esto no puede sumar una por
 * crédito.
 */
export async function getCorreccionesDeCreditos(
  prestamoIds: string[],
): Promise<Map<string, CorreccionCredito>> {
  const out = new Map<string, CorreccionCredito>();
  const ids = [...new Set(prestamoIds.filter(Boolean))];
  if (ids.length === 0) return out;

  try {
    const { data, error } = await createSupabaseAdmin()
      .from("auditoria")
      .select("entidad_id, accion, detalle, creado_en")
      .eq("entidad", "prestamo")
      .in("entidad_id", ids)
      .like("accion", `${ACCION_CORRECCION}%`)
      .order("creado_en", { ascending: false });
    if (error) throw error;

    for (const fila of data ?? []) {
      const id = fila.entidad_id as string;
      // Ordenado desc: la primera que aparece de cada crédito es la última hecha.
      if (out.has(id)) continue;
      out.set(id, {
        que: resumirAccion(String(fila.accion ?? "")),
        cuando: String(fila.creado_en ?? "").slice(0, 10),
      });
    }
  } catch {
    // ⚠️ Best-effort A PROPÓSITO: esto es un cartelito informativo. Si el libro
    // no responde, la ficha tiene que seguir abriendo — el cobrador está parado
    // frente al cliente y lo que necesita es cobrar. Se pierde el chip, no la
    // pantalla. (Distinto de las consultas de PLATA, que sí tienen que tronar.)
  }
  return out;
}

/** "Corrección administrativa: formato de crédito" → "se corrigió el formato". */
function resumirAccion(accion: string): string {
  const cola = accion.slice(ACCION_CORRECCION.length).replace(/^:\s*/, "").toLowerCase();
  if (cola.includes("formato")) return "se corrigió el formato del crédito";
  if (cola.includes("pago duplicado") || cola.includes("duplicado")) return "se anuló un pago duplicado";
  return cola ? `se corrigió ${cola}` : "se corrigieron los términos";
}
