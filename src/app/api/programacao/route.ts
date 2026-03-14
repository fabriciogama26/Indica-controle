import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type BoardProjectRow = {
  id: string;
  sob: string;
  service_center_text: string | null;
  service_type_text: string | null;
  city_text: string | null;
  priority_text: string | null;
  service_description: string | null;
  observation: string | null;
  is_active: boolean;
};

type TeamRow = {
  id: string;
  name: string;
  service_center_id: string | null;
  team_type_id: string;
  foreman_person_id: string;
  ativo: boolean;
};

type TeamTypeRow = {
  id: string;
  name: string;
};

type PersonRow = {
  id: string;
  nome: string;
};

type ServiceCenterRow = {
  id: string;
  name: string;
};

type ProgrammingRow = {
  id: string;
  project_id: string;
  team_id: string;
  execution_date: string;
  period: "INTEGRAL" | "PARCIAL";
  start_time: string;
  end_time: string;
  expected_minutes: number;
  feeder: string | null;
  support: string | null;
  note: string | null;
  sgd_number: string | null;
  sgd_included_at: string | null;
  sgd_delivered_at: string | null;
  pi_number: string | null;
  pi_included_at: string | null;
  pi_delivered_at: string | null;
  pep_number: string | null;
  pep_included_at: string | null;
  pep_delivered_at: string | null;
  created_at: string;
  updated_at: string;
};

type ProgrammingActivityRow = {
  id: string;
  programming_id: string;
  service_activity_id: string;
  activity_code: string;
  activity_description: string;
  activity_unit: string;
  quantity: number | string;
  is_active: boolean;
};

type HistoryChange = {
  from: string | null;
  to: string | null;
};

type SaveProgrammingPayload = {
  id?: string;
  projectId?: string;
  teamId?: string;
  date?: string;
  period?: string;
  startTime?: string;
  endTime?: string;
  expectedMinutes?: number | string;
  feeder?: string;
  support?: string;
  note?: string;
  expectedUpdatedAt?: string;
  documents?: {
    sgd?: { number?: string; deliveredAt?: string };
    pi?: { number?: string; deliveredAt?: string };
    pep?: { number?: string; deliveredAt?: string };
  };
  activities?: Array<{
    catalogId?: string;
    quantity?: number | string;
  }>;
};

type SaveProgrammingRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  action?: "INSERT" | "UPDATE";
  programming_id?: string;
  project_code?: string;
  updated_at?: string;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeNullableText(value: unknown) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeIsoDate(value: unknown) {
  const normalized = normalizeText(value);
  return isIsoDate(normalized) ? normalized : null;
}

function normalizeTime(value: unknown) {
  const normalized = normalizeText(value);
  if (/^\d{2}:\d{2}$/.test(normalized)) {
    return `${normalized}:00`;
  }

  if (/^\d{2}:\d{2}:\d{2}$/.test(normalized)) {
    return normalized;
  }

  return null;
}

function formatTime(value: string | null) {
  return normalizeText(value).slice(0, 5);
}

