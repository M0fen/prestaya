// Sonda de las rutas DEV (07-09): sin sesión no se ve nada, pero el CÓDIGO de
// estado dice si la ruta EXISTE en el build que sirve prod.
//   /api/dev/en-vivo      → 403 (existe y está cerrada); 404 = build viejo
//   /admin/en-vivo        → redirige a /ingresar (existe); 404 = build viejo
//   /admin/piloto         → idem
// Corre sin navegador:  node scripts/_probe-dev-0907.mjs
const BASE = process.env.BASE || "https://prestaya.uy";
const casos = [
  { path: "/api/dev/en-vivo", esperado: [403], de: "endpoint en vivo (cerrado sin sesion)" },
  { path: "/admin/en-vivo", esperado: [200, 302, 307, 308], de: "pantalla En vivo (redirige al login)" },
  { path: "/admin/piloto", esperado: [200, 302, 307, 308], de: "pantalla Panel del piloto (redirige al login)" },
];
let ok = true;
for (const c of casos) {
  const r = await fetch(`${BASE}${c.path}`, { redirect: "manual", cache: "no-store" });
  const bien = c.esperado.includes(r.status) && r.status !== 404;
  ok = ok && bien;
  console.log(`${bien ? "OK " : "MAL"} ${r.status} ${c.path}  ${c.de}${r.headers.get("location") ? " -> " + r.headers.get("location") : ""}`);
}
console.log(ok ? "RUTAS DEV DESPLEGADAS" : "FALTA: prod sirve un build sin estas rutas");
process.exit(ok ? 0 : 1);
