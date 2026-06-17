---
name: presta-ya
description: Reglas de negocio y diseño de Presta Ya, app de préstamos
  de cobro diario. Usar SIEMPRE que se trabaje en la vista de cliente,
  app de cobrador o panel admin de este proyecto.
---

# Presta Ya — Reglas del proyecto

## Contexto
Plataforma digital de un prestamista de cobro diario en **Uruguay** con ~4.000
clientes. Tres interfaces que comparten la misma lógica: **vista de cliente**
(solo lectura, por link con token), **app de cobrador** y **panel de
administración**.

## Naturaleza crítica
Esta app maneja DINERO de terceros (préstamos de cobro diario, ~4.000
clientes). La lógica de cálculo de saldos y estados es crítica: un error
hace que el prestamista pierda plata o cobre de más a un deudor. Prioriza
corrección, claridad y **trazabilidad** sobre velocidad. Comenta toda lógica
financiera.
- **Nunca usar float para dinero:** siempre `numeric`/`decimal` en BD y manejo
  cuidadoso en TS.
- **Los pagos NO se borran ni se editan:** se anulan (`anulado = true`) con
  registro de quién y por qué. El libro de pagos es la verdad inmutable.

## Modelo del préstamo (regla única, idéntica en TODAS las interfaces)
- Cobro DIARIO de cuota fija. Un solo crédito activo por cliente.
- Cada día es una casilla con uno de estos estados:
  - PAGADO (verde #1FA971): el día tiene pago >= cuota diaria.
  - PENDIENTE (ámbar #E8A317): abono parcial (pago > 0 pero < cuota),
    o es el día de hoy aún sin completar.
  - ATRASADO (rojo #D64545): día vencido sin pago.
  - FUTURO (gris #EEF1F8): día que aún no vence.
- Abono parcial NO cuenta como día pagado: queda PENDIENTE.

## La lógica de estados es el núcleo
La función que calcula los estados de cada día debe vivir AISLADA de los
componentes visuales (su propio módulo, tipada en TypeScript, testeable).
Se reutiliza igual en cliente, cobrador y admin. Que un día "atrasado"
signifique lo mismo en las tres pantallas.

## El estado del cartón se CALCULA, no se guarda
La base guarda los **pagos** (verdad inmutable). El estado de cada casilla
(pagado/pendiente/atrasado/futuro) se **deriva** de los pagos en tiempo real.
Nunca guardar el estado de la casilla en la BD.

## Roles
- **admin** (Mauricio, dueño) · **supervisor** (su esposa) · **cobrador**.
- Cada rol ve cosas distintas. Un cobrador **solo** ve sus clientes asignados.
- Acceso por rol se aplicará con Row Level Security (RLS) en Supabase.

## Paleta (exacta)
- Azul rey principal: #1E47C8
- Azul rey oscuro: #13308C
- Fondo: #F6F8FD   | Tarjetas: #FFFFFF
- Verde pagado: #1FA971 | Ámbar pendiente: #E8A317 | Rojo atrasado: #D64545
- Texto principal: #0F1B3D | Texto secundario: #6B7494
- Tipografía: Inter.

## Stack
Next.js 15 (App Router) + TypeScript + Tailwind CSS. Mobile-first.
Base de datos y auth en **Supabase (PostgreSQL)**. Despliegue en **Vercel**.
La `SERVICE_ROLE_KEY` se usa SOLO en servidor (server components / route
handlers), NUNCA en el navegador. Hay un mock de la vista de cliente ya
portado; la capa real Supabase se monta sobre estos cimientos.

## Vista de cliente
Principalmente de lectura. Sin WhatsApp, sin mostrar el cobrador.
Pensada para adultos mayores: legible, números grandes, clara.
**Excepción de escritura:** el cliente PUEDE reportar una discrepancia
("falta un pago mío"). Es el único write y va por Server Action que valida el
token en el servidor (service_role); el navegador nunca toca Supabase. Sirve
como control anti-fraude: el cliente es testigo del libro de pagos.
Cada pago del historial muestra un **comprobante** (hora + sello "Registrado").

## Tono amable (psicología del pago — es una DEUDA)
La gente evita lo que da vergüenza o miedo → diseñar para que pagar se sienta
como AVANZAR hacia un logro, no como saldar una culpa.
- **Framing positivo:** destacar el progreso/meta antes que el monto adeudado.
  Mensaje de aliento arriba, anclado a identidad positiva ("vas excelente").
- **Celebración:** cuando está al día, reconocerlo (🎉) y mostrar la racha.
- **Sin culpa:** en la vista de cliente NO usar lenguaje ni color de alarma.
  - Estado de un día vencido sin pago: etiqueta **"Pendiente"** (no "No pagado")
    y color **rojo suave #E06A6A** (no el rojo fuerte #D64545).
  - Internamente el estado se sigue llamando `atrasado`; solo cambia cómo se
    MUESTRA al cliente. En cobrador/admin sí puede usarse el rojo fuerte.
- **Banner segmentable:** mensaje distinto para quien está al día vs con
  pendientes (aliento, no reproche).

## Espacio de juegos
Componente aislado tipo "slot", fácil de reemplazar cada mes.

## Cálculo de estados — detalle fiel (portado de renderVals)
La fecha de "hoy" sale del crédito (en prod: del servidor). Para cada día i (1..totalDias):
- fecha del día = fechaInicio + (i-1) días. `pagado` = suma de pagos de ese día.
- Orden de evaluación del estado (IMPORTANTE, respetar):
  1. fecha > hoy → FUTURO
  2. pagado >= cuotaDiaria → PAGADO
  3. pagado > 0 → PENDIENTE (abono parcial)
  4. es hoy → PENDIENTE (hoy nunca es atrasado aunque no haya pagado)
  5. en otro caso → ATRASADO
- Regla de oro: el día de HOY jamás se marca atrasado; solo los días PASADOS sin pago.

### Derivados que se muestran
- `totalPagado` = suma de todo lo abonado.
- `falta` = max(0, cuotaDiaria*totalDias - totalPagado).
- `progresoPct` = round(totalPagado / totalAPagar * 100).
- `estadoGeneral` = "Tienes pagos pendientes" si hay algún día ATRASADO o
  PENDIENTE; si no, "Estás al día". Punto: ámbar #FFC24B vs verde #34E0A1.
- Próxima cuota = primer día FUTURO. Relativo: Hoy / Mañana / "En N días".
- Historial = días con pago > 0, en orden INVERSO (más reciente primero).
  Chip verde si pagado, ámbar si abono parcial.

### Formato
- Moneda: `'$' + Math.round(n).toLocaleString('es-CO')` → ej. $600.000.
- Fechas en español: domingo..sábado, enero..diciembre.

## Modelo de datos (mock separado, mapea 1:1 a BD)
```
Cliente { nombre, inicial }
Negocio { nombre, direccion, telefono, horario }
Credito { montoPrestado, cuotaDiaria, totalDias, fechaInicio, fechaHoy }
Pago    { dia, fecha, monto }
Loan    { cliente, negocio, credito, pagos: Pago[] }
```
El componente NO contiene datos: solo consume el objeto Loan.

## Tokens de diseño extra (para fidelidad visual exacta)
- Fondo de página (fuera de la tarjeta): #EAEEF7. Tarjeta app interior: #F6F8FD.
- Azul gradiente claro: #2453DC. Texto deshabilitado/futuro: #9AA3BC.
- Gradiente tarjeta principal: `linear-gradient(150deg,#2453DC 0%,#1E47C8 45%,#13308C 100%)`.
- Barra progreso: `linear-gradient(90deg,#34E0A1,#1FA971)`.
- Radios: tarjetas 20–24px, celdas del cartón 14px, chips 999px.
- Sombras azuladas suaves (ej. tarjeta principal `0 16px 34px rgba(19,48,140,0.34)`).
- Resaltado HOY en el cartón: doble anillo `0 0 0 3px #FFFFFF, 0 0 0 6px <colorEstado>`.
- Números: `font-variant-numeric: tabular-nums` + letter-spacing negativo.
- Contenedor: máx 440px, centrado.

## Prohibido en el código portado
No usar etiquetas propietarias `<x-dc>`, `<sc-for>`, `<sc-if>`, `{{ }}` ni la
clase `DCLogic`: no son estándar. Solo React/TSX limpio.