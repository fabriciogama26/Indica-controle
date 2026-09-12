import {
  buildMassImportTemplateCsv,
  normalizeLookupText,
  readMassImportCsv,
  resolveCsvValue,
  type MassImportIssue,
} from "@/lib/utils/massImport";

import type { BlockedDateKind, BlockedDateMunicipalityOption, BlockedDateScope } from "./types";

export type BlockedDateImportRow = {
  rowNumber: number;
  blockedDate: string;
  description: string;
  scope: BlockedDateScope;
  municipalityId: string | null;
  kind: BlockedDateKind;
};

const REQUIRED_HEADERS = ["data", "descricao", "abrangencia"];

export const BLOCKED_DATE_MASS_IMPORT_COLUMNS_HINT =
  "Colunas obrigatorias: data, descricao e abrangencia. Data em DD/MM/AAAA ou AAAA-MM-DD. Abrangencia NACIONAL ou MUNICIPAL; em MUNICIPAL o municipio e obrigatorio e informado pelo nome exato cadastrado no tenant. Tipo e opcional (FERIADO, PONTO FACULTATIVO ou OUTRO) e assume FERIADO quando vazio. Cada linha cadastra uma data bloqueada ativa.";

function normalizeText(value: string) {
  return String(value ?? "").trim();
}

/**
 * Aceita `DD/MM/AAAA` e `AAAA-MM-DD` e devolve sempre ISO.
 *
 * O `Date` confirma o calendario porque `31/02/2027` casa com o formato mas nao
 * existe: sem essa checagem o JavaScript rolaria para 03/03 e o usuario
 * cadastraria uma data que nunca digitou.
 */