function normalizePositiveInteger(value: unknown) {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function normalizePositiveNumber(value: unknown) {
  const raw = String(value ?? "").trim().replace(",", ".");
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Number(parsed.toFixed(2));
}

function normalizePeriod(value: unknown) {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === "INTEGRAL" || normalized === "PARCIAL") {
    return normalized;
  }

  return null;
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

function toActivitySnapshot(items: Array<{ code: string; quantity: number }>) {
  return JSON.stringify(
    [...items]
      .map((item) => ({
        code: normalizeText(item.code),
        quantity: Number(item.quantity.toFixed(2)),
      }))
      .sort((left, right) => left.code.localeCompare(right.code)),
  );
}

async function fetchProjects(
  supabase: SupabaseClient,
  tenantId: string,
) {
  const { data, error } = await supabase
    .from("project_with_labels")
    .select("id, sob, service_center_text, service_type_text, city_text, priority_text, service_description, observation, is_active")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("execution_deadline", { ascending: true })
    .returns<BoardProjectRow[]>();

  if (error) {
    return [] as BoardProjectRow[];
  }

  return data ?? [];
}

async function fetchTeams(
  supabase: SupabaseClient,
  tenantId: string,
) {
  const { data: teams, error } = await supabase
    .from("teams")
    .select("id, name, service_center_id, team_type_id, foreman_person_id, ativo")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .order("name", { ascending: true })
    .returns<TeamRow[]>();

  if (error || !teams?.length) {
    return [];
  }

  const teamTypeIds = Array.from(new Set(teams.map((item) => item.team_type_id).filter(Boolean)));
  const foremanIds = Array.from(new Set(teams.map((item) => item.foreman_person_id).filter(Boolean)));
  const serviceCenterIds = Array.from(new Set(teams.map((item) => item.service_center_id).filter(Boolean)));

  const [{ data: teamTypes }, { data: people }, { data: serviceCenters }] = await Promise.all([
    teamTypeIds.length
      ? supabase
          .from("team_types")
          .select("id, name")
          .eq("tenant_id", tenantId)
          .in("id", teamTypeIds)
          .returns<TeamTypeRow[]>()
      : Promise.resolve({ data: [] as TeamTypeRow[] }),
    foremanIds.length
      ? supabase
          .from("people")
          .select("id, nome")
          .eq("tenant_id", tenantId)
          .in("id", foremanIds)
          .returns<PersonRow[]>()
      : Promise.resolve({ data: [] as PersonRow[] }),
    serviceCenterIds.length
      ? supabase
          .from("project_service_centers")
          .select("id, name")
          .eq("tenant_id", tenantId)
          .in("id", serviceCenterIds)
          .returns<ServiceCenterRow[]>()
      : Promise.resolve({ data: [] as ServiceCenterRow[] }),
  ]);

  const teamTypeMap = new Map((teamTypes ?? []).map((item) => [item.id, normalizeText(item.name)]));
  const foremanMap = new Map((people ?? []).map((item) => [item.id, normalizeText(item.nome)]));
  const serviceCenterMap = new Map((serviceCenters ?? []).map((item) => [item.id, normalizeText(item.name)]));

  return teams.map((team) => ({
    id: team.id,
    name: normalizeText(team.name),
    serviceCenterId: team.service_center_id,
    serviceCenterName: team.service_center_id ? serviceCenterMap.get(team.service_center_id) ?? "Sem base" : "Sem base",
    teamTypeName: teamTypeMap.get(team.team_type_id) ?? "Sem tipo",
    foremanName: foremanMap.get(team.foreman_person_id) ?? "Sem encarregado",
  }));
}

async function fetchProgrammingRows(
  supabase: SupabaseClient,
  tenantId: string,
  startDate: string,
  endDate: string,
) {
  const { data, error } = await supabase
    .from("project_programming")
    .select(
      "id, project_id, team_id, execution_date, period, start_time, end_time, expected_minutes, feeder, support, note, sgd_number, sgd_included_at, sgd_delivered_at, pi_number, pi_included_at, pi_delivered_at, pep_number, pep_included_at, pep_delivered_at, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .gte("execution_date", startDate)
    .lte("execution_date", endDate)
    .order("execution_date", { ascending: true })
    .order("start_time", { ascending: true })
    .returns<ProgrammingRow[]>();

  if (error) {
    return [] as ProgrammingRow[];
  }

  return data ?? [];
}

async function fetchProgrammingActivities(
  supabase: SupabaseClient,
  tenantId: string,
  programmingIds: string[],
) {
  if (!programmingIds.length) {
    return new Map<string, ProgrammingActivityRow[]>();
  }

  const { data, error } = await supabase
    .from("project_programming_activities")
    .select("id, programming_id, service_activity_id, activity_code, activity_description, activity_unit, quantity, is_active")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .in("programming_id", programmingIds)
    .order("activity_code", { ascending: true })
    .returns<ProgrammingActivityRow[]>();

  if (error) {
    return new Map<string, ProgrammingActivityRow[]>();
  }

  const activityMap = new Map<string, ProgrammingActivityRow[]>();
  for (const item of data ?? []) {
    const current = activityMap.get(item.programming_id) ?? [];
    current.push(item);
    activityMap.set(item.programming_id, current);
  }

  return activityMap;
}

async function fetchProgrammingById(
  supabase: SupabaseClient,
  tenantId: string,
  programmingId: string,
) {
  const { data, error } = await supabase
    .from("project_programming")
    .select(
      "id, project_id, team_id, execution_date, period, start_time, end_time, expected_minutes, feeder, support, note, sgd_number, sgd_included_at, sgd_delivered_at, pi_number, pi_included_at, pi_delivered_at, pep_number, pep_included_at, pep_delivered_at, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("id", programmingId)
    .maybeSingle<ProgrammingRow>();

  if (error || !data) {
    return null;
  }

  return data;
}

async function saveProgrammingViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId?: string | null;
  projectId: string;
  teamId: string;
  executionDate: string;
  period: "INTEGRAL" | "PARCIAL";
  startTime: string;
  endTime: string;
  expectedMinutes: number;
  feeder?: string | null;
  support?: string | null;
  note?: string | null;
  documents: NonNullable<SaveProgrammingPayload["documents"]>;
  activities: Array<{ catalogId: string; quantity: number }>;
  expectedUpdatedAt?: string | null;
}) {
  const { data, error } = await params.supabase.rpc("save_project_programming", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_project_id: params.projectId,
    p_team_id: params.teamId,
    p_execution_date: params.executionDate,
    p_period: params.period,
    p_start_time: params.startTime,
    p_end_time: params.endTime,
    p_expected_minutes: params.expectedMinutes,
    p_feeder: params.feeder ?? null,
    p_support: params.support ?? null,
    p_note: params.note ?? null,
    p_documents: params.documents,
    p_activities: params.activities.map((item) => ({
      catalogId: item.catalogId,
      quantity: item.quantity,
    })),
    p_programming_id: params.programmingId ?? null,
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
  });

  if (error) {
    return {
      ok: false,
      status: 500,
      message: "Falha ao salvar programacao via RPC.",
    } as const;
  }

  const result = (data ?? {}) as SaveProgrammingRpcResult;
  if (result.success !== true || !result.programming_id) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar programacao.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    action: result.action ?? null,
    programmingId: result.programming_id,
    projectCode: normalizeText(result.project_code),
    updatedAt: normalizeText(result.updated_at),
    message: result.message ?? "Programacao salva com sucesso.",
  } as const;
}

