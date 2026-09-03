import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import {
  buildConcurrencyConflictResponse,
  hasUpdatedAtConflict,
  normalizeExpectedUpdatedAt,
} from "@/lib/server/concurrency";
import {
  addChange,
  buildNameMap,
  buildUserDisplayMap,
  buildUserLoginNameMap,
  formatComparableValue,
  normalizeHistoryChanges,
  normalizeNullableText,
  normalizeText,
  parsePagination,
  parsePositiveInteger,
} from "@/lib/server/apiHelpers";
import { MASS_IMPORT_ROW_LIMIT } from "@/lib/constants/massImport";
import { authorizePageAction } from "@/lib/server/routeAuthorization";

type ActivityRow = {
  id: string;
  code: string;
  code_idd: string | null;
  description: string;
  team_type_id: string;
  type_service: string;
  group_id: string | null;
  group_name: string | null;
  unit_value: number | string;
  voice_point: number | string | null;
  unit: string;
  scope: string | null;
  ativo: boolean;
  cancellation_reason: string | null;
  canceled_at: string | null;
  canceled_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

type TeamTypeRow = {
  id: string;
  name: string;
};

type TypeServiceActivityRow = {
  id: string;
  name: string;
};

type ActivityGroupRow = {
  id: string;
  name: string;
  unit_value: number | string;
};

type ActivityHistoryRow = {
  id: string;
  change_type: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason: string | null;
  changes: unknown;
  created_at: string;
  created_by: string | null;
};

type HistoryChange = {
  from: string | null;
  to: string | null;
};

type CreateActivityPayload = {
  code: string;
  codeIdd?: string | null;
  description: string;
  teamTypeId: string;
  categoryId: string;
  groupId: string;
  voicePoint: string | number;
  unit: string;
  scope?: string;
};

type UpdateActivityPayload = CreateActivityPayload & {
  id: string;
  expectedUpdatedAt?: string | null;
};

type ActivityBatchImportPayload = {
  action?: "BATCH_IMPORT";
  rows?: Array<Partial<CreateActivityPayload> & { rowNumber?: number }>;
};

type UpdateActivityStatusPayload = {
  id: string;
  reason: string;
  action?: "cancel" | "activate";
  expectedUpdatedAt?: string | null;
};

type ActivityCodePrecheckResult = {
  success?: boolean;
  reason?: string;
};

type ActivitySaveRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  activity_id?: string;
  updated_at?: string;
};

type ActivityRpcError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

function normalizeCode(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function parseActivityStatusFilter(value: string | null) {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === "ATIVO") {
    return true;
  }
  if (normalized === "INATIVO") {
    return false;
  }
  return null;
}

function normalizePositiveDecimal(value: unknown) {
  const raw = String(value ?? "").trim().replace(",", ".");
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Number(numeric.toFixed(6));
}

function parseActivityInput(payload: Partial<CreateActivityPayload>) {
  return {
    code: normalizeCode(payload.code),
    codeIdd: normalizeNullableText(payload.codeIdd),
    description: normalizeText(payload.description),
    teamTypeId: normalizeText(payload.teamTypeId),
    categoryId: normalizeText(payload.categoryId),
    groupId: normalizeText(payload.groupId),
    voicePoint: normalizePositiveDecimal(payload.voicePoint),
    unit: normalizeText(payload.unit),
    scope: normalizeNullableText(payload.scope),
  };
}

function formatComparableDecimal(value: unknown, fractionDigits: number) {
  if (value === null || value === undefined) {
    return null;
  }

  const numericValue = typeof value === "number" ? value : Number(String(value).trim().replace(",", "."));
  if (!Number.isFinite(numericValue)) {
    return formatComparableValue(value);
  }

  return numericValue.toFixed(fractionDigits);
}

function addDecimalChange(
  changes: Record<string, HistoryChange>,
  field: string,
  previousValue: unknown,
  nextValue: unknown,
  fractionDigits: number,
) {
  const from = formatComparableDecimal(previousValue, fractionDigits);
  const to = formatComparableDecimal(nextValue, fractionDigits);

  if (from === to) {
    return;
  }

  changes[field] = { from, to };
}

function buildTeamTypeMap(teamTypes: TeamTypeRow[]) {
  return buildNameMap(teamTypes);
}

