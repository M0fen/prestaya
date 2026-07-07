"use client";
// Mapa de calles NAVEGABLE (Leaflet + tiles de OpenStreetMap). Muestra cada
// cobro del día sobre calles reales: verde en zona, rojo fuera de zona, con la
// "fuga" punteada hasta el domicilio. Se carga lazy (solo al pedir esta vista),
// así la Vista rápida (SVG) sigue liviana y sin depender de la red.
//
// Usa circleMarker (vectorial) → no necesita los PNG de íconos de Leaflet, que
// suelen romperse con bundlers. Solo servidor: NO (es client, carga bajo demanda).
import { useEffect, useRef } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { PuntoCobro } from "@/lib/data/control";

export default function MapaCallesLeaflet({ puntos }: { puntos: PuntoCobro[] }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!contenedor.current || mapaRef.current) return;
    const mapa = L.map(contenedor.current, { scrollWheelZoom: true });
    mapaRef.current = mapa;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(mapa);

    const limites: L.LatLngExpression[] = [];
    for (const p of puntos) {
      const color = p.enZona === false ? "#E74C3C" : p.enZona === true ? "#2F9E63" : "#8A93AD";

      // Fuga: línea punteada del cobro al domicilio (si cobró fuera de zona).
      if (p.enZona === false && p.casaLat != null && p.casaLng != null) {
        L.polyline(
          [
            [p.lat, p.lng],
            [p.casaLat, p.casaLng],
          ],
          { color: "#E74C3C", weight: 2, dashArray: "4 6", opacity: 0.85 },
        ).addTo(mapa);
      }

      // Domicilio del cliente (aro gris).
      if (p.casaLat != null && p.casaLng != null) {
        L.circleMarker([p.casaLat, p.casaLng], { radius: 5, color: "#5B6478", weight: 2, fill: false })
          .addTo(mapa)
          .bindPopup(`🏠 Domicilio · ${p.clienteNombre}`);
        limites.push([p.casaLat, p.casaLng]);
      }

      // Cobro (punto de color).
      L.circleMarker([p.lat, p.lng], {
        radius: 7,
        color: "#fff",
        weight: 2,
        fillColor: color,
        fillOpacity: 0.9,
      })
        .addTo(mapa)
        .bindPopup(
          `${p.clienteNombre}${p.cobradorNombre ? " · " + p.cobradorNombre : ""}${
            p.enZona === false ? " · FUERA DE ZONA" : p.enZona === true ? " · en zona" : ""
          }`,
        );
      limites.push([p.lat, p.lng]);
    }

    if (limites.length > 0) mapa.fitBounds(L.latLngBounds(limites), { padding: [28, 28], maxZoom: 16 });
    else mapa.setView([-34.9011, -56.1645], 12); // Montevideo por defecto

    // Al montar dentro de un tab el contenedor puede medir 0px un instante.
    const t = setTimeout(() => mapa.invalidateSize(), 60);

    return () => {
      clearTimeout(t);
      mapa.remove();
      mapaRef.current = null;
    };
  }, [puntos]);

  return (
    <div
      ref={contenedor}
      className="aspect-[5/4] w-full overflow-hidden rounded-[14px] border border-[#DCE6F4]"
    />
  );
}
