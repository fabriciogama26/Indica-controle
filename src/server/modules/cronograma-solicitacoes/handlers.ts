import { NextResponse } from "next/server";

import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { addChange, normalizeNullableText, normalizeText, parsePagination } from "@/lib/server/apiHelpers";
import { authorizeCronogramaAction } from "./authorization";
import {
  businessToday,
  diffDays,
  isAsbuiltAllowedState,
  isIsoDate,
  isPrioridade,
  isTipoSolicitacao,
  resolveDataLimite,
  resolveDiasRestantes,
  resolveStatusEfetivo,
  type Prioridade,
  type TipoSolicitacao,
} from "./normalizers";
import {
  applySolicitacaoFilters,
  deleteUserDefaultTipo,
  fetchAsbuiltEligibleProjectIds,
  fetchLatestProgrammingState,
  fetchLatestProgrammingStateMap,
  fetchPeopleNameMap,
  fetchTipoDefaultsWithUsers,
  fetchUserDefaultTipo,
  upsertUserDefaultTipo,
  fetchPersonActive,
  fetchProjectLookup,
  fetchProjectLookupMap,
  fetchSolicitacaoById,
  fetchUserNameMap,
  insertHistory,
  resolveProjectIdsByCity,
  resolveSearchIds,
  SOLICITACAO_SELECT,
} from "./queries";
import type {
  CreatePayload,
  ListFilters,
  ProjectLookupRow,
  SolicitacaoItem,
  SolicitacaoRow,
  SolicitacaoSummary,
  UpdatePayload,
} from "./types";

const META_CACHE_TTL_MS = 5 * 60_000;
const metaCache = new Map<string, { expiresAt: number; payload: unknown }>();

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ message, ...(extra ?? {}) }, { status });
}

function buildProjectAddress(project: ProjectLookupRow | undefined): string {
  if (!project) return "";
  return [normalizeText(project.street), normalizeText(project.neighborhood)]
    .filter(Boolean)
    .join(", ");
}

