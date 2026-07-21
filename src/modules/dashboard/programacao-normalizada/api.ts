import type {
  ActionResponse,
  ActivityCatalogItem,
  HistoryResponse,
  MetaResponse,
  PlanResponse,
  SaveStageResponse,
  StageDetailsResponse,
  StageListFilters,
  StageListResponse,
} from "./types";

async function readJson<T>(response: Response) {
  return (await response.json().catch(() => ({}))) as T;
}

function authHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

export async function fetchProgrammingMeta(params: { accessToken: string }) {
  const response = await fetch("/api/programacao-normalizada/meta", {
    cache: "no-store",
    headers: authHeaders(params.accessToken),
  });

  const data = await readJson<MetaResponse>(response);
  if (!response.ok) {
    throw new Error(data.message ?? "Falha ao carregar catalogo de programacao.");
  }

  return data;
}

export async function fetchProgrammingPlan(params: { accessToken: string; projectId: string }) {
  const response = await fetch(`/api/programacao-normalizada?projectId=${encodeURIComponent(params.projectId)}`, {
    cache: "no-store",
    headers: authHeaders(params.accessToken),
  });

  const data = await readJson<PlanResponse>(response);
  if (!response.ok) {
    throw new Error(data.message ?? "Falha ao carregar o plano de programacao.");
  }

  return data.plan ?? [];
}

export async function fetchProgrammingStageList(params: {
  accessToken: string;
  filters: StageListFilters;
  page: number;
  pageSize: number;
  forExport?: boolean;
}) {
  const query = new URLSearchParams({
    dateFrom: params.filters.dateFrom,
    dateTo: params.filters.dateTo,
    statusChip: params.filters.statusChip,
    search: params.filters.search,
    municipality: params.filters.municipality,
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.filters.teamIds.length) {
    query.set("teamIds", params.filters.teamIds.join(","));
  }
  if (params.forExport) {
    query.set("forExport", "1");
  }

  const response = await fetch(`/api/programacao-normalizada?${query.toString()}`, {
    cache: "no-store",
    headers: authHeaders(params.accessToken),
  });

  const data = await readJson<StageListResponse>(response);
  if (!response.ok) {
    throw new Error(data.message ?? "Falha ao carregar a lista de programacoes.");
  }

  return data;
}

export async function fetchActivityCatalog(params: { accessToken: string; query: string; signal?: AbortSignal }) {
  const response = await fetch(`/api/projects/activity-forecast/catalog?q=${encodeURIComponent(params.query)}`, {
    cache: "no-store",
    headers: authHeaders(params.accessToken),
    signal: params.signal,
  });

  if (!response.ok) return [] as ActivityCatalogItem[];

  const data = await readJson<{ items?: ActivityCatalogItem[] }>(response);
  return data.items ?? [];
}

export async function fetchProgrammingStageDetails(params: { accessToken: string; programmingId: string }) {
  const response = await fetch(`/api/programacao-normalizada?programmingId=${encodeURIComponent(params.programmingId)}`, {
    cache: "no-store",
    headers: authHeaders(params.accessToken),
  });

  const data = await readJson<StageDetailsResponse>(response);
  if (!response.ok) {
    throw new Error(data.message ?? "Falha ao carregar detalhes da etapa.");
  }

  return data.stage ?? null;
}

export async function fetchProgrammingStageHistory(params: { accessToken: string; programmingId: string }) {
  const response = await fetch(`/api/programacao-normalizada?historyProgrammingId=${encodeURIComponent(params.programmingId)}`, {
    cache: "no-store",
    headers: authHeaders(params.accessToken),
  });

  const data = await readJson<HistoryResponse>(response);
  if (!response.ok) {
    throw new Error(data.message ?? "Falha ao carregar historico da etapa.");
  }

  return data.history ?? [];
}

export type SaveStageRequestBody = {
  projectId: string;
  executionDate: string;
  teamIds?: string[];
  programmingId?: string;
  expectedUpdatedAt?: string;
  serviceDescription?: string;
  period?: string;
  startTime?: string;
  endTime?: string;
  outageStartTime?: string;
  outageEndTime?: string;
  feeder?: string;
  campoEletrico?: string;
  affectedCustomers?: string;
  sgdTypeId?: string;
  electricalEqCatalogId?: string;
  support?: string;
  supportItemId?: string;
  posteQty?: string;
  estruturaQty?: string;
  trafoQty?: string;
  redeQty?: string;
  note?: string;
  historyReason?: string;
  isPendencia?: boolean;
  activities?: Array<{ catalogId: string; quantity: string }>;
  documents?: Record<string, { number?: string; includedAt?: string; deliveredAt?: string }>;
};

export async function saveProgrammingStage(params: {
  accessToken: string;
  isEditing: boolean;
  body: SaveStageRequestBody;
}) {
  const response = await fetch("/api/programacao-normalizada", {
    method: params.isEditing ? "PUT" : "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(params.accessToken) },
    body: JSON.stringify(params.body),
  });

  return { status: response.status, ok: response.ok, data: await readJson<SaveStageResponse>(response) };
}

export async function addProgrammingTeam(params: { accessToken: string; programmingId: string; teamId: string }) {
  const response = await fetch("/api/programacao-normalizada", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(params.accessToken) },
    body: JSON.stringify({ action: "ADD_TEAM", programmingId: params.programmingId, teamId: params.teamId }),
  });

  return { status: response.status, ok: response.ok, data: await readJson<SaveStageResponse>(response) };
}

