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
import { reportarError } from "@/lib/observabilidad";

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
  } catch (e) {
    // ⚠️ Best-effort A PROPÓSITO: esto es un cartelito informativo. Si el libro
    // no responde, la ficha tiene que seguir abriendo — el cobrador está parado
    // frente al cliente y lo que necesita es cobrar. Se pierde el chip, no la
    // pantalla. (Distinto de las consultas de PLATA, que sí tienen que tronar.)
    //
    // Pero SE DEJA RASTRO. Un catch mudo acá esconde justo el fallo que importa:
    // si se pierde la service_role key en un deploy, la ficha abre perfecta, los
    // tests siguen en verde y el chip desaparece PARA SIEMPRE sin que nadie se
    // entere — la marca de corrección se apaga en silencio, que es exactamente
    // la clase de ceguera que este proyecto ya pagó cara.
    reportarError("getCorreccionesDeCreditos", e, { creditos: ids.length });
  }
  return out;
}

/**
 * "Corrección administrativa: formato de crédito" → "corrigió el formato".
 *
 * ⚠️ El texto se lee DESPUÉS de "La oficina", así que tiene que ser un verbo en
 * tercera persona: "La oficina corrigió el formato". Con el reflexivo salía
 * "La oficina se corrigió el formato", que es lo que 24 fichas activas le
 * mostraban al cobrador mientras le explicaba al cliente por qué le cambió el
 * cartón.
 *
 * ⚠️ Y NUNCA hace eco del texto del libro. Los asientos tienen 400+ caracteres
 * con montos, evidencia y responsable; volcarlos a un chip de la pantalla del
 * cobrador —leídos con service_role— es filtrar el libro por la ventana. Lo que
 * no se reconoce cae en una frase genérica.
 */
function resumirAccion(accion: string): string {
  const cola = accion.slice(ACCION_CORRECCION.length).replace(/^:\s*/, "").toLowerCase();
  if (cola.includes("formato")) return "corrigió el formato del crédito";
  if (cola.includes("duplicado")) return "anuló un pago duplicado";
  return "corrigió los términos de este crédito";
}