function buildItem(
  row: SolicitacaoRow,
  maps: {
    projectMap: Map<string, ProjectLookupRow>;
    peopleMap: Map<string, string>;
    userMap: Map<string, string>;
    estadoMap: Map<string, { rawStatus: string; stateToken: string; programmingId: string }>;
  },
  today: string,
): SolicitacaoItem {
  const project = maps.projectMap.get(row.projeto_id);
  const statusEfetivo = resolveStatusEfetivo(row.status, row.data_limite, today);
  const diasRestantes = resolveDiasRestantes(row.status, row.data_limite, today);
  const estadoAtual = maps.estadoMap.get(row.projeto_id);

  return {
    id: row.id,
    projetoId: row.projeto_id,
    projetoCodigo: row.projeto_codigo,
    projetoMunicipio: normalizeText(project?.city_text),
    projetoEndereco: buildProjectAddress(project),
    projetoPrioridade: normalizeText(project?.priority_text),
    tipo: row.tipo_solicitacao,
    prioridade: row.prioridade,
    dataEntrada: row.data_entrada,
    dataLimite: row.data_limite,
    dataConclusao: row.data_conclusao,
    status: row.status,
    statusEfetivo,
    diasRestantes,
    diasAtraso: statusEfetivo === "ATRASADO" ? Math.abs(diffDays(row.data_limite, today)) : null,
    responsavelId: row.responsavel_id,
    responsavelNome: maps.peopleMap.get(row.responsavel_id) ?? "Nao identificado",
    solicitanteId: row.solicitante_id,
    solicitanteNome: maps.userMap.get(row.solicitante_id) ?? "Nao identificado",
    observacao: row.observacao,
    justificativaPrioridade: row.justificativa_prioridade,
    motivoCancelamento: row.motivo_cancelamento,
    estadoProgramacaoSnapshot: row.estado_programacao_snapshot,
    estadoProgramacaoAtual: estadoAtual ? (estadoAtual.rawStatus || "-") : "A PROGRAMAR",
    programacaoId: row.programacao_id,
    createdByName: maps.userMap.get(row.created_by ?? "") ?? "Nao identificado",
    updatedByName: maps.userMap.get(row.updated_by ?? "") ?? "Nao identificado",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseFilters(params: URLSearchParams): ListFilters {
  return {
    tipo: normalizeText(params.get("tipo")),
    prioridade: normalizeText(params.get("prioridade")),
    status: normalizeText(params.get("status")),
    responsavelId: normalizeText(params.get("responsavelId")),
    projetoId: normalizeText(params.get("projetoId")),
    municipio: normalizeText(params.get("municipio")),
    dataEntradaInicio: normalizeText(params.get("dataEntradaInicio")),
    dataEntradaFim: normalizeText(params.get("dataEntradaFim")),
    dataLimiteInicio: normalizeText(params.get("dataLimiteInicio")),
    dataLimiteFim: normalizeText(params.get("dataLimiteFim")),
    search: normalizeText(params.get("search")),
  };
}

function resolveSortColumn(sort: string): { column: string; ascending: boolean } {
  const normalized = normalizeText(sort).toLowerCase();
  switch (normalized) {
    case "prioridade":
      return { column: "prioridade", ascending: true };
    case "projeto":
      return { column: "projeto_codigo", ascending: true };
    case "status":
      return { column: "status", ascending: true };
    case "entrada":
      return { column: "data_entrada", ascending: false };
    case "atualizacao":
      return { column: "updated_at", ascending: false };
    case "prazo":
    default:
      return { column: "data_limite", ascending: true };
  }
}

export async function listSolicitacoes(
  context: AuthenticatedAppUserContext,
  params: URLSearchParams,
): Promise<NextResponse> {
  const denied = await authorizeCronogramaAction(context, "read");
  if (denied) return denied;

  const { supabase, appUser } = context;
  const tenantId = appUser.tenant_id;
  const today = businessToday();
  const filters = parseFilters(params);
  const { page, pageSize, from, to } = parsePagination(params, { maxPageSize: 100 });
  const sort = resolveSortColumn(normalizeText(params.get("sort")));

  const [municipioProjectIds, searchIds] = await Promise.all([
    filters.municipio ? resolveProjectIdsByCity(supabase, tenantId, filters.municipio) : Promise.resolve(null),
    filters.search ? resolveSearchIds(supabase, tenantId, filters.search) : Promise.resolve(null),
  ]);

  const baseFilterCtx = { filters, today, municipioProjectIds, searchIds };

  let pageQuery = supabase
    .from("cronograma_solicitacoes")
    .select(SOLICITACAO_SELECT, { count: "exact" })
    .eq("tenant_id", tenantId);
  pageQuery = applySolicitacaoFilters(pageQuery, { ...baseFilterCtx, includeStatus: true });
  pageQuery = pageQuery
    .order(sort.column, { ascending: sort.ascending })
    .order("id", { ascending: true })
    .range(from, to);

  const { data: rows, error, count } = await pageQuery.returns<SolicitacaoRow[]>();
  if (error) {
    return jsonError("Falha ao listar solicitacoes.", 500);
  }

  const summary = await fetchSummary(supabase, tenantId, baseFilterCtx);

  const pageRows = rows ?? [];
  const projectIds = pageRows.map((row) => row.projeto_id);
  const peopleIds = pageRows.map((row) => row.responsavel_id);
  const userIds = pageRows.flatMap((row) => [row.solicitante_id, row.created_by, row.updated_by]).filter(Boolean) as string[];

  const [projectMap, peopleMap, userMap, estadoMap] = await Promise.all([
    fetchProjectLookupMap(supabase, tenantId, projectIds),
    fetchPeopleNameMap(supabase, tenantId, peopleIds),
    fetchUserNameMap(supabase, tenantId, userIds),
    fetchLatestProgrammingStateMap(supabase, tenantId, projectIds),
  ]);

  const items = pageRows.map((row) => buildItem(row, { projectMap, peopleMap, userMap, estadoMap }, today));

  return NextResponse.json({
    items,
    pagination: { page, pageSize, total: count ?? 0 },
    summary,
    today,
  });
}

async function fetchSummary(
  supabase: AuthenticatedAppUserContext["supabase"],
  tenantId: string,
  baseFilterCtx: {
    filters: ListFilters;
    today: string;
    municipioProjectIds: string[] | null;
    searchIds: { term: string; projetoIds: string[]; responsavelIds: string[]; solicitanteIds: string[] } | null;
  },
): Promise<SolicitacaoSummary> {
  const today = baseFilterCtx.today;
  const in3 = new Date(`${today}T00:00:00Z`);
  in3.setUTCDate(in3.getUTCDate() + 3);
  const dataLimiteMax3 = in3.toISOString().slice(0, 10);

  const countBase = () => {
    const q = supabase
      .from("cronograma_solicitacoes")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    return applySolicitacaoFilters(q, { ...baseFilterCtx, includeStatus: false });
  };

  const [total, pendentes, concluidas, atrasadas, vencendoHoje, vencendoProximos3] = await Promise.all([
    countBase(),
    countBase().eq("status", "PENDENTE").gte("data_limite", today),
    countBase().eq("status", "CONCLUIDO"),
    countBase().eq("status", "PENDENTE").lt("data_limite", today),
    countBase().eq("status", "PENDENTE").eq("data_limite", today),
    countBase().eq("status", "PENDENTE").gt("data_limite", today).lte("data_limite", dataLimiteMax3),
  ]);

  return {
    total: total.count ?? 0,
    pendentes: pendentes.count ?? 0,
    concluidas: concluidas.count ?? 0,
    atrasadas: atrasadas.count ?? 0,
    vencendoHoje: vencendoHoje.count ?? 0,
    vencendoProximos3: vencendoProximos3.count ?? 0,
  };
}

export async function getMeta(context: AuthenticatedAppUserContext): Promise<NextResponse> {
  const denied = await authorizeCronogramaAction(context, "read");
  if (denied) return denied;

  const { supabase, appUser } = context;
  const tenantId = appUser.tenant_id;

  // defaultTipo e por usuario, fora do cache por tenant.
  const defaultTipo = await fetchUserDefaultTipo(supabase, tenantId, appUser.id);

  const cached = metaCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ ...(cached.payload as Record<string, unknown>), defaultTipo });
  }

  const [jobTitles, projects, asbuiltIds] = await Promise.all([
    supabase
      .from("job_titles")
      .select("id, code")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .returns<Array<{ id: string; code: string | null }>>(),
    supabase
      .from("project_with_labels")
      .select("id, sob, city_text, street, neighborhood, priority_text")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("sob", { ascending: true })
      .limit(5000)
      .returns<Array<{ id: string; sob: string; city_text: string | null; street: string | null; neighborhood: string | null; priority_text: string | null }>>(),
    fetchAsbuiltEligibleProjectIds(supabase, tenantId),
  ]);

  const responsavelJobTitleIds = (jobTitles.data ?? [])
    .filter((item) => ["VISTORIADOR"].includes(normalizeText(item.code).toUpperCase()))
    .map((item) => item.id);

  let responsaveis: Array<{ id: string; nome: string }> = [];
  if (responsavelJobTitleIds.length) {
    const { data: people } = await supabase
      .from("people")
      .select("id, name:nome")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .in("job_title_id", responsavelJobTitleIds)
      .order("nome", { ascending: true })
      .returns<Array<{ id: string; name: string | null }>>();

    responsaveis = (people ?? []).map((item) => ({ id: item.id, nome: normalizeText(item.name) }));
  }

  const projetos = (projects.data ?? []).map((item) => ({
    id: item.id,
    codigo: normalizeText(item.sob),
    municipio: normalizeText(item.city_text),
    endereco: [normalizeText(item.street), normalizeText(item.neighborhood)].filter(Boolean).join(", "),
    prioridade: normalizeText(item.priority_text),
  }));

  const payload = {
    tipos: [
      { value: "INSPECAO", label: "Fiscalizacao" },
      { value: "AS_BUILT", label: "As Built" },
      { value: "LOCACAO", label: "Locacao" },
    ],
    prioridades: [
      { value: "BAIXA", label: "Baixa" },
      { value: "MEDIA", label: "Media" },
      { value: "ALTA", label: "Alta" },
    ],
    status: [
      { value: "PENDENTE", label: "Pendente" },
      { value: "CONCLUIDO", label: "Concluido" },
      { value: "CANCELADO", label: "Cancelado" },
      { value: "ATRASADO", label: "Atrasado" },
    ],
    responsaveis,
    projetos,
    asbuiltProjetoIds: asbuiltIds,
  };

  metaCache.set(tenantId, { expiresAt: Date.now() + META_CACHE_TTL_MS, payload });
  return NextResponse.json({ ...payload, defaultTipo });
}

