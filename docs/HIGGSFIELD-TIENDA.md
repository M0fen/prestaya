# Higgsfield × Tienda Presta Ya — el plan de imágenes

> La galería de la ficha YA soporta multi-foto + video + zoom + miniaturas
> (Embla) — está **hambrienta de contenido, no de código**: hoy los 53
> productos tienen UNA sola foto. Este documento es la receta completa para
> generar el paquete con Higgsfield y subirlo. Con 3 tomas por producto la
> ficha pasa a sentirse Mercado Libre de verdad.

## Reglas técnicas (para TODAS las imágenes)

| Regla | Valor | Por qué |
|---|---|---|
| Relación | **1:1 (cuadrada)**, 2048×2048 | la grilla, la galería y el zoom asumen cuadrado |
| Fondo | **blanco puro #FFFFFF** | el estándar ML/Amazon; la tarjeta pone su propio degradé |
| Sombra | de contacto, suave, abajo | "apoya" el producto; sin sombra flota raro |
| Margen | producto ocupa ~85% del lienzo | el `object-contain p-2` de la tarjeta ya da aire |
| Formato | PNG (el CDN lo convierte a WebP solo) | subimos calidad; `fotoTienda()` sirve la variante liviana |
| Texto/logos | **NUNCA texto ni marcas inventadas** en la imagen | evitar marcas de terceros: productos genéricos premium |

**Peso**: no importa que salgan pesadas — desde el 15-08 `fotoTienda()` sirve
todas las fotos por el CDN de transformación (800 KB → ~20 KB medido). Subí la
mejor calidad.

## Las 3 tomas por producto (en este orden en `fotos[]`)

1. **`-01` Frontal héroe** — producto de frente, centrado, fondo blanco.
   Es LA foto de la tarjeta (la primera del array manda en la grilla).
2. **`-02` Ángulo 3/4** — girado ~30°, muestra profundidad/lateral.
3. **`-03` Lifestyle** — el producto ambientado en un hogar uruguayo de clase
   trabajadora, luz cálida natural, sin personas reconocibles. Es la toma que
   vende el "cómo se ve en TU casa".

## Prompts listos (los 12 electro propios)

Base común (pegar antes de cada prompt):
> *Professional e-commerce product photography, pure white background #FFFFFF,
> soft contact shadow, studio lighting, centered, square 1:1, ultra sharp,
> no text, no logos, no watermark.*

Para la toma `-03` cambiar el fondo por:
> *…in a warm modest Uruguayan home interior, natural window light, cozy
> working-class household, no people.*

| Producto | Prompt específico (agregar a la base) |
|---|---|
| Heladera No Frost 300L | *modern stainless steel no-frost refrigerator, 300 liters, two doors, minimalist handle* |
| Smart TV 50" 4K UHD | *50 inch flat 4K smart TV, slim bezels, abstract blue wallpaper on screen, central stand* |
| Lavarropas Automático 8kg | *white front-load washing machine 8kg, chrome door ring, digital panel* |
| Cocina a Gas 4 Hornallas | *white 4-burner gas stove with oven, black grates, glass lid* |
| Aire Split 12.000 BTU | *white split air conditioner indoor unit, slim modern design* (lifestyle: montado alto en pared) |
| Microondas 20L | *compact silver microwave oven 20 liters, black door, digital keypad* |
| Lavavajillas 12 Cubiertos | *white freestanding dishwasher, front panel with controls* |
| Termotanque Eléctrico 50L | *white cylindrical electric water heater 50 liters, wall-mounted* |
| Celular Smartphone 128GB | *modern android smartphone, edge-to-edge screen with abstract gradient wallpaper, floating at slight angle* |
| Notebook 15.6" Core i5 | *slim silver laptop 15.6 inch, open at 110 degrees, abstract wallpaper* |
| Ventilador de Pie 20" | *black pedestal fan 20 inch, round base, three speed buttons* |
| (extra) Banner OG portada | **1200×630**: *hero banner: modern appliances collection (fridge, TV, washing machine) on deep royal blue gradient background (#2453DC to #13308C), product-focused, no text* → va como `og-tienda.png` (imagen al compartir /tienda por WhatsApp — hoy la portada no tiene) |

**Curbe (41 perfumes/oro)**: las fotos actuales son buenas. Sumarles solo la
toma `-03` lifestyle (frasco sobre mármol/tocador con luz dorada; joyas sobre
terciopelo oscuro) cuando haya tiempo — no es lo urgente.

## Cómo subirlas (5 minutos)

1. Nombrar: `<slug-producto>-01.png`, `-02`, `-03` (el slug como el actual:
   `01-heladera-no-frost-300l-01.png`…).
2. Supabase → Storage → bucket **tienda** → carpeta `productos/` → subir.
3. En `/admin/tienda`, editar el producto → agregar las URLs al campo fotos
   **en orden** (la `-01` primera: es la de la tarjeta).
   *(La fase siguiente del panel admin trae carga multi-foto con arrastre —
   mientras tanto es pegar 3 URLs.)*
4. Verificar en `/tienda/<id>`: la galería muestra puntos + miniaturas sola.

## Pendiente de datos (detectado en la barrida 15-08)

- El producto **"heladera"** (minúscula, sin foto, $3.200) parece una prueba:
  revisarlo en el panel y desactivarlo o completarlo.
- `video_url` existe y la galería lo reproduce: un clip corto de Higgsfield
  (producto girando 360°, 4-6 s, mismo fondo blanco) en 2-3 productos estrella
  sería el diferencial que ni ML tiene en este segmento.
