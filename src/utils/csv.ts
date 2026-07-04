// Minimal CSV writer. All values are quoted and quotes doubled, so user
// text (including commas and newlines) round-trips safely.

export function toCsv(headers: string[], rows: (string | number | undefined)[][]): string {
  const escape = (v: string | number | undefined): string => {
    const s = v === undefined || v === null ? "" : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [headers.map(escape).join(",")];
  for (const row of rows) lines.push(row.map(escape).join(","));
  return lines.join("\r\n");
}
