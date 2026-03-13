import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type TeamRow = {
  id: string;
  name: string;
  vehicle_plate: string;
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
  teamTypeId: string;
  foremanId: string;
};

type UpdateTeamPayload = CreateTeamPayload & {
  id: string;
};

type UpdateTeamStatusPayload = {
  id: string;
  reason: string;
  action?: "cancel" | "activate";
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

function normalizePlate(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function isTeamDuplicateCombinationError(rawMessage: unknown) {
  const message = String(rawMessage ?? "").toLowerCase();
  if (!message.includes("duplicate key")) {
    return false;
  }

  return (
    message.includes("teams_tenant_foreman_name_plate_key")
    || message.includes("teams_tenant_id_name_key")
    || message.includes("teams_tenant_id_vehicle_plate_key")
  );
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
    .or("code.ilike.ENCARREGADO,name.ilike.ENCARREGADO")
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

async function fetchTeamById(
  supabase: SupabaseClient,
  tenantId: string,
  teamId: string,
) {
  const { data, error } = await supabase
    .from("teams")
    .select(
      "id, name, vehicle_plate, team_type_id, foreman_person_id, ativo, cancellation_reason, canceled_at, canceled_by, created_by, updated_by, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("id", teamId)
    .maybeSingle<TeamRow>();

  if (error || !data) {
    return null;
  }

  return data;
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
    const teamTypeId = normalizeText(params.get("teamTypeId"));
    const foremanId = normalizeText(params.get("foremanId"));
    const page = parsePositiveInteger(params.get("page"), 1);
    const pageSize = Math.min(parsePositiveInteger(params.get("pageSize"), 20), 100);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("teams")
      .select(
        "id, name, vehicle_plate, team_type_id, foreman_person_id, ativo, cancellation_reason, canceled_at, canceled_by, created_by, updated_by, created_at, updated_at",
        { count: "exact" },
      )
      .eq("tenant_id", appUser.tenant_id);

    if (name) {
      query = query.ilike("name", `%${name}%`);
    }

    if (vehiclePlate) {
      query = query.ilike("vehicle_plate", `%${vehiclePlate}%`);
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

    const userDisplayMap = buildUserDisplayMap(users);
    const userLoginNameMap = buildUserLoginNameMap(users);
    const foremanMap = buildForemanMap(foremen);
    const teamTypeMap = buildTeamTypeMap(teamTypes);

    return NextResponse.json({
      teams: (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        vehiclePlate: row.vehicle_plate,
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
      teamTypeId: normalizeText(body.teamTypeId),
      foremanId: normalizeText(body.foremanId),
    };

    if (!input.name || !input.vehiclePlate || !input.teamTypeId || !input.foremanId) {
      return NextResponse.json({ message: "Preencha todos os campos obrigatorios da equipe." }, { status: 400 });
    }

    const teamType = await fetchTeamTypeById(supabase, appUser.tenant_id, input.teamTypeId);
    if (!teamType) {
      return NextResponse.json({ message: "Tipo de equipe invalido para o tenant atual." }, { status: 422 });
    }

    const foreman = await fetchForemanById(supabase, appUser.tenant_id, input.foremanId);
    if (!foreman) {
      return NextResponse.json({ message: "Encarregado invalido para o tenant atual." }, { status: 422 });
    }

    const { error } = await supabase.from("teams").insert({
      tenant_id: appUser.tenant_id,
      name: input.name,
      vehicle_plate: input.vehiclePlate,
      team_type_id: input.teamTypeId,
      foreman_person_id: input.foremanId,
      ativo: true,
      cancellation_reason: null,
      canceled_at: null,
      canceled_by: null,
      created_by: appUser.id,
      updated_by: appUser.id,
    });

    if (error) {
      if (isTeamDuplicateCombinationError(error.message)) {
        return NextResponse.json(
          { message: "Ja existe equipe com o mesmo nome, encarregado e placa no tenant atual." },
          { status: 409 },
        );
      }

      return NextResponse.json({ message: "Falha ao cadastrar equipe." }, { status: 500 });
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
    const input = {
      name: normalizeText(body.name),
      vehiclePlate: normalizePlate(body.vehiclePlate),
      teamTypeId: normalizeText(body.teamTypeId),
      foremanId: normalizeText(body.foremanId),
    };

    if (!teamId) {
      return NextResponse.json({ message: "Equipe invalida para edicao." }, { status: 400 });
    }

    if (!input.name || !input.vehiclePlate || !input.teamTypeId || !input.foremanId) {
      return NextResponse.json({ message: "Preencha todos os campos obrigatorios da equipe." }, { status: 400 });
    }

    const currentTeam = await fetchTeamById(supabase, appUser.tenant_id, teamId);
    if (!currentTeam) {
      return NextResponse.json({ message: "Equipe nao encontrada." }, { status: 404 });
    }

    if (!currentTeam.ativo) {
      return NextResponse.json({ message: "Ative a equipe antes de editar." }, { status: 409 });
    }

    const currentTeamType = await fetchTeamTypeById(supabase, appUser.tenant_id, currentTeam.team_type_id);
    const nextTeamType = await fetchTeamTypeById(supabase, appUser.tenant_id, input.teamTypeId);
    if (!nextTeamType) {
      return NextResponse.json({ message: "Tipo de equipe invalido para o tenant atual." }, { status: 422 });
    }

    const currentForeman = await fetchForemanById(supabase, appUser.tenant_id, currentTeam.foreman_person_id);
    const nextForeman = await fetchForemanById(supabase, appUser.tenant_id, input.foremanId);

    if (!nextForeman) {
      return NextResponse.json({ message: "Encarregado invalido para o tenant atual." }, { status: 422 });
    }

    const changes: Record<string, HistoryChange> = {};
    addChange(changes, "name", currentTeam.name, input.name);
    addChange(changes, "vehiclePlate", currentTeam.vehicle_plate, input.vehiclePlate);
    addChange(changes, "teamTypeName", currentTeamType?.name ?? null, nextTeamType.name);
    addChange(changes, "foremanName", currentForeman?.name ?? null, nextForeman.name);

    if (Object.keys(changes).length === 0) {
      return NextResponse.json({
        success: true,
        message: `Nenhuma alteracao detectada na equipe ${currentTeam.name}.`,
      });
    }

    const { error } = await supabase
      .from("teams")
      .update({
        name: input.name,
        vehicle_plate: input.vehiclePlate,
        team_type_id: input.teamTypeId,
        foreman_person_id: input.foremanId,
        updated_by: appUser.id,
      })
      .eq("tenant_id", appUser.tenant_id)
      .eq("id", teamId);

    if (error) {
      if (isTeamDuplicateCombinationError(error.message)) {
        return NextResponse.json(
          { message: "Ja existe equipe com o mesmo nome, encarregado e placa no tenant atual." },
          { status: 409 },
        );
      }

      return NextResponse.json({ message: "Falha ao editar equipe." }, { status: 500 });
    }

    const { error: historyError } = await supabase.from("app_entity_history").insert({
      tenant_id: appUser.tenant_id,
      module_key: "equipes",
      entity_table: "teams",
      entity_id: teamId,
      entity_code: input.name,
      change_type: "UPDATE",
      reason: null,
      changes,
      metadata: {},
      created_by: appUser.id,
      updated_by: appUser.id,
    });

    if (historyError) {
      return NextResponse.json(
        {
          success: true,
          warning: true,
          message: `Equipe ${input.name} atualizada, mas falhou ao registrar historico.`,
        },
        { status: 200 },
      );
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

    if (!teamId) {
      return NextResponse.json({ message: "Equipe invalida para atualizar status." }, { status: 400 });
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

    if (action === "CANCEL" && !currentTeam.ativo) {
      return NextResponse.json({ message: `Equipe ${currentTeam.name} ja esta inativa.` }, { status: 409 });
    }

    if (action === "ACTIVATE" && currentTeam.ativo) {
      return NextResponse.json({ message: `Equipe ${currentTeam.name} ja esta ativa.` }, { status: 409 });
    }

    const nowIso = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("teams")
      .update(
        action === "ACTIVATE"
          ? {
              ativo: true,
              cancellation_reason: null,
              canceled_at: null,
              canceled_by: null,
              updated_by: appUser.id,
            }
          : {
              ativo: false,
              cancellation_reason: reason,
              canceled_at: nowIso,
              canceled_by: appUser.id,
              updated_by: appUser.id,
            },
      )
      .eq("tenant_id", appUser.tenant_id)
      .eq("id", teamId);

    if (updateError) {
      return NextResponse.json(
        { message: action === "ACTIVATE" ? "Falha ao ativar equipe." : "Falha ao cancelar equipe." },
        { status: 500 },
      );
    }

    const changePayload: Record<string, HistoryChange> =
      action === "ACTIVATE"
        ? {
            isActive: { from: "false", to: "true" },
            cancellationReason: { from: currentTeam.cancellation_reason, to: null },
            canceledAt: { from: currentTeam.canceled_at, to: null },
            activationReason: { from: null, to: reason },
          }
        : {
            isActive: { from: "true", to: "false" },
            cancellationReason: { from: currentTeam.cancellation_reason, to: reason },
            canceledAt: { from: currentTeam.canceled_at, to: nowIso },
          };

    const { error: historyError } = await supabase.from("app_entity_history").insert({
      tenant_id: appUser.tenant_id,
      module_key: "equipes",
      entity_table: "teams",
      entity_id: teamId,
      entity_code: currentTeam.name,
      change_type: action,
      reason,
      changes: changePayload,
      metadata: {},
      created_by: appUser.id,
      updated_by: appUser.id,
    });

    if (historyError) {
      return NextResponse.json(
        {
          success: true,
          warning: true,
          message:
            action === "ACTIVATE"
              ? `Equipe ${currentTeam.name} ativada, mas falhou ao registrar historico.`
              : `Equipe ${currentTeam.name} cancelada, mas falhou ao registrar historico.`,
        },
        { status: 200 },
      );
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

