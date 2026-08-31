import {
  buildMassImportTemplateCsv,
  normalizeLookupText,
  readMassImportCsv,
  resolveCsvValue,
  type MassImportIssue,
} from "@/lib/utils/massImport";

export type ActivityImportRow = {
  rowNumber: number;
  code: string;
  codeIdd: string;
  description: string;
  teamTypeId: string;
  categoryId: string;
  groupId: string;
  value: number;
  voicePoint: number;
  unit: string;
  scope: string;
};

export type ActivityImportOption = {
  id: string;
  name: string;
};

const REQUIRED_HEADERS = ["codigo", "descricao", "tipo_equipe", "categoria", "grupo", "valor", "pontos", "unidade"];

export const ACTIVITY_MASS_IMPORT_COLUMNS_HINT =
  "Colunas obrigatorias: codigo, descricao, tipo_equipe, categoria, grupo, valor, pontos e unidade. Cod. SAP e alcance sao opcionais. Tipo e categoria devem existir no cadastro base do tenant.";

function normalizeText(value: string) {
  return String(value ?? "").trim();
}

function parseDecimal(value: string, minimum: "zero" | "positive") {
  const raw = normalizeText(value).replace(/\s+/g, "");
  if (!raw) {
    return null;
  }

  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  const decimalSeparator = lastComma > lastDot ? "," : lastDot > -1 ? "." : "";
  const normalized = decimalSeparator
    ? raw
        .replace(new RegExp(`\${decimalSeparator === "," ? "." : ","}`, "g"), "")
        .replace(decimalSeparator, ".")
    : raw;
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  if (minimum === "positive" ? parsed <= 0 : parsed < 0) {
    return null;
  }

  return Number(parsed.toFixed(minimum === "positive" ? 6 : 2));
}

export function buildActivityMassImportTemplateCsv() {
  return buildMassImportTemplateCsv(
    ["codigo", "cod_sap", "descricao", "tipo_equipe", "categoria", "grupo", "valor", "pontos", "unidade", "alcance"],
    [
      ["ATV-001", "SAP-1001", "Instalacao de poste", "LEVE", "REDE", "CONSTRUCAO", "150,00", "1", "un", "Poste ate 11m"],
      ["ATV-002", "", "Lancamento de cabo", "PESADA", "REDE", "CONSTRUCAO", "12,35", "0,5", "m", ""],
    ],
  );
}

export function parseActivityMassImportCsv(params: {
  content: string;
  fileName: string;
  teamTypes: ActivityImportOption[];
  categories: ActivityImportOption[];
  groups: ActivityImportOption[];
}) {
  const table = readMassImportCsv({
    content: params.content,
    fileName: params.fileName,
    requiredHeaders: REQUIRED_HEADERS,
  });
  const issues: MassImportIssue[] = [...table.issues];
  const rows: ActivityImportRow[] = [];
  const seenCodes = new Set<string>();
  const teamTypeByName = new Map(params.teamTypes.map((option) => [normalizeLookupText(option.name), option]));
  const categoryByName = new Map(params.categories.map((option) => [normalizeLookupText(option.name), option]));
  const groupByName = new Map(params.groups.map((option) => [normalizeLookupText(option.name), option]));

  for (const { rowNumber, values } of table.rows) {
    const code = normalizeText(resolveCsvValue(values, ["codigo", "cod", "code"])).toUpperCase();
    const codeIdd = normalizeText(resolveCsvValue(values, ["cod_sap", "codigo_sap", "code_idd", "cod_idd"]));
    const description = normalizeText(resolveCsvValue(values, ["descricao", "description"]));
    const teamTypeRaw = resolveCsvValue(values, ["tipo_equipe", "tipo", "team_type"]);
    const categoryRaw = resolveCsvValue(values, ["categoria", "category"]);
    const groupRaw = resolveCsvValue(values, ["grupo", "group"]);
    const valueRaw = resolveCsvValue(values, ["valor", "value"]);
    const voicePointRaw = resolveCsvValue(values, ["pontos", "ponto", "voice_point"]);
    const unit = normalizeText(resolveCsvValue(values, ["unidade", "unit", "umb"]));
    const scope = normalizeText(resolveCsvValue(values, ["alcance", "scope"]));
    const teamType = teamTypeByName.get(normalizeLookupText(teamTypeRaw)) ?? null;
    const category = categoryByName.get(normalizeLookupText(categoryRaw)) ?? null;
    const group = groupByName.get(normalizeLookupText(groupRaw)) ?? null;
    const value = parseDecimal(valueRaw, "zero");
    const voicePoint = parseDecimal(voicePointRaw, "positive");
    const issuesBefore = issues.length;

    if (!code) {
      issues.push({ rowNumber, column: "codigo", value: code, error: "Codigo obrigatorio." });
    } else if (seenCodes.has(code)) {
      issues.push({ rowNumber, column: "codigo", value: code, error: "Codigo duplicado no arquivo." });
    }

    if (!description) {
      issues.push({ rowNumber, column: "descricao", value: description, error: "Descricao obrigatoria." });
    }

    if (!teamType) {
      issues.push({ rowNumber, column: "tipo_equipe", value: teamTypeRaw, error: "Tipo de equipe invalido ou inativo." });
    }

    if (!category) {
      issues.push({ rowNumber, column: "categoria", value: categoryRaw, error: "Categoria invalida ou inativa." });
    }

    if (!group) {
      issues.push({ rowNumber, column: "grupo", value: groupRaw, error: "Grupo invalido ou inativo." });
    }

    if (value === null) {
      issues.push({ rowNumber, column: "valor", value: valueRaw, error: "Valor invalido. Informe numero maior ou igual a zero." });
    }

    if (voicePoint === null) {
      issues.push({ rowNumber, column: "pontos", value: voicePointRaw, error: "Pontos invalidos. Informe numero maior que zero." });
    }

    if (!unit) {
      issues.push({ rowNumber, column: "unidade", value: unit, error: "Unidade obrigatoria." });
    }

    if (code) {
      seenCodes.add(code);
    }

    if (issues.length === issuesBefore) {
      rows.push({
        rowNumber,
        code,
        codeIdd,
        description,
        teamTypeId: teamType?.id ?? "",
        categoryId: category?.id ?? "",
        groupId: group?.id ?? "",
        value: value ?? 0,
        voicePoint: voicePoint ?? 0,
        unit,
        scope,
      });
    }
  }

  return { rows, issues };
}
