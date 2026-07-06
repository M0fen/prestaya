# Presta Ya — Raspadita profesional (para Claude Code)

> Guardá en el repo y decile a Claude Code: "Leé `raspadita-pro.md` y ejecutalo.
> Proponé el diseño del componente y esperá mi OK antes de integrarlo a la vista
> de cliente." Regla del proyecto vigente: el RESULTADO del premio lo decide el
> SERVIDOR; el raspado es solo la animación de revelar algo ya decidido.

## Objetivo
Reemplazar la raspadita actual (tap-to-revelar) por una raspadita realista que
se rasca con el dedo en pantalla, estéticamente profesional, que NO se abra con
un solo toque (hay que raspar de verdad). Mobile-first, para la vista de cliente.

## Técnica y librería
- Usá la técnica estándar: canvas HTML5 encima del premio, borrado con
  `globalCompositeOperation = "destination-out"` al mover el dedo.
- Librería base recomendada: **`scratchcard-js`** (npm, MIT, agnóstica de
  framework). Trae tipos de raspado, imagen de frente/fondo, medición de
  porcentaje (`getPercent()`) y callback `percentToFinish`.
- IMPORTANTE (Next.js 15 + React 19): NO uses wrappers de React de raspaditas
  de terceros (suelen estar abandonados y romper con React 19). Envolvé la
  librería base en un componente cliente propio (`"use client"`), o implementá
  el canvas a mano con la misma técnica si eso da más control. El componente es
  nuestro; no heredamos uno sin mantenimiento.

## Requisitos de "se siente profesional"
1. Capa a raspar con textura realista: gris metálico plateado con leve ruido/grano
   (no un color plano). Puede ser una imagen de textura o un patrón dibujado en canvas.
2. Pincel de borrado tipo yema de dedo: radio adecuado al touch, bordes suaves y
   levemente irregulares (no un círculo perfecto y duro).
3. Umbral de revelado ALTO: exigí raspar 55–65% antes de revelar del todo
   (`percentToFinish` ~60). Que no se abra de un toque.
4. Momento de recompensa: al completar, animación breve (brillo/escala/pop) sobre
   el premio revelado.
5. Táctil impecable en móvil: manejar `touchstart/move/end`, prevenir el scroll
   mientras se rasca, sin resaltado de tap. Que ande fluido en gama baja.
6. Accesible: fallback por si el canvas no carga, y que el premio siga siendo
   legible (números/íconos grandes, coherente con la vista de cliente).

## Seguridad del premio (innegociable)
- El premio se decide y registra en el SERVIDOR ANTES de mostrar la raspadita.
  El componente solo revela visualmente ese resultado ya definido.
- Nunca calcular el premio en el navegador ni exponer las probabilidades al
  cliente. Las probabilidades se administran desde el admin y viven en el servidor.
- Registrar cada raspadita jugada (quién, cuándo, resultado) para auditoría, igual
  que el resto del sistema.

## Integración
- Encajar en el flujo de estrellas/juegos ya existente (una raspadita se desbloquea
  por pago o gastando fragmentos, según se definió).
- Mantener la separación núcleo-puro / presentación del proyecto.
- Sumar tests de la lógica de servidor (asignación y registro del premio). El canvas
  visual no necesita test unitario, pero la decisión del premio SÍ.

## Método
1. Proponé el diseño del componente y cómo lo integrás, y esperá mi OK.
2. Implementá el componente cliente + la ruta/acción de servidor que decide el premio.
3. Mostrame cómo probarlo en móvil.
```
