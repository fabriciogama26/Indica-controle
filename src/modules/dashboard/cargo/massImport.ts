import {
  buildMassImportTemplateCsv,
  readMassImportCsv,
  resolveCsvValue,
  type MassImportIssue,
} from "@/lib/utils/massImport";

export type JobTitleImportRow = {
  rowNumber: number;
  code: string;
  name: string;
  types: string[];
  levels: string[];
};

const REQUIRED_HEADERS = ["codigo", "nome", "tipos"];

export const JOB_TITLE_MASS_IMPORT_COLUMNS_HINT =
  "Colunas obrigatorias: codigo, nome e tipos. Niveis e opcional. Use virgula para separar varios tipos ou niveis na mesma celula.";

function normalizeText(value: string) {
  return String(value ?? "").trim();
}

function normalizeCode(value: string) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function splitList(value: string) {
  return Array.from(
    new Map(
      normalizeText(value)
        .split(/\r?\n|,|\|/g)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => [item.toLocaleUpperCase("pt-BR"), item]),
    ).values(),
  );
}

export function buildJobTitleMassImportTemplateCsv() {
  return buildMassImportTemplateCsv(
    ["codigo", "nome", "tipos", "niveis"],
    [
      ["ENCARREGADO", "Encarregado", "ENCARREGADO", "I,II,III"],
      ["ELETRICISTA", "Eletricista", "ELETRICISTA,LINHA VIVA", "I,II"],
    ],
  );
}

export function parseJobTitleMassImportCsv(content: string, fileName: string) {
  const table = readMassImportCsv({ content, fileName, requiredHeaders: REQUIRED_HEADERS });
  const issues: MassImportIssue[] = [...table.issues];
  const rows: JobTitleImportRow[] = [];
  const seenCodes = new Set<string>();

  for (const { rowNumber, values } of table.rows) {
    const code = normalizeCode(resolveCsvValue(values, ["codigo", "cod", "code"]));
    const name = normalizeText(resolveCsvValue(values, ["nome", "name"]));
    const types = splitList(resolveCsvValue(values, ["tipos", "tipo", "types"]));
    const levels = splitList(resolveCsvValue(values, ["niveis", "nivel", "levels"]));
    const issuesBefore = issues.length;

    if (!code) {
      issues.push({ rowNumber, column: "codigo", value: code, error: "Codigo obrigatorio." });
    } else if (seenCodes.has(code)) {
      issues.push({ rowNumber, column: "codigo", value: code, error: "Codigo duplicado no arquivo." });
    }

    if (!name) {
      issues.push({ rowNumber, column: "nome", value: name, error: "Nome obrigatorio." });
    }

    if (!types.length) {
      issues.push({ rowNumber, column: "tipos", value: resolveCsvValue(values, ["tipos", "tipo", "types"]), error: "Informe ao menos um tipo." });
    }

    if (code) {
      seenCodes.add(code);
    }

    if (issues.length === issuesBefore) {
      rows.push({ rowNumber, code, name, types, levels });
    }
  }

  return { rows, issues };
}
