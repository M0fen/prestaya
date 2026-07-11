import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AccesibilidadControl } from "@/components/AccesibilidadControl";
import { RegistrarSW } from "@/components/pwa/RegistrarSW";
import { InstalarApp } from "@/components/pwa/InstalarApp";

// Inter es VARIABLE font: no fijamos `weight` (uso idiomático) → Next sirve el
// archivo variable y los pesos de Tailwind (font-bold, etc.) interpolan vía
// font-variation-settings. (El array de pesos era redundante: con o sin él el
// woff2 servido es el mismo archivo variable.)
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Presta Ya — Tu crédito diario",
  description: "Estado de cuenta de tu crédito de cobro diario.",
  applicationName: "Presta Ya",
  icons: {
    icon: "/icon.svg",
    apple: "/icons/apple-180.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Presta Ya",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#13308C",
  // Extiende el contenido bajo el notch/home-indicator; los headers y el
  // bottom-nav respetan el área segura con env(safe-area-inset-*). Mobile-first.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={inter.variable}>
      <body>
        {/* #app-zoom: objetivo del escalado de texto (accesibilidad). */}
        <div id="app-zoom">{children}</div>
        <AccesibilidadControl />
        {/* PWA: instalable + offline elegante (ver public/sw.js). */}
        <RegistrarSW />
        <InstalarApp />
      </body>
    </html>
  );
}
