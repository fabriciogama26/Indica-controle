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

type ActivityCatalogRow = {
  id: string;
  code: string;
  description: string;
  unit: string;
  ativo: boolean;
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
    .select("id, name, team_type_id, foreman_person_id, ativo")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .order("name", { ascending: true })
    .returns<TeamRow[]>();

  if (error || !teams?.length) {
    return [];
  }

  const teamTypeIds = Array.from(new Set(teams.map((item) => item.team_type_id).filter(Boolean)));
  const foremanIds = Array.from(new Set(teams.map((item) => item.foreman_person_id).filter(Boolean)));

  const [{ data: teamTypes }, { data: people }] = await Promise.all([
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
  ]);

  const teamTypeMap = new Map((teamTypes ?? []).map((item) => [item.id, normalizeText(item.name)]));
  const foremanMap = new Map((people ?? []).map((item) => [item.id, normalizeText(item.nome)]));

  return teams.map((team) => ({
    id: team.id,
    name: normalizeText(team.name),
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

function buildDocumentFields(
  key: "sgd" | "pi" | "pep",
  payload: SaveProgrammingPayload["documents"],
  currentProgramming?: ProgrammingRow | null,
) {
  const rawNumber = normalizeNullableText(payload?.[key]?.number);
  const deliveredAt = normalizeIsoDate(payload?.[key]?.deliveredAt);
  const today = new Date().toISOString().slice(0, 10);
  const currentNumber = currentProgramming ? normalizeNullableText(currentProgramming[`${key}_number`]) : null;
  const currentIncludedAt = currentProgramming ? normalizeIsoDate(currentProgramming[`${key}_included_at`]) : null;

  if (!rawNumber) {
    return {
      [`${key}_number`]: null,
      [`${key}_included_at`]: null,
      [`${key}_delivered_at`]: null,
    };
  }

  return {
    [`${key}_number`]: rawNumber,
    [`${key}_included_at`]: currentNumber === rawNumber && currentIncludedAt ? currentIncludedAt : today,
    [`${key}_delivered_at`]: deliveredAt,
  };
}

async function syncProgrammingActivities(params: {
  supabase: SupabaseClient;
  tenantId: string;
  programmingId: string;
  actorUserId: string;
  activities: Array<{ catalogId: string; quantity: number }>;
}) {
  const { data: existingRows } = await params.supabase
    .from("project_programming_activities")
    .select("id, service_activity_id, quantity, is_active")
    .eq("tenant_id", params.tenantId)
    .eq("programming_id", params.programmingId);

  const existingMap = new Map(
    (existingRows ?? []).map((item) => [item.service_activity_id, item]),
  );

  const activityIds = Array.from(new Set(params.activities.map((item) => item.catalogId)));
  const { data: activityRows, error: activitiesError } = await params.supabase
    .from("service_activities")
    .select("id, code, description, unit, ativo")
    .eq("tenant_id", params.tenantId)
    .in("id", activityIds)
    .returns<ActivityCatalogRow[]>();

  if (activitiesError) {
    return { ok: false, status: 500, message: "Falha ao validar atividades da programacao." } as const;
  }

  const activityMap = new Map(
    (activityRows ?? [])
      .filter((item) => item.ativo)
      .map((item) => [item.id, item]),
  );

  for (const item of params.activities) {
    const activity = activityMap.get(item.catalogId);
    if (!activity) {
      return { ok: false, status: 422, message: "Atividade invalida para o tenant atual." } as const;
    }

    const existing = existingMap.get(item.catalogId);
    if (existing) {
      const { error } = await params.supabase
        .from("project_programming_activities")
        .update({
          activity_code: activity.code,
          activity_description: activity.description,
          activity_unit: activity.unit,
          quantity: item.quantity,
          is_active: true,
          updated_by: params.actorUserId,
        })
        .eq("tenant_id", params.tenantId)
        .eq("id", existing.id);

      if (error) {
        return { ok: false, status: 500, message: "Falha ao atualizar atividades da programacao." } as const;
      }

      continue;
    }

    const { error } = await params.supabase.from("project_programming_activities").insert({
      tenant_id: params.tenantId,
      programming_id: params.programmingId,
      service_activity_id: activity.id,
      activity_code: activity.code,
      activity_description: activity.description,
      activity_unit: activity.unit,
      quantity: item.quantity,
      is_active: true,
      created_by: params.actorUserId,
      updated_by: params.actorUserId,
    });

    if (error) {
      return { ok: false, status: 500, message: "Falha ao registrar atividades da programacao." } as const;
    }
  }

  const nextIds = new Set(params.activities.map((item) => item.catalogId));
  const inactiveRows = (existingRows ?? []).filter((item) => item.is_active && !nextIds.has(item.service_activity_id));

  for (const item of inactiveRows) {
    const { error } = await params.supabase
      .from("project_programming_activities")
      .update({
        is_active: false,
        updated_by: params.actorUserId,
      })
      .eq("tenant_id", params.tenantId)
      .eq("id", item.id);

    if (error) {
      return { ok: false, status: 500, message: "Falha ao inativar atividades removidas da programacao." } as const;
    }
  }

  return { ok: true } as const;
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
  const activitiesInput = Array.isArray(payload?.activities) ? payload.activities : [];
  const activities = activitiesInput
    .map((item) => ({
      catalogId: normalizeText(item.catalogId),
      quantity: normalizePositiveNumber(item.quantity),
    }))
    .filter((item): item is { catalogId: string; quantity: number } => Boolean(item.catalogId) && item.quantity !== null);

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

  const [{ data: project }, { data: team }] = await Promise.all([
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
  ]);

  if (!project) {
    return NextResponse.json({ message: "Projeto invalido para o tenant atual." }, { status: 422 });
  }

  if (!team) {
    return NextResponse.json({ message: "Equipe invalida para o tenant atual." }, { status: 422 });
  }

  let previousTeamName: string | null = null;
  if (currentProgramming?.team_id) {
    if (currentProgramming.team_id === team.id) {
      previousTeamName = team.name;
    } else {
      const { data: previousTeam } = await resolution.supabase
        .from("teams")
        .select("name")
        .eq("tenant_id", resolution.appUser.tenant_id)
        .eq("id", currentProgramming.team_id)
        .maybeSingle<{ name: string }>();

      previousTeamName = normalizeText(previousTeam?.name) || currentProgramming.team_id;
    }
  }

  const documentFields = {
    ...buildDocumentFields("sgd", payload?.documents, currentProgramming),
    ...buildDocumentFields("pi", payload?.documents, currentProgramming),
    ...buildDocumentFields("pep", payload?.documents, currentProgramming),
  };

  const basePayload = {
    tenant_id: resolution.appUser.tenant_id,
    project_id: projectId,
    team_id: teamId,
    execution_date: executionDate,
    period,
    start_time: startTime,
    end_time: endTime,
    expected_minutes: expectedMinutes,
    feeder,
    support,
    note,
    ...documentFields,
    updated_by: resolution.appUser.id,
  };

  let persistedProgrammingId: string | null = programmingId || null;
  if (method === "POST") {
    const { data, error } = await resolution.supabase
      .from("project_programming")
      .insert({
        ...basePayload,
        created_by: resolution.appUser.id,
      })
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error) {
      if (String(error.message ?? "").toLowerCase().includes("duplicate key")) {
        return NextResponse.json({ message: "Ja existe programacao para este projeto, equipe e data." }, { status: 409 });
      }

      return NextResponse.json({ message: "Falha ao registrar programacao." }, { status: 500 });
    }

    persistedProgrammingId = data?.id ?? null;
  } else {
    const { error } = await resolution.supabase
      .from("project_programming")
      .update(basePayload)
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("id", programmingId);

    if (error) {
      if (String(error.message ?? "").toLowerCase().includes("duplicate key")) {
        return NextResponse.json({ message: "Ja existe programacao para este projeto, equipe e data." }, { status: 409 });
      }

      return NextResponse.json({ message: "Falha ao editar programacao." }, { status: 500 });
    }
  }

  if (!persistedProgrammingId) {
    return NextResponse.json({ message: "Falha ao persistir a programacao." }, { status: 500 });
  }

  const syncActivitiesResult = await syncProgrammingActivities({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    programmingId: persistedProgrammingId,
    actorUserId: resolution.appUser.id,
    activities,
  });

  if (!syncActivitiesResult.ok) {
    return NextResponse.json({ message: syncActivitiesResult.message }, { status: syncActivitiesResult.status });
  }

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
  addChange(changes, "project", currentProgramming ? project.sob : null, project.sob);
  addChange(changes, "team", previousTeamName, team.name);
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
    projectCode: project.sob,
    changes,
    metadata: {
      action: method === "POST" ? "CREATE" : "UPDATE",
      projectId,
      teamId,
      executionDate,
    },
  });

  return NextResponse.json({
    success: true,
    id: persistedProgrammingId,
    message:
      method === "POST"
        ? `Programacao do projeto ${project.sob} registrada com sucesso.`
        : `Programacao do projeto ${project.sob} atualizada com sucesso.`,
  });
}

export async function POST(request: NextRequest) {
  return saveProgramming(request, "POST");
}

export async function PUT(request: NextRequest) {
  return saveProgramming(request, "PUT");
}
