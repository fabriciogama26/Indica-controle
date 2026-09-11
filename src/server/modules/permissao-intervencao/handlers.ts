import { NextResponse } from "next/server";

import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import {
  buildUserDisplayMap,
  fetchTenantLinkedAppUsers,
  normalizeText,
  parsePagination,
} from "@/lib/server/apiHelpers";
import { normalizeExpectedUpdatedAt } from "@/lib/server/concurrency";
import { authorizePageAction } from "@/lib/server/routeAuthorization";

import {
  buildPiComparison,
  fetchActiveProjectOptions,
  fetchPiById,
  fetchPiExecutionSteps,
  fetchPiHistory,
  fetchPiList,
  fetchPiMeta,
  fetchPiPeopleAndTeams,
  fetchPiRoleJobTitles,
  fetchPiTagsByPi,
  fetchProgrammingStageOptions,
  fetchProjectLookupMap,
  toStageClassification,
  type PiRow,
} from "./queries";
import type { PiCreationSource, PiLinkStatus, PiListFilters, PiListItem, PiStatus } from "./types";

/**
 * Handlers da tela Permissao de Intervencao.
 *
 * Uma unica `page_key` cobre listagem, detalhe, historico, cadastro, plano de
 * execucao, status e vinculo, conforme o "Padrao de permissao por tela" do
 * CLAUDE.md: quem enxerga a tela usa todas as funcoes dela.
 *
 * ATENCAO para a fase da emissao: o documento e gerado a partir do template
 * ativo, que pertence a tela `modelo-pi`. Aquele endpoint e DESTA tela e nao
 * pode exigir `modelo-pi` — tem de aceitar as duas chaves via
 * `authorizeAnyPageAction`, senao a tela abre e a propria acao dela toma 403.
 */

export const PI_PAGE_KEY = "permissao-intervencao";

const MAX_PAGE_SIZE = 100;

type RpcResult = {
  success?: boolean;
  status?: number;
  reason?: string | null;
  message?: string;
  errors?: unknown;
  pi_id?: string;
  pi_code?: string;
  pi_sequence?: number;
  pi_status?: string;
  updated_at?: string;
  link_status?: string;
  programming_id?: string | null;
  step_count?: number;
};

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ message, ...(extra ?? {}) }, { status });
}

/** Toda RPC do modulo devolve o mesmo envelope; este helper o traduz em resposta. */
function rpcResponse(result: RpcResult, fallbackMessage: string) {
  if (result.success !== true) {
    return jsonError(result.message ?? fallbackMessage, Number(result.status ?? 400), {
      reason: result.reason ?? null,
      ...(result.errors ? { errors: result.errors } : {}),
    });
  }

  return NextResponse.json({
    piId: result.pi_id ?? null,
    piCode: result.pi_code ?? null,
    piSequence: result.pi_sequence ?? null,
    piStatus: result.pi_status ?? null,
    linkStatus: result.link_status ?? null,
    programmingId: result.programming_id ?? null,
    stepCount: result.step_count ?? null,
    updatedAt: result.updated_at ?? null,
    message: result.message ?? "Operacao concluida.",
  });
}

// ---------------------------------------------------------------------------
// Listagem
// ---------------------------------------------------------------------------

function parseFilters(params: URLSearchParams): PiListFilters {
  const { page, pageSize } = parsePagination(params, { defaultPageSize: 20, maxPageSize: MAX_PAGE_SIZE });
  return {
    search: normalizeText(params.get("search")),
    status: normalizeText(params.get("status")),
    linkStatus: normalizeText(params.get("linkStatus")),
    projectId: normalizeText(params.get("projectId")),
    operationAreaCode: normalizeText(params.get("operationArea")),
    voltageLevelCode: normalizeText(params.get("voltageLevel")),
    dateFrom: normalizeText(params.get("dateFrom")),
    dateTo: normalizeText(params.get("dateTo")),
    page,
    pageSize,
  };
}

