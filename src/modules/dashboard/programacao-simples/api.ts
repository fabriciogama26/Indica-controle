import type {
  ActivityCatalogResponse,
  BatchCreateResponse,
  ProgrammingHistoryResponse,
  ProgrammingResponse,
  SaveProgrammingResponse,
  StageValidationResponse,
  StageValidationTeamSummary,
} from "./types";

async function readJson<T>(response: Response) {
  return (await response.json().catch(() => ({}))) as T;
}

function authHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

export async function fetchProgrammingSnapshot(params: {
  accessToken: string;
  startDate: string;
  endDate: string;
}) {
  const response = await fetch(
    `/api/programacao?startDate=${params.startDate}&endDate=${params.endDate}`,
    {
      cache: "no-store",
      headers: authHeaders(params.accessToken),
    },
  );

  const data = await readJson<ProgrammingResponse>(response);
  if (!response.ok) {
    throw new Error(data.message ?? "Falha ao carregar programacao.");
  }

  return data;
}

export async function fetchActivityCatalog(params: {
  accessToken: string;
  query: string;
  signal: AbortSignal;
}) {
  const response = await fetch(
    `/api/projects/activity-forecast/catalog?q=${encodeURIComponent(params.query)}`,
    {
      cache: "no-store",
      headers: authHeaders(params.accessToken),
      signal: params.signal,
    },
  );

  if (!response.ok) {
    return null;
  }

  return readJson<ActivityCatalogResponse>(response);
}

export async function fetchNextEtapaNumber(params: {
  accessToken: string;
  projectId: string;
  date: string;
  teamIds: string[];
  signal: AbortSignal;
}) {
  const query = new URLSearchParams({
    nextEtapaProjectId: params.projectId,
    nextEtapaDate: params.date,
    nextEtapaTeamIds: params.teamIds.join(","),
  });

  const response = await fetch(`/api/programacao?${query.toString()}`, {
    cache: "no-store",
    headers: authHeaders(params.accessToken),
    signal: params.signal,
  });

  const data = await readJson<ProgrammingResponse>(response);
  if (!response.ok || !data.nextEtapaNumber) {
    return null;
  }

  return data.nextEtapaNumber;
}

export async function validateProgrammingStageConflict(params: {
  accessToken: string;
  projectId: string;
  teamIds: string[];
  etapaNumber: number;
  excludeProgrammingId?: string | null;
  currentEditingStage?: number | null;
  currentEditingDate?: string | null;
  currentEditingTeamId?: string | null;
}): Promise<{
  enteredEtapaNumber: number;
  highestStage: number;
  teams: StageValidationTeamSummary[];
} | null> {
  const query = new URLSearchParams({
    etapaValidationProjectId: params.projectId,
    etapaValidationTeamIds: params.teamIds.join(","),
    etapaValidationNumber: String(params.etapaNumber),
  });

  if (params.excludeProgrammingId) {
    query.set("etapaValidationExcludeProgrammingId", params.excludeProgrammingId);
  }
  if (params.currentEditingStage) {
    query.set("etapaValidationCurrentStage", String(params.currentEditingStage));
  }
  if (params.currentEditingDate) {
    query.set("etapaValidationCurrentDate", params.currentEditingDate);
  }
  if (params.currentEditingTeamId) {
    query.set("etapaValidationCurrentTeamId", params.currentEditingTeamId);
  }

  const response = await fetch(`/api/programacao?${query.toString()}`, {
    cache: "no-store",
    headers: authHeaders(params.accessToken),
  });

  const data = await readJson<StageValidationResponse>(response);
  if (!response.ok) {
    throw new Error(data.message ?? "Falha ao validar a etapa da programacao.");
  }

  if (data.hasConflict && Array.isArray(data.teams) && data.teams.length) {
    return {
      enteredEtapaNumber: Number(data.enteredEtapaNumber ?? params.etapaNumber),
      highestStage: Number(data.highestStage ?? 0),
      teams: data.teams,
    };
  }

  return null;
}

export async function fetchProgrammingHistory(params: {
  accessToken: string;
  programmingId: string;
}) {
  const response = await fetch(
    `/api/programacao?historyProgrammingId=${encodeURIComponent(params.programmingId)}`,
    {
      cache: "no-store",
      headers: authHeaders(params.accessToken),
    },
  );

  const data = await readJson<ProgrammingHistoryResponse>(response);
  if (!response.ok) {
    throw new Error(data.message ?? "Falha ao carregar historico da programacao.");
  }

  return data;
}

export async function cancelProgramming(params: {
  accessToken: string;
  id: string;
  reason: string;
  expectedUpdatedAt: string;
}) {
  const response = await fetch("/api/programacao", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(params.accessToken),
    },
    body: JSON.stringify({
      id: params.id,
      action: "CANCELAR",
      reason: params.reason,
      expectedUpdatedAt: params.expectedUpdatedAt,
    }),
  });

  return {
    ok: response.ok,
    data: await readJson<SaveProgrammingResponse>(response),
  };
}

export async function postponeProgramming(params: {
  accessToken: string;
  id: string;
  reason: string;
  newDate: string;
  expectedUpdatedAt: string;
}) {
  const response = await fetch("/api/programacao", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(params.accessToken),
    },
    body: JSON.stringify({
      id: params.id,
      action: "ADIAR",
      reason: params.reason,
      newDate: params.newDate,
      expectedUpdatedAt: params.expectedUpdatedAt,
    }),
  });

  return {
    ok: response.ok,
    data: await readJson<SaveProgrammingResponse>(response),
  };
}

export async function saveProgrammingWorkCompletionStatus(params: {
  accessToken: string;
  id: string;
  workCompletionStatus: string;
  expectedUpdatedAt: string;
  reason?: string;
}) {
  const response = await fetch("/api/programacao", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(params.accessToken),
    },
    body: JSON.stringify({
      id: params.id,
      action: "SALVAR_ESTADO_TRABALHO",
      workCompletionStatus: params.workCompletionStatus,
      expectedUpdatedAt: params.expectedUpdatedAt,
      reason: params.reason,
    }),
  });

  return {
    status: response.status,
    ok: response.ok,
    data: await readJson<SaveProgrammingResponse>(response),
  };
}

export async function saveProgramming(params: {
  accessToken: string;
  isEditing: boolean;
  requestBody: string;
}) {
  const response = await fetch("/api/programacao", {
    method: params.isEditing ? "PUT" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(params.accessToken),
    },
    body: params.requestBody,
  });

  return {
    status: response.status,
    ok: response.ok,
    data: await readJson<BatchCreateResponse & SaveProgrammingResponse>(response),
  };
}
