import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import {
  buildConcurrencyConflictResponse,
  hasUpdatedAtConflict,
  normalizeExpectedUpdatedAt,
} from "@/lib/server/concurrency";

type TeamRow = {
  id: string;
  name: string;
  vehicle_plate: string;
  service_center_id: string | null;
  team_type_id: string;
  foreman_person_id: string;
  ativo: boolean;
  cancellation_reason: string | null;
  canceled_at: string | null;
  canceled_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type ForemanRow = {
  id: string;
  nome: string;
  job_title_id: string;
};

type JobTitleIdRow = {
  id: string;
};

type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

type PersonRow = {
  id: string;
  nome: string;
};

type TeamTypeRow = {
  id: string;
  name: string;
};

type ServiceCenterRow = {
  id: string;
  name: string;
};

type ExistingTeamByForemanRow = {
  id: string;
  name: string;
  foreman_person_id: string;
};

type TeamHistoryRow = {
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

type CreateTeamPayload = {
  name: string;
  vehiclePlate: string;
  serviceCenterId: string;
  teamTypeId: string;
  foremanId: string;
};

type UpdateTeamPayload = CreateTeamPayload & {
  id: string;
  expectedUpdatedAt?: string | null;
};

type UpdateTeamStatusPayload = {
  id: string;
  reason: string;
  action?: "cancel" | "activate";
  expectedUpdatedAt?: string | null;
};

type TeamSaveRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  team_id?: string;
  updated_at?: string;
};

type DbErrorShape = {
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
};

const FOREMAN_JOB_TITLE_FILTER =
  "code.ilike.%ENCARREGADO%,name.ilike.%ENCARREGADO%,code.ilike.%SUPERVISOR%,name.ilike.%SUPERVISOR%";

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

function normalizePlate(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function normalizeDbErrorText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function isMissingFunctionError(error: unknown, functionName: string) {
  const rawMessage = normalizeDbErrorText((error as DbErrorShape | null)?.message);
  return rawMessage.includes("function") && rawMessage.includes(functionName.toLowerCase());
}

function isTeamDuplicateCombinationError(rawMessage: unknown) {
  const message = normalizeDbErrorText(rawMessage);
  if (!message.includes("duplicate key")) {
    return false;
  }

  return (
    message.includes("teams_tenant_foreman_name_plate_key")
    || message.includes("teams_tenant_id_name_key")
    || message.includes("teams_tenant_id_vehicle_plate_key")
  );
}

function mapTeamDbError(error: unknown, fallbackMessage: string) {
  const dbError = (error ?? {}) as DbErrorShape;
  const message = normalizeDbErrorText(dbError.message);
  const details = normalizeDbErrorText(dbError.details);
  const hint = normalizeDbErrorText(dbError.hint);
  const combined = `${message} ${details} ${hint}`.trim();

  if (isTeamDuplicateCombinationError(combined) || combined.includes("duplicate_team_combination")) {
    return {
      status: 409,
      message: "Ja existe equipe com o mesmo nome, encarregado e placa no tenant atual.",
      reason: "DUPLICATE_TEAM_COMBINATION",
    } as const;
  }

  if (combined.includes("teams_service_center_tenant_fk")) {
    return {
      status: 422,
      message: "Base invalida para o tenant atual.",
      reason: "INVALID_SERVICE_CENTER",
    } as const;
  }

  if (combined.includes("teams_team_type_tenant_fk")) {
    return {
      status: 422,
      message: "Tipo de equipe invalido para o tenant atual.",
      reason: "INVALID_TEAM_TYPE",
    } as const;
  }

  if (combined.includes("teams_foreman_person_tenant_fk")) {
    return {
      status: 422,
      message: "Encarregado invalido para o tenant atual.",
      reason: "INVALID_FOREMAN",
    } as const;
  }

  if (
    combined.includes("chk_teams_name_not_blank")
    || combined.includes("chk_teams_vehicle_plate_not_blank")
    || combined.includes("null value in column \"name\"")
    || combined.includes("null value in column \"vehicle_plate\"")
    || combined.includes("null value in column \"service_center_id\"")
    || combined.includes("null value in column \"team_type_id\"")
    || combined.includes("null value in column \"foreman_person_id\"")
  ) {
    return {
      status: 400,
      message: "Preencha todos os campos obrigatorios da equipe.",
      reason: "MISSING_REQUIRED_FIELDS",
    } as const;
  }

  if (combined.includes("save_team_record") && combined.includes("function")) {
    return {
      status: 500,
      message: "RPC save_team_record indisponivel no banco. Aplique a migration 077_create_admin_write_rpcs.sql.",
      reason: "RPC_MISSING",
    } as const;
  }

  if (combined.includes("set_team_record_status") && combined.includes("function")) {
    return {
      status: 500,
      message: "RPC set_team_record_status indisponivel no banco. Aplique a migration 077_create_admin_write_rpcs.sql.",
      reason: "RPC_MISSING",
    } as const;
  }

  const detailsMessage = [dbError.message, dbError.hint, dbError.details]
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .join(" | ");

  return {
    status: 500,
    message: detailsMessage ? `${fallbackMessage} ${detailsMessage}` : fallbackMessage,
    reason: null,
  } as const;
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

function buildForemanMap(people: PersonRow[]) {
  return new Map(people.map((person) => [person.id, String(person.nome ?? "").trim() || "Nao identificado"]));
}

function buildTeamTypeMap(teamTypes: TeamTypeRow[]) {
  return new Map(teamTypes.map((teamType) => [teamType.id, String(teamType.name ?? "").trim() || "Nao identificado"]));
}

async function fetchForemanJobTitleIds(supabase: SupabaseClient, tenantId: string) {
  const { data, error } = await supabase
    .from("job_titles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .or(FOREMAN_JOB_TITLE_FILTER)
    .returns<JobTitleIdRow[]>();

  if (error) {
    return [] as string[];
  }

  return (data ?? []).map((item) => item.id).filter(Boolean);
}

async function fetchForemanById(
  supabase: SupabaseClient,
  tenantId: string,
  foremanId: string,
) {
  const jobTitleIds = await fetchForemanJobTitleIds(supabase, tenantId);
  if (jobTitleIds.length === 0) {
    return null;
  }

  const { data, error } = await supabase
    .from("people")
    .select("id, nome, job_title_id")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .eq("id", foremanId)
    .in("job_title_id", jobTitleIds)
    .maybeSingle<ForemanRow>();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    name: normalizeText(data.nome),
  };
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

async function fetchServiceCenterById(
  supabase: SupabaseClient,
  tenantId: string,
  serviceCenterId: string,
) {
  const { data, error } = await supabase
    .from("project_service_centers")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .eq("id", serviceCenterId)
    .maybeSingle<ServiceCenterRow>();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    name: normalizeText(data.name),
  };
}

async function fetchTeamById(
  supabase: SupabaseClient,
  tenantId: string,
  teamId: string,
) {
  const { data, error } = await supabase
    .from("teams")
    .select(
      "id, name, vehicle_plate, service_center_id, team_type_id, foreman_person_id, ativo, cancellation_reason, canceled_at, canceled_by, created_by, updated_by, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("id", teamId)
    .maybeSingle<TeamRow>();

  if (error || !data) {
    return null;
  }

  return data;
}

async function fetchExistingTeamByForeman(params: {
  supabase: SupabaseClient;
  tenantId: string;
  foremanId: string;
  excludeTeamId?: string | null;
}) {
  let query = params.supabase
    .from("teams")
    .select("id, name, foreman_person_id")
    .eq("tenant_id", params.tenantId)
    .eq("foreman_person_id", params.foremanId)
    .limit(1);

  if (params.excludeTeamId) {
    query = query.neq("id", params.excludeTeamId);
  }

  const { data, error } = await query.returns<ExistingTeamByForemanRow[]>();
  if (error || !data || data.length === 0) {
    return null;
  }

  return data[0];
}

async function saveTeamViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  teamId: string | null;
  name: string;
  vehiclePlate: string;
  serviceCenterId: string;
  teamTypeId: string;
  foremanId: string;
  changes?: Record<string, HistoryChange>;
  expectedUpdatedAt?: string | null;
}) {
  async function saveTeamDirectFallback() {
    const basePayload = {
      tenant_id: params.tenantId,
      name: params.name,
      vehicle_plate: params.vehiclePlate,
      service_center_id: params.serviceCenterId,
      team_type_id: params.teamTypeId,
      foreman_person_id: params.foremanId,
      ativo: true,
      cancellation_reason: null as string | null,
      canceled_at: null as string | null,
      canceled_by: null as string | null,
      created_by: params.actorUserId,
      updated_by: params.actorUserId,
    };

    const operation = !params.teamId
      ? params.supabase.from("teams").insert(basePayload)
      : params.supabase
        .from("teams")
        .update({
          name: params.name,
          vehicle_plate: params.vehiclePlate,
          service_center_id: params.serviceCenterId,
          team_type_id: params.teamTypeId,
          foreman_person_id: params.foremanId,
          updated_by: params.actorUserId,
        })
        .eq("tenant_id", params.tenantId)
        .eq("id", params.teamId);

    const { error } = await operation;
    if (error) {
      const mappedError = mapTeamDbError(error, "Falha ao salvar equipe.");
      return {
        ok: false,
        status: mappedError.status,
        message: mappedError.message,
        reason: mappedError.reason,
      } as const;
    }

    return { ok: true, updatedAt: null } as const;
  }

  const { data, error } = await params.supabase.rpc("save_team_record", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_team_id: params.teamId,
    p_name: params.name,
    p_vehicle_plate: params.vehiclePlate,
    p_service_center_id: params.serviceCenterId,
    p_team_type_id: params.teamTypeId,
    p_foreman_person_id: params.foremanId,
    p_changes: params.changes ?? {},
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
  });

  if (error) {
    if (isMissingFunctionError(error, "save_team_record")) {
      return saveTeamDirectFallback();
    }

    const mappedError = mapTeamDbError(error, "Falha ao salvar equipe.");
    return {
      ok: false,
      status: mappedError.status,
      message: mappedError.message,
      reason: mappedError.reason,
    } as const;
  }

  const result = (data ?? {}) as TeamSaveRpcResult;
  if (result.success !== true) {
    if (isMissingFunctionError({ message: result.message }, "save_team_record")) {
      return saveTeamDirectFallback();
    }

    return {
      ok: false,
      status: Number(result.status ?? 500),
      message: result.message ?? "Falha ao salvar equipe.",
      reason: result.reason ?? null,
    } as const;
  }

  return { ok: true, updatedAt: result.updated_at ?? null } as const;
}

async function setTeamStatusViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  teamId: string;
  action: "ACTIVATE" | "CANCEL";
  reason: string;
  expectedUpdatedAt: string | null;
}) {
  async function setTeamStatusDirectFallback() {
    const nowIso = new Date().toISOString();
    const payload = params.action === "ACTIVATE"
      ? {
        ativo: true,
        cancellation_reason: null as string | null,
        canceled_at: null as string | null,
        canceled_by: null as string | null,
        updated_by: params.actorUserId,
      }
      : {
        ativo: false,
        cancellation_reason: params.reason,
        canceled_at: nowIso,
        canceled_by: params.actorUserId,
        updated_by: params.actorUserId,
      };

    const { error } = await params.supabase
      .from("teams")
      .update(payload)
      .eq("tenant_id", params.tenantId)
      .eq("id", params.teamId);

    if (error) {
      const mappedError = mapTeamDbError(error, "Falha ao atualizar status da equipe.");
      return {
        ok: false,
        status: mappedError.status,
        message: mappedError.message,
        reason: mappedError.reason,
      } as const;
    }

    return { ok: true, updatedAt: null } as const;
  }

  const { data, error } = await params.supabase.rpc("set_team_record_status", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_team_id: params.teamId,
    p_action: params.action,
    p_reason: params.reason,
    p_expected_updated_at: params.expectedUpdatedAt,
  });

  if (error) {
    if (isMissingFunctionError(error, "set_team_record_status")) {
      return setTeamStatusDirectFallback();
    }

    const mappedError = mapTeamDbError(error, "Falha ao atualizar status da equipe.");
    return {
      ok: false,
      status: mappedError.status,
      message: mappedError.message,
      reason: mappedError.reason,
    } as const;
  }

  const result = (data ?? {}) as TeamSaveRpcResult;
  if (result.success !== true) {
    if (isMissingFunctionError({ message: result.message }, "set_team_record_status")) {
      return setTeamStatusDirectFallback();
    }

    return {
      ok: false,
      status: Number(result.status ?? 500),
      message: result.message ?? "Falha ao atualizar status da equipe.",
      reason: result.reason ?? null,
    } as const;
  }

  return { ok: true, updatedAt: result.updated_at ?? null } as const;
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para consultar equipes.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const params = request.nextUrl.searchParams;
    const historyTeamId = normalizeText(params.get("historyTeamId"));

    if (historyTeamId) {
      const team = await fetchTeamById(supabase, appUser.tenant_id, historyTeamId);
      if (!team) {
        return NextResponse.json({ message: "Equipe nao encontrada." }, { status: 404 });
      }

      const historyPage = parsePositiveInteger(params.get("historyPage"), 1);
      const historyPageSize = Math.min(parsePositiveInteger(params.get("historyPageSize"), 5), 30);
      const historyFrom = (historyPage - 1) * historyPageSize;
      const historyTo = historyFrom + historyPageSize - 1;

      const { data: historyData, error: historyError, count: historyCount } = await supabase
        .from("app_entity_history")
        .select("id, change_type, reason, changes, created_at, created_by", { count: "exact" })
        .eq("tenant_id", appUser.tenant_id)
        .eq("module_key", "equipes")
        .eq("entity_table", "teams")
        .eq("entity_id", historyTeamId)
        .order("created_at", { ascending: false })
        .range(historyFrom, historyTo)
        .returns<TeamHistoryRow[]>();

      if (historyError) {
        return NextResponse.json({ message: "Falha ao carregar historico da equipe." }, { status: 500 });
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
        team: {
          id: team.id,
          name: team.name,
          isActive: team.ativo,
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

    const name = normalizeText(params.get("name"));
    const vehiclePlate = normalizePlate(params.get("vehiclePlate"));
    const serviceCenterId = normalizeText(params.get("serviceCenterId"));
    const teamTypeId = normalizeText(params.get("teamTypeId"));
    const foremanId = normalizeText(params.get("foremanId"));
    const page = parsePositiveInteger(params.get("page"), 1);
    const pageSize = Math.min(parsePositiveInteger(params.get("pageSize"), 20), 100);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("teams")
      .select(
        "id, name, vehicle_plate, service_center_id, team_type_id, foreman_person_id, ativo, cancellation_reason, canceled_at, canceled_by, created_by, updated_by, created_at, updated_at",
        { count: "exact" },
      )
      .eq("tenant_id", appUser.tenant_id);

    if (name) {
      query = query.ilike("name", `%${name}%`);
    }

    if (vehiclePlate) {
      query = query.ilike("vehicle_plate", `%${vehiclePlate}%`);
    }

    if (serviceCenterId) {
      query = query.eq("service_center_id", serviceCenterId);
    }

    if (teamTypeId) {
      query = query.eq("team_type_id", teamTypeId);
    }

    if (foremanId) {
      query = query.eq("foreman_person_id", foremanId);
    }

    const { data, error, count } = await query
      .order("ativo", { ascending: false })
      .order("name", { ascending: true })
      .range(from, to)
      .returns<TeamRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao listar equipes." }, { status: 500 });
    }

    const userIds = Array.from(
      new Set(
        (data ?? [])
          .flatMap((item) => [item.created_by, item.updated_by, item.canceled_by])
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const foremanIds = Array.from(
      new Set((data ?? []).map((item) => item.foreman_person_id).filter((value): value is string => Boolean(value))),
    );
    const teamTypeIds = Array.from(
      new Set((data ?? []).map((item) => item.team_type_id).filter((value): value is string => Boolean(value))),
    );
    const serviceCenterIds = Array.from(
      new Set((data ?? []).map((item) => item.service_center_id).filter((value): value is string => Boolean(value))),
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

    let foremen: PersonRow[] = [];
    if (foremanIds.length > 0) {
      const foremenResult = await supabase
        .from("people")
        .select("id, nome")
        .eq("tenant_id", appUser.tenant_id)
        .in("id", foremanIds)
        .returns<PersonRow[]>();

      if (!foremenResult.error) {
        foremen = foremenResult.data ?? [];
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

    let serviceCenters: ServiceCenterRow[] = [];
    if (serviceCenterIds.length > 0) {
      const serviceCentersResult = await supabase
        .from("project_service_centers")
        .select("id, name")
        .eq("tenant_id", appUser.tenant_id)
        .in("id", serviceCenterIds)
        .returns<ServiceCenterRow[]>();

      if (!serviceCentersResult.error) {
        serviceCenters = serviceCentersResult.data ?? [];
      }
    }

    const userDisplayMap = buildUserDisplayMap(users);
    const userLoginNameMap = buildUserLoginNameMap(users);
    const foremanMap = buildForemanMap(foremen);
    const teamTypeMap = buildTeamTypeMap(teamTypes);
    const serviceCenterMap = new Map(serviceCenters.map((item) => [item.id, normalizeText(item.name)]));

    return NextResponse.json({
      teams: (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        vehiclePlate: row.vehicle_plate,
        serviceCenterId: row.service_center_id,
        serviceCenterName: row.service_center_id ? serviceCenterMap.get(row.service_center_id) ?? "Nao identificado" : "Sem base",
        teamTypeId: row.team_type_id,
        teamTypeName: teamTypeMap.get(row.team_type_id) ?? "Nao identificado",
        foremanId: row.foreman_person_id,
        foremanName: foremanMap.get(row.foreman_person_id) ?? "Nao identificado",
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
    return NextResponse.json({ message: "Falha ao listar equipes." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para cadastrar equipes.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as Partial<CreateTeamPayload>;
    const input = {
      name: normalizeText(body.name),
      vehiclePlate: normalizePlate(body.vehiclePlate),
      serviceCenterId: normalizeText(body.serviceCenterId),
      teamTypeId: normalizeText(body.teamTypeId),
      foremanId: normalizeText(body.foremanId),
    };

    if (!input.name || !input.vehiclePlate || !input.serviceCenterId || !input.teamTypeId || !input.foremanId) {
      return NextResponse.json({ message: "Preencha todos os campos obrigatorios da equipe." }, { status: 400 });
    }

    const serviceCenter = await fetchServiceCenterById(supabase, appUser.tenant_id, input.serviceCenterId);
    if (!serviceCenter) {
      return NextResponse.json({ message: "Base invalida para o tenant atual." }, { status: 422 });
    }

    const teamType = await fetchTeamTypeById(supabase, appUser.tenant_id, input.teamTypeId);
    if (!teamType) {
      return NextResponse.json({ message: "Tipo de equipe invalido para o tenant atual." }, { status: 422 });
    }

    const foreman = await fetchForemanById(supabase, appUser.tenant_id, input.foremanId);
    if (!foreman) {
      return NextResponse.json({ message: "Encarregado invalido para o tenant atual." }, { status: 422 });
    }

    const existingTeamByForeman = await fetchExistingTeamByForeman({
      supabase,
      tenantId: appUser.tenant_id,
      foremanId: input.foremanId,
      excludeTeamId: null,
    });
    if (existingTeamByForeman) {
      return NextResponse.json(
        { message: "Ja existe equipe cadastrada para este encarregado. Selecione outro encarregado." },
        { status: 409 },
      );
    }

    const saveResult = await saveTeamViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      teamId: null,
      name: input.name,
      vehiclePlate: input.vehiclePlate,
      serviceCenterId: input.serviceCenterId,
      teamTypeId: input.teamTypeId,
      foremanId: input.foremanId,
    });

    if (!saveResult.ok) {
      return NextResponse.json({ message: saveResult.message, code: saveResult.reason ?? undefined }, { status: saveResult.status });
    }

    return NextResponse.json({
      success: true,
      message: `Equipe ${input.name} cadastrada com sucesso.`,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao cadastrar equipe." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para editar equipes.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as Partial<UpdateTeamPayload>;
    const teamId = normalizeText(body.id);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);
    const input = {
      name: normalizeText(body.name),
      vehiclePlate: normalizePlate(body.vehiclePlate),
      serviceCenterId: normalizeText(body.serviceCenterId),
      teamTypeId: normalizeText(body.teamTypeId),
      foremanId: normalizeText(body.foremanId),
    };

    if (!teamId) {
      return NextResponse.json({ message: "Equipe invalida para edicao." }, { status: 400 });
    }

    if (!expectedUpdatedAt) {
      return NextResponse.json({ message: "Atualize a lista antes de editar a equipe." }, { status: 400 });
    }

    if (!input.name || !input.vehiclePlate || !input.serviceCenterId || !input.teamTypeId || !input.foremanId) {
      return NextResponse.json({ message: "Preencha todos os campos obrigatorios da equipe." }, { status: 400 });
    }

    const currentTeam = await fetchTeamById(supabase, appUser.tenant_id, teamId);
    if (!currentTeam) {
      return NextResponse.json({ message: "Equipe nao encontrada." }, { status: 404 });
    }

    if (hasUpdatedAtConflict(expectedUpdatedAt, currentTeam.updated_at)) {
      return buildConcurrencyConflictResponse(
        `A equipe ${currentTeam.name} foi alterada por outro usuario. Recarregue os dados antes de salvar novamente.`,
      );
    }

    if (!currentTeam.ativo) {
      return buildConcurrencyConflictResponse("Ative a equipe antes de editar.", "RECORD_INACTIVE");
    }

    const currentTeamType = await fetchTeamTypeById(supabase, appUser.tenant_id, currentTeam.team_type_id);
    const currentServiceCenter = currentTeam.service_center_id
      ? await fetchServiceCenterById(supabase, appUser.tenant_id, currentTeam.service_center_id)
      : null;
    const nextServiceCenter = await fetchServiceCenterById(supabase, appUser.tenant_id, input.serviceCenterId);
    if (!nextServiceCenter) {
      return NextResponse.json({ message: "Base invalida para o tenant atual." }, { status: 422 });
    }
    const nextTeamType = await fetchTeamTypeById(supabase, appUser.tenant_id, input.teamTypeId);
    if (!nextTeamType) {
      return NextResponse.json({ message: "Tipo de equipe invalido para o tenant atual." }, { status: 422 });
    }

    const currentForeman = await fetchForemanById(supabase, appUser.tenant_id, currentTeam.foreman_person_id);
    const nextForeman = await fetchForemanById(supabase, appUser.tenant_id, input.foremanId);

    if (!nextForeman) {
      return NextResponse.json({ message: "Encarregado invalido para o tenant atual." }, { status: 422 });
    }

    const existingTeamByForeman = await fetchExistingTeamByForeman({
      supabase,
      tenantId: appUser.tenant_id,
      foremanId: input.foremanId,
      excludeTeamId: teamId,
    });
    if (existingTeamByForeman) {
      return NextResponse.json(
        { message: "Ja existe equipe cadastrada para este encarregado. Selecione outro encarregado." },
        { status: 409 },
      );
    }

    const changes: Record<string, HistoryChange> = {};
    addChange(changes, "name", currentTeam.name, input.name);
    addChange(changes, "vehiclePlate", currentTeam.vehicle_plate, input.vehiclePlate);
    addChange(changes, "serviceCenterName", currentServiceCenter?.name ?? null, nextServiceCenter.name);
    addChange(changes, "teamTypeName", currentTeamType?.name ?? null, nextTeamType.name);
    addChange(changes, "foremanName", currentForeman?.name ?? null, nextForeman.name);

    if (Object.keys(changes).length === 0) {
      return NextResponse.json({
        success: true,
        message: `Nenhuma alteracao detectada na equipe ${currentTeam.name}.`,
      });
    }

    const saveResult = await saveTeamViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      teamId,
      name: input.name,
      vehiclePlate: input.vehiclePlate,
      serviceCenterId: input.serviceCenterId,
      teamTypeId: input.teamTypeId,
      foremanId: input.foremanId,
      changes,
      expectedUpdatedAt,
    });

    if (!saveResult.ok) {
      return NextResponse.json({ message: saveResult.message, code: saveResult.reason ?? undefined }, { status: saveResult.status });
    }

    return NextResponse.json({
      success: true,
      message: `Equipe ${input.name} atualizada com sucesso.`,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao editar equipe." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para atualizar status de equipes.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as Partial<UpdateTeamStatusPayload>;
    const teamId = normalizeText(body.id);
    const reason = normalizeText(body.reason);
    const action = normalizeText(body.action).toLowerCase() === "activate" ? "ACTIVATE" : "CANCEL";
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);

    if (!teamId) {
      return NextResponse.json({ message: "Equipe invalida para atualizar status." }, { status: 400 });
    }

    if (!expectedUpdatedAt) {
      return NextResponse.json({ message: "Atualize a lista antes de alterar o status da equipe." }, { status: 400 });
    }

    if (!reason) {
      return NextResponse.json(
        { message: action === "ACTIVATE" ? "Informe o motivo da ativacao." : "Informe o motivo do cancelamento." },
        { status: 400 },
      );
    }

    const currentTeam = await fetchTeamById(supabase, appUser.tenant_id, teamId);
    if (!currentTeam) {
      return NextResponse.json({ message: "Equipe nao encontrada." }, { status: 404 });
    }

    if (hasUpdatedAtConflict(expectedUpdatedAt, currentTeam.updated_at)) {
      return buildConcurrencyConflictResponse(
        `A equipe ${currentTeam.name} foi alterada por outro usuario. Recarregue os dados antes de alterar o status.`,
      );
    }

    if (action === "CANCEL" && !currentTeam.ativo) {
      return buildConcurrencyConflictResponse(`Equipe ${currentTeam.name} ja esta inativa.`, "STATUS_ALREADY_CHANGED");
    }

    if (action === "ACTIVATE" && currentTeam.ativo) {
      return buildConcurrencyConflictResponse(`Equipe ${currentTeam.name} ja esta ativa.`, "STATUS_ALREADY_CHANGED");
    }

    const statusResult = await setTeamStatusViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      teamId,
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
          ? `Equipe ${currentTeam.name} ativada com sucesso.`
          : `Equipe ${currentTeam.name} cancelada com sucesso.`,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao atualizar status da equipe." }, { status: 500 });
  }
}