export async function listPermissionInterventions(
  context: AuthenticatedAppUserContext,
  params: URLSearchParams,
) {
  const denied = await authorizePageAction(context, PI_PAGE_KEY, "read");
  if (denied) return denied;

  const { supabase, appUser } = context;
  const filters = parseFilters(params);

  try {
    const { items, total, projectMap } = await fetchPiList(supabase, appUser.tenant_id, filters);
    const piIds = items.map((row) => row.id);

    const [{ areas, voltages }, users] = await Promise.all([
      fetchPiTagsByPi(supabase, appUser.tenant_id, piIds),
      fetchTenantLinkedAppUsers(
        supabase,
        appUser.tenant_id,
        Array.from(new Set(items.map((row) => row.created_by).filter((id): id is string => Boolean(id)))),
      ),
    ]);

    const displayMap = buildUserDisplayMap(users);

    const mapped: PiListItem[] = items.map((row) => {
      const project = projectMap.get(row.project_id);
      return {
        id: row.id,
        piCode: row.pi_code,
        projectId: row.project_id,
        projectCode: project?.sob ?? "Nao identificado",
        projectCity: project?.city_text ?? "",
        workDate: row.work_date,
        status: row.status as PiStatus,
        linkStatus: row.link_status as PiLinkStatus,
        creationSource: row.creation_source as PiCreationSource,
        programmingId: row.programming_id,
        linkedStage: toStageClassification(row.programming),
        operationAreaCodes: areas.get(row.id)?.PI ?? [],
        voltageLevelCodes: voltages.get(row.id)?.PI ?? [],
        primaryOperationAreaCode: row.primary_operation_area_code,
        primaryVoltageLevelCode: row.primary_voltage_level_code,
        supervisorName: row.supervisor_name_snapshot,
        foremanName: row.foreman_name_snapshot,
        createdByName: displayMap.get(row.created_by ?? "") ?? "Nao identificado",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });

    return NextResponse.json({
      items: mapped,
      page: filters.page,
      pageSize: filters.pageSize,
      total,
    });
  } catch {
    return jsonError("Falha ao carregar as Permissoes de Intervencao.", 500);
  }
}

// ---------------------------------------------------------------------------
// Detalhe
// ---------------------------------------------------------------------------

/** Converte `snake_case` do banco em `camelCase` para a tela, sem perder campo. */
function toDetailPayload(row: PiRow) {
  const detail: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "programming") continue;
    const camel = key.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
    detail[camel] = value;
  }
  detail.linkedStage = toStageClassification(row.programming);
  return detail;
}

export async function getPermissionIntervention(context: AuthenticatedAppUserContext, piId: string) {
  const denied = await authorizePageAction(context, PI_PAGE_KEY, "read");
  if (denied) return denied;

  const { supabase, appUser } = context;

  try {
    const row = await fetchPiById(supabase, appUser.tenant_id, piId);
    if (!row) return jsonError("PI nao encontrada.", 404);

    const [steps, { areas, voltages }, projectMap] = await Promise.all([
      fetchPiExecutionSteps(supabase, appUser.tenant_id, piId),
      fetchPiTagsByPi(supabase, appUser.tenant_id, [piId]),
      fetchProjectLookupMap(supabase, appUser.tenant_id, [row.project_id]),
    ]);

    const project = projectMap.get(row.project_id) ?? null;
    const snapshot = (row.source_programming_snapshot as Record<string, unknown> | null) ?? null;

    return NextResponse.json({
      pi: toDetailPayload(row),
      project: project
        ? {
            id: project.id,
            code: project.sob,
            city: project.city_text,
            address: [project.street, project.neighborhood].filter(Boolean).join(", "),
            latitude: project.latitude,
            longitude: project.longitude,
            serviceDescription: project.service_description,
          }
        : null,
      operationAreas: areas.get(piId)?.PI ?? [],
      contactOperationAreas: areas.get(piId)?.CONTACT ?? [],
      voltageLevels: voltages.get(piId)?.PI ?? [],
      interferingVoltageLevels: voltages.get(piId)?.INTERFERING ?? [],
      executionSteps: steps.map((step) => ({
        id: step.id,
        sortOrder: step.sort_order,
        workZone: step.work_zone,
        teamId: step.team_id,
        teamName: step.team_name_snapshot,
        activity: step.activity,
        origin: step.origin,
      })),
      // Divergencia e leitura: aparece como aviso e nunca impede salvar.
      comparison: buildPiComparison(
        snapshot,
        {
          feeder: row.feeder as string | null,
          activity_description: row.activity_description as string | null,
          start_time: row.start_time as string | null,
          end_time: row.end_time as string | null,
          foreman_name_snapshot: row.foreman_name_snapshot,
        },
        steps,
      ),
    });
  } catch {
    return jsonError("Falha ao carregar a PI.", 500);
  }
}

