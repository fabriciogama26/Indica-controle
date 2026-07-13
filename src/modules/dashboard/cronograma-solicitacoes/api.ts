import {
  CRONOGRAMA_CANCEL_ENDPOINT,
  CRONOGRAMA_ENDPOINT,
  CRONOGRAMA_ESTADO_ENDPOINT,
  CRONOGRAMA_META_ENDPOINT,
  CRONOGRAMA_TIPO_DEFAULTS_ENDPOINT,
  CRONOGRAMA_VERIFY_ENDPOINT,
  PAGE_SIZE,
} from "./constants";
import type {
  EstadoResponse,
  FilterState,
  ListResponse,
  MetaResponse,
  SolicitacaoItem,
  TipoDefaultsResponse,
} from "./types";

function authHeaders(token: string, json = false): HeadersInit {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

async function parseJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) {
    throw new Error(data.message ?? fallbackMessage);
  }
  return data;
}

export async function fetchMeta(token: string): Promise<MetaResponse> {
  const response = await fetch(CRONOGRAMA_META_ENDPOINT, {
    cache: "no-store",
    headers: authHeaders(token),
  });
  return parseJson<MetaResponse>(response, "Falha ao carregar dados de apoio.");
}

export async function fetchList(token: string, filters: FilterState, page: number): Promise<ListResponse> {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(PAGE_SIZE));
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.tipo) params.set("tipo", filters.tipo);
  if (filters.prioridade) params.set("prioridade", filters.prioridade);
  if (filters.status) params.set("status", filters.status);
  if (filters.responsavelId) params.set("responsavelId", filters.responsavelId);
  if (filters.projetoId) params.set("projetoId", filters.projetoId);
  if (filters.municipio.trim()) params.set("municipio", filters.municipio.trim());
  if (filters.dataEntradaInicio) params.set("dataEntradaInicio", filters.dataEntradaInicio);
  if (filters.dataEntradaFim) params.set("dataEntradaFim", filters.dataEntradaFim);
  if (filters.dataLimiteInicio) params.set("dataLimiteInicio", filters.dataLimiteInicio);
  if (filters.dataLimiteFim) params.set("dataLimiteFim", filters.dataLimiteFim);
  if (filters.search.trim()) params.set("search", filters.search.trim());

  const response = await fetch(`${CRONOGRAMA_ENDPOINT}?${params.toString()}`, {
    cache: "no-store",
    headers: authHeaders(token),
  });
  return parseJson<ListResponse>(response, "Falha ao carregar solicitacoes.");
}

export async function fetchEstadoProgramacao(
  token: string,
  projetoId: string,
  tipo: string,
): Promise<EstadoResponse> {
  const params = new URLSearchParams({ projetoId, tipo });
  const response = await fetch(`${CRONOGRAMA_ESTADO_ENDPOINT}?${params.toString()}`, {
    cache: "no-store",
    headers: authHeaders(token),
  });
  return parseJson<EstadoResponse>(response, "Falha ao consultar estado da Programacao.");
}

type SavePayload = {
  id?: string | null;
  projetoId: string;
  tipo: string;
  prioridade: string;
  dataEntrada: string;
  dataLimite: string | null;
  responsavelId: string;
  observacao: string | null;
  justificativaPrioridade: string | null;
  expectedUpdatedAt?: string | null;
};

export async function saveSolicitacao(token: string, payload: SavePayload): Promise<{ item: SolicitacaoItem }> {
  const isUpdate = Boolean(payload.id);
  const response = await fetch(CRONOGRAMA_ENDPOINT, {
    method: isUpdate ? "PUT" : "POST",
    headers: authHeaders(token, true),
    body: JSON.stringify(payload),
  });
  return parseJson<{ item: SolicitacaoItem }>(response, "Falha ao salvar solicitacao.");
}

export async function verifySolicitacao(
  token: string,
  id: string,
  expectedUpdatedAt: string | null,
  dataConclusao: string | null,
): Promise<{ item: SolicitacaoItem }> {
  const response = await fetch(CRONOGRAMA_VERIFY_ENDPOINT, {
    method: "POST",
    headers: authHeaders(token, true),
    body: JSON.stringify({ id, expectedUpdatedAt, dataConclusao }),
  });
  return parseJson<{ item: SolicitacaoItem }>(response, "Falha ao verificar solicitacao.");
}

export async function cancelSolicitacao(
  token: string,
  id: string,
  motivo: string,
  expectedUpdatedAt: string | null,
): Promise<{ item: SolicitacaoItem }> {
  const response = await fetch(CRONOGRAMA_CANCEL_ENDPOINT, {
    method: "POST",
    headers: authHeaders(token, true),
    body: JSON.stringify({ id, motivo, expectedUpdatedAt }),
  });
  return parseJson<{ item: SolicitacaoItem }>(response, "Falha ao cancelar solicitacao.");
}

export async function fetchTipoDefaults(token: string): Promise<TipoDefaultsResponse> {
  const response = await fetch(CRONOGRAMA_TIPO_DEFAULTS_ENDPOINT, {
    cache: "no-store",
    headers: authHeaders(token),
  });
  return parseJson<TipoDefaultsResponse>(response, "Falha ao carregar tipos padrao por usuario.");
}

export async function setTipoDefault(
  token: string,
  userId: string,
  tipo: string,
): Promise<{ userId: string; defaultTipo: string | null }> {
  const response = await fetch(CRONOGRAMA_TIPO_DEFAULTS_ENDPOINT, {
    method: "PUT",
    headers: authHeaders(token, true),
    body: JSON.stringify({ userId, tipo }),
  });
  return parseJson<{ userId: string; defaultTipo: string | null }>(response, "Falha ao salvar tipo padrao.");
}
