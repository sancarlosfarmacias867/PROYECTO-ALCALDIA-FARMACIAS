import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "dist");

// La salida de Vercel contiene únicamente los archivos públicos del sistema.
if (existsSync(output)) rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const entry of ["index.html", "assets", "src"]) {
  cpSync(join(root, entry), join(output, entry), { recursive: true });
}

console.log("Sitio estático generado correctamente en dist/");