async function registerProgrammingHistory(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  projectCode: string;
  changes: Record<string, HistoryChange>;
  metadata: Record<string, unknown>;
}) {
  if (Object.keys(params.changes).length === 0) {
    return;
  }

  await params.supabase.from("app_entity_history").insert({
    tenant_id: params.tenantId,
    module_key: "programacao",
    entity_table: "project_programming",
    entity_id: params.programmingId,
    entity_code: params.projectCode,
    change_type: "UPDATE",
    reason: null,
    changes: params.changes,
    metadata: params.metadata,
    created_by: params.actorUserId,
    updated_by: params.actorUserId,
  });
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para consultar programacao.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const startDate = normalizeIsoDate(request.nextUrl.searchParams.get("startDate"));
    const endDate = normalizeIsoDate(request.nextUrl.searchParams.get("endDate"));

    if (!startDate || !endDate) {
      return NextResponse.json({ message: "startDate e endDate sao obrigatorios." }, { status: 400 });
    }

    const [projects, teams, programmingRows] = await Promise.all([
      fetchProjects(resolution.supabase, resolution.appUser.tenant_id),
      fetchTeams(resolution.supabase, resolution.appUser.tenant_id),
      fetchProgrammingRows(resolution.supabase, resolution.appUser.tenant_id, startDate, endDate),
    ]);

    const projectMap = new Map(projects.map((item) => [item.id, item]));
    const activitiesMap = await fetchProgrammingActivities(
      resolution.supabase,
      resolution.appUser.tenant_id,
      programmingRows.map((item) => item.id),
    );

    return NextResponse.json({
      projects: projects.map((item) => ({
          id: item.id,
          code: normalizeText(item.sob),
          serviceName: normalizeText(item.service_description) || normalizeText(item.service_type_text) || "Sem descricao",
          city: normalizeText(item.city_text) || "Sem municipio",
          base: normalizeText(item.service_center_text) || "Sem base",
          serviceType: normalizeText(item.service_type_text) || "Sem tipo",
          priority: normalizeText(item.priority_text) || "Sem prioridade",
          note: normalizeText(item.observation) || normalizeText(item.service_description),
        })),
      teams,
      schedules: programmingRows.map((item) => {
        const project = projectMap.get(item.project_id);
        const scheduleActivities = activitiesMap.get(item.id) ?? [];

        return {
          id: item.id,
          projectId: item.project_id,
          teamId: item.team_id,
          date: item.execution_date,
          period: item.period === "INTEGRAL" ? "integral" : "partial",
          startTime: formatTime(item.start_time),
          endTime: formatTime(item.end_time),
          updatedAt: item.updated_at,
          expectedMinutes: Number(item.expected_minutes ?? 0),
          feeder: normalizeText(item.feeder),
          support: normalizeText(item.support),
          note: normalizeText(item.note),
          projectBase: normalizeText(project?.service_center_text) || "Sem base",
          activities: scheduleActivities.map((activity) => ({
            catalogId: activity.service_activity_id,
            code: normalizeText(activity.activity_code),
            description: normalizeText(activity.activity_description),
            quantity: Number(activity.quantity ?? 0),
            unit: normalizeText(activity.activity_unit),
          })),
          documents: {
            sgd: {
              number: normalizeText(item.sgd_number),
              includedAt: item.sgd_included_at ?? "",
              deliveredAt: item.sgd_delivered_at ?? "",
            },
            pi: {
              number: normalizeText(item.pi_number),
              includedAt: item.pi_included_at ?? "",
              deliveredAt: item.pi_delivered_at ?? "",
            },
            pep: {
              number: normalizeText(item.pep_number),
              includedAt: item.pep_included_at ?? "",
              deliveredAt: item.pep_delivered_at ?? "",
            },
          },
        };
      }),
    });
  } catch {
    return NextResponse.json({ message: "Falha ao consultar programacao." }, { status: 500 });
  }
}

