// File download helpers. Downloads are the canonical backup mechanism
// because the File System Access API may be unavailable (plan section 10).

export function downloadText(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadJson(filename: string, data: unknown): void {
  downloadText(filename, JSON.stringify(data, null, 2), "application/json");
}

export function backupFilename(prefix: string, ext: string): string {
  const now = new Date();
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}`;
  return `${prefix}_${stamp}.${ext}`;
}