function buildTypeServiceMap(typeServices: TypeServiceActivityRow[]) {
  return buildNameMap(typeServices);
}

function mapCodeConflictReasonToMessage(reason: string | undefined) {
  if (reason === "CODE_ALREADY_EXISTS") {
    return { status: 409, message: "Ja existe atividade com este codigo no tenant atual." };
  }

  if (reason === "TENANT_REQUIRED") {
    return { status: 400, message: "Tenant obrigatorio para validar codigo da atividade." };
  }

  if (reason === "CODE_REQUIRED") {
    return { status: 400, message: "Codigo obrigatorio para validar atividade." };
  }

  return { status: 500, message: "Falha ao validar codigo da atividade." };
}

function formatDatabaseEventMessage(error: ActivityRpcError) {
  const message = normalizeText(error.message);
  if (!message) {
    return "";
  }

  return ` Evento do banco: ${message.slice(0, 240)}`;
}

function mapActivitySaveRpcError(error: ActivityRpcError) {
  const normalized = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();

  if (error.code === "PGRST202" || normalized.includes("schema cache")) {
    return {
      message:
        "RPC save_service_activity_record indisponivel ou com assinatura desatualizada. Aplique a migration 404 e recarregue o schema cache do Supabase.",
      reason: "ACTIVITY_RPC_SCHEMA_MISMATCH",
    };
  }

  if (error.code === "42804" && normalized.includes("code_idd")) {
    return {
      message: `Coluna Cod. SAP esta com tipo incorreto no banco. Aplique a migration 406 para converter service_activities.code_idd para text.${formatDatabaseEventMessage(error)}`,
      reason: "ACTIVITY_CODE_IDD_TYPE_MISMATCH",
    };
  }

  if (error.code === "23505" || normalized.includes("duplicate key")) {
    return {
      message: "Ja existe atividade com este codigo no tenant atual.",
      reason: "DUPLICATE_ACTIVITY_CODE",
    };
  }

  if (error.code === "23503" && normalized.includes("team_type")) {
    return {
      message: "Tipo de equipe invalido ou removido antes do salvamento.",
      reason: "INVALID_TEAM_TYPE",
    };
  }

  if (error.code === "23503" && (normalized.includes("type_service") || normalized.includes("types_service_activities"))) {
    return {
      message: "Categoria invalida ou removida antes do salvamento.",
      reason: "INVALID_CATEGORY",
    };
  }

  if (error.code === "23503" && normalized.includes("activity_group")) {
    return {
      message: "Grupo invalido ou removido antes do salvamento.",
      reason: "INVALID_GROUP",
    };
  }

  if (error.code === "23502") {
    return {
      message:
        "Campo obrigatorio ausente no salvamento da atividade. Confira codigo, descricao, tipo, categoria, grupo, pontos e unidade.",
      reason: "INVALID_ACTIVITY",
    };
  }

  return {
    message: `Falha tecnica ao salvar atividade (codigo ${error.code ?? "sem codigo"}). Consulte os logs da API para o detalhe do banco.`,
    reason: "ACTIVITY_SAVE_RPC_ERROR",
  };
}

async function fetchActivityById(
  supabase: SupabaseClient,
  tenantId: string,
  activityId: string,
) {
  const { data, error } = await supabase
    .from("service_activities")
    .select(
      "id, code, code_idd, description, team_type_id, type_service, group_id, group_name, unit_value, voice_point, unit, scope, ativo, cancellation_reason, canceled_at, canceled_by, created_by, updated_by, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("id", activityId)
    .maybeSingle<ActivityRow>();

  if (error || !data) {
    return null;
  }

  return data;
}

async function fetchTeamTypeById(
  supabase: SupabaseClient,
  tenantId: string,
  teamTypeId: string,
) {
  const { data, error } = await supabase
    .from("team_types")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .eq("id", teamTypeId)
    .maybeSingle<TeamTypeRow>();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    name: normalizeText(data.name),
  };
}

async function fetchTypeServiceById(
  supabase: SupabaseClient,
  tenantId: string,
  typeServiceId: string,
) {
  const { data, error } = await supabase
    .from("types_service_activities")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .eq("id", typeServiceId)
    .maybeSingle<TypeServiceActivityRow>();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    name: normalizeText(data.name),
  };
}

