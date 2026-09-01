import {
  buildMassImportTemplateCsv,
  readMassImportCsv,
  resolveCsvValue,
  type MassImportIssue,
} from "@/lib/utils/massImport";

export type ActivityCategoryImportRow = {
  rowNumber: number;
  name: string;
};

const REQUIRED_HEADERS = ["nome"];

export const ACTIVITY_CATEGORY_MASS_IMPORT_COLUMNS_HINT =
  "Coluna obrigatoria: nome. Cada linha cadastra uma categoria de atividade ativa para o tenant atual.";

function normalizeText(value: string) {
  return String(value ?? "").trim();
}

function normalizeComparableName(value: string) {
  return normalizeText(value).toLocaleUpperCase("pt-BR");
}

export function buildActivityCategoryMassImportTemplateCsv() {
  return buildMassImportTemplateCsv(
    ["nome"],
    [
      ["REDE"],
      ["MANUTENCAO"],
    ],
  );
}

export function parseActivityCategoryMassImportCsv(content: string, fileName: string) {
  const table = readMassImportCsv({ content, fileName, requiredHeaders: REQUIRED_HEADERS });
  const issues: MassImportIssue[] = [...table.issues];
  const rows: ActivityCategoryImportRow[] = [];
  const seenNames = new Set<string>();

  for (const { rowNumber, values } of table.rows) {
    const name = normalizeText(resolveCsvValue(values, ["nome", "name", "categoria"]));
    const comparableName = normalizeComparableName(name);
    const issuesBefore = issues.length;

    if (!name) {
      issues.push({ rowNumber, column: "nome", value: name, error: "Nome obrigatorio." });
    } else if (seenNames.has(comparableName)) {
      issues.push({ rowNumber, column: "nome", value: name, error: "Nome duplicado no arquivo." });
    }

    if (comparableName) {
      seenNames.add(comparableName);
    }

    if (issues.length === issuesBefore) {
      rows.push({ rowNumber, name });
    }
  }

  return { rows, issues };
}