export async function listTipoDefaults(context: AuthenticatedAppUserContext): Promise<NextResponse> {
  const denied = await authorizeCronogramaAction(context, "read");
  if (denied) return denied;
  if (!context.role.isAdmin) {
    return jsonError("Apenas administradores podem gerenciar o tipo padrao por usuario.", 403);
  }

  const users = await fetchTipoDefaultsWithUsers(context.supabase, context.appUser.tenant_id);
  return NextResponse.json({ users });
}

export async function setTipoDefault(
  context: AuthenticatedAppUserContext,
  payload: { userId: string; tipo: string },
): Promise<NextResponse> {
  const denied = await authorizeCronogramaAction(context, "read");
  if (denied) return denied;
  if (!context.role.isAdmin) {
    return jsonError("Apenas administradores podem gerenciar o tipo padrao por usuario.", 403);
  }

  const { supabase, appUser } = context;
  const tenantId = appUser.tenant_id;
  const userId = normalizeText(payload.userId);
  const tipo = normalizeText(payload.tipo).toUpperCase();

  if (!userId) return jsonError("Informe o usuario.", 422);

  if (!tipo) {
    await deleteUserDefaultTipo(supabase, tenantId, userId);
    return NextResponse.json({ userId, defaultTipo: null });
  }

  if (!isTipoSolicitacao(tipo)) return jsonError("Tipo de solicitacao invalido.", 422);

  await upsertUserDefaultTipo(supabase, { tenantId, userId, tipo, actorUserId: appUser.id });
  return NextResponse.json({ userId, defaultTipo: tipo });
}

