// Reportes — exportación de datos a CSV (Excel) y estado de cuenta en PDF.
// Solo gestores. Las descargas van por /api/reportes/<tipo> (protegido por rol).
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { RespaldoTotal } from "@/components/admin/RespaldoTotal";

export const dynamic = "force-dynamic";

// Botón de descarga (link con atributo download → el navegador baja el .csv).
function Descargar({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      download
      className="inline-flex items-center gap-1.5 btn-primario px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-[#1E47C8]"
    >
      <span aria-hidden>⤓</span>
      {children}
    </a>
  );
}

function Tarjeta({
  icono,
  titulo,
  desc,
  children,
}: {
  icono: string;
  titulo: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[16px] border border-borde bg-tarjeta p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[12px] bg-[#EEF3FF] text-[18px]">
          {icono}
        </div>
        <div className="flex flex-col">
          <span className="text-[15px] font-extrabold text-tinta">{titulo}</span>
          <span className="text-[12.5px] font-medium text-gris">{desc}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export default async function ReportesPage() {
  // Solo el dueño: exporta la operación completa (incluye datos financieros).
  await requireAdmin();

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Reportes</h1>
        <span className="text-[13px] font-medium text-gris">
          Descargá tus datos en Excel/CSV para tu contador, respaldo o análisis. Son tuyos.
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Tarjeta
          icono="👛"
          titulo="Cartera completa"
          desc="Todos los créditos activos con saldo, avance, atraso y cobrador."
        >
          <Descargar href="/api/reportes/cartera">Cartera (CSV)</Descargar>
        </Tarjeta>

        <Tarjeta
          icono="💵"
          titulo="Caja / movimientos"
          desc="Libro de cobros, gastos, desembolsos y retiros del período."
        >
          <Descargar href="/api/reportes/caja?periodo=hoy">Hoy</Descargar>
          <Descargar href="/api/reportes/caja?periodo=mes">Este mes</Descargar>
        </Tarjeta>

        <Tarjeta
          icono="⏰"
          titulo="Mora"
          desc="Clientes en riesgo con deuda vencida y recargo sugerido."
        >
          <Descargar href="/api/reportes/mora">Mora (CSV)</Descargar>
        </Tarjeta>

        <Tarjeta
          icono="📊"
          titulo="Comisiones por cobrador"
          desc="Recaudado, tasa y comisión a liquidar por período."
        >
          <Descargar href="/api/reportes/comisiones?periodo=semana">Semana</Descargar>
          {/* La cadencia OFICIAL de liquidación (08-05) — primero y a un toque. */}
          <Descargar href="/api/reportes/comisiones?periodo=quincena">Quincena</Descargar>
          <Descargar href="/api/reportes/comisiones?periodo=mes">Mes</Descargar>
          <Descargar href="/api/reportes/comisiones?periodo=anio">Año</Descargar>
        </Tarjeta>
      </div>

      <div className="flex flex-col gap-3 rounded-[16px] border border-borde bg-tarjeta p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[12px] bg-[#EEF3FF] text-[18px]">
            🧾
          </div>
          <div className="flex flex-col">
            <span className="text-[15px] font-extrabold text-tinta">Estado de cuenta de un cliente (PDF)</span>
            <span className="text-[12.5px] font-medium text-gris">
              Abrí la ficha de un cliente y tocá <b>“Estado de cuenta”</b>: se abre listo para
              imprimir o guardar como PDF (con todo el detalle de cuotas y pagos).
            </span>
          </div>
        </div>
        <div>
          <Link
            href="/admin/clientes"
            className="inline-flex items-center gap-1.5 rounded-full border border-borde px-3.5 py-2 text-[12.5px] font-bold text-azul hover:bg-suave"
          >
            Ir a clientes →
          </Link>
        </div>
      </div>

      {/* Respaldo total */}
      <div className="flex flex-col gap-3 rounded-[16px] border border-[#D6DEF5] bg-[#F7F9FF] p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[12px] bg-[#0F1B3D] text-[18px]">
            🗄️
          </div>
          <div className="flex flex-col">
            <span className="text-[15px] font-extrabold text-tinta">Respaldo completo</span>
            <span className="text-[12.5px] font-medium text-gris">
              Descargá TODO de un click: padrón de clientes, cartera, el <b>libro de pagos completo</b>,
              caja del mes, mora y comisiones. Tu copia de seguridad, cuando quieras.
            </span>
          </div>
        </div>
        <div>
          <RespaldoTotal />
        </div>
      </div>

      <p className="text-[11.5px] leading-[1.6] font-medium text-tenue">
        Los montos se exportan como números enteros (sin símbolo) para que puedas sumar y
        armar tablas dinámicas. El archivo abre directo en Excel o Google Sheets.
      </p>
    </div>
  );
}