async function fetchActivityGroupById(
  supabase: SupabaseClient,
  tenantId: string,
  activityGroupId: string,
) {
  const { data, error } = await supabase
    .from("activity_groups")
    .select("id, name, unit_value")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .eq("id", activityGroupId)
    .maybeSingle<ActivityGroupRow>();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    name: normalizeText(data.name),
    unitValue: Number(data.unit_value ?? 0),
  };
}

async function saveActivityViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  activityId: string | null;
  code: string;
  codeIdd: string | null;
  description: string;
  teamTypeId: string;
  categoryId: string;
  groupId: string;
  value: number;
  voicePoint: number;
  unit: string;
  scope: string | null;
  changes?: Record<string, HistoryChange>;
  expectedUpdatedAt?: string | null;
}) {
  const { data, error } = await params.supabase.rpc("save_service_activity_record", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_activity_id: params.activityId,
    p_code: params.code,
    p_code_idd: params.codeIdd,
    p_description: params.description,
    p_team_type_id: params.teamTypeId,
    p_type_service: params.categoryId,
    p_group_id: params.groupId,
    p_unit_value: params.value,
    p_voice_point: params.voicePoint,
    p_unit: params.unit,
    p_scope: params.scope,
    p_changes: params.changes ?? {},
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
  });

  if (error) {
    const mappedError = mapActivitySaveRpcError(error);
    return { ok: false, status: 500, message: mappedError.message, reason: mappedError.reason } as const;
  }

  const result = (data ?? {}) as ActivitySaveRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 500),
      message: result.message ?? "Falha ao salvar atividade.",
      reason: result.reason ?? null,
    } as const;
  }

  return { ok: true, updatedAt: result.updated_at ?? null } as const;
}


async function importActivityBatch(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  rows: Array<Partial<CreateActivityPayload> & { rowNumber?: number }>;
}) {
  const results: Array<{ rowNumber: number; success: boolean; message: string; code?: string }> = [];
  const validTeamTypeIds = new Map<string, boolean>();
  const validCategoryIds = new Map<string, boolean>();
  const validGroupsById = new Map<string, Awaited<ReturnType<typeof fetchActivityGroupById>>>();
  let savedCount = 0;

  for (const [index, row] of params.rows.entries()) {
    const rowNumber = Number.isInteger(Number(row.rowNumber)) && Number(row.rowNumber) > 0 ? Number(row.rowNumber) : index + 2;
    const input = parseActivityInput(row);

    if (
      !input.code
      || !input.description
      || !input.teamTypeId
      || !input.categoryId
      || !input.groupId
      || input.voicePoint === null
      || !input.unit
    ) {
      results.push({
        rowNumber,
        success: false,
        message: "Preencha todos os campos obrigatorios da atividade.",
        code: "INVALID_ACTIVITY",
      });
      continue;
    }

    if (!validTeamTypeIds.has(input.teamTypeId)) {
      validTeamTypeIds.set(
        input.teamTypeId,
        Boolean(await fetchTeamTypeById(params.supabase, params.tenantId, input.teamTypeId)),
      );
    }

    if (!validTeamTypeIds.get(input.teamTypeId)) {
      results.push({ rowNumber, success: false, message: "Tipo invalido para o tenant atual.", code: "INVALID_TEAM_TYPE" });
      continue;
    }

    if (!validCategoryIds.has(input.categoryId)) {
      validCategoryIds.set(
        input.categoryId,
        Boolean(await fetchTypeServiceById(params.supabase, params.tenantId, input.categoryId)),
      );
    }

    if (!validCategoryIds.get(input.categoryId)) {
      results.push({ rowNumber, success: false, message: "Categoria invalida para o tenant atual.", code: "INVALID_CATEGORY" });
      continue;
    }

    if (!validGroupsById.has(input.groupId)) {
      validGroupsById.set(
        input.groupId,
        await fetchActivityGroupById(params.supabase, params.tenantId, input.groupId),
      );
    }

    const activityGroup = validGroupsById.get(input.groupId);
    if (!activityGroup) {
      results.push({ rowNumber, success: false, message: "Grupo invalido para o tenant atual.", code: "INVALID_GROUP" });
      continue;
    }

    const { data: precheck, error: precheckError } = await params.supabase.rpc("precheck_activity_code_conflict", {
      p_tenant_id: params.tenantId,
      p_activity_id: null,
      p_code: input.code,
    });

    const precheckResult = precheckError ? null : ((precheck ?? null) as ActivityCodePrecheckResult | null);
    if (!precheckResult?.success) {
      const mapped = mapCodeConflictReasonToMessage(precheckResult?.reason);
      results.push({
        rowNumber,
        success: false,
        message: mapped.message,
        code: mapped.status === 409 ? "DUPLICATE_ACTIVITY_CODE" : undefined,
      });
      continue;
    }

    const saveResult = await saveActivityViaRpc({
      supabase: params.supabase,
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      activityId: null,
      code: input.code,
      codeIdd: input.codeIdd,
      description: input.description,
      teamTypeId: input.teamTypeId,
      categoryId: input.categoryId,
      groupId: input.groupId,
      value: activityGroup.unitValue,
      voicePoint: input.voicePoint as number,
      unit: input.unit,
      scope: input.scope,
    });

    if (!saveResult.ok) {
      results.push({ rowNumber, success: false, message: saveResult.message, code: saveResult.reason ?? undefined });
      continue;
    }

    savedCount += 1;
    results.push({ rowNumber, success: true, message: `Atividade ${input.code} cadastrada com sucesso.` });
  }

  return {
    success: true,
    savedCount,
    errorCount: results.filter((result) => !result.success).length,
    results,
  };
}

