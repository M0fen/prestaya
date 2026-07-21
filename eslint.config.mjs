// Flat config (ESLint 9). Gate de CALIDAD que atrapa bugs reales (hooks, imports
// rotos, promesas sin await) sin imponer estilo — el ruido queda en "warn" y NO
// bloquea el build ni el deploy. Corre con `npm run lint`.
import next from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default [
  // Generados / no-fuente: support.js sale de dc-runtime (bundle), no se lintea.
  { ignores: [".next/**", "node_modules/**", "public/**", "scripts/**", "**/*.mjs", "supabase/**", "support.js", "dc-runtime/**"] },
  ...(Array.isArray(next) ? next : [next]),
  ...(Array.isArray(nextTs) ? nextTs : [nextTs]),
  {
    rules: {
      // Apóstrofes/comillas en texto ES (está, "…") no son bugs → off (era el 90% del ruido).
      "react/no-unescaped-entities": "off",
      // React Compiler (react-hooks v6): advisorios de patrones (setState-en-effect, pureza,
      // refs/immutability en render). Son ~22 pre-existentes que funcionan; se revisan con
      // calma en la adopción del compiler, no bloquean el gate → warn.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      // Descarga de CSV vía <a href="/api/reportes/…"> es correcta (no es nav de página) → warn.
      "@next/next/no-html-link-for-pages": "warn",
      // Ruido de tipos/estilo → warn (no bloquea el build ni el deploy).
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];
