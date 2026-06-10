import type {
  ActivityCatalogResponse,
  BatchCreateResponse,
  CopyProgrammingToDatesResponse,
  CopyProgrammingToDatesTarget,
  ProgrammingHistoryResponse,
  ProgrammingResponse,
  SaveProgrammingResponse,
  StageValidationResponse,
  StageValidationTeamSummary,
} from "./types";

async function readJson<T>(response: Response) {
  return (await response.json().catch(() => ({}))) as T;
}

async function readJsonWithStatus<T>(response: Response) {
  const responseText = await response.text();
  if (!responseText.trim()) {
    return { data: {} as T, parsed: false, responseText: "" };
  }

  try {
    return {
      data: JSON.parse(responseText) as T,
      parsed: true,
      responseText,
    };
  } catch {
    return {
      data: {} as T,
      parsed: false,
      responseText,
    };
  }
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

export async function copyProgrammingToDates(params: {
  accessToken: string;
  sourceProgrammingId: string;
  expectedUpdatedAt: string;
  targets: CopyProgrammingToDatesTarget[];
}) {
  const response = await fetch("/api/programacao", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(params.accessToken),
    },
    body: JSON.stringify({
      action: "COPY_TO_DATES",
      sourceProgrammingId: params.sourceProgrammingId,
      expectedUpdatedAt: params.expectedUpdatedAt,
      targets: params.targets,
    }),
  });

  return {
    status: response.status,
    ok: response.ok,
    data: await readJson<CopyProgrammingToDatesResponse>(response),
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
}): Promise<{
  status: number;
  ok: boolean;
  data: BatchCreateResponse & SaveProgrammingResponse;
}> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch("/api/programacao", {
      method: params.isEditing ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(params.accessToken),
      },
      body: params.requestBody,
      signal: controller.signal,
    });
    const parsedResponse = await readJsonWithStatus<BatchCreateResponse & SaveProgrammingResponse>(response);

    if (!parsedResponse.parsed) {
      return {
        status: response.status,
        ok: false,
        data: {
          reason: "INVALID_SERVER_RESPONSE",
          message: "O servidor respondeu em formato invalido. Verifique a conexao e tente novamente.",
          detail: parsedResponse.responseText.trim().slice(0, 500) || `Resposta HTTP ${response.status} sem conteudo JSON.`,
        } satisfies BatchCreateResponse & SaveProgrammingResponse,
      };
    }

    return {
      status: response.status,
      ok: response.ok,
      data: parsedResponse.data,
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      status: 0,
      ok: false,
      data: {
        reason: timedOut ? "REQUEST_TIMEOUT" : "NETWORK_ERROR",
        message: timedOut
          ? "A comunicacao com o servidor demorou mais de 30 segundos. Verifique a conexao e tente novamente."
          : "Nao foi possivel comunicar com o servidor. Verifique sua internet e tente novamente.",
        detail: error instanceof Error ? error.message : null,
      } satisfies BatchCreateResponse & SaveProgrammingResponse,
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}
