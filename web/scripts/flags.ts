// Copies the 4:3 flag SVGs out of flag-icons into public/flags so only that
// set ships, and only the flags actually shown are ever downloaded.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../node_modules/flag-icons/flags/4x3");
const dst = path.resolve(here, "../public/flags");
if (!existsSync(src)) {
  console.error("flag-icons is not installed; run bun install first");
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
let n = 0;
for (const f of readdirSync(src)) {
  if (f.endsWith(".svg")) {
    copyFileSync(path.join(src, f), path.join(dst, f));
    n++;
  }
}
console.log(`copied ${n} flags`);