export function parseImportDate(value: string) {
  const raw = normalizeText(value);
  if (!raw) {
    return null;
  }

  let iso = "";
  const brMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (brMatch) {
    iso = `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    iso = raw;
  } else {
    return null;
  }

  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    return null;
  }

  return iso;
}

function parseImportScope(value: string): BlockedDateScope | null {
  const key = normalizeLookupText(value);
  if (key === "nacional") return "NACIONAL";
  if (key === "municipal") return "MUNICIPAL";
  return null;
}

// Vazio assume FERIADO, que e o caso esmagadoramente comum. `null` aqui e valor
// preenchido e INVALIDO, que precisa virar erro de linha.
function parseImportKind(value: string): BlockedDateKind | null {
  const key = normalizeLookupText(value);
  if (!key) return "FERIADO";
  if (key === "feriado") return "FERIADO";
  if (key === "ponto_facultativo") return "PONTO_FACULTATIVO";
  if (key === "outro") return "OUTRO";
  return null;
}

/**
 * Indexa os municipios pelo nome normalizado. `project_municipalities` ja e
 * unico por `(tenant_id, upper(btrim(name)))`, mas `normalizeLookupText` tambem
 * remove acento, entao `SAO PAULO` e `SÃO PAULO` colidem aqui — a linha e
 * recusada em vez de escolher um registro no escuro.
 */
function indexMunicipalitiesByName(municipalities: BlockedDateMunicipalityOption[]) {
  const index = new Map<string, BlockedDateMunicipalityOption | "AMBIGUOUS">();

  for (const municipality of municipalities) {
    const key = normalizeLookupText(municipality.name);
    if (!key) {
      continue;
    }
    index.set(key, index.has(key) ? "AMBIGUOUS" : municipality);
  }

  return index;
}

export function buildBlockedDateMassImportTemplateCsv() {
  return buildMassImportTemplateCsv(
    ["data", "descricao", "abrangencia", "municipio", "tipo"],
    [
      ["25/12/2026", "Natal", "NACIONAL", "", "FERIADO"],
      ["01/01/2027", "Confraternizacao Universal", "NACIONAL", "", "FERIADO"],
      ["20/01/2027", "Aniversario da cidade", "MUNICIPAL", "RIO DE JANEIRO", "FERIADO"],
    ],
  );
}

export function parseBlockedDateMassImportCsv(params: {
  content: string;
  fileName: string;
  municipalities: BlockedDateMunicipalityOption[];
}) {
  const table = readMassImportCsv({
    content: params.content,
    fileName: params.fileName,
    requiredHeaders: REQUIRED_HEADERS,
  });
  const issues: MassImportIssue[] = [...table.issues];
  const rows: BlockedDateImportRow[] = [];
  const municipalityByName = indexMunicipalitiesByName(params.municipalities);
  // Mesma chave dos dois indices unicos parciais da migration 424: a data se
  // repete entre abrangencias e entre municipios, so nao dentro da mesma.
  const seenKeys = new Set<string>();

  for (const { rowNumber, values } of table.rows) {
    const dateRaw = resolveCsvValue(values, ["data", "data_bloqueada", "blocked_date"]);
    const description = normalizeText(resolveCsvValue(values, ["descricao", "descricao_data", "description"]));
    const scopeRaw = resolveCsvValue(values, ["abrangencia", "escopo", "scope"]);
    const municipalityRaw = resolveCsvValue(values, ["municipio", "cidade", "municipality"]);
    const kindRaw = resolveCsvValue(values, ["tipo", "kind"]);

    const blockedDate = parseImportDate(dateRaw);
    const scope = parseImportScope(scopeRaw);
    const kind = parseImportKind(kindRaw);
    const municipality = normalizeText(municipalityRaw)
      ? municipalityByName.get(normalizeLookupText(municipalityRaw)) ?? null
      : null;
    const issuesBefore = issues.length;

    if (!blockedDate) {
      issues.push({
        rowNumber,
        column: "data",
        value: normalizeText(dateRaw),
        error: "Data invalida. Use DD/MM/AAAA ou AAAA-MM-DD.",
      });
    }

    if (!description) {
      issues.push({ rowNumber, column: "descricao", value: description, error: "Descricao obrigatoria." });
    }

    if (!scope) {
      issues.push({
        rowNumber,
        column: "abrangencia",
        value: normalizeText(scopeRaw),
        error: "Abrangencia invalida. Use NACIONAL ou MUNICIPAL.",
      });
    }

    if (!kind) {
      issues.push({
        rowNumber,
        column: "tipo",
        value: normalizeText(kindRaw),
        error: "Tipo invalido. Use FERIADO, PONTO FACULTATIVO ou OUTRO.",
      });
    }

    if (scope === "MUNICIPAL") {
      if (!normalizeText(municipalityRaw)) {
        issues.push({
          rowNumber,
          column: "municipio",
          value: "",
          error: "Municipio obrigatorio quando a abrangencia e MUNICIPAL.",
        });
      } else if (!municipality) {
        issues.push({
          rowNumber,
          column: "municipio",
          value: normalizeText(municipalityRaw),
          error: "Municipio invalido ou inativo.",
        });
      } else if (municipality === "AMBIGUOUS") {
        issues.push({
          rowNumber,
          column: "municipio",
          value: normalizeText(municipalityRaw),
          error: "Existe mais de um municipio com este nome.",
        });
      }
    }

    // NACIONAL com municipio preenchido nao e erro: o campo e ignorado, como no
    // formulario, que limpa o municipio ao trocar a abrangencia.
    const municipalityId = scope === "MUNICIPAL" && municipality && municipality !== "AMBIGUOUS" ? municipality.id : null;

    if (blockedDate && scope) {
      const key = `${blockedDate}|${scope}|${municipalityId ?? ""}`;
      if (seenKeys.has(key)) {
        issues.push({
          rowNumber,
          column: "data",
          value: normalizeText(dateRaw),
          error: "Data duplicada no arquivo para a mesma abrangencia.",
        });
      }
      seenKeys.add(key);
    }

    if (issues.length === issuesBefore && blockedDate && scope && kind) {
      rows.push({ rowNumber, blockedDate, description, scope, municipalityId, kind });
    }
  }

  return { rows, issues };
}
