// Empaqueta la app compilada (dist/) en un único HTML autocontenido: dist/arken-diseno.html.
// Útil para abrir la aplicación sin servidor o publicarla como una sola página.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const html = readFileSync(join(dist, "index.html"), "utf8");
const js = html.match(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"><\/script>/);
const css = html.match(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)">/);
if (!js || !css) throw new Error("No se encontraron los recursos de dist/index.html; ejecuta primero npm run build");
const code = readFileSync(join(dist, js[1]), "utf8").replace(/<\/script/gi, "<\\/script");
const style = readFileSync(join(dist, css[1]), "utf8");
const body = html.match(/<body>([\s\S]*)<\/body>/)[1].trim();
const out = `<title>ARKEN DISEÑO</title>
<meta name="description" content="Editor BIM de ARKEN 360 con el proyecto Casa Lote 01 · Bosque de Agua">
<style>${style}</style>
${body}
<script type="module">${code}</script>
`;
writeFileSync(join(dist, "arken-diseno.html"), out);
console.log(`dist/arken-diseno.html (${(out.length / 1024).toFixed(0)} kB)`);
