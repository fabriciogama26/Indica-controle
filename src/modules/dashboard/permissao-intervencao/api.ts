import type {
  PiDetailResponse,
  PiHistoryEntry,
  PiListFilterState,
  PiListResponse,
  PiMetaResponse,
  PiMutationResponse,
  PiStageOption,
} from "./types";

/**
 * Chamadas da tela para `/api/permissao-intervencao`.
 *
 * Todas usam o mesmo `page_key` da tela: quem consegue abrir a tela consegue
 * executar todas as funcoes dela.
 */

const BASE_URL = "/api/permissao-intervencao";

function authHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

function jsonHeaders(accessToken: string): HeadersInit {
  return { ...authHeaders(accessToken), "Content-Type": "application/json" };
}

/** Erro que carrega o corpo da resposta, para a tela mostrar a lista de pendencias. */
export class PiRequestError extends Error {
  payload: PiMutationResponse;

  constructor(message: string, payload: PiMutationResponse) {
    super(message);
    this.name = "PiRequestError";
    this.payload = payload;
  }
}

async function parseOrThrow(response: Response, fallback: string): Promise<PiMutationResponse> {
  const data = (await response.json().catch(() => ({}))) as PiMutationResponse;
  if (!response.ok) throw new PiRequestError(data.message ?? fallback, data);
  return data;
}

export async function fetchPiMeta(accessToken: string): Promise<PiMetaResponse> {
  const response = await fetch(`${BASE_URL}/meta`, { cache: "no-store", headers: authHeaders(accessToken) });
  const data = (await response.json().catch(() => ({}))) as PiMetaResponse;
  if (!response.ok) throw new Error(data.message ?? "Falha ao carregar os catalogos da PI.");
  return data;
}

export async function fetchPiList(
  accessToken: string,
  filters: PiListFilterState,
  page: number,
  pageSize: number,
): Promise<PiListResponse> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (filters.linkStatus) params.set("linkStatus", filters.linkStatus);
  if (filters.operationArea) params.set("operationArea", filters.operationArea);
  if (filters.voltageLevel) params.set("voltageLevel", filters.voltageLevel);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);

  const response = await fetch(`${BASE_URL}?${params.toString()}`, {
    cache: "no-store",
    headers: authHeaders(accessToken),
  });
  const data = (await response.json().catch(() => ({}))) as PiListResponse;
  if (!response.ok) throw new Error(data.message ?? "Falha ao carregar as Permissoes de Intervencao.");
  return data;
}

/** Etapas do projeto para o fluxo `Criar a partir da Programacao`. */
export async function fetchProgrammingStages(accessToken: string, projectId: string): Promise<PiStageOption[]> {
  const response = await fetch(`${BASE_URL}/programacoes?projectId=${encodeURIComponent(projectId)}`, {
    cache: "no-store",
    headers: authHeaders(accessToken),
  });
  const data = (await response.json().catch(() => ({}))) as { items?: PiStageOption[]; message?: string };
  if (!response.ok) throw new Error(data.message ?? "Falha ao carregar as etapas da Programacao.");
  return data.items ?? [];
}

export type CreatePiInput = {
  projectId: string;
  workDate: string;
  creationSource: "FROM_PROGRAMMING" | "MANUAL";
  /** Campos herdados da etapa escolhida. A PI nasce com eles e permanece editavel. */
  inherited?: Record<string, unknown>;
};

export async function createPi(accessToken: string, input: CreatePiInput): Promise<PiMutationResponse> {
  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({
      data: {
        projectId: input.projectId,
        workDate: input.workDate,
        creationSource: input.creationSource,
        ...(input.inherited ?? {}),
      },
    }),
  });
  return parseOrThrow(response, "Falha ao criar a PI.");
}

export async function changePiStatus(
  accessToken: string,
  piId: string,
  action: "READY" | "REOPEN" | "ISSUE" | "CANCEL",
  expectedUpdatedAt: string,
  reason?: string,
): Promise<PiMutationResponse> {
  const response = await fetch(`${BASE_URL}/${piId}/status`, {
    method: "POST",
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ action, reason: reason ?? null, expectedUpdatedAt }),
  });
  return parseOrThrow(response, "Falha ao alterar o status da PI.");
}

export async function linkPiToProgramming(
  accessToken: string,
  piId: string,
  expectedUpdatedAt: string,
  programmingId?: string | null,
  reason?: string,
): Promise<PiMutationResponse> {
  const response = await fetch(`${BASE_URL}/${piId}/vinculo`, {
    method: "POST",
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ programmingId: programmingId ?? null, reason: reason ?? null, expectedUpdatedAt }),
  });
  return parseOrThrow(response, "Falha ao vincular a PI a Programacao.");
}

export async function fetchPiDetail(accessToken: string, piId: string): Promise<PiDetailResponse> {
  const response = await fetch(`${BASE_URL}/${piId}`, { cache: "no-store", headers: authHeaders(accessToken) });
  const data = (await response.json().catch(() => ({}))) as PiDetailResponse;
  if (!response.ok) throw new Error(data.message ?? "Falha ao carregar a PI.");
  return data;
}

export async function fetchPiHistory(accessToken: string, piId: string): Promise<PiHistoryEntry[]> {
  const response = await fetch(`${BASE_URL}/${piId}/historico`, {
    cache: "no-store",
    headers: authHeaders(accessToken),
  });
  const data = (await response.json().catch(() => ({}))) as { items?: PiHistoryEntry[]; message?: string };
  if (!response.ok) throw new Error(data.message ?? "Falha ao carregar o historico.");
  return data.items ?? [];
}

/**
 * Salva a PI.
 *
 * O payload e o conjunto COMPLETO dos campos editaveis: o backend trata chave
 * ausente como nulo, e nao como "nao mexer". Enviar o objeto inteiro e o que
 * torna possivel limpar um campo.
 */
export async function savePi(
  accessToken: string,
  piId: string,
  expectedUpdatedAt: string,
  data: Record<string, unknown>,
): Promise<PiMutationResponse> {
  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ piId, expectedUpdatedAt, data }),
  });
  return parseOrThrow(response, "Falha ao salvar a PI.");
}

export async function savePiExecutionPlan(
  accessToken: string,
  piId: string,
  expectedUpdatedAt: string,
  steps: unknown[],
): Promise<PiMutationResponse> {
  const response = await fetch(`${BASE_URL}/${piId}/plano`, {
    method: "PUT",
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ expectedUpdatedAt, steps }),
  });
  return parseOrThrow(response, "Falha ao salvar o Plano de Execucao.");
}

/**
 * Baixa o DOCX oficial de uma PI emitida.
 *
 * A resposta e binaria no caminho feliz e JSON no erro, entao o `response.ok`
 * decide como ler. Devolve o Blob para quem chama disparar o download.
 */
export async function downloadPiDocument(
  accessToken: string,
  piId: string,
): Promise<{ blob: Blob; fileName: string }> {
  const response = await fetch(`${BASE_URL}/${piId}/documento`, {
    cache: "no-store",
    headers: authHeaders(accessToken),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as PiMutationResponse;
    throw new PiRequestError(data.message ?? "Falha ao gerar o documento da PI.", data);
  }

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  return { blob: await response.blob(), fileName: match?.[1] ?? "PI.docx" };
}

/** Dispara o download no navegador a partir do Blob recebido. */
export function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