async function setActivityStatusViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  activityId: string;
  action: "ACTIVATE" | "CANCEL";
  reason: string;
  expectedUpdatedAt: string | null;
}) {
  const { data, error } = await params.supabase.rpc("set_service_activity_record_status", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_activity_id: params.activityId,
    p_action: params.action,
    p_reason: params.reason,
    p_expected_updated_at: params.expectedUpdatedAt,
  });

  if (error) {
    return { ok: false, status: 500, message: "Falha ao atualizar status da atividade." } as const;
  }

  const result = (data ?? {}) as ActivitySaveRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 500),
      message: result.message ?? "Falha ao atualizar status da atividade.",
      reason: result.reason ?? null,
    } as const;
  }

  return { ok: true, updatedAt: result.updated_at ?? null } as const;
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para consultar atividades.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const params = request.nextUrl.searchParams;
    const historyActivityId = normalizeText(params.get("historyActivityId"));

    if (historyActivityId) {
      const activity = await fetchActivityById(supabase, appUser.tenant_id, historyActivityId);
      if (!activity) {
        return NextResponse.json({ message: "Atividade nao encontrada." }, { status: 404 });
      }

      const historyPage = parsePositiveInteger(params.get("historyPage"), 1);
      const historyPageSize = Math.min(parsePositiveInteger(params.get("historyPageSize"), 5), 30);
      const historyFrom = (historyPage - 1) * historyPageSize;
      const historyTo = historyFrom + historyPageSize - 1;

      const { data: historyData, error: historyError, count: historyCount } = await supabase
        .from("app_entity_history")
        .select("id, change_type, reason, changes, created_at, created_by", { count: "exact" })
        .eq("tenant_id", appUser.tenant_id)
        .eq("module_key", "atividades")
        .eq("entity_table", "service_activities")
        .eq("entity_id", historyActivityId)
        .order("created_at", { ascending: false })
        .range(historyFrom, historyTo)
        .returns<ActivityHistoryRow[]>();

      if (historyError) {
        return NextResponse.json({ message: "Falha ao carregar historico da atividade." }, { status: 500 });
      }

      const userIds = Array.from(
        new Set((historyData ?? []).map((entry) => entry.created_by).filter((value): value is string => Boolean(value))),
      );

      let users: AppUserRow[] = [];
      if (userIds.length > 0) {
        const usersResult = await supabase
          .from("app_users")
          .select("id, display, login_name")
          .eq("tenant_id", appUser.tenant_id)
          .in("id", userIds)
          .returns<AppUserRow[]>();

        if (!usersResult.error) {
          users = usersResult.data ?? [];
        }
      }

      const userDisplayMap = buildUserDisplayMap(users);

      return NextResponse.json({
        activity: {
          id: activity.id,
          code: activity.code,
          isActive: activity.ativo,
        },
        history: (historyData ?? []).map((entry) => ({
          id: entry.id,
          changeType: entry.change_type,
          reason: entry.reason,
          changes: normalizeHistoryChanges(entry.changes),
          createdAt: entry.created_at,
          createdByName: userDisplayMap.get(entry.created_by ?? "") ?? "Nao identificado",
        })),
        pagination: {
          page: historyPage,
          pageSize: historyPageSize,
          total: historyCount ?? 0,
        },
      });
    }

    const code = normalizeText(params.get("code"));
    const description = normalizeText(params.get("description"));
    const teamTypeId = normalizeText(params.get("teamTypeId"));
    const categoryId = normalizeText(params.get("categoryId"));
    const groupName = normalizeText(params.get("group"));
    const statusFilter = parseActivityStatusFilter(params.get("status"));
    const { page, pageSize, from, to } = parsePagination(params);

    let query = supabase
      .from("service_activities")
      .select(
        "id, code, code_idd, description, team_type_id, type_service, group_id, group_name, unit_value, voice_point, unit, scope, ativo, cancellation_reason, canceled_at, canceled_by, created_by, updated_by, created_at, updated_at",
        { count: "exact" },
      )
      .eq("tenant_id", appUser.tenant_id);

    if (code) {
      query = query.ilike("code", `%${code}%`);
    }

    if (description) {
      query = query.ilike("description", `%${description}%`);
    }

    if (teamTypeId) {
      query = query.eq("team_type_id", teamTypeId);
    }

    if (categoryId) {
      query = query.eq("type_service", categoryId);
    }

    if (groupName) {
      query = query.ilike("group_name", `%${groupName}%`);
    }

    if (statusFilter !== null) {
      query = query.eq("ativo", statusFilter);
    }

    const { data, error, count } = await query
      .order("ativo", { ascending: false })
      .order("code", { ascending: true })
      .range(from, to)
      .returns<ActivityRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao listar atividades." }, { status: 500 });
    }

    const userIds = Array.from(
      new Set(
        (data ?? [])
          .flatMap((item) => [item.created_by, item.updated_by, item.canceled_by])
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const teamTypeIds = Array.from(
      new Set((data ?? []).map((item) => item.team_type_id).filter((value): value is string => Boolean(value))),
    );
    const typeServiceIds = Array.from(
      new Set((data ?? []).map((item) => item.type_service).filter((value): value is string => Boolean(value))),
    );

    let users: AppUserRow[] = [];
    if (userIds.length > 0) {
      const usersResult = await supabase
        .from("app_users")
        .select("id, display, login_name")
        .eq("tenant_id", appUser.tenant_id)
        .in("id", userIds)
        .returns<AppUserRow[]>();

      if (!usersResult.error) {
        users = usersResult.data ?? [];
      }
    }

    let teamTypes: TeamTypeRow[] = [];
    if (teamTypeIds.length > 0) {
      const teamTypesResult = await supabase
        .from("team_types")
        .select("id, name")
        .eq("tenant_id", appUser.tenant_id)
        .in("id", teamTypeIds)
        .returns<TeamTypeRow[]>();

      if (!teamTypesResult.error) {
        teamTypes = teamTypesResult.data ?? [];
      }
    }

    let typeServices: TypeServiceActivityRow[] = [];
    if (typeServiceIds.length > 0) {
      const typeServicesResult = await supabase
        .from("types_service_activities")
        .select("id, name")
        .eq("tenant_id", appUser.tenant_id)
        .in("id", typeServiceIds)
        .returns<TypeServiceActivityRow[]>();

      if (!typeServicesResult.error) {
        typeServices = typeServicesResult.data ?? [];
      }
    }

    const userDisplayMap = buildUserDisplayMap(users);
    const userLoginNameMap = buildUserLoginNameMap(users);
    const teamTypeMap = buildTeamTypeMap(teamTypes);
    const typeServiceMap = buildTypeServiceMap(typeServices);

    return NextResponse.json({
      activities: (data ?? []).map((row) => ({
        id: row.id,
        code: row.code,
        codeIdd: row.code_idd ?? "",
        description: row.description,
        teamTypeId: row.team_type_id,
        teamTypeName: teamTypeMap.get(row.team_type_id) ?? "Nao identificado",
        categoryId: row.type_service,
        categoryName: typeServiceMap.get(row.type_service) ?? "Nao identificado",
        groupId: row.group_id ?? "",
        groupName: row.group_name ?? "",
        value: Number(row.unit_value ?? 0),
        voicePoint: row.voice_point === null ? null : Number(row.voice_point ?? 0),
        unit: row.unit,
        scope: row.scope ?? "",
        isActive: Boolean(row.ativo),
        cancellationReason: row.cancellation_reason,
        canceledAt: row.canceled_at,
        canceledByName: row.canceled_by ? userDisplayMap.get(row.canceled_by) ?? "Nao identificado" : null,
        createdByName: row.created_by ? userLoginNameMap.get(row.created_by) ?? "Nao identificado" : "Nao identificado",
        updatedByName: row.updated_by ? userDisplayMap.get(row.updated_by) ?? "Nao identificado" : "Nao identificado",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      pagination: {
        page,
        pageSize,
        total: count ?? 0,
      },
    });
  } catch {
    return NextResponse.json({ message: "Falha ao listar atividades." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para cadastrar atividades.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as Partial<CreateActivityPayload> & ActivityBatchImportPayload;

    if (normalizeText(body.action).toUpperCase() === "BATCH_IMPORT") {
      const authorizationError = await authorizePageAction(resolution, "atividades", "import");
      if (authorizationError) {
        return authorizationError;
      }

      const rows = Array.isArray(body.rows) ? body.rows : [];

      if (!rows.length) {
        return NextResponse.json({ message: "Nenhuma linha valida enviada para cadastro em massa." }, { status: 400 });
      }

      if (rows.length > MASS_IMPORT_ROW_LIMIT) {
        return NextResponse.json(
          { message: `Cadastro em massa limitado a ${MASS_IMPORT_ROW_LIMIT} linhas por arquivo.` },
          { status: 400 },
        );
      }

      const batchResult = await importActivityBatch({
        supabase,
        tenantId: appUser.tenant_id,
        actorUserId: appUser.id,
        rows,
      });

      return NextResponse.json({
        ...batchResult,
        message:
          batchResult.errorCount > 0
            ? `Cadastro em massa processado com ${batchResult.savedCount} atividades salvas e ${batchResult.errorCount} linhas com erro.`
            : `Cadastro em massa concluido com ${batchResult.savedCount} atividades salvas.`,
      });
    }

    const authorizationError = await authorizePageAction(resolution, "atividades", "create");
    if (authorizationError) {
      return authorizationError;
    }

    const input = parseActivityInput(body);

    if (
      !input.code
      || !input.description
      || !input.teamTypeId
      || !input.categoryId
      || !input.groupId
      || input.voicePoint === null
      || !input.unit
    ) {
      return NextResponse.json({ message: "Preencha todos os campos obrigatorios da atividade." }, { status: 400 });
    }

    const voicePoint = input.voicePoint as number;

    if (!(await fetchTeamTypeById(supabase, appUser.tenant_id, input.teamTypeId))) {
      return NextResponse.json({ message: "Tipo invalido para o tenant atual." }, { status: 422 });
    }

    if (!(await fetchTypeServiceById(supabase, appUser.tenant_id, input.categoryId))) {
      return NextResponse.json({ message: "Categoria invalida para o tenant atual." }, { status: 422 });
    }

    const activityGroup = await fetchActivityGroupById(supabase, appUser.tenant_id, input.groupId);
    if (!activityGroup) {
      return NextResponse.json({ message: "Grupo invalido para o tenant atual." }, { status: 422 });
    }

    const { data: precheck, error: precheckError } = await supabase.rpc("precheck_activity_code_conflict", {
      p_tenant_id: appUser.tenant_id,
      p_activity_id: null,
      p_code: input.code,
    });

    if (precheckError) {
      return NextResponse.json({ message: "Falha ao validar codigo da atividade." }, { status: 500 });
    }

    const precheckResult = (precheck ?? null) as ActivityCodePrecheckResult | null;
    if (!precheckResult?.success) {
      const mapped = mapCodeConflictReasonToMessage(precheckResult?.reason);
      return NextResponse.json({ message: mapped.message }, { status: mapped.status });
    }

    const saveResult = await saveActivityViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      activityId: null,
      code: input.code,
      codeIdd: input.codeIdd,
      description: input.description,
      teamTypeId: input.teamTypeId,
      categoryId: input.categoryId,
      groupId: input.groupId,
      value: activityGroup.unitValue,
      voicePoint,
      unit: input.unit,
      scope: input.scope,
    });

    if (!saveResult.ok) {
      return NextResponse.json({ message: saveResult.message, code: saveResult.reason ?? undefined }, { status: saveResult.status });
    }

    return NextResponse.json({
      success: true,
      message: `Atividade ${input.code} cadastrada com sucesso.`,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao cadastrar atividade." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para editar atividades.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorizationError = await authorizePageAction(resolution, "atividades", "update");
    if (authorizationError) {
      return authorizationError;
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as Partial<UpdateActivityPayload>;
    const activityId = normalizeText(body.id);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);
    const input = parseActivityInput(body);

    if (!activityId) {
      return NextResponse.json({ message: "Atividade invalida para edicao." }, { status: 400 });
    }

    if (!expectedUpdatedAt) {
      return NextResponse.json({ message: "Atualize a lista antes de editar a atividade." }, { status: 400 });
    }

    if (
      !input.code
      || !input.description
      || !input.teamTypeId
      || !input.categoryId
      || !input.groupId
      || input.voicePoint === null
      || !input.unit
    ) {
      return NextResponse.json({ message: "Preencha todos os campos obrigatorios da atividade." }, { status: 400 });
    }

    const voicePoint = input.voicePoint as number;

    const currentActivity = await fetchActivityById(supabase, appUser.tenant_id, activityId);
    if (!currentActivity) {
      return NextResponse.json({ message: "Atividade nao encontrada." }, { status: 404 });
    }

    if (hasUpdatedAtConflict(expectedUpdatedAt, currentActivity.updated_at)) {
      return buildConcurrencyConflictResponse(
        `A atividade ${currentActivity.code} foi alterada por outro usuario. Recarregue os dados antes de salvar novamente.`,
      );
    }

    if (!currentActivity.ativo) {
      return buildConcurrencyConflictResponse("Ative a atividade antes de editar.", "RECORD_INACTIVE");
    }

    const currentTeamType = await fetchTeamTypeById(supabase, appUser.tenant_id, currentActivity.team_type_id);
    const nextTeamType = await fetchTeamTypeById(supabase, appUser.tenant_id, input.teamTypeId);
    if (!nextTeamType) {
      return NextResponse.json({ message: "Tipo invalido para o tenant atual." }, { status: 422 });
    }

    const currentTypeService = await fetchTypeServiceById(supabase, appUser.tenant_id, currentActivity.type_service);
    const nextTypeService = await fetchTypeServiceById(supabase, appUser.tenant_id, input.categoryId);
    if (!nextTypeService) {
      return NextResponse.json({ message: "Categoria invalida para o tenant atual." }, { status: 422 });
    }

    const nextActivityGroup = await fetchActivityGroupById(supabase, appUser.tenant_id, input.groupId);
    if (!nextActivityGroup) {
      return NextResponse.json({ message: "Grupo invalido para o tenant atual." }, { status: 422 });
    }

    const { data: precheck, error: precheckError } = await supabase.rpc("precheck_activity_code_conflict", {
      p_tenant_id: appUser.tenant_id,
      p_activity_id: activityId,
      p_code: input.code,
    });

    if (precheckError) {
      return NextResponse.json({ message: "Falha ao validar codigo da atividade." }, { status: 500 });
    }

    const precheckResult = (precheck ?? null) as ActivityCodePrecheckResult | null;
    if (!precheckResult?.success) {
      const mapped = mapCodeConflictReasonToMessage(precheckResult?.reason);
      return NextResponse.json({ message: mapped.message }, { status: mapped.status });
    }

    const changes: Record<string, HistoryChange> = {};
    addChange(changes, "code", currentActivity.code, input.code);
    addChange(changes, "codeIdd", currentActivity.code_idd, input.codeIdd);
    addChange(changes, "description", currentActivity.description, input.description);
    addChange(changes, "teamTypeName", currentTeamType?.name ?? null, nextTeamType.name);
    addChange(changes, "categoryName", currentTypeService?.name ?? null, nextTypeService.name);
    // O historico continua guardando o NOME do grupo, nao o id: e o que a tela
    // exibe. `group_name` da linha atual ja e o snapshot do nome anterior.
    addChange(changes, "group", currentActivity.group_name, nextActivityGroup.name);
    addDecimalChange(changes, "value", currentActivity.unit_value, nextActivityGroup.unitValue, 2);
    addDecimalChange(changes, "voicePoint", currentActivity.voice_point, voicePoint, 6);
    addChange(changes, "unit", currentActivity.unit, input.unit);
    addChange(changes, "scope", currentActivity.scope, input.scope);

    if (Object.keys(changes).length === 0) {
      return NextResponse.json({ success: true, message: `Nenhuma alteracao detectada na atividade ${currentActivity.code}.` });
    }

    const saveResult = await saveActivityViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      activityId,
      code: input.code,
      codeIdd: input.codeIdd,
      description: input.description,
      teamTypeId: input.teamTypeId,
      categoryId: input.categoryId,
      groupId: input.groupId,
      value: nextActivityGroup.unitValue,
      voicePoint,
      unit: input.unit,
      scope: input.scope,
      changes,
      expectedUpdatedAt,
    });

    if (!saveResult.ok) {
      return NextResponse.json({ message: saveResult.message, code: saveResult.reason ?? undefined }, { status: saveResult.status });
    }

    return NextResponse.json({
      success: true,
      message: `Atividade ${input.code} atualizada com sucesso.`,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao editar atividade." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para atualizar status de atividades.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as Partial<UpdateActivityStatusPayload>;
    const activityId = normalizeText(body.id);
    const reason = normalizeText(body.reason);
    const action = normalizeText(body.action).toLowerCase() === "activate" ? "ACTIVATE" : "CANCEL";

    const authorizationError = await authorizePageAction(resolution, "atividades", action === "ACTIVATE" ? "update" : "cancel");
    if (authorizationError) {
      return authorizationError;
    }

    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);

    if (!activityId) {
      return NextResponse.json({ message: "Atividade invalida para atualizar status." }, { status: 400 });
    }

    if (!expectedUpdatedAt) {
      return NextResponse.json({ message: "Atualize a lista antes de alterar o status da atividade." }, { status: 400 });
    }

    if (!reason) {
      return NextResponse.json(
        { message: action === "ACTIVATE" ? "Informe o motivo da ativacao." : "Informe o motivo do cancelamento." },
        { status: 400 },
      );
    }

    const currentActivity = await fetchActivityById(supabase, appUser.tenant_id, activityId);
    if (!currentActivity) {
      return NextResponse.json({ message: "Atividade nao encontrada." }, { status: 404 });
    }

    if (hasUpdatedAtConflict(expectedUpdatedAt, currentActivity.updated_at)) {
      return buildConcurrencyConflictResponse(
        `A atividade ${currentActivity.code} foi alterada por outro usuario. Recarregue os dados antes de alterar o status.`,
      );
    }

    if (action === "CANCEL" && !currentActivity.ativo) {
      return buildConcurrencyConflictResponse(`Atividade ${currentActivity.code} ja esta inativa.`, "STATUS_ALREADY_CHANGED");
    }

    if (action === "ACTIVATE" && currentActivity.ativo) {
      return buildConcurrencyConflictResponse(`Atividade ${currentActivity.code} ja esta ativa.`, "STATUS_ALREADY_CHANGED");
    }

    const statusResult = await setActivityStatusViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      activityId,
      action,
      reason,
      expectedUpdatedAt,
    });

    if (!statusResult.ok) {
      return NextResponse.json({ message: statusResult.message, code: statusResult.reason ?? undefined }, { status: statusResult.status });
    }

    return NextResponse.json({
      success: true,
      message:
        action === "ACTIVATE"
          ? `Atividade ${currentActivity.code} ativada com sucesso.`
          : `Atividade ${currentActivity.code} cancelada com sucesso.`,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao atualizar status da atividade." }, { status: 500 });
  }
}