export async function getEstadoProgramacao(
  context: AuthenticatedAppUserContext,
  projetoId: string,
  tipo: string,
): Promise<NextResponse> {
  const denied = await authorizeCronogramaAction(context, "read");
  if (denied) return denied;

  const { supabase, appUser } = context;
  const tenantId = appUser.tenant_id;

  if (!projetoId) {
    return jsonError("Informe o projeto.", 400);
  }

  const project = await fetchProjectLookup(supabase, tenantId, projetoId);
  if (!project || !project.is_active) {
    return jsonError("Projeto inexistente ou inativo.", 422);
  }

  const latest = await fetchLatestProgrammingState(supabase, tenantId, projetoId);
  const tipoUpper = normalizeText(tipo).toUpperCase();
  const allowed =
    tipoUpper !== "AS_BUILT"
    || Boolean(latest && isAsbuiltAllowedState(latest.stateToken));

  return NextResponse.json({
    projetoId,
    projetoCodigo: normalizeText(project.sob),
    municipio: normalizeText(project.city_text),
    endereco: [normalizeText(project.street), normalizeText(project.neighborhood)].filter(Boolean).join(", "),
    prioridade: normalizeText(project.priority_text),
    estadoProgramacao: latest?.rawStatus ?? "",
    estadoToken: latest?.stateToken ?? "",
    programacaoId: latest?.programmingId ?? null,
    allowed,
    blockMessage: allowed
      ? null
      : "Este projeto nao esta com estado CONCLUIDO ou PARCIAL PLANEJADO BENEFICIO ATINGIDO na Programacao. Somente esses estados permitem As Built.",
  });
}

type ResolvedInput = {
  tipo: TipoSolicitacao;
  prioridade: Prioridade;
  dataEntrada: string;
  dataLimite: string;
  justificativa: string | null;
  observacao: string | null;
  responsavelId: string;
  project: ProjectLookupRow;
  estadoSnapshot: string | null;
  programacaoId: string | null;
};