async function saveProgramming(request: NextRequest, method: "POST" | "PUT") {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: method === "POST" ? "Sessao invalida para registrar programacao." : "Sessao invalida para editar programacao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as SaveProgrammingPayload | null;
  const programmingId = normalizeText(payload?.id);
  const projectId = normalizeText(payload?.projectId);
  const teamId = normalizeText(payload?.teamId);
  const executionDate = normalizeIsoDate(payload?.date);
  const period = normalizePeriod(payload?.period);
  const startTime = normalizeTime(payload?.startTime);
  const endTime = normalizeTime(payload?.endTime);
  const expectedMinutes = normalizePositiveInteger(payload?.expectedMinutes);
  const feeder = normalizeNullableText(payload?.feeder);
  const support = normalizeNullableText(payload?.support);
  const note = normalizeNullableText(payload?.note);
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt) || null;
  const activitiesInput = Array.isArray(payload?.activities) ? payload.activities : [];
  const activities = activitiesInput
    .map((item) => ({
      catalogId: normalizeText(item.catalogId),
      quantity: normalizePositiveNumber(item.quantity),
    }))
    .filter((item): item is { catalogId: string; quantity: number } => Boolean(item.catalogId) && item.quantity !== null);
  const documents = payload?.documents ?? {};

  if (method === "PUT" && !programmingId) {
    return NextResponse.json({ message: "Programacao invalida para edicao." }, { status: 400 });
  }

  if (!projectId || !teamId || !executionDate || !period || !startTime || !endTime || !expectedMinutes) {
    return NextResponse.json({ message: "Preencha os campos obrigatorios da programacao." }, { status: 400 });
  }

  const currentProgramming = programmingId
    ? await fetchProgrammingById(resolution.supabase, resolution.appUser.tenant_id, programmingId)
    : null;

  if (programmingId && !currentProgramming) {
    return NextResponse.json({ message: "Programacao nao encontrada." }, { status: 404 });
  }

  const currentTeamNamePromise = currentProgramming?.team_id
    ? resolution.supabase
        .from("teams")
        .select("name")
        .eq("tenant_id", resolution.appUser.tenant_id)
        .eq("id", currentProgramming.team_id)
        .maybeSingle<{ name: string }>()
    : Promise.resolve({ data: null as { name: string } | null });

  const [{ data: project }, { data: team }, { data: currentTeamLabel }] = await Promise.all([
    resolution.supabase
      .from("project_with_labels")
      .select("id, sob, is_active")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("id", projectId)
      .eq("is_active", true)
      .maybeSingle<{ id: string; sob: string; is_active: boolean }>(),
    resolution.supabase
      .from("teams")
      .select("id, name, ativo")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("id", teamId)
      .eq("ativo", true)
      .maybeSingle<{ id: string; name: string; ativo: boolean }>(),
    currentTeamNamePromise,
  ]);

  const saveResult = await saveProgrammingViaRpc({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    actorUserId: resolution.appUser.id,
    programmingId: programmingId || null,
    projectId,
    teamId,
    executionDate,
    period,
    startTime,
    endTime,
    expectedMinutes,
    feeder,
    support,
    note,
    documents,
    activities,
    expectedUpdatedAt,
  });

  if (!saveResult.ok) {
    return NextResponse.json({ message: saveResult.message }, { status: saveResult.status });
  }

  const persistedProgrammingId = saveResult.programmingId;
  const nextProgramming = await fetchProgrammingById(resolution.supabase, resolution.appUser.tenant_id, persistedProgrammingId);
  if (!nextProgramming) {
    return NextResponse.json({ message: "Falha ao recarregar programacao salva." }, { status: 500 });
  }

  const nextActivitiesMap = await fetchProgrammingActivities(
    resolution.supabase,
    resolution.appUser.tenant_id,
    [persistedProgrammingId],
  );
  const nextActivities = (nextActivitiesMap.get(persistedProgrammingId) ?? []).map((item) => ({
    code: normalizeText(item.activity_code),
    quantity: Number(item.quantity ?? 0),
  }));

  const previousActivitiesMap = currentProgramming
    ? await fetchProgrammingActivities(resolution.supabase, resolution.appUser.tenant_id, [currentProgramming.id])
    : new Map<string, ProgrammingActivityRow[]>();
  const previousActivities = currentProgramming
    ? (previousActivitiesMap.get(currentProgramming.id) ?? []).map((item) => ({
        code: normalizeText(item.activity_code),
        quantity: Number(item.quantity ?? 0),
      }))
    : [];

  const changes: Record<string, HistoryChange> = {};
  addChange(changes, "project", currentProgramming ? project?.sob ?? null : null, project?.sob ?? null);
  addChange(
    changes,
    "team",
    currentProgramming ? normalizeText(currentTeamLabel?.name) || currentProgramming.team_id : null,
    team?.name ?? teamId,
  );
  addChange(changes, "executionDate", currentProgramming?.execution_date ?? null, nextProgramming.execution_date);
  addChange(changes, "period", currentProgramming?.period ?? null, nextProgramming.period);
  addChange(changes, "startTime", currentProgramming ? formatTime(currentProgramming.start_time) : null, formatTime(nextProgramming.start_time));
  addChange(changes, "endTime", currentProgramming ? formatTime(currentProgramming.end_time) : null, formatTime(nextProgramming.end_time));
  addChange(changes, "expectedMinutes", currentProgramming?.expected_minutes ?? null, nextProgramming.expected_minutes);
  addChange(changes, "feeder", currentProgramming?.feeder ?? null, nextProgramming.feeder);
  addChange(changes, "support", currentProgramming?.support ?? null, nextProgramming.support);
  addChange(changes, "note", currentProgramming?.note ?? null, nextProgramming.note);
  addChange(changes, "sgdNumber", currentProgramming?.sgd_number ?? null, nextProgramming.sgd_number);
  addChange(changes, "piNumber", currentProgramming?.pi_number ?? null, nextProgramming.pi_number);
  addChange(changes, "pepNumber", currentProgramming?.pep_number ?? null, nextProgramming.pep_number);
  addChange(changes, "activities", toActivitySnapshot(previousActivities), toActivitySnapshot(nextActivities));

  await registerProgrammingHistory({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    actorUserId: resolution.appUser.id,
    programmingId: persistedProgrammingId,
    projectCode: project?.sob ?? saveResult.projectCode ?? projectId,
    changes,
    metadata: {
      action: saveResult.action === "INSERT" ? "CREATE" : "UPDATE",
      projectId,
      teamId,
      executionDate,
    },
  });

  return NextResponse.json({
    success: true,
    id: persistedProgrammingId,
    message: saveResult.message,
  });
}

export async function POST(request: NextRequest) {
  return saveProgramming(request, "POST");
}

export async function PUT(request: NextRequest) {
  return saveProgramming(request, "PUT");
}
