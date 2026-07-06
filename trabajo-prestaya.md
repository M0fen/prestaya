# Presta Ya — Trabajo para Claude Code (correcciones críticas + cambios de Mauricio)

> Guardá este archivo en la raíz del repo y en Claude Code decí:
> "Leé `trabajo-prestaya.md` y ejecutalo por fases, empezando por la FASE 0.
> Esperá mi aprobación al terminar cada fase."
>
> Regla que rige todo (ya está en el SKILL del proyecto): **maneja dinero de
> ~4.000 personas.** Prioridad: corrección, trazabilidad y pruebas. Toda lógica
> nueva que toque dinero, estrellas o estados va con tests. No se toca la lógica
> financiera existente sin tests que la respalden.

---

## FASE 0 — CORRECCIONES CRÍTICAS (antes de cargar datos reales)

Resolvé esto primero. Nada sale a producción sin las cuatro.

### 0.1 — Modelo de IA del asesor
En `lib/asesor/prompt.ts` los modelos son `deepseek-chat` y `deepseek-reasoner`.
`deepseek-chat` puede estar deprecado. Verificá contra la documentación oficial
de DeepSeek el nombre de modelo vigente (familia V4 Flash) y actualizá las
constantes `MODELO_ASESOR` / `MODELO_ASESOR_PROFUNDO`. No inventes el nombre:
si no podés verificarlo, dejalo señalado en un TODO visible y avisame para que
yo confirme el string correcto.

### 0.2 — Acceso del cliente por token (seguridad)
Auditá TODAS las lecturas/escrituras de la vista de cliente (`app/c/[token]/…`)
y confirmá que cada consulta filtra por el `cliente_id` derivado del token, y que
la `SERVICE_ROLE_KEY` nunca se importa en código que llegue al navegador.
Agregá un test de seguridad que intente, con el token del cliente A, leer datos
del cliente B, y que DEBE fallar. Reportame qué encontraste antes de cambiar nada.

### 0.3 — Idempotencia de pagos
Existe `0006_idempotencia`. Verificá que un doble envío del mismo pago (cobrador
con mala señal que toca "cobrar" dos veces) NO cree dos registros. Escribí un
test que simule el doble envío y confirme un solo pago. Si el mecanismo no cubre
el caso, proponé la corrección antes de aplicarla.

### 0.4 — "Hoy" en horario de Uruguay (servidor)
Todo el cálculo de atraso/vencimiento depende de qué día es "hoy". Revisá
`lib/fecha.ts` y confirmá que "hoy" se calcula SIEMPRE en `America/Montevideo`
del lado del servidor, nunca con el reloj del dispositivo del cobrador. Agregá
un test que fije un instante cerca de medianoche UY y verifique el día correcto.

**Al terminar la Fase 0:** dame un resumen de qué estaba bien, qué corregiste y
qué quedó pendiente de mi confirmación (sobre todo 0.1).

---

## FASE 1 — RETIRAR LA MASCOTA

Mauricio decidió quitar la mascota/tamagotchi. Removela de forma limpia y completa,
reemplazándola por la nueva línea de comportamiento (Fase 3), que ocupa su lugar
emocional en la vista de cliente.

Archivos involucrados (identificados en el repo):
- `lib/mascota.ts`, `lib/mascota.test.ts`, `lib/data/mascota.ts`
- `components/mascota/MascotaTamagotchi.tsx`, `components/mascota/Criatura.tsx`
- `components/MascotaCliente.tsx`
- referencias en `lib/juegoCliente.ts`, `lib/juegoAjustes.ts`,
  `components/admin/FormAjustesJuego.tsx`, `components/VistaClienteScreen.tsx`,
  `app/c/[token]/page.tsx`, `app/c/[token]/actions.ts`, `app/admin/(panel)/juego/page.tsx`
- migración `0012_mascotas.sql` (tabla `mascotas`)