export async function getPermissionInterventionHistory(context: AuthenticatedAppUserContext, piId: string) {
  const denied = await authorizePageAction(context, PI_PAGE_KEY, "read");
  if (denied) return denied;

  const { supabase, appUser } = context;

  try {
    const rows = await fetchPiHistory(supabase, appUser.tenant_id, piId);
    const users = await fetchTenantLinkedAppUsers(
      supabase,
      appUser.tenant_id,
      Array.from(new Set(rows.map((row) => row.created_by).filter((id): id is string => Boolean(id)))),
    );
    const displayMap = buildUserDisplayMap(users);

    return NextResponse.json({
      items: rows.map((row) => ({
        id: row.id,
        actionType: row.action_type,
        reason: row.reason,
        changes: row.changes,
        metadata: row.metadata,
        createdByName: displayMap.get(row.created_by ?? "") ?? "Nao identificado",
        createdAt: row.created_at,
      })),
    });
  } catch {
    return jsonError("Falha ao carregar o historico da PI.", 500);
  }
}

// ---------------------------------------------------------------------------
// Catalogos e etapas oferecidas
// ---------------------------------------------------------------------------

export async function getPermissionInterventionMeta(context: AuthenticatedAppUserContext) {
  const denied = await authorizePageAction(context, PI_PAGE_KEY, "read");
  if (denied) return denied;

  const { supabase, appUser } = context;

  try {
    const [meta, projects, peopleAndTeams, roleTitles] = await Promise.all([
      fetchPiMeta(supabase, appUser.tenant_id),
      fetchActiveProjectOptions(supabase, appUser.tenant_id),
      fetchPiPeopleAndTeams(supabase, appUser.tenant_id),
      fetchPiRoleJobTitles(supabase, appUser.tenant_id),
    ]);

    return NextResponse.json({
      operationAreas: meta.operationAreas,
      voltageLevels: meta.voltageLevels,
      executionStepTemplates: meta.executionStepTemplates,
      // Cada pessoa carrega os papeis que o cargo dela habilita, e a tela filtra
      // cada select por isso. Quando o contrato nao configurou cargo nenhum,
      // `roles` vem vazio e a tela libera todos, em vez de deixar o select vazio
      // e a PI inutilizavel.
      people: peopleAndTeams.people.map((person) => ({
        id: person.id,
        name: person.nome,
        registration: person.matriculation,
        roles: [
          ...(person.job_title_id && roleTitles.foreman.has(person.job_title_id) ? ["FOREMAN"] : []),
          ...(person.job_title_id && roleTitles.supervisor.has(person.job_title_id) ? ["SUPERVISOR"] : []),
        ],
      })),
      roleFilterConfigured: {
        foreman: roleTitles.foreman.size > 0,
        supervisor: roleTitles.supervisor.size > 0,
      },
      supervisorRequiredTeamCount: meta.settings?.supervisor_required_team_count ?? 3,
      teams: peopleAndTeams.teams.map((team) => ({ id: team.id, name: team.name })),
      projects: projects.map((project) => ({
        id: project.id,
        code: project.sob,
        city: project.city_text ?? "",
        address: [project.street, project.neighborhood].filter(Boolean).join(", "),
      })),
      // Valores iniciais da secao de identificacao. Pre-preenchem a PI e
      // continuam editaveis nela.
      contractDefaults: meta.contract
        ? {
            companyName: meta.contract.empresa,
            managerName: meta.contract.nome_gestor,
            managerEmail: meta.contract.email,
            managerPhone: meta.contract.telefone_corporativo,
            contractNumber: meta.contract.number,
          }
        : null,
      // A tela avisa antes de o usuario chegar na emissao e tomar erro.
      readiness: {
        hasSettings: Boolean(meta.settings),
        hasEmergencyPlan: Boolean(meta.settings?.emergency_plan_text),
        hasActiveTemplate: meta.activeTemplateVersion !== null,
        hasStepTemplates: meta.executionStepTemplates.length > 0,
      },
    });
  } catch {
    return jsonError("Falha ao carregar os catalogos da PI.", 500);
  }
}

