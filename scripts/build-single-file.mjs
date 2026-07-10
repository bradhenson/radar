// Post-build step: inline the bundled JS and CSS into dist/index.html so the
// application opens directly from a local file path (plan sections 8.3-8.5).
//
// Why: browsers refuse to fetch <script type="module" src="..."> over
// file:// (CORS on opaque origins), but an *inline* module script executes
// fine. Inlining makes both dist/index.html and the copied single files work
// when opened with no server.

import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const indexPath = join(dist, "index.html");

if (!existsSync(indexPath)) {
  console.error("build-single-file: dist/index.html not found. Run vite build first.");
  process.exit(1);
}

let html = readFileSync(indexPath, "utf8");
let inlinedScripts = 0;
let inlinedStyles = 0;

// Inline the JS bundle(s).
html = html.replace(
  /<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/g,
  (_m, rel) => {
    inlinedScripts++;
    const code = readFileSync(join(dist, rel), "utf8");
    return `<script type="module">\n${code}\n</script>`;
  }
);

// Inline the CSS bundle(s).
html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g, (_m, rel) => {
  inlinedStyles++;
  const css = readFileSync(join(dist, rel), "utf8");
  return `<style>\n${css}\n</style>`;
});

// Remove modulepreload hints (no longer needed once inlined).
html = html.replace(/<link rel="modulepreload"[^>]*>/g, "");

// Fail loudly when Vite's generated markup changes. A successful copy of an
// HTML file that still points at ./assets is not a valid file:// artifact.
if (inlinedScripts === 0 || inlinedStyles === 0) {
  console.error(`build-single-file: expected at least one JS and CSS asset (found ${inlinedScripts} JS, ${inlinedStyles} CSS).`);
  process.exit(1);
}
if (/<script\b[^>]*\bsrc=["'][^"']+["']/i.test(html)) {
  console.error("build-single-file: a script src remained after inlining.");
  process.exit(1);
}
if (/<link\b[^>]*\brel=["'][^"']*(?:stylesheet|modulepreload)[^"']*["'][^>]*>/i.test(html)) {
  console.error("build-single-file: a stylesheet or module-preload link remained after inlining.");
  process.exit(1);
}

writeFileSync(indexPath, html);
copyFileSync(indexPath, join(dist, "radar.html"));
copyFileSync(indexPath, join(dist, "supervisor-assistant.html"));

const kb = Math.round(Buffer.byteLength(html, "utf8") / 1024);
console.log(`build-single-file: OK. Inlined ${inlinedScripts} JS and ${inlinedStyles} CSS asset(s); dist/index.html, dist/radar.html, and legacy dist/supervisor-assistant.html are self-contained (${kb} KB).`);
