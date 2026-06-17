import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AccesibilidadControl } from "@/components/AccesibilidadControl";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Presta Ya — Tu crédito diario",
  description: "Estado de cuenta de tu crédito de cobro diario.",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
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
      </body>
    </html>
  );
}
