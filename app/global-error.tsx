"use client";
// Límite de error RAÍZ: solo entra si falla el propio layout raíz (raro). Reemplaza
// TODO el árbol, así que renderiza su propio <html>/<body> y NO puede depender de la
// hoja de estilos del layout → estilos inline. El 99% de los errores los toman los
// límites por-segmento (app/panel/cobrador/cliente); esta es la última red.
import { useEffect } from "react";
import { reportarError } from "@/lib/observabilidad";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportarError("boundary.global", error, { digest: error.digest });
  }, [error]);

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          background: "#F6F8FD",
          color: "#0F1B3D",
        }}
      >
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            padding: 24,
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 18,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(150deg,#2453DC,#13308C)",
              color: "#fff",
              fontSize: 26,
              fontWeight: 900,
            }}
          >
            P
          </div>
          <h1 style={{ margin: 0, fontSize: 19, fontWeight: 800 }}>No pudimos cargar la app</h1>
          <p style={{ margin: 0, maxWidth: 300, fontSize: 14, lineHeight: 1.5, color: "#6B7494" }}>
            Fue algo temporal. Probá de nuevo.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              border: 0,
              borderRadius: 999,
              background: "#2453DC",
              color: "#fff",
              padding: "10px 24px",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
