export type CsvCell = unknown;
export type CsvRow = CsvCell[];

export function escapeCsvValue(value: CsvCell): string {
  const raw = String(value ?? "").replace(/\r?\n|\r/g, " ").trim();
  if (raw.includes(";") || raw.includes('"')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function buildCsvContent(headers: string[], rows: CsvRow[]): string {
  const lines = [headers, ...rows].map((line) =>
    line.map((cell) => escapeCsvValue(cell)).join(";"),
  );
  return "﻿" + lines.join("\n");
}

export function downloadCsvFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadBlobFile(content: Blob, filename: string): void {
  const url = URL.createObjectURL(content);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}