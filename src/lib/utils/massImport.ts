import { escapeCsvValue } from "./csv";
import { parseCsvRows } from "./parsers";

export type MassImportIssue = {
  rowNumber: number;
  column: string;
  value: string;
  error: string;
};

export type MassImportErrorReport = {
  fileName: string;
  content: string;
  errorRows: number;
  totalIssues: number;
};

export type MassImportResult = {
  status: "success" | "partial" | "error";
  message: string;
  successCount: number;
  errorRows: number;
};

export type MassImportRowResult = {
  rowNumber: number;
  success: boolean;
  message: string;
  code?: string;
};

export type MassImportCsvRow = {
  rowNumber: number;
  values: Record<string, string>;
};

export type MassImportCsvTable = {
  issues: MassImportIssue[];
  rows: MassImportCsvRow[];
};

function normalizeText(value: string) {
  return String(value ?? "").trim();
}

export function normalizeCsvHeader(value: string) {
  return normalizeText(value)
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeLookupText(value: string) {
  return normalizeCsvHeader(value);
}

export function resolveCsvValue(row: Record<string, string>, aliases: string[]) {
  for (const alias of aliases) {
    const value = row[alias];
    if (value !== undefined) {
      return value;
    }
  }

  return "";
}

/**
 * Le o CSV de cadastro em massa e devolve as linhas de dados ja indexadas pelo
 * cabecalho normalizado. Erros estruturais (arquivo vazio, coluna obrigatoria
 * ausente) voltam em `issues` e, nesse caso, `rows` vem vazio para o chamador
 * nao validar linha a linha um arquivo com cabecalho invalido.
 */
export function readMassImportCsv(params: {
  content: string;
  fileName: string;
  requiredHeaders: string[];
}): MassImportCsvTable {
  const issues: MassImportIssue[] = [];
  const records = parseCsvRows(params.content).filter((record) => record.some((value) => normalizeText(value)));

  if (records.length < 2) {
    issues.push({
      rowNumber: 1,
      column: "arquivo",
      value: params.fileName,
      error: "Arquivo CSV sem linhas de dados.",
    });
  }

  const headers = (records[0] ?? []).map(normalizeCsvHeader);
  for (const header of params.requiredHeaders) {
    if (!headers.includes(header)) {
      issues.push({
        rowNumber: 1,
        column: header,
        value: "",
        error: `Coluna obrigatoria ausente: ${header}.`,
      });
    }
  }

  if (issues.length) {
    return { issues, rows: [] };
  }

  const rows: MassImportCsvRow[] = [];
  for (let index = 1; index < records.length; index += 1) {
    const values = records[index] ?? [];
    rows.push({
      rowNumber: index + 1,
      values: headers.reduce<Record<string, string>>((accumulator, header, headerIndex) => {
        accumulator[header] = values[headerIndex] ?? "";
        return accumulator;
      }, {}),
    });
  }

  return { issues, rows };
}

export function buildMassImportTemplateCsv(headers: string[], sampleRows: string[][]) {
  const lines = [headers, ...sampleRows].map((line) => line.map((item) => escapeCsvValue(item)).join(";"));
  return `\uFEFF${lines.join("\n")}\n`;
}

export function createMassImportErrorReport(filePrefix: string, issues: MassImportIssue[]): MassImportErrorReport | null {
  if (!issues.length) {
    return null;
  }

  const header = ["linha", "coluna", "valor", "erro"];
  const rows = issues.map((issue) => [issue.rowNumber, issue.column, issue.value, issue.error]);
  const csvLines = [header, ...rows].map((line) => line.map((item) => escapeCsvValue(item)).join(";"));

  return {
    fileName: `${filePrefix}_erros_${new Date().toISOString().slice(0, 10)}.csv`,
    content: `\uFEFF${csvLines.join("\n")}`,
    errorRows: new Set(issues.map((issue) => issue.rowNumber)).size,
    totalIssues: issues.length,
  };
}