Instrucciones:
1. Primero mapeá TODAS las referencias a mascota y mostrame el plan de remoción
   antes de borrar (para no romper imports ni la vista de cliente).
2. Quitá los componentes y la lógica de mascota; dejá la vista de cliente
   funcionando sin ella.
3. Para la tabla `mascotas`: NO la borres con datos reales encima. Creá una
   migración nueva (`00XX_retiro_mascota.sql`) que la marque como obsoleta o la
   elimine solo si está vacía. En dev se puede dropear; en prod, cuidado.
4. Verificá que los tests siguen verdes tras la remoción.

---

## FASE 2 — SISTEMA DE ESTRELLAS (reemplaza el vínculo de la mascota)

Reglas de negocio EXACTAS (respetalas al pie):

- Cada vez que un cliente **paga**, gana **1 fragmento de estrella**.
- **5 fragmentos = 1 estrella completa.**
- Los fragmentos/estrellas se **acumulan indefinidamente** (sin tope de acumulación).
- Al **redimir**, se pueden cobrar **máximo 5 estrellas por ciclo** (definí "ciclo"
  conmigo: propongo "por crédito" o "por mes calendario" — preguntá antes de fijarlo).
- La redención la **aprueba/gestiona el admin** (el cliente solicita o acumula; el
  premio real lo entrega Mauricio). Definí conmigo si el cliente redime solo o pide.

Diseño técnico sugerido (proponémelo y ajustamos antes de codear):
1. Migración nueva con dos tablas:
   - `estrellas_saldo` (por cliente): fragmentos acumulados, estrellas disponibles,
     estrellas ya redimidas. O bien derivá fragmentos del conteo de pagos y guardá
     solo las redenciones — evaluá cuál es más a prueba de errores (es dinero-adyacente).
   - `estrellas_redenciones`: cada redención con cuántas estrellas, cuándo, quién la
     aprobó, en qué ciclo. Inmutable, con auditoría, como los pagos.
2. Núcleo PURO y testeable en `lib/estrellas.ts`: dado los pagos y las redenciones,
   calcula fragmentos, estrellas completas, disponibles para redimir y cuántas se
   pueden redimir en el ciclo actual (tope 5). SIN React, SIN IO.
3. Tests que cubran: 1 pago = 1 fragmento; 5 fragmentos = 1 estrella; acumulación
   sin tope; tope de 5 por ciclo; que un pago anulado NO regale un fragmento
   (clave: si se anula el pago, se revierte el fragmento).
4. Panel admin: ver saldo de estrellas por cliente y gestionar/aprobar redenciones.
5. Vista cliente: mostrar fragmentos (progreso a la próxima estrella) y estrellas.

Punto crítico a resolver en el diseño: **un fragmento vale por un pago VIGENTE.**
Si el pago se anula, el fragmento debe desaparecer. Atá los fragmentos a pagos no
anulados para que nunca haya estrellas "fantasma".

---

## FASE 3 — LÍNEA DE COMPORTAMIENTO CON CARITAS (vista de cliente)

Reemplaza visualmente a la mascota. Una línea/timeline del avance del crédito con
caritas según el comportamiento de pago:

- 🔴 **Roja (enojada):** crédito con atraso serio / deuda vencida.
- 🟠 **Naranja (medio molesta):** pendientes o atraso leve.
- 🟢 **Verde (feliz):** al día.

Instrucciones:
1. La lógica de qué carita corresponde debe DERIVAR del núcleo existente del cartón
   (`lib/cartones.ts`) y del estado de juego (`lib/juegoCliente.ts`), no inventar
   otra fuente de verdad. Definí los umbrales conmigo (cuántos días de atraso pasan
   de naranja a roja).
2. Núcleo puro en `lib/comportamiento.ts` + tests (al día → verde; con pendiente →
   naranja; atraso ≥ umbral → roja).
3. Componente de timeline en la vista de cliente que muestre la evolución (los
   últimos N días/cuotas con su carita), no solo el estado actual. Que se lea de un
   vistazo, para adultos mayores.