async function resolveAndValidateInput(
  context: AuthenticatedAppUserContext,
  payload: CreatePayload,
): Promise<{ error: NextResponse } | { data: ResolvedInput }> {
  const { supabase, appUser } = context;
  const tenantId = appUser.tenant_id;

  if (!isTipoSolicitacao(payload.tipo)) return { error: jsonError("Tipo de solicitacao invalido.", 422) };
  if (!isPrioridade(payload.prioridade)) return { error: jsonError("Prioridade invalida.", 422) };
  if (!isIsoDate(payload.dataEntrada)) return { error: jsonError("Data de entrada invalida.", 422) };

  const tipo = payload.tipo.toUpperCase() as TipoSolicitacao;
  const prioridade = payload.prioridade.toUpperCase() as Prioridade;
  const responsavelId = normalizeText(payload.responsavelId);
  if (!responsavelId) return { error: jsonError("Selecione o responsavel.", 422) };

  const project = await fetchProjectLookup(supabase, tenantId, normalizeText(payload.projetoId));
  if (!project || !project.is_active) {
    return { error: jsonError("Projeto inexistente ou inativo.", 422) };
  }

  const manualDataLimite = normalizeNullableText(payload.dataLimite);
  const dataLimite = resolveDataLimite(prioridade, payload.dataEntrada, manualDataLimite);
  const justificativa = normalizeNullableText(payload.justificativaPrioridade);

  if (prioridade === "ALTA") {
    if (!dataLimite) return { error: jsonError("Informe a Data Limite para prioridade Alta.", 422) };
    if (dataLimite < payload.dataEntrada) {
      return { error: jsonError("A Data Limite nao pode ser menor que a Data de Entrada.", 422) };
    }
    if (!justificativa) return { error: jsonError("Informe a justificativa da prioridade Alta.", 422) };
  }

  if (!dataLimite) return { error: jsonError("Nao foi possivel calcular a Data Limite.", 422) };

  const responsavelAtivo = await fetchPersonActive(supabase, tenantId, responsavelId);
  if (!responsavelAtivo) return { error: jsonError("Responsavel invalido ou inativo.", 422) };

  let estadoSnapshot: string | null = null;
  let programacaoId: string | null = null;

  if (tipo === "AS_BUILT") {
    const latest = await fetchLatestProgrammingState(supabase, tenantId, project.id);
    if (!latest || !isAsbuiltAllowedState(latest.stateToken)) {
      return {
        error: jsonError(
          "Este projeto nao esta com estado CONCLUIDO ou PARCIAL PLANEJADO BENEFICIO ATINGIDO na Programacao. Somente esses estados permitem As Built.",
          409,
        ),
      };
    }
    estadoSnapshot = latest.rawStatus || latest.stateToken;
    programacaoId = latest.programmingId;
  }

  return {
    data: {
      tipo,
      prioridade,
      dataEntrada: payload.dataEntrada,
      dataLimite,
      justificativa: prioridade === "ALTA" ? justificativa : null,
      observacao: normalizeNullableText(payload.observacao),
      responsavelId,
      project,
      estadoSnapshot,
      programacaoId,
    },
  };
}

async function loadItemResponse(
  context: AuthenticatedAppUserContext,
  row: SolicitacaoRow,
): Promise<NextResponse> {
  const { supabase, appUser } = context;
  const tenantId = appUser.tenant_id;
  const today = businessToday();

  const [projectMap, peopleMap, userMap, estadoMap] = await Promise.all([
    fetchProjectLookupMap(supabase, tenantId, [row.projeto_id]),
    fetchPeopleNameMap(supabase, tenantId, [row.responsavel_id]),
    fetchUserNameMap(supabase, tenantId, [row.solicitante_id, row.created_by ?? "", row.updated_by ?? ""].filter(Boolean)),
    fetchLatestProgrammingStateMap(supabase, tenantId, [row.projeto_id]),
  ]);

  return NextResponse.json({ item: buildItem(row, { projectMap, peopleMap, userMap, estadoMap }, today) });
}

