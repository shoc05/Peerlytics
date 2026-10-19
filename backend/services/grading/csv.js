// CSV for the VLE (RFC 4180: comma-separated, CRLF line ends, fields with a comma, quote or
// line break are quoted and quotes doubled). Text that a spreadsheet would run as a formula
// (starting with = + - @, a tab or a carriage return) is prefixed with ' so a student's name
// can't become a formula in the lecturer's spreadsheet (CSV injection).

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value) {
  if (value == null) return '';
  // Numbers (including negative ones) are data, not formulas; only text is guarded.
  let s = String(value);
  if (typeof value === 'string' && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** columns: [{ header, value: (row) => any }] */
export function toCsv(rows, columns) {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
