import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import {
  buildConcurrencyConflictResponse,
  hasUpdatedAtConflict,
  normalizeExpectedUpdatedAt,
} from "@/lib/server/concurrency";

type ActivityRow = {
  id: string;
  code: string;
  description: string;
  team_type_id: string;
  type_service: string;
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
  description: string;
  teamTypeId: string;
  categoryId: string;
  group?: string;
  value: string | number;
  voicePoint: string | number;
  unit: string;
  scope?: string;
};

type UpdateActivityPayload = CreateActivityPayload & {
  id: string;
  expectedUpdatedAt?: string | null;
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

function parsePositiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeNullableText(value: unknown) {
  const normalized = normalizeText(value);
  return normalized || null;
}

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

function normalizeDecimal(value: unknown) {
  const raw = String(value ?? "").trim().replace(",", ".");
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  return Number(numeric.toFixed(2));
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
    description: normalizeText(payload.description),
    teamTypeId: normalizeText(payload.teamTypeId),
    categoryId: normalizeText(payload.categoryId),
    group: normalizeNullableText(payload.group),
    value: normalizeDecimal(payload.value),
    voicePoint: normalizePositiveDecimal(payload.voicePoint),
    unit: normalizeText(payload.unit),
    scope: normalizeNullableText(payload.scope),
  };
}

function formatComparableValue(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toFixed(2) : null;
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  const normalized = String(value).trim();
  return normalized || null;
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

function addChange(
  changes: Record<string, HistoryChange>,
  field: string,
  previousValue: unknown,
  nextValue: unknown,
) {
  const from = formatComparableValue(previousValue);
  const to = formatComparableValue(nextValue);

  if (from === to) {
    return;
  }

  changes[field] = { from, to };
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

function normalizeHistoryChanges(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, HistoryChange>;
  }

  const result: Record<string, HistoryChange> = {};
  for (const [field, rawChange] of Object.entries(value as Record<string, unknown>)) {
    if (!rawChange || typeof rawChange !== "object" || Array.isArray(rawChange)) {
      continue;
    }

    const from = formatComparableValue((rawChange as { from?: unknown }).from);
    const to = formatComparableValue((rawChange as { to?: unknown }).to);
    result[field] = { from, to };
  }

  return result;
}

function buildUserDisplayMap(users: AppUserRow[]) {
  return new Map(
    users.map((user) => [
      user.id,
      String(user.display ?? user.login_name ?? "").trim() || "Nao identificado",
    ]),
  );
}

function buildUserLoginNameMap(users: AppUserRow[]) {
  return new Map(
    users.map((user) => [user.id, String(user.login_name ?? "").trim() || "Nao identificado"]),
  );
}

function buildTeamTypeMap(teamTypes: TeamTypeRow[]) {
  return new Map(teamTypes.map((teamType) => [teamType.id, String(teamType.name ?? "").trim() || "Nao identificado"]));
}

function buildTypeServiceMap(typeServices: TypeServiceActivityRow[]) {
  return new Map(
    typeServices.map((typeService) => [typeService.id, String(typeService.name ?? "").trim() || "Nao identificado"]),
  );
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

async function fetchActivityById(
  supabase: SupabaseClient,
  tenantId: string,
  activityId: string,
) {
  const { data, error } = await supabase
    .from("service_activities")
    .select(
      "id, code, description, team_type_id, type_service, group_name, unit_value, voice_point, unit, scope, ativo, cancellation_reason, canceled_at, canceled_by, created_by, updated_by, created_at, updated_at",
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

async function saveActivityViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  activityId: string | null;
  code: string;
  description: string;
  teamTypeId: string;
  categoryId: string;
  group: string | null;
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
    p_description: params.description,
    p_team_type_id: params.teamTypeId,
    p_type_service: params.categoryId,
    p_group_name: params.group,
    p_unit_value: params.value,
    p_voice_point: params.voicePoint,
    p_unit: params.unit,
    p_scope: params.scope,
    p_changes: params.changes ?? {},
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
  });

  if (error) {
    return { ok: false, status: 500, message: "Falha ao salvar atividade." } as const;
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
    const page = parsePositiveInteger(params.get("page"), 1);
    const pageSize = Math.min(parsePositiveInteger(params.get("pageSize"), 20), 100);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("service_activities")
      .select(
        "id, code, description, team_type_id, type_service, group_name, unit_value, voice_point, unit, scope, ativo, cancellation_reason, canceled_at, canceled_by, created_by, updated_by, created_at, updated_at",
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
        description: row.description,
        teamTypeId: row.team_type_id,
        teamTypeName: teamTypeMap.get(row.team_type_id) ?? "Nao identificado",
        categoryId: row.type_service,
        categoryName: typeServiceMap.get(row.type_service) ?? "Nao identificado",
        group: row.group_name ?? "",
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
    const body = (await request.json().catch(() => ({}))) as Partial<CreateActivityPayload>;
    const input = parseActivityInput(body);

    if (
      !input.code
      || !input.description
      || !input.teamTypeId
      || !input.categoryId
      || input.value === null
      || input.voicePoint === null
      || !input.unit
    ) {
      return NextResponse.json({ message: "Preencha todos os campos obrigatorios da atividade." }, { status: 400 });
    }

    const unitValue = input.value as number;
    const voicePoint = input.voicePoint as number;

    if (!(await fetchTeamTypeById(supabase, appUser.tenant_id, input.teamTypeId))) {
      return NextResponse.json({ message: "Tipo invalido para o tenant atual." }, { status: 422 });
    }

    if (!(await fetchTypeServiceById(supabase, appUser.tenant_id, input.categoryId))) {
      return NextResponse.json({ message: "Categoria invalida para o tenant atual." }, { status: 422 });
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
      description: input.description,
      teamTypeId: input.teamTypeId,
      categoryId: input.categoryId,
      group: input.group,
      value: unitValue,
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
      || input.value === null
      || input.voicePoint === null
      || !input.unit
    ) {
      return NextResponse.json({ message: "Preencha todos os campos obrigatorios da atividade." }, { status: 400 });
    }

    const unitValue = input.value as number;
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
    addChange(changes, "description", currentActivity.description, input.description);
    addChange(changes, "teamTypeName", currentTeamType?.name ?? null, nextTeamType.name);
    addChange(changes, "categoryName", currentTypeService?.name ?? null, nextTypeService.name);
    addChange(changes, "group", currentActivity.group_name, input.group);
    addDecimalChange(changes, "value", currentActivity.unit_value, unitValue, 2);
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
      description: input.description,
      teamTypeId: input.teamTypeId,
      categoryId: input.categoryId,
      group: input.group,
      value: unitValue,
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
