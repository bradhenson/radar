// Scans the production build for external network references (plan rule 24,
// section 6.6). Fails the build if any http(s):// URL that is not a known
// documentation/namespace string appears in dist output.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = join(dirname(dirname(fileURLToPath(import.meta.url))), "dist");

// Namespace/spec identifiers that appear in bundled code but are never fetched.
const ALLOWED = [
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xhtml",
  "http://www.w3.org/1998/Math/MathML",
  "https://svelte.dev" // error-message help links embedded in dev warnings
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

let failures = [];
let checkedFiles = 0;

for (const file of walk(DIST)) {
  if (!/\.(html|js|css|svg|json|txt)$/i.test(file)) continue;
  checkedFiles++;
  const text = readFileSync(file, "utf8");
  const re = /https?:\/\/[^\s"'`<>\\)]+/g;
  for (const match of text.matchAll(re)) {
    const url = match[0].replace(/[",;]+$/, "");
    if (ALLOWED.some((a) => url.startsWith(a))) continue;
    failures.push(`${file}: ${url}`);
  }
  // Loading of external resources via link/script tags.
  for (const tag of text.matchAll(/<(script|link|img|iframe)[^>]+(src|href)=["'](?!\.|#|data:)[^"']*["']/gi)) {
    const t = tag[0];
    if (/href=["']\.?\//.test(t) || /src=["']\.?\//.test(t)) continue;
    failures.push(`${file}: suspicious tag ${t.slice(0, 120)}`);
  }
  // The release artifact is intentionally self-contained. Relative external
  // JavaScript/CSS references would pass the network scan yet fail under
  // file://, so reject them explicitly.
  if (/\.html?$/i.test(file)) {
    for (const tag of text.matchAll(/<(script\b[^>]*\bsrc|link\b(?=[^>]*\brel=["'][^"']*(?:stylesheet|modulepreload)[^"']*["'])[^>]*\bhref)=["'][^"']+["'][^>]*>/gi)) {
      failures.push(`${file}: non-inline executable or stylesheet reference ${tag[0].slice(0, 120)}`);
    }
  }
}

if (checkedFiles === 0) {
  console.error("verify-no-network: no files found in dist/. Run the build first.");
  process.exit(1);
}

if (failures.length > 0) {
  console.error("verify-no-network: FAILED. External references found:");
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}

console.log(`verify-no-network: OK (${checkedFiles} files checked, no external network references).`);
