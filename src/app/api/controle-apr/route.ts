import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { parsePagination } from "@/lib/server/apiHelpers";

type AprStatus = "ATIVO" | "CANCELADO" | "DIVERGENTE" | "CONFERIDO";

type AprRow = {
  id: string;
  apr_id: string;
  project_id: string;
  team_id: string;
  programming_id: string | null;
  service_date: string;
  status: AprStatus;
  observation: string | null;
  project_code_snapshot: string;
  team_name_snapshot: string;
  foreman_name_snapshot: string | null;
  programming_status_snapshot: string | null;
  validated_at: string | null;
  canceled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

type ProjectRow = {
  id: string;
  sob: string;
  service_description: string | null;
  service_type_text: string | null;
};

type TeamRow = {
  id: string;
  name: string;
  foreman_person_id: string | null;
};

type PersonRow = {
  id: string;
  nome: string;
};

type HistoryRow = {
  id: string;
  action_type: string;
  reason: string | null;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  created_by: string | null;
};

type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

type SavePayload = {
  id?: string;
  aprId?: string;
  projectId?: string;
  teamId?: string;
  serviceDate?: string;
  observation?: string;
  expectedUpdatedAt?: string;
};

type StatusPayload = {
  id?: string;
  action?: "CONFERIR" | "DIVERGIR" | "CANCELAR";
  reason?: string;
  expectedUpdatedAt?: string;
};

type RpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  apr_control_id?: string;
  apr_status?: AprStatus;
  updated_at?: string;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeUuid(value: unknown) {
  const normalized = normalizeText(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null;
}

function normalizeIsoDate(value: unknown) {
  const normalized = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function resolveUserName(user: AppUserRow | undefined) {
  return normalizeText(user?.login_name) || normalizeText(user?.display) || "Nao identificado";
}

async function loadMeta(
  supabase: AuthenticatedAppUserContext["supabase"],
  tenantId: string,
) {
  const [projectsResult, teamsResult] = await Promise.all([
    supabase
      .from("project_with_labels")
      .select("id, sob, service_description, service_type_text")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("sob", { ascending: true })
      .returns<ProjectRow[]>(),
    supabase
      .from("teams")
      .select("id, name, foreman_person_id")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .order("name", { ascending: true })
      .returns<TeamRow[]>(),
  ]);

  if (projectsResult.error || teamsResult.error) {
    return { error: "Falha ao carregar projetos e equipes do Controle de APR." } as const;
  }

  const teams = teamsResult.data ?? [];
  const foremanIds = Array.from(
    new Set(teams.map((item) => item.foreman_person_id).filter((item): item is string => Boolean(item))),
  );
  const peopleResult = foremanIds.length
    ? await supabase
        .from("people")
        .select("id, nome")
        .eq("tenant_id", tenantId)
        .in("id", foremanIds)
        .returns<PersonRow[]>()
    : { data: [] as PersonRow[], error: null };

  if (peopleResult.error) {
    return { error: "Falha ao carregar encarregados das equipes." } as const;
  }

  const foremanMap = new Map((peopleResult.data ?? []).map((item) => [item.id, normalizeText(item.nome)]));

  return {
    projects: (projectsResult.data ?? []).map((item) => ({
      id: item.id,
      code: normalizeText(item.sob),
      serviceName: normalizeText(item.service_description) || normalizeText(item.service_type_text),
    })),
    teams: teams.map((item) => ({
      id: item.id,
      name: normalizeText(item.name),
      foremanId: item.foreman_person_id,
      foremanName: item.foreman_person_id ? foremanMap.get(item.foreman_person_id) ?? "Sem encarregado" : "Sem encarregado",
    })),
  } as const;
}

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para consultar o Controle de APR.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const tenantId = resolution.appUser.tenant_id;
  const url = new URL(request.url);
  const historyId = normalizeUuid(url.searchParams.get("historyId"));
  const includeMeta = url.searchParams.get("meta") === "1";

  if (historyId) {
    const historyResult = await resolution.supabase
      .from("project_apr_control_history")
      .select("id, action_type, reason, changes, metadata, created_at, created_by")
      .eq("tenant_id", tenantId)
      .eq("apr_control_id", historyId)
      .order("created_at", { ascending: false })
      .returns<HistoryRow[]>();

    if (historyResult.error) {
      return NextResponse.json({ message: "Falha ao carregar historico da APR." }, { status: 500 });
    }

    const userIds = Array.from(
      new Set((historyResult.data ?? []).map((item) => item.created_by).filter((item): item is string => Boolean(item))),
    );
    const usersResult = userIds.length
      ? await resolution.supabase
          .from("app_users")
          .select("id, display, login_name")
          .eq("tenant_id", tenantId)
          .in("id", userIds)
          .returns<AppUserRow[]>()
      : { data: [] as AppUserRow[], error: null };
    const userMap = new Map((usersResult.data ?? []).map((item) => [item.id, item]));

    return NextResponse.json({
      history: (historyResult.data ?? []).map((item) => ({
        id: item.id,
        action: item.action_type,
        reason: normalizeText(item.reason),
        changes: item.changes ?? {},
        metadata: item.metadata ?? {},
        changedAt: item.created_at,
        changedByName: resolveUserName(userMap.get(item.created_by ?? "")),
      })),
    });
  }

  const startDate = normalizeIsoDate(url.searchParams.get("startDate"));
  const endDate = normalizeIsoDate(url.searchParams.get("endDate"));
  const projectId = normalizeUuid(url.searchParams.get("projectId"));
  const teamId = normalizeUuid(url.searchParams.get("teamId"));
  const aprId = normalizeText(url.searchParams.get("aprId"));
  const foremanName = normalizeText(url.searchParams.get("foremanName"));
  const status = normalizeText(url.searchParams.get("status")).toUpperCase();
  const { page, pageSize } = parsePagination(url.searchParams, {
    defaultPageSize: 20,
    maxPageSize: 500,
    maxPage: 100000,
  });

  let query = resolution.supabase
    .from("project_apr_controls")
    .select(
      "id, apr_id, project_id, team_id, programming_id, service_date, status, observation, project_code_snapshot, team_name_snapshot, foreman_name_snapshot, programming_status_snapshot, validated_at, canceled_at, cancellation_reason, created_at, updated_at, created_by, updated_by",
      { count: "exact" },
    )
    .eq("tenant_id", tenantId)
    .order("service_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (startDate) query = query.gte("service_date", startDate);
  if (endDate) query = query.lte("service_date", endDate);
  if (projectId) query = query.eq("project_id", projectId);
  if (teamId) query = query.eq("team_id", teamId);
  if (aprId) query = query.ilike("apr_id", `%${aprId.replace(/[%_]/g, "")}%`);
  if (foremanName) query = query.eq("foreman_name_snapshot", foremanName);
  if (["ATIVO", "CANCELADO", "DIVERGENTE", "CONFERIDO"].includes(status)) {
    query = query.eq("status", status);
  }

  const from = (page - 1) * pageSize;
  const rowsResult = await query.range(from, from + pageSize - 1).returns<AprRow[]>();
  if (rowsResult.error) {
    return NextResponse.json({ message: "Falha ao carregar registros do Controle de APR." }, { status: 500 });
  }

  const response: Record<string, unknown> = {
    records: (rowsResult.data ?? []).map((item) => ({
      id: item.id,
      aprId: normalizeText(item.apr_id),
      projectId: item.project_id,
      teamId: item.team_id,
      programmingId: item.programming_id,
      serviceDate: item.service_date,
      status: item.status,
      observation: normalizeText(item.observation),
      projectCode: normalizeText(item.project_code_snapshot),
      teamName: normalizeText(item.team_name_snapshot),
      foremanName: normalizeText(item.foreman_name_snapshot),
      programmingStatus: normalizeText(item.programming_status_snapshot),
      programmingMatchStatus: item.programming_id ? "PROGRAMADA" : "NAO_PROGRAMADA",
      validatedAt: item.validated_at,
      canceledAt: item.canceled_at,
      cancellationReason: normalizeText(item.cancellation_reason),
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    })),
    pagination: {
      page,
      pageSize,
      total: rowsResult.count ?? 0,
    },
  };

  if (includeMeta) {
    const meta = await loadMeta(resolution.supabase, tenantId);
    if ("error" in meta) {
      return NextResponse.json({ message: meta.error }, { status: 500 });
    }
    response.projects = meta.projects;
    response.teams = meta.teams;
  }

  return NextResponse.json(response);
}

async function saveApr(request: NextRequest, method: "POST" | "PUT") {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para salvar a APR.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as SavePayload | null;
  const id = normalizeUuid(payload?.id);
  const projectId = normalizeUuid(payload?.projectId);
  const teamId = normalizeUuid(payload?.teamId);
  const serviceDate = normalizeIsoDate(payload?.serviceDate);
  const aprId = normalizeText(payload?.aprId);
  const observation = normalizeText(payload?.observation) || null;
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt) || null;

  if (method === "PUT" && !id) {
    return NextResponse.json({ message: "APR invalida para edicao." }, { status: 400 });
  }
  if (!projectId || !teamId || !serviceDate || !aprId) {
    return NextResponse.json({ message: "Projeto, ID APR, Data do servico e Equipe sao obrigatorios." }, { status: 400 });
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  if (serviceDate > today) {
    return NextResponse.json({ message: "A Data do servico nao pode ser futura." }, { status: 400 });
  }

  const { data, error } = await resolution.supabase.rpc("save_project_apr_control", {
    p_tenant_id: resolution.appUser.tenant_id,
    p_actor_user_id: resolution.appUser.id,
    p_apr_control_id: method === "PUT" ? id : null,
    p_apr_id: aprId,
    p_project_id: projectId,
    p_team_id: teamId,
    p_service_date: serviceDate,
    p_observation: observation,
    p_expected_updated_at: expectedUpdatedAt,
  });

  if (error) {
    return NextResponse.json({ message: "Falha ao salvar a APR. Verifique se a migration 226 foi aplicada." }, { status: 500 });
  }

  const result = (data ?? {}) as RpcResult;
  if (result.success !== true) {
    return NextResponse.json(
      { message: result.message ?? "Falha ao salvar a APR.", reason: result.reason ?? null },
      { status: Number(result.status ?? 400) },
    );
  }

  return NextResponse.json({
    success: true,
    id: result.apr_control_id,
    updatedAt: result.updated_at,
    message: result.message ?? "APR salva com sucesso.",
  });
}

export async function POST(request: NextRequest) {
  return saveApr(request, "POST");
}

export async function PUT(request: NextRequest) {
  return saveApr(request, "PUT");
}

export async function PATCH(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para alterar a situacao da APR.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as StatusPayload | null;
  const id = normalizeUuid(payload?.id);
  const action = normalizeText(payload?.action).toUpperCase();
  const reason = normalizeText(payload?.reason) || null;
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt) || null;

  if (!id || !["CONFERIR", "DIVERGIR", "CANCELAR"].includes(action)) {
    return NextResponse.json({ message: "Informe a APR e uma acao valida." }, { status: 400 });
  }

  const { data, error } = await resolution.supabase.rpc("set_project_apr_control_status", {
    p_tenant_id: resolution.appUser.tenant_id,
    p_actor_user_id: resolution.appUser.id,
    p_apr_control_id: id,
    p_action: action,
    p_reason: reason,
    p_expected_updated_at: expectedUpdatedAt,
  });

  if (error) {
    return NextResponse.json({ message: "Falha ao alterar a situacao da APR." }, { status: 500 });
  }

  const result = (data ?? {}) as RpcResult;
  if (result.success !== true) {
    return NextResponse.json(
      { message: result.message ?? "Falha ao alterar a situacao da APR.", reason: result.reason ?? null },
      { status: Number(result.status ?? 400) },
    );
  }

  return NextResponse.json({
    success: true,
    id: result.apr_control_id,
    status: result.apr_status,
    updatedAt: result.updated_at,
    message: result.message ?? "Situacao da APR atualizada.",
  });
}