export async function createSolicitacao(
  context: AuthenticatedAppUserContext,
  payload: CreatePayload,
): Promise<NextResponse> {
  const denied = await authorizeCronogramaAction(context, "create");
  if (denied) return denied;

  const { supabase, appUser } = context;
  const tenantId = appUser.tenant_id;

  const resolved = await resolveAndValidateInput(context, payload);
  if ("error" in resolved) return resolved.error;
  const input = resolved.data;

  const { data: duplicate } = await supabase
    .from("cronograma_solicitacoes")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("projeto_id", input.project.id)
    .eq("data_entrada", input.dataEntrada)
    .eq("tipo_solicitacao", input.tipo)
    .maybeSingle<{ id: string }>();

  if (duplicate) {
    return jsonError("Ja existe uma solicitacao deste tipo para este projeto e data de entrada.", 409);
  }

  const { data: inserted, error } = await supabase
    .from("cronograma_solicitacoes")
    .insert({
      tenant_id: tenantId,
      projeto_id: input.project.id,
      projeto_codigo: normalizeText(input.project.sob),
      tipo_solicitacao: input.tipo,
      prioridade: input.prioridade,
      data_entrada: input.dataEntrada,
      data_limite: input.dataLimite,
      status: "PENDENTE",
      responsavel_id: input.responsavelId,
      solicitante_id: appUser.id,
      observacao: input.observacao,
      justificativa_prioridade: input.justificativa,
      estado_programacao_snapshot: input.estadoSnapshot,
      programacao_id: input.programacaoId,
      created_by: appUser.id,
      updated_by: appUser.id,
    })
    .select(SOLICITACAO_SELECT)
    .single<SolicitacaoRow>();

  if (error || !inserted) {
    const message = normalizeText(error?.message);
    if (message.includes("cronograma_solicitacoes_dedupe_key")) {
      return jsonError("Ja existe uma solicitacao deste tipo para este projeto e data de entrada.", 409);
    }
    return jsonError("Falha ao cadastrar solicitacao.", 500);
  }

  await insertHistory(supabase, {
    tenantId,
    solicitacaoId: inserted.id,
    changeType: "CREATE",
    changes: { status: { from: null, to: "PENDENTE" } },
    reason: null,
    actorUserId: appUser.id,
  });

  return loadItemResponse(context, inserted);
}

export async function updateSolicitacao(
  context: AuthenticatedAppUserContext,
  payload: UpdatePayload,
): Promise<NextResponse> {
  const denied = await authorizeCronogramaAction(context, "update");
  if (denied) return denied;

  const { supabase, appUser } = context;
  const tenantId = appUser.tenant_id;

  const current = await fetchSolicitacaoById(supabase, tenantId, normalizeText(payload.id));
  if (!current) return jsonError("Solicitacao nao encontrada.", 404);
  if (current.status !== "PENDENTE") {
    return jsonError("Solicitacao concluida ou cancelada nao pode ser editada.", 409);
  }

  const expectedUpdatedAt = normalizeNullableText(payload.expectedUpdatedAt);
  if (expectedUpdatedAt && expectedUpdatedAt !== current.updated_at) {
    return jsonError("Esta solicitacao foi alterada por outro usuario. Recarregue e tente novamente.", 409);
  }

  const resolved = await resolveAndValidateInput(context, payload);
  if ("error" in resolved) return resolved.error;
  const input = resolved.data;

  const { data: duplicate } = await supabase
    .from("cronograma_solicitacoes")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("projeto_id", input.project.id)
    .eq("data_entrada", input.dataEntrada)
    .eq("tipo_solicitacao", input.tipo)
    .neq("id", current.id)
    .maybeSingle<{ id: string }>();

  if (duplicate) {
    return jsonError("Ja existe uma solicitacao deste tipo para este projeto e data de entrada.", 409);
  }

  const changes: Record<string, { from: string | null; to: string | null }> = {};
  addChange(changes, "tipo", current.tipo_solicitacao, input.tipo);
  addChange(changes, "prioridade", current.prioridade, input.prioridade);
  addChange(changes, "projeto", current.projeto_codigo, input.project.sob);
  addChange(changes, "dataEntrada", current.data_entrada, input.dataEntrada);
  addChange(changes, "dataLimite", current.data_limite, input.dataLimite);
  addChange(changes, "responsavel", current.responsavel_id, input.responsavelId);
  addChange(changes, "observacao", current.observacao, input.observacao);
  addChange(changes, "justificativaPrioridade", current.justificativa_prioridade, input.justificativa);

  const { data: updated, error } = await supabase
    .from("cronograma_solicitacoes")
    .update({
      projeto_id: input.project.id,
      projeto_codigo: normalizeText(input.project.sob),
      tipo_solicitacao: input.tipo,
      prioridade: input.prioridade,
      data_entrada: input.dataEntrada,
      data_limite: input.dataLimite,
      responsavel_id: input.responsavelId,
      observacao: input.observacao,
      justificativa_prioridade: input.justificativa,
      estado_programacao_snapshot: input.estadoSnapshot,
      programacao_id: input.programacaoId,
      updated_by: appUser.id,
    })
    .eq("tenant_id", tenantId)
    .eq("id", current.id)
    .select(SOLICITACAO_SELECT)
    .single<SolicitacaoRow>();

  if (error || !updated) {
    return jsonError("Falha ao atualizar solicitacao.", 500);
  }

  if (Object.keys(changes).length > 0) {
    await insertHistory(supabase, {
      tenantId,
      solicitacaoId: updated.id,
      changeType: "UPDATE",
      changes,
      reason: null,
      actorUserId: appUser.id,
    });
  }

  return loadItemResponse(context, updated);
}

