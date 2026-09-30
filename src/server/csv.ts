/**
 * Minimal RFC-4180 CSV parse/stringify (no dependency). Handles quoted fields,
 * escaped quotes ("") and CR/LF inside quotes.
 */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else {
      field += c;
    }
  }
  // Flush the trailing field/row unless the input ended with a newline.
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Neutralise CSV formula injection: values starting with = + - @ (spec sanitise). */
function safeCell(value: unknown): string {
  let v = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(v)) v = "'" + v;
  if (/[",\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
  return v;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(safeCell).join(",")];
  for (const r of rows) lines.push(r.map(safeCell).join(","));
  return lines.join("\n") + "\n";
}
