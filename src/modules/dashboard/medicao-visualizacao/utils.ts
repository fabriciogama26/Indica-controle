import type { ActivityCatalogItem, Filters, ProjectItem } from "./types";

// Helpers de filtro espelhados de `src/modules/dashboard/medicao/MeasurementPageView.tsx`.
// A tela de consulta precisa casar codigo de projeto e de atividade exatamente como a
// tela de cadastro casa, senao o mesmo texto digitado produziria filtros diferentes nas
// duas telas e as extracoes divergiriam.

export function toIsoDate(value: Date) {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function monthRange(today: string) {
  const [year, month] = today.split("-");
  const lastDay = new Date(Number(year), Number(month), 0).getDate();
  return { startDate: `${year}-${month}-01`, endDate: `${year}-${month}-${String(lastDay).padStart(2, "0")}` };
}

export function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

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

export function normalizeWorkCompletionCodeToken(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

export function resolveEconomicWorkCompletionStatus(value: unknown) {
  const token = normalizeWorkCompletionCodeToken(value);
  if (token === "CONCLUIDO" || token === "COMPLETO" || token.startsWith("CONCLUIDO")) {
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

export function activityOptionLabel(item: ActivityCatalogItem) {
  return `${item.code} - ${item.description}`;
}

export function findProjectOption(value: string, options: ProjectItem[]) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return null;

  return options.find((item) => normalizeSearchText(item.code) === normalized) ?? null;
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

export function buildOrdersQuery(filters: Filters, page: number, pageSize: number) {
  const params = new URLSearchParams();
  params.set("startDate", filters.startDate);
  params.set("endDate", filters.endDate);
  params.set("status", filters.status);
  params.set("measurementKind", filters.measurementKind);
  params.set("programmingMatch", filters.programmingMatch);
  params.set("workCompletionStatus", filters.workCompletionStatus);
  params.set("completionAlert", filters.completionAlert);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.teamId) params.set("teamId", filters.teamId);
  if (filters.serviceTypeId) params.set("serviceTypeId", filters.serviceTypeId);
  if (filters.activityId) params.set("activityId", filters.activityId);
  if (filters.noProductionReasonId) params.set("noProductionReasonId", filters.noProductionReasonId);
  return params.toString();
}
