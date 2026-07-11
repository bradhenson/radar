// File save helpers. In the browser, anchor downloads are the canonical
// backup mechanism because the File System Access API may be unavailable
// (plan section 10). Under the desktop (Wails) shell, saves route through a
// native save dialog instead (plan section 8.10).

import { wailsAppBindings } from "../data/wailsBridge";

/**
 * Save text content to a file. Resolves true when the file was saved (or the
 * browser download was handed off), false when the user cancelled a native
 * save dialog — callers must not treat a cancel as a completed export.
 */
export async function downloadText(filename: string, content: string, mimeType: string): Promise<boolean> {
  const desktop = wailsAppBindings();
  if (desktop) {
    const savedPath = await desktop.SaveTextFile(filename, content);
    return savedPath !== "";
  }
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

export async function downloadJson(filename: string, data: unknown): Promise<boolean> {
  return downloadText(filename, JSON.stringify(data, null, 2), "application/json");
}

export function backupFilename(prefix: string, ext: string): string {
  const now = new Date();
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}`;
  return `${prefix}_${stamp}.${ext}`;
}
