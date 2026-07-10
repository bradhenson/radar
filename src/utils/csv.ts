// Minimal CSV writer. All values are quoted and quotes doubled, so user
// text (including commas and newlines) round-trips safely. Text that a
// spreadsheet would interpret as a formula (=, +, -, @, or control-character
// prefixes) is neutralized with a leading apostrophe so opening an export in
// Excel/Calc cannot execute injected formulas (CSV injection).

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function toCsv(headers: string[], rows: (string | number | undefined)[][]): string {
  const escape = (v: string | number | undefined): string => {
    if (v === undefined || v === null) return '""';
    let s = String(v);
    // Numbers are trusted (a numeric -5 is data, not a formula); only
    // neutralize strings, where injected content could start a formula.
    if (typeof v === "string" && FORMULA_PREFIX.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [headers.map(escape).join(",")];
  for (const row of rows) lines.push(row.map(escape).join(","));
  return lines.join("\r\n");
}