---

## FASE 4 — CONTROL DE PUBLICIDAD DE TEMPORADA (admin)

Ya existe la tabla `anuncios` (segmentable por fecha y estado) y campos de
`temporada` en `ajustes_juego`. Ampliá el CONTROL desde el admin:

1. Panel para que Mauricio/su esposa gestionen campañas de temporada sin tocar
   código: crear/editar/activar anuncios, programar por fechas, segmentar
   (todos / al día / con pendientes), ordenar por prioridad, subir imagen.
2. Que puedan definir la "temporada" visual del mes (nombre, emoji, meta, premio)
   desde el panel, no por SQL.
3. Vista previa de cómo se verá el anuncio en la pantalla del cliente antes de
   publicar.
4. Respetá lo que ya hay; extendé, no reescribas. Todo lo de temporada es
   promocional/simbólico (sin dinero real).

---

## FASE 5 — QUINIELA Y RASPADITAS (⚠️ SOLO PROMOCIONAL / SIN DINERO REAL)

**RESTRICCIÓN LEGAL INNEGOCIABLE:** en Uruguay la quiniela y los juegos de azar
por dinero están regulados por el Estado (Dirección de Loterías y Quinielas).
Estas features se construyen ESTRICTAMENTE como juegos promocionales:
- Se juega con **fragmentos de estrella o puntos**, NUNCA con dinero real.
- Los premios son **beneficios del préstamo** (descuento, mejor tasa, días de
  gracia) o estrellas, NUNCA dinero.
- No hay apuesta con plata ni pago de premio en efectivo.

Si en algún momento el diseño deriva hacia dinero real, PARÁ y avisame: eso
requiere licencia estatal y no se implementa. Dejá esta restricción escrita en
un comentario visible en el código de estas features.

### 5.1 — Quiniela promocional (manejo desde admin)
1. El admin abre una "quiniela" del período: define números/opciones, premio
   (en estrellas o beneficio), fecha de sorteo.
2. El cliente participa gastando fragmentos/estrellas o por estar al día (definí
   conmigo el mecanismo de entrada).
3. El admin registra el resultado; el sistema muestra ganadores. Todo auditable.
4. Núcleo de la lógica separado y testeado; sin dinero real en ninguna parte.

### 5.2 — Raspaditas ("raspados")
1. Un "raspado" digital que el cliente desbloquea con fragmentos o por pagar.
2. Premios simbólicos (estrellas, beneficios), con probabilidades DEFINIBLES desde
   el admin y auditables (no truqueadas en runtime).
3. Componente visual de raspar (interacción táctil) en la vista de cliente.
4. El resultado se decide en el SERVIDOR (no en el cliente, para que no se pueda
   manipular), y se registra.

---

## ORDEN Y MÉTODO

1. Fase 0 completa y confirmada por mí.
2. Fase 1 (retirar mascota) + Fase 3 (caritas) juntas, porque una reemplaza a la otra.
3. Fase 2 (estrellas): es la base de las Fases 4 y 5, hacela antes.
4. Fase 4 (publicidad de temporada).
5. Fase 5 (quiniela + raspaditas), solo tras confirmar el marco promocional.

En cada fase: proponé el diseño y esperá mi OK antes de codear lo que toca datos.
Mantené los 111 tests existentes en verde y sumá tests para todo lo nuevo que
toque dinero, estrellas o estados. No rompas la separación núcleo-puro / presentación
que ya tiene el proyecto.

## DECISIONES QUE TENÉS QUE PREGUNTARME ANTES DE FIJAR
- Definición de "ciclo" para el tope de 5 estrellas (¿por crédito? ¿por mes?).
- Si el cliente redime solo o solicita y el admin aprueba.
- Umbrales de días de atraso para naranja → roja en las caritas.
- Mecanismo de entrada a quiniela/raspaditas (gastar fragmentos vs. estar al día).
