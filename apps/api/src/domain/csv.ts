/**
 * CSV for spreadsheets. Two things matter: a cell that starts with = + - @ (or a tab/CR) is read as a formula by Excel, so it is
 * prefixed with an apostrophe; and Excel only reads Arabic correctly when the file starts with a UTF-8 byte order mark.
 */
export const csvCell = (v: string | number | boolean | Date | null | undefined): string => {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export const toCsv = (header: string[], rows: (string | number | boolean | Date | null | undefined)[][]): string =>
  "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

/** Halalas as a plain decimal in riyals ("123.45"), so a spreadsheet can sum the column. */
export const riyals = (halalas: number): string => (halalas / 100).toFixed(2);
