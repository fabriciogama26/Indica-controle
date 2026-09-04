// Funcoes puras da tela de Medicao: formatacao de rotulos, normalizacao de
// texto/codigo e as buscas de opcao (atividade, projeto, equipe) usadas tanto
// pelo formulario quanto pelo cadastro em massa.
//
// Nao ha React aqui de proposito -- e a primeira fatia da modularizacao do
// `MeasurementPageView.tsx`, que segue acima do teto do CLAUDE.md.
import type {
  ActivityCatalogItem,
  EconomicWorkCompletionStatus,
  MeasurementKind,
  MeasurementStatus,
  ProgrammingMatchStatus,
  ProjectItem,
  RateSuggestionSource,
  TeamItem,
  WorkCompletionStatus,
} from "./types";

export function parsePositiveNumber(value: string | number) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Number(parsed.toFixed(6));
}

export function parseNonNegativeNumber(value: string | number) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Number(parsed.toFixed(6));
}

export function measurementKindLabel(value: MeasurementKind) {
  return value === "SEM_PRODUCAO" ? "Sem producao" : "Com producao";
}

export function rateSuggestionSourceLabel(source: RateSuggestionSource) {
  if (source === "ELECTRICAL_FIELD") return "Taxa vinculada ao ponto eletrico desta programacao.";
  if (source === "PREVIOUS_MEASUREMENT") return "Taxa sugerida com base na ultima medicao deste projeto.";
  return "Taxa em preenchimento manual.";
}

export function isMvaHourUnit(value: string) {
  const normalized = normalizeSearchText(value).replace(/\s+/g, "");
  return (
    normalized.includes("mva*hora")
    || normalized.includes("mva/hora")
    || normalized.includes("mvahora")
    || normalized.includes("mva*h")
  );
}

export function programmingMatchLabel(status: ProgrammingMatchStatus) {
  return status === "PROGRAMADA" ? "Programada" : "Nao programada";
}

