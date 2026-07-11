// Copies the built single-file frontend into desktop/dist so the Go embed
// in desktop/main.go can include it — go:embed cannot reference paths
// outside its module directory. Only index.html is copied; the radar.html /
// supervisor-assistant.html copies are identical and would triple the
// executable's embedded payload.

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "dist", "index.html");

if (!existsSync(source)) {
  console.error("copy-desktop-assets: dist/index.html not found. Run the main build first.");
  process.exit(1);
}

const targetDir = join(root, "desktop", "dist");
mkdirSync(targetDir, { recursive: true });
copyFileSync(source, join(targetDir, "index.html"));
console.log("copy-desktop-assets: OK. dist/index.html -> desktop/dist/index.html");
