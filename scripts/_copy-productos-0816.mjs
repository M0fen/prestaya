// Copy de FICHA para los 11 electro propios (16-08): párrafo de venta + viñetas
// de especificaciones (la ficha renderiza whitespace-pre-line). Sin claims de
// marca/modelo inventados: capacidades del nombre + beneficios reales del tipo
// de producto. Además desactiva el producto de PRUEBA "heladera" (sin foto,
// minúscula — reversible desde /admin/tienda).
// Uso: node --env-file=.env.local scripts/_copy-productos-0816.mjs
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const COPYS = {
  "Heladera No Frost 300L": `Basta de descongelar: la tecnología No Frost evita la escarcha y mantiene cada alimento en su punto, con espacio de sobra para las compras de toda la familia.

· 300 litros: freezer amplio abajo + heladera a la altura de la vista
· No Frost: nunca más descongelar a mano
· Bajo consumo, pensada para uso diario intenso
· Estantes regulables y cajón de verduras de gran capacidad`,

  'Smart TV 50" 4K UHD': `Cine en tu living: 50 pulgadas con resolución 4K real para que las películas, el fútbol y las series se vean con un detalle que sorprende, y con tus apps favoritas integradas.

· Pantalla 50" 4K UHD (4× la definición de un Full HD)
· Smart TV: Netflix, YouTube y más, directo con tu WiFi
· Marcos finos: toda la pantalla, nada de plástico
· Ideal para living o dormitorio grande`,

  "Lavarropas Automático 8kg": `Metés la ropa, elegís el programa y te olvidás: 8 kilos de capacidad para lavar las sábanas, los acolchados y la ropa de la semana en una sola tanda.

· 8 kg de carga frontal: familia entera en una lavada
· Múltiples programas: delicado, rápido, algodón y más
· Centrifugado potente: la ropa sale casi seca
· Eficiente en agua y en luz`,

  "Cocina a Gas 4 Hornallas": `La cocina de siempre, como debe ser: 4 hornallas con encendido automático y un horno parejo que no quema abajo ni deja crudo arriba.

· 4 hornallas con encendido automático (sin fósforos)
· Horno amplio con visor y luz interior
· Rejillas de hierro fundido firmes, para olla grande
· Válvula de seguridad en horno y hornallas`,

  "Aire Split 12.000 BTU Frío/Calor": `Verano e invierno resueltos con un solo equipo: 12.000 BTU que enfrían rápido los días de calor y calefaccionan parejo cuando baja la temperatura.

· 12.000 BTU frío/calor: para ambientes de hasta 25 m²
· Bajo consumo: enfría rápido y mantiene sin gastar de más
· Control remoto + timer para programarlo de noche
· Funcionamiento silencioso, ideal dormitorio`,

  "Microondas 20L": `El ayudante de todos los días: calentá, descongelá y cociná en minutos, con espacio justo para la mesada y potencia de sobra.

· 20 litros: entra el plato grande y la fuente mediana
· Varios niveles de potencia + descongelado por peso
· Panel simple: lo usa toda la familia
· Interior fácil de limpiar`,

  "Lavavajillas 12 Cubiertos": `El fin de la pila de platos: cargalo después de cenar y despertate con todo impecable, gastando menos agua que lavando a mano.

· Capacidad para 12 cubiertos: la vajilla de una familia
· Programas intensivo, normal y rápido
· Gasta hasta 3 veces menos agua que el lavado a mano
· Bandejas regulables para ollas y fuentes`,

  "Termotanque Eléctrico 50L": `Agua caliente segura y constante para toda la casa: 50 litros listos para la ducha, la cocina y el lavado, con la recuperación rápida que se agradece en invierno.

· 50 litros: ducha larga + cocina sin quedarte frío
· Recuperación rápida: vuelve a calentar en poco tiempo
· Termostato regulable y válvula de seguridad
· Instalación vertical de pared, no ocupa piso`,

  "Celular Smartphone 128GB": `Espacio para todo y batería para todo el día: 128GB para tus fotos, videos y apps sin andar borrando nada, con una cámara que saca fotos que dan ganas de compartir.

· 128GB de almacenamiento: miles de fotos y videos
· Batería para el día completo de uso real
· Cámara principal de alta resolución + selfie
· Pantalla grande y nítida, doble SIM`,

  'Notebook 15.6" Core i5': `Potencia para trabajar y estudiar sin esperas: procesador Core i5, pantalla grande de 15,6" y el equilibrio justo entre rendimiento y batería.

· Procesador Intel Core i5: fluida para todo uso
· Pantalla 15,6" de gran tamaño para trabajar cómodo
· Liviana y fina: va con vos a todos lados
· Ideal estudio, trabajo y entretenimiento`,

  'Ventilador de Pie 20"': `El clásico que salva el verano: 20 pulgadas de aspas que mueven aire de verdad, con la altura y la inclinación que necesites en cada rincón.

· Aspas de 20": caudal de aire para ambientes grandes
· 3 velocidades + oscilación automática
· Altura regulable y cabezal reclinable
· Base firme y estable, motor resistente`,
};

let ok = 0;
for (const [nombre, descripcion] of Object.entries(COPYS)) {
  const { data, error } = await db.from("productos").update({ descripcion }).eq("nombre", nombre).select("id");
  if (error) throw error;
  if (!data?.length) { console.log(`⚠️  no encontrado: ${nombre}`); continue; }
  ok++;
}
console.log(`✓ copy actualizado en ${ok}/11 productos`);

// El producto de PRUEBA "heladera" (minúscula, sin foto): desactivar (reversible).
const { data: junk, error: e2 } = await db.from("productos").update({ activo: false }).eq("nombre", "heladera").eq("activo", true).select("id");
if (e2) throw e2;
console.log(junk?.length ? "✓ producto de prueba 'heladera' desactivado" : "○ 'heladera' ya estaba inactivo");
