// Copia los assets heredados (no procesados por Vite) a dist/ de forma portable.
// Reemplaza el comando PowerShell del build para que funcione en cualquier SO.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");

const ASSETS = ["utils.js", "state.js", "ui.js", "charts.js", "app.js", "logo.png"];

if (!existsSync(dist)) mkdirSync(dist, { recursive: true });

let copied = 0;
for (const asset of ASSETS) {
  const from = join(root, asset);
  if (!existsSync(from)) {
    console.warn(`[copy-legacy-assets] omitido (no existe): ${asset}`);
    continue;
  }
  copyFileSync(from, join(dist, asset));
  copied += 1;
}

console.log(`[copy-legacy-assets] ${copied}/${ASSETS.length} archivos copiados a dist/`);