export async function getProgrammingStageOptions(
  context: AuthenticatedAppUserContext,
  projectId: string,
) {
  const denied = await authorizePageAction(context, PI_PAGE_KEY, "read");
  if (denied) return denied;

  if (!projectId) return jsonError("Informe o projeto.", 400);

  const { supabase, appUser } = context;

  try {
    const stages = await fetchProgrammingStageOptions(supabase, appUser.tenant_id, projectId);
    return NextResponse.json({ items: stages });
  } catch {
    return jsonError("Falha ao carregar as etapas da Programacao.", 500);
  }
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

export type SavePiPayload = {
  piId?: string;
  expectedUpdatedAt?: string;
  data?: Record<string, unknown>;
};

export async function savePermissionIntervention(
  context: AuthenticatedAppUserContext,
  payload: SavePiPayload,
) {
  const isCreate = !payload.piId;
  const denied = await authorizePageAction(context, PI_PAGE_KEY, isCreate ? "create" : "update");
  if (denied) return denied;

  const { supabase, appUser } = context;

  const { data, error } = await supabase.rpc("save_permission_intervention", {
    p_tenant_id: appUser.tenant_id,
    p_actor_user_id: appUser.id,
    p_pi_id: payload.piId ?? null,
    p_payload: payload.data ?? {},
    p_expected_updated_at: normalizeExpectedUpdatedAt(payload.expectedUpdatedAt),
  });

  if (error) return jsonError("Falha ao salvar a PI.", 500);
  return rpcResponse((data ?? {}) as RpcResult, "Falha ao salvar a PI.");
}

export type SavePiExecutionPlanPayload = {
  expectedUpdatedAt?: string;
  steps?: unknown[];
};

export async function savePermissionInterventionExecutionPlan(
  context: AuthenticatedAppUserContext,
  piId: string,
  payload: SavePiExecutionPlanPayload,
) {
  const denied = await authorizePageAction(context, PI_PAGE_KEY, "update");
  if (denied) return denied;

  const { supabase, appUser } = context;

  const { data, error } = await supabase.rpc("save_pi_execution_steps", {
    p_tenant_id: appUser.tenant_id,
    p_actor_user_id: appUser.id,
    p_pi_id: piId,
    p_steps: payload.steps ?? [],
    p_expected_updated_at: normalizeExpectedUpdatedAt(payload.expectedUpdatedAt),
  });

  if (error) return jsonError("Falha ao salvar o Plano de Execucao.", 500);
  return rpcResponse((data ?? {}) as RpcResult, "Falha ao salvar o Plano de Execucao.");
}

export type ChangePiStatusPayload = {
  action?: string;
  reason?: string;
  expectedUpdatedAt?: string;
};

export async function changePermissionInterventionStatus(
  context: AuthenticatedAppUserContext,
  piId: string,
  payload: ChangePiStatusPayload,
) {
  const action = String(payload.action ?? "").trim().toUpperCase();

  // Cancelar usa a permissao de cancelamento; as demais transicoes sao edicao.
  const denied = await authorizePageAction(context, PI_PAGE_KEY, action === "CANCEL" ? "cancel" : "update");
  if (denied) return denied;

  const { supabase, appUser } = context;

  const { data, error } = await supabase.rpc("set_permission_intervention_status", {
    p_tenant_id: appUser.tenant_id,
    p_actor_user_id: appUser.id,
    p_pi_id: piId,
    p_action: action,
    p_reason: payload.reason ?? null,
    p_expected_updated_at: normalizeExpectedUpdatedAt(payload.expectedUpdatedAt),
  });

  if (error) return jsonError("Falha ao alterar o status da PI.", 500);
  return rpcResponse((data ?? {}) as RpcResult, "Falha ao alterar o status da PI.");
}

export type LinkPiPayload = {
  programmingId?: string | null;
  reason?: string;
  expectedUpdatedAt?: string;
};

export async function linkPermissionInterventionToProgramming(
  context: AuthenticatedAppUserContext,
  piId: string,
  payload: LinkPiPayload,
) {
  const denied = await authorizePageAction(context, PI_PAGE_KEY, "update");
  if (denied) return denied;

  const { supabase, appUser } = context;

  const { data, error } = await supabase.rpc("link_permission_intervention_to_programming", {
    p_tenant_id: appUser.tenant_id,
    p_actor_user_id: appUser.id,
    p_pi_id: piId,
    p_programming_id: payload.programmingId ?? null,
    p_reason: payload.reason ?? null,
    p_expected_updated_at: normalizeExpectedUpdatedAt(payload.expectedUpdatedAt),
  });

  if (error) return jsonError("Falha ao vincular a PI a Programacao.", 500);
  return rpcResponse((data ?? {}) as RpcResult, "Falha ao vincular a PI a Programacao.");
}