function canManageStatus(context: AuthenticatedAppUserContext, row: SolicitacaoRow): boolean {
  return context.role.isAdmin || row.created_by === context.appUser.id;
}

export async function verifySolicitacao(
  context: AuthenticatedAppUserContext,
  payload: { id: string; expectedUpdatedAt: string | null },
): Promise<NextResponse> {
  const denied = await authorizeCronogramaAction(context, "update");
  if (denied) return denied;

  const { supabase, appUser } = context;
  const tenantId = appUser.tenant_id;

  const current = await fetchSolicitacaoById(supabase, tenantId, normalizeText(payload.id));
  if (!current) return jsonError("Solicitacao nao encontrada.", 404);
  if (!canManageStatus(context, current)) {
    return jsonError("Apenas o solicitante que cadastrou ou um administrador pode verificar este pedido.", 403);
  }
  if (current.status !== "PENDENTE") {
    return jsonError("Somente solicitacoes pendentes podem ser verificadas.", 409);
  }

  const expectedUpdatedAt = normalizeNullableText(payload.expectedUpdatedAt);
  if (expectedUpdatedAt && expectedUpdatedAt !== current.updated_at) {
    return jsonError("Esta solicitacao foi alterada por outro usuario. Recarregue e tente novamente.", 409);
  }

  const { data: updated, error } = await supabase
    .from("cronograma_solicitacoes")
    .update({
      status: "CONCLUIDO",
      data_conclusao: businessToday(),
      updated_by: appUser.id,
    })
    .eq("tenant_id", tenantId)
    .eq("id", current.id)
    .select(SOLICITACAO_SELECT)
    .single<SolicitacaoRow>();

  if (error || !updated) {
    return jsonError("Falha ao verificar solicitacao.", 500);
  }

  await insertHistory(supabase, {
    tenantId,
    solicitacaoId: updated.id,
    changeType: "VERIFY",
    changes: { status: { from: current.status, to: "CONCLUIDO" } },
    reason: null,
    actorUserId: appUser.id,
  });

  return loadItemResponse(context, updated);
}

export async function cancelSolicitacao(
  context: AuthenticatedAppUserContext,
  payload: { id: string; motivo: string; expectedUpdatedAt: string | null },
): Promise<NextResponse> {
  const denied = await authorizeCronogramaAction(context, "cancel");
  if (denied) return denied;

  const { supabase, appUser } = context;
  const tenantId = appUser.tenant_id;

  const motivo = normalizeText(payload.motivo);
  if (!motivo) return jsonError("Informe o motivo do cancelamento.", 422);

  const current = await fetchSolicitacaoById(supabase, tenantId, normalizeText(payload.id));
  if (!current) return jsonError("Solicitacao nao encontrada.", 404);
  if (!canManageStatus(context, current)) {
    return jsonError("Apenas o solicitante que cadastrou ou um administrador pode cancelar este pedido.", 403);
  }
  if (current.status !== "PENDENTE") {
    return jsonError("Somente solicitacoes pendentes podem ser canceladas.", 409);
  }

  const expectedUpdatedAt = normalizeNullableText(payload.expectedUpdatedAt);
  if (expectedUpdatedAt && expectedUpdatedAt !== current.updated_at) {
    return jsonError("Esta solicitacao foi alterada por outro usuario. Recarregue e tente novamente.", 409);
  }

  const { data: updated, error } = await supabase
    .from("cronograma_solicitacoes")
    .update({
      status: "CANCELADO",
      motivo_cancelamento: motivo,
      updated_by: appUser.id,
    })
    .eq("tenant_id", tenantId)
    .eq("id", current.id)
    .select(SOLICITACAO_SELECT)
    .single<SolicitacaoRow>();

  if (error || !updated) {
    return jsonError("Falha ao cancelar solicitacao.", 500);
  }

  await insertHistory(supabase, {
    tenantId,
    solicitacaoId: updated.id,
    changeType: "CANCEL",
    changes: { status: { from: current.status, to: "CANCELADO" } },
    reason: motivo,
    actorUserId: appUser.id,
  });

  return loadItemResponse(context, updated);
}