export async function removeProgrammingTeam(params: { accessToken: string; programmingTeamId: string; expectedUpdatedAt: string }) {
  const response = await fetch("/api/programacao-normalizada", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(params.accessToken) },
    body: JSON.stringify({ action: "REMOVE_TEAM", programmingTeamId: params.programmingTeamId, expectedUpdatedAt: params.expectedUpdatedAt }),
  });

  return { status: response.status, ok: response.ok, data: await readJson<ActionResponse>(response) };
}

// newExecutionDate null = "deixar em espera" (ADIADA sem data); com data = remarcar.
export async function postponeProgrammingStage(params: {
  accessToken: string;
  programmingId: string;
  newExecutionDate: string | null;
  reason: string;
  expectedUpdatedAt: string;
}) {
  const response = await fetch("/api/programacao-normalizada", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(params.accessToken) },
    body: JSON.stringify({
      action: "POSTPONE",
      programmingId: params.programmingId,
      newExecutionDate: params.newExecutionDate,
      reason: params.reason,
      expectedUpdatedAt: params.expectedUpdatedAt,
    }),
  });

  return { status: response.status, ok: response.ok, data: await readJson<ActionResponse>(response) };
}

export async function setProgrammingPendenciaFlag(params: {
  accessToken: string;
  programmingId: string;
  isPendencia: boolean;
  expectedUpdatedAt: string;
}) {
  const response = await fetch("/api/programacao-normalizada", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(params.accessToken) },
    body: JSON.stringify({
      action: "SET_PENDENCIA",
      programmingId: params.programmingId,
      isPendencia: params.isPendencia,
      expectedUpdatedAt: params.expectedUpdatedAt,
    }),
  });

  return { status: response.status, ok: response.ok, data: await readJson<ActionResponse>(response) };
}

export async function cancelProgrammingStage(params: {
  accessToken: string;
  programmingId: string;
  reason: string;
  expectedUpdatedAt: string;
}) {
  const response = await fetch("/api/programacao-normalizada", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(params.accessToken) },
    body: JSON.stringify({
      action: "CANCEL",
      programmingId: params.programmingId,
      reason: params.reason,
      expectedUpdatedAt: params.expectedUpdatedAt,
    }),
  });

  return { status: response.status, ok: response.ok, data: await readJson<ActionResponse>(response) };
}

export async function completeProgrammingStage(params: { accessToken: string; programmingId: string; expectedUpdatedAt: string }) {
  const response = await fetch("/api/programacao-normalizada", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(params.accessToken) },
    body: JSON.stringify({ action: "COMPLETE", programmingId: params.programmingId, expectedUpdatedAt: params.expectedUpdatedAt }),
  });

  return { status: response.status, ok: response.ok, data: await readJson<ActionResponse>(response) };
}

export async function reopenProgrammingStage(params: { accessToken: string; programmingId: string; expectedUpdatedAt: string }) {
  const response = await fetch("/api/programacao-normalizada", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(params.accessToken) },
    body: JSON.stringify({ action: "REOPEN", programmingId: params.programmingId, expectedUpdatedAt: params.expectedUpdatedAt }),
  });

  return { status: response.status, ok: response.ok, data: await readJson<ActionResponse>(response) };
}

export async function setProgrammingWorkCompletionStatus(params: {
  accessToken: string;
  programmingId: string;
  workCompletionStatus: string | null;
  expectedUpdatedAt: string;
}) {
  const response = await fetch("/api/programacao-normalizada", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(params.accessToken) },
    body: JSON.stringify({
      action: "SET_WORK_COMPLETION_STATUS",
      programmingId: params.programmingId,
      workCompletionStatus: params.workCompletionStatus,
      expectedUpdatedAt: params.expectedUpdatedAt,
    }),
  });

  return { status: response.status, ok: response.ok, data: await readJson<ActionResponse>(response) };
}