export function normalizeWorkCompletionCodeToken(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

export function resolveEconomicWorkCompletionStatus(value: unknown): EconomicWorkCompletionStatus | null {
  const token = normalizeWorkCompletionCodeToken(value);
  if (
    token === "CONCLUIDO"
    || token === "COMPLETO"
    || token.startsWith("CONCLUIDO")
  ) {
    return "CONCLUIDO";
  }

  if (token === "PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO" || token === "PARCIAL_PLANEJADO_BENFICIO_ATINGIDO") {
    return "PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO";
  }

  if (token === "PARCIAL" || token.startsWith("PARCIAL")) {
    return "PARCIAL";
  }

  return null;
}

export function workCompletionStatusLabel(status: WorkCompletionStatus, labelMap: Map<string, string>) {
  if (!status) return "-";

  const economicStatus = resolveEconomicWorkCompletionStatus(status);
  if (economicStatus) {
    return labelMap.get(economicStatus) ?? economicStatus;
  }

  const normalized = String(status).trim().toUpperCase();
  return labelMap.get(normalized) ?? normalized;
}

export function formatHistoryActionLabel(action: string) {
  const normalized = String(action ?? "").toUpperCase();
  if (normalized === "CREATE") return "Cadastro";
  if (normalized === "UPDATE") return "Edicao";
  if (normalized === "CLOSE") return "Fechamento";
  if (normalized === "CANCEL") return "Cancelamento";
  if (normalized === "OPEN") return "Abertura";
  if (normalized === "UNCANCEL") return "Descancelamento";
  return normalized || "Atualizacao";
}

export function getOpenStatusActionLabel(status: MeasurementStatus | undefined) { return status === "CANCELADA" ? "Descancelar" : "Abrir"; }
export function getOpenStatusReasonLabel(status: MeasurementStatus | undefined) { return status === "CANCELADA" ? "descancelamento" : "reabertura"; }

export function formatHistoryValue(value: unknown) {
  if (value === null || value === undefined) return "-";
  const normalized = String(value).trim();
  return normalized || "-";
}

export function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function teamOptionLabel(team: TeamItem) { const teamName = String(team.name ?? "").trim(); const foremanName = String(team.foremanName ?? "").trim(); return foremanName && normalizeSearchText(foremanName) !== "nao identificado" ? `${teamName} / ${foremanName}` : teamName; }

export function normalizeCodeToken(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

export function normalizeCodeTokenLoose(value: string) {
  return normalizeCodeToken(value).replace(/o/g, "0");
}

export function normalizeMeasurementKindInput(value: string): MeasurementKind {
  const normalized = normalizeSearchText(value)
    .replace(/[^a-z0-9]/g, "");
  return normalized.includes("semproducao") ? "SEM_PRODUCAO" : "COM_PRODUCAO";
}

export function buildActivityLookupQueries(rawValue: string) {
  const input = String(rawValue ?? "").trim();
  if (!input) return [] as string[];

  const candidates = new Set<string>();
  candidates.add(input);

  const byPipe = input.split("|")[0]?.trim();
  if (byPipe) candidates.add(byPipe);

  const byDash = input.split("-")[0]?.trim();
  if (byDash) candidates.add(byDash);

  const codePart = input.split(/[|\-]/)[0]?.trim() ?? "";
  if (codePart) {
    const zeroToO = codePart.replace(/0/g, "O");
    const oToZero = codePart.replace(/[oO]/g, "0");
    if (zeroToO && zeroToO !== codePart) candidates.add(zeroToO);
    if (oToZero && oToZero !== codePart) candidates.add(oToZero);
  }

  const normalized = normalizeSearchText(input);
  if (normalized.includes(" - ")) {
    const codePart = normalized.split(" - ")[0]?.trim();
    if (codePart) candidates.add(codePart);
  }

  return Array.from(candidates).filter((item) => item.length >= 2);
}

export function activityOptionLabel(item: ActivityCatalogItem) {
  return `${item.code} - ${item.description}`;
}

export function buildImportCodeCandidates(rawValue: string) {
  const input = String(rawValue ?? "").trim();
  if (!input) return [] as string[];

  const candidates = new Set<string>();
  candidates.add(input);

  const byPipe = input.split("|")[0]?.trim();
  if (byPipe) candidates.add(byPipe);

  const byLabel = input.split(" - ")[0]?.trim();
  if (byLabel) candidates.add(byLabel);

  const bySpace = input.split(/\s+/)[0]?.trim();
  if (bySpace) candidates.add(bySpace);

  const byUnderscore = input.split("_")[0]?.trim();
  if (byUnderscore) candidates.add(byUnderscore);

  return Array.from(candidates)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

export function findActivityOptionByImportCode(value: string, options: ActivityCatalogItem[]) {
  const candidates = buildImportCodeCandidates(value);
  if (!candidates.length) return null;

  const normalizedCandidates = new Set(candidates.map((item) => normalizeSearchText(item)).filter(Boolean));
  const tokenCandidates = new Set(candidates.map((item) => normalizeCodeToken(item)).filter(Boolean));
  const looseTokenCandidates = new Set(candidates.map((item) => normalizeCodeTokenLoose(item)).filter(Boolean));

  const exactCodeMatches = options.filter((item) => normalizedCandidates.has(normalizeSearchText(item.code)));
  if (exactCodeMatches.length === 1) return exactCodeMatches[0];
  if (exactCodeMatches.length > 1) return null;

  const exactLabelMatches = options.filter((item) => normalizedCandidates.has(normalizeSearchText(activityOptionLabel(item))));
  if (exactLabelMatches.length === 1) return exactLabelMatches[0];
  if (exactLabelMatches.length > 1) return null;

  const exactTokenMatches = options.filter((item) => tokenCandidates.has(normalizeCodeToken(item.code)));
  if (exactTokenMatches.length === 1) return exactTokenMatches[0];
  if (exactTokenMatches.length > 1) return null;

  const exactLooseTokenMatches = options.filter((item) => looseTokenCandidates.has(normalizeCodeTokenLoose(item.code)));
  if (exactLooseTokenMatches.length === 1) return exactLooseTokenMatches[0];
  if (exactLooseTokenMatches.length > 1) return null;

  return null;
}

export function findActivityOption(value: string, options: ActivityCatalogItem[]) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return null;
  const codeCandidate = normalized.split("-")[0]?.trim();
  const codeCandidateToken = normalizeCodeToken(codeCandidate);
  const codeCandidateTokenLoose = normalizeCodeTokenLoose(codeCandidate);
  const exact = options.find((item) => {
    const codeToken = normalizeCodeToken(item.code);
    const codeTokenLoose = normalizeCodeTokenLoose(item.code);
    return (
      (codeCandidateToken && codeToken === codeCandidateToken)
      || (codeCandidateTokenLoose && codeTokenLoose === codeCandidateTokenLoose)
      || normalizeSearchText(item.code) === normalized
      || normalizeSearchText(activityOptionLabel(item)) === normalized
    );
  });

  if (exact) return exact;

  return options.find((item) => {
    const code = normalizeSearchText(item.code);
    const label = normalizeSearchText(activityOptionLabel(item));
    const codeToken = normalizeCodeToken(item.code);
    const codeTokenLoose = normalizeCodeTokenLoose(item.code);
    return (
      code === normalized
      || label === normalized
      || code === codeCandidate
      || normalized.startsWith(`${code} -`)
      || normalized.startsWith(`${code}|`)
      || (codeCandidateToken && (codeToken === codeCandidateToken || codeToken.startsWith(codeCandidateToken)))
      || (codeCandidateTokenLoose && (codeTokenLoose === codeCandidateTokenLoose || codeTokenLoose.startsWith(codeCandidateTokenLoose)))
      || label.includes(normalized)
    );
  }) ?? null;
}

export function findActivitySelectionOption(value: string, options: ActivityCatalogItem[]) {
  return findActivityOption(value, options) ?? findActivityOptionByImportCode(value, options);
}

export function findProjectOption(value: string, options: ProjectItem[]) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return null;

  return options.find((item) => normalizeSearchText(item.code) === normalized) ?? null;
}

export function findTeamOption(value: string, options: TeamItem[]) {
  const normalized = normalizeSearchText(value);
  const token = normalizeCodeToken(value);
  if (!normalized && !token) return null;

  const exactByName = options.find((item) => normalizeSearchText(item.name) === normalized);
  if (exactByName) return exactByName;
  if (token) {
    const exactByToken = options.find((item) => normalizeCodeToken(item.name) === token);
    if (exactByToken) return exactByToken;
  }
  return options.find((item) => item.id === value) ?? null;
}

