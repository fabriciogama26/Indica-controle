import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import {
  buildConcurrencyConflictResponse,
  hasUpdatedAtConflict,
  normalizeExpectedUpdatedAt,
} from "@/lib/server/concurrency";

type CompositionRow = {
  id: string;
  composition_date: string;
  project_id: string;
  team_id: string;
  project_code_snapshot: string;
  project_service_center_snapshot: string | null;
  team_name_snapshot: string;
  vehicle_plate_snapshot: string | null;
  foreman_name_snapshot: string | null;
  sector: string;
  yard: string | null;
  start_time: string;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

type MemberRow = {
  id: string;
  composition_id: string;
  person_id: string;
  person_name_snapshot: string;
  matriculation_snapshot: string | null;
  cpf_snapshot: string | null;
  phone_snapshot: string | null;
  job_title_snapshot: string | null;
  is_present: boolean;
  sort_order: number;
};

type ProjectRow = {
  id: string;
  sob: string;
  service_center_text: string | null;
};

type TeamRow = {
  id: string;
  name: string;
  vehicle_plate: string | null;
  service_center_id: string | null;
  foreman_person_id: string;
  ativo: boolean;
};

type PersonRow = {
  id: string;
  nome: string;
  matriculation: string | null;
  cpf: string | null;
  phone: string | null;
  job_title_id: string;
  ativo: boolean;
};

type JobTitleRow = {
  id: string;
  name: string;
};

type ServiceCenterRow = {
  id: string;
  name: string;
};

type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

type HistoryRow = {
  id: string;
  change_type: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason: string | null;
  changes: unknown;
  created_at: string;
  created_by: string | null;
};

type CompositionMemberPayload = {
  personId?: string;
  isPresent?: boolean;
};

type CompositionPayload = {
  id?: string | null;
  expectedUpdatedAt?: string | null;
  compositionDate?: string;
  projectId?: string;
  teamId?: string;
  sector?: string;
  yard?: string | null;
  startTime?: string;
  notes?: string | null;
  members?: CompositionMemberPayload[];
};

type HistoryChange = {
  from: string | null;
  to: string | null;
};

type SaveTeamCompositionRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string | null;
  message?: string;
  composition_id?: string;
  updated_at?: string;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeLookupKey(value: unknown) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function normalizeMatriculation(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function isForemanRole(value: unknown) {
  return normalizeLookupKey(value).includes("ENCARREGADO");
}

function normalizeNullableText(value: unknown) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeUuid(value: unknown) {
  const normalized = normalizeText(value);
  return /^[0-9a-f-]{36}$/i.test(normalized) ? normalized : null;
}

function normalizeIsoDate(value: unknown) {
  const normalized = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeTime(value: unknown) {
  const normalized = normalizeText(value);
  if (/^\d{2}:\d{2}$/.test(normalized)) {
    return normalized;
  }
  if (/^\d{2}:\d{2}:\d{2}$/.test(normalized)) {
    return normalized.slice(0, 5);
  }
  return null;
}

function parsePositiveInteger(value: string | null, fallback: number, max = 100) {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function formatComparableValue(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function findDuplicateMemberMatriculation(
  members: Array<{ matriculation_snapshot: string | null; person_name_snapshot: string }>,
) {
  const seen = new Map<string, string>();
  for (const member of members) {
    const matriculation = normalizeMatriculation(member.matriculation_snapshot);
    if (!matriculation) {
      continue;
    }
    const previousName = seen.get(matriculation);
    if (previousName) {
      return { matriculation, names: [previousName, member.person_name_snapshot] };
    }
    seen.set(matriculation, member.person_name_snapshot);
  }
  return null;
}

function countForemen(members: Array<{ job_title_snapshot: string | null }>) {
  return members.filter((member) => isForemanRole(member.job_title_snapshot)).length;
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
    result[field] = {
      from: formatComparableValue((rawChange as { from?: unknown }).from),
      to: formatComparableValue((rawChange as { to?: unknown }).to),
    };
  }
  return result;
}

function resolveUserName(user: AppUserRow | undefined) {
  if (!user) {
    return "Nao identificado";
  }
  return normalizeText(user.login_name) || normalizeText(user.display) || "Nao identificado";
}

function buildUserMap(users: AppUserRow[]) {
  return new Map(users.map((user) => [user.id, user]));
}

function mapComposition(row: CompositionRow, members: MemberRow[], userMap: Map<string, AppUserRow>) {
  return {
    id: row.id,
    compositionDate: row.composition_date,
    projectId: row.project_id,
    teamId: row.team_id,
    projectCode: row.project_code_snapshot,
    projectServiceCenter: row.project_service_center_snapshot ?? "",
    teamName: row.team_name_snapshot,
    vehiclePlate: row.vehicle_plate_snapshot ?? "",
    foremanName: row.foreman_name_snapshot ?? "",
    sector: row.sector,
    yard: row.yard ?? "",
    startTime: normalizeTime(row.start_time) ?? row.start_time,
    notes: row.notes ?? "",
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByName: resolveUserName(userMap.get(row.created_by ?? "")),
    updatedByName: resolveUserName(userMap.get(row.updated_by ?? "")),
    members: members.map((member) => ({
      id: member.id,
      personId: member.person_id,
      name: member.person_name_snapshot,
      matriculation: member.matriculation_snapshot,
      cpf: member.cpf_snapshot,
      phone: member.phone_snapshot,
      jobTitleName: member.job_title_snapshot,
      isPresent: Boolean(member.is_present),
      sortOrder: Number(member.sort_order ?? 0),
    })),
  };
}

async function fetchProjectById(supabase: SupabaseClient, tenantId: string, projectId: string) {
  const { data, error } = await supabase
    .from("project_with_labels")
    .select("id, sob, service_center_text")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("id", projectId)
    .maybeSingle<ProjectRow>();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    code: normalizeText(data.sob),
    serviceCenter: normalizeText(data.service_center_text),
  };
}

async function fetchTeamById(supabase: SupabaseClient, tenantId: string, teamId: string) {
  const { data, error } = await supabase
    .from("teams")
    .select("id, name, vehicle_plate, service_center_id, foreman_person_id, ativo")
    .eq("tenant_id", tenantId)
    .eq("id", teamId)
    .maybeSingle<TeamRow>();

  if (error || !data || !data.ativo) {
    return null;
  }

  let serviceCenterName = "";
  if (data.service_center_id) {
    const serviceCenterResult = await supabase
      .from("project_service_centers")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("id", data.service_center_id)
      .maybeSingle<ServiceCenterRow>();
    serviceCenterName = normalizeText(serviceCenterResult.data?.name);
  }

  let foremanPhone: string | null = null;
  if (data.foreman_person_id) {
    const foremanResult = await supabase
      .from("people")
      .select("phone")
      .eq("tenant_id", tenantId)
      .eq("id", data.foreman_person_id)
      .eq("ativo", true)
      .maybeSingle<{ phone: string | null }>();
    foremanPhone = foremanResult.data?.phone ?? null;
  }

  return {
    id: data.id,
    name: normalizeText(data.name),
    vehiclePlate: normalizeText(data.vehicle_plate),
    serviceCenterName,
    foremanId: data.foreman_person_id,
    foremanPhone,
  };
}

async function fetchPeopleSnapshots(supabase: SupabaseClient, tenantId: string, personIds: string[]) {
  const uniquePersonIds = Array.from(new Set(personIds));
  if (!uniquePersonIds.length) {
    return new Map<string, {
      id: string;
      name: string;
      matriculation: string | null;
      cpf: string | null;
      phone: string | null;
      jobTitleName: string;
    }>();
  }

  const { data: peopleRows, error: peopleError } = await supabase
    .from("people")
    .select("id, nome, matriculation, cpf, phone, job_title_id, ativo")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .in("id", uniquePersonIds)
    .returns<PersonRow[]>();

  if (peopleError) {
    return null;
  }

  const jobTitleIds = Array.from(new Set((peopleRows ?? []).map((item) => item.job_title_id).filter(Boolean)));

  const jobTitlesResult = jobTitleIds.length
    ? await supabase.from("job_titles").select("id, name").eq("tenant_id", tenantId).in("id", jobTitleIds).returns<JobTitleRow[]>()
    : { data: [] as JobTitleRow[], error: null };

  const jobTitleMap = new Map((jobTitlesResult.data ?? []).map((item) => [item.id, normalizeText(item.name)]));

  return new Map(
    (peopleRows ?? []).map((person) => {
      const jobTitle = jobTitleMap.get(person.job_title_id) ?? "Nao identificado";
      return [
        person.id,
        {
          id: person.id,
          name: normalizeText(person.nome) || "Nao identificado",
          matriculation: person.matriculation,
          cpf: person.cpf,
          phone: person.phone,
          jobTitleName: jobTitle,
        },
      ];
    }),
  );
}

async function fetchCompositionById(supabase: SupabaseClient, tenantId: string, compositionId: string) {
  const { data, error } = await supabase
    .from("team_compositions")
    .select("id, composition_date, project_id, team_id, project_code_snapshot, project_service_center_snapshot, team_name_snapshot, vehicle_plate_snapshot, foreman_name_snapshot, sector, yard, start_time, notes, is_active, created_at, updated_at, created_by, updated_by")
    .eq("tenant_id", tenantId)
    .eq("id", compositionId)
    .maybeSingle<CompositionRow>();

  if (error || !data) {
    return null;
  }

  return data;
}

async function loadCompositionMembers(supabase: SupabaseClient, tenantId: string, compositionIds: string[]) {
  if (!compositionIds.length) {
    return [] as MemberRow[];
  }

  const { data, error } = await supabase
    .from("team_composition_members")
    .select("id, composition_id, person_id, person_name_snapshot, matriculation_snapshot, cpf_snapshot, phone_snapshot, job_title_snapshot, is_present, sort_order")
    .eq("tenant_id", tenantId)
    .in("composition_id", compositionIds)
    .order("sort_order", { ascending: true })
    .returns<MemberRow[]>();

  if (error) {
    return null;
  }

  return data ?? [];
}

async function insertHistory(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  compositionId: string;
  entityCode: string;
  reason: string;
  changes: Record<string, HistoryChange>;
  metadata?: Record<string, unknown>;
}) {
  await params.supabase.from("app_entity_history").insert({
    tenant_id: params.tenantId,
    module_key: "composicao-equipe",
    entity_table: "team_compositions",
    entity_id: params.compositionId,
    entity_code: params.entityCode,
    change_type: "UPDATE",
    reason: params.reason,
    changes: params.changes,
    metadata: params.metadata ?? {},
    created_by: params.actorUserId,
    updated_by: params.actorUserId,
  });
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para consultar composicao de equipe.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const params = request.nextUrl.searchParams;
    const detailId = normalizeUuid(params.get("detailId"));
    const historyId = normalizeUuid(params.get("historyCompositionId"));

    if (historyId) {
      const historyPage = parsePositiveInteger(params.get("historyPage"), 1, 50);
      const historyPageSize = parsePositiveInteger(params.get("historyPageSize"), 5, 20);
      const from = (historyPage - 1) * historyPageSize;
      const to = from + historyPageSize - 1;
      const currentComposition = await fetchCompositionById(supabase, appUser.tenant_id, historyId);
      if (!currentComposition) {
        return NextResponse.json({ message: "Composicao nao encontrada." }, { status: 404 });
      }

      const { data, error, count } = await supabase
        .from("app_entity_history")
        .select("id, change_type, reason, changes, created_at, created_by", { count: "exact" })
        .eq("tenant_id", appUser.tenant_id)
        .eq("module_key", "composicao-equipe")
        .eq("entity_table", "team_compositions")
        .eq("entity_id", historyId)
        .order("created_at", { ascending: false })
        .range(from, to)
        .returns<HistoryRow[]>();

      if (error) {
        return NextResponse.json({ message: "Falha ao carregar historico da composicao." }, { status: 500 });
      }

      const userIds = Array.from(new Set((data ?? []).map((item) => item.created_by).filter((item): item is string => Boolean(item))));
      const { data: users } = userIds.length
        ? await supabase.from("app_users").select("id, display, login_name").eq("tenant_id", appUser.tenant_id).in("id", userIds).returns<AppUserRow[]>()
        : { data: [] as AppUserRow[] };
      const userMap = buildUserMap(users ?? []);

      return NextResponse.json({
        history: (data ?? []).map((entry) => ({
          id: entry.id,
          changeType: entry.change_type,
          reason: entry.reason,
          changes: normalizeHistoryChanges(entry.changes),
          createdAt: entry.created_at,
          createdByName: resolveUserName(userMap.get(entry.created_by ?? "")),
        })),
        pagination: {
          page: historyPage,
          pageSize: historyPageSize,
          total: count ?? 0,
        },
      });
    }

    if (detailId) {
      const composition = await fetchCompositionById(supabase, appUser.tenant_id, detailId);
      if (!composition) {
        return NextResponse.json({ message: "Composicao nao encontrada." }, { status: 404 });
      }

      const members = await loadCompositionMembers(supabase, appUser.tenant_id, [detailId]);
      if (!members) {
        return NextResponse.json({ message: "Falha ao carregar integrantes da composicao." }, { status: 500 });
      }

      const userIds = [composition.created_by, composition.updated_by].filter((item): item is string => Boolean(item));
      const { data: users } = userIds.length
        ? await supabase.from("app_users").select("id, display, login_name").eq("tenant_id", appUser.tenant_id).in("id", userIds).returns<AppUserRow[]>()
        : { data: [] as AppUserRow[] };

      return NextResponse.json({
        composition: mapComposition(composition, members, buildUserMap(users ?? [])),
      });
    }

    const startDate = normalizeIsoDate(params.get("startDate"));
    const endDate = normalizeIsoDate(params.get("endDate"));
    const projectId = normalizeUuid(params.get("projectId"));
    const teamId = normalizeUuid(params.get("teamId"));
    const page = parsePositiveInteger(params.get("page"), 1);
    const pageSize = parsePositiveInteger(params.get("pageSize"), 20, 100);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("team_compositions")
      .select("id, composition_date, project_id, team_id, project_code_snapshot, project_service_center_snapshot, team_name_snapshot, vehicle_plate_snapshot, foreman_name_snapshot, sector, yard, start_time, notes, is_active, created_at, updated_at, created_by, updated_by", { count: "exact" })
      .eq("tenant_id", appUser.tenant_id)
      .eq("is_active", true);

    if (startDate) {
      query = query.gte("composition_date", startDate);
    }
    if (endDate) {
      query = query.lte("composition_date", endDate);
    }
    if (projectId) {
      query = query.eq("project_id", projectId);
    }
    if (teamId) {
      query = query.eq("team_id", teamId);
    }

    const { data, error, count } = await query
      .order("composition_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to)
      .returns<CompositionRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao listar composicoes de equipe." }, { status: 500 });
    }

    const compositionIds = (data ?? []).map((item) => item.id);
    const members = await loadCompositionMembers(supabase, appUser.tenant_id, compositionIds);
    if (!members) {
      return NextResponse.json({ message: "Falha ao carregar integrantes das composicoes." }, { status: 500 });
    }

    const userIds = Array.from(
      new Set((data ?? []).flatMap((item) => [item.created_by, item.updated_by]).filter((item): item is string => Boolean(item))),
    );
    const { data: users } = userIds.length
      ? await supabase.from("app_users").select("id, display, login_name").eq("tenant_id", appUser.tenant_id).in("id", userIds).returns<AppUserRow[]>()
      : { data: [] as AppUserRow[] };
    const userMap = buildUserMap(users ?? []);
    const memberMap = new Map<string, MemberRow[]>();
    for (const member of members) {
      memberMap.set(member.composition_id, [...(memberMap.get(member.composition_id) ?? []), member]);
    }

    return NextResponse.json({
      compositions: (data ?? []).map((composition) => mapComposition(composition, memberMap.get(composition.id) ?? [], userMap)),
      pagination: {
        page,
        pageSize,
        total: count ?? 0,
      },
    });
  } catch {
    return NextResponse.json({ message: "Falha ao consultar composicao de equipe." }, { status: 500 });
  }
}

async function saveComposition(request: NextRequest, method: "POST" | "PUT") {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para salvar composicao de equipe.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const { supabase, appUser } = resolution;
  const body = (await request.json().catch(() => ({}))) as CompositionPayload;
  const compositionId = normalizeUuid(body.id);
  const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);
  const compositionDate = normalizeIsoDate(body.compositionDate);
  const projectId = normalizeUuid(body.projectId);
  const teamId = normalizeUuid(body.teamId);
  const sector = normalizeText(body.sector) || "OBRA";
  const startTime = normalizeTime(body.startTime);
  const notes = normalizeNullableText(body.notes);
  const rawMembers = Array.isArray(body.members) ? body.members : [];

  if (method === "PUT" && !compositionId) {
    return NextResponse.json({ message: "Composicao invalida para edicao." }, { status: 400 });
  }

  if (method === "PUT" && !expectedUpdatedAt) {
    return NextResponse.json({ message: "Atualize a lista antes de editar a composicao." }, { status: 400 });
  }

  const initialMissingFields = [
    !compositionDate ? "Data" : "",
    !projectId ? "Projeto" : "",
    !teamId ? "Equipe" : "",
    !sector ? "Setor" : "",
    !startTime ? "Hora inicial" : "",
    !rawMembers.length ? "Ao menos uma pessoa" : "",
  ].filter(Boolean);

  if (initialMissingFields.length) {
    return NextResponse.json(
      { message: `Campos obrigatorios pendentes: ${initialMissingFields.join(", ")}.` },
      { status: 400 },
    );
  }

  if (!projectId || !teamId) {
    return NextResponse.json({ message: "Projeto ou equipe invalida para salvar." }, { status: 400 });
  }

  const memberPersonIds = rawMembers.map((member) => normalizeUuid(member.personId)).filter((item): item is string => Boolean(item));
  const uniqueMemberPersonIds = Array.from(new Set(memberPersonIds));
  if (!uniqueMemberPersonIds.length) {
    return NextResponse.json({ message: "Inclua ao menos uma pessoa na composicao." }, { status: 400 });
  }
  if (uniqueMemberPersonIds.length !== memberPersonIds.length) {
    return NextResponse.json({ message: "A mesma pessoa nao pode aparecer duas vezes na composicao." }, { status: 400 });
  }

  const [project, team, peopleMap] = await Promise.all([
    fetchProjectById(supabase, appUser.tenant_id, projectId),
    fetchTeamById(supabase, appUser.tenant_id, teamId),
    fetchPeopleSnapshots(supabase, appUser.tenant_id, uniqueMemberPersonIds),
  ]);

  if (!project) {
    return NextResponse.json({ message: "Projeto invalido ou inativo para o tenant atual." }, { status: 422 });
  }
  if (!team) {
    return NextResponse.json({ message: "Equipe invalida ou inativa para o tenant atual." }, { status: 422 });
  }
  const yard = normalizeNullableText(team.serviceCenterName) ?? normalizeNullableText(body.yard);
  if (!yard) {
    return NextResponse.json(
      { message: "Campos obrigatorios pendentes: Patio/Centro de Servico da equipe." },
      { status: 400 },
    );
  }
  if (!peopleMap) {
    return NextResponse.json({ message: "Falha ao validar pessoas da composicao." }, { status: 500 });
  }
  if (peopleMap.size !== uniqueMemberPersonIds.length) {
    return NextResponse.json({ message: "Uma ou mais pessoas estao inativas ou nao pertencem ao tenant atual." }, { status: 422 });
  }

  const memberRows = rawMembers
    .map((member, index) => {
      const personId = normalizeUuid(member.personId) as string;
      const person = peopleMap.get(personId);
      if (!person) {
        return null;
      }
      return {
        tenant_id: appUser.tenant_id,
        person_id: personId,
        person_name_snapshot: person.name,
        matriculation_snapshot: person.matriculation,
        cpf_snapshot: person.cpf,
        phone_snapshot: team.foremanPhone,
        job_title_snapshot: person.jobTitleName,
        is_present: member.isPresent !== false,
        sort_order: index + 1,
        created_by: appUser.id,
        updated_by: appUser.id,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const duplicatedMatriculation = findDuplicateMemberMatriculation(memberRows);
  if (duplicatedMatriculation) {
    return NextResponse.json(
      {
        message: `Matricula duplicada na composicao: ${duplicatedMatriculation.matriculation} (${duplicatedMatriculation.names.join(" / ")}).`,
      },
      { status: 400 },
    );
  }

  if (countForemen(memberRows) > 1) {
    return NextResponse.json(
      { message: "A composicao nao pode conter mais de um encarregado." },
      { status: 400 },
    );
  }

  const currentComposition = method === "PUT" && compositionId
    ? await fetchCompositionById(supabase, appUser.tenant_id, compositionId)
    : null;

  if (method === "PUT") {
    if (!currentComposition) {
      return NextResponse.json({ message: "Composicao nao encontrada." }, { status: 404 });
    }
    if (hasUpdatedAtConflict(expectedUpdatedAt, currentComposition.updated_at)) {
      return buildConcurrencyConflictResponse("A composicao foi alterada por outro usuario. Recarregue antes de salvar novamente.");
    }
  }

  const changes: Record<string, HistoryChange> = {};
  if (currentComposition) {
    addChange(changes, "compositionDate", currentComposition.composition_date, compositionDate);
    addChange(changes, "projectCode", currentComposition.project_code_snapshot, project.code);
    addChange(changes, "teamName", currentComposition.team_name_snapshot, team.name);
    addChange(changes, "sector", currentComposition.sector, sector);
    addChange(changes, "yard", currentComposition.yard, yard);
    addChange(changes, "startTime", normalizeTime(currentComposition.start_time), startTime);
    addChange(changes, "notes", currentComposition.notes, notes);
    addChange(changes, "members", "lista anterior", `${memberRows.length} integrante(s)`);
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc("save_team_composition_record", {
    p_tenant_id: appUser.tenant_id,
    p_actor_user_id: appUser.id,
    p_composition_id: method === "PUT" ? compositionId : null,
    p_composition_date: compositionDate,
    p_project_id: projectId,
    p_team_id: teamId,
    p_sector: sector,
    p_start_time: startTime,
    p_notes: notes,
    p_members: memberRows.map((member) => ({
      personId: member.person_id,
      isPresent: member.is_present,
    })),
    p_yard: yard,
    p_expected_updated_at: method === "PUT" ? expectedUpdatedAt : null,
  });

  if (rpcError) {
    const rawMessage = normalizeText(rpcError.message);
    const rawDetails = normalizeText(rpcError.details);
    const rawHint = normalizeText(rpcError.hint);
    const normalizedError = `${rawMessage} ${rawDetails} ${rawHint}`.toLowerCase();
    const isMissingOrStaleRpc = normalizedError.includes("save_team_composition_record")
      || normalizedError.includes("schema cache")
      || normalizedError.includes("p_yard")
      || rpcError.code === "PGRST202";
    const detail = [rawMessage, rawDetails, rawHint].filter(Boolean).join(" ");
    const message = isMissingOrStaleRpc
      ? "Falha ao salvar composicao de equipe. Aplique a migration 201_fix_team_composition_save.sql e recarregue o cache do Supabase/PostgREST."
      : `Falha ao salvar composicao de equipe.${detail ? ` Detalhe: ${detail}` : ""}`;

    return NextResponse.json(
      {
        message,
        reason: isMissingOrStaleRpc ? "RPC_SCHEMA_OUTDATED" : "RPC_SAVE_ERROR",
        code: rpcError.code ?? null,
      },
      { status: 500 },
    );
  }

  const saveResult = (rpcData ?? {}) as SaveTeamCompositionRpcResult;
  if (saveResult.success !== true) {
    return NextResponse.json(
      { message: saveResult.message ?? "Falha ao salvar composicao de equipe.", reason: saveResult.reason ?? null },
      { status: Number(saveResult.status ?? 400) },
    );
  }

  const persistedId = normalizeUuid(saveResult.composition_id);
  if (!persistedId) {
    return NextResponse.json({ message: "Composicao salva, mas nao foi possivel retornar o identificador." }, { status: 500 });
  }

  await insertHistory({
    supabase,
    tenantId: appUser.tenant_id,
    actorUserId: appUser.id,
    compositionId: persistedId,
    entityCode: `${project.code} | ${team.name} | ${compositionDate}`,
    reason: method === "POST" ? "Cadastro inicial da composicao." : "Atualizacao da composicao.",
    changes: method === "POST"
      ? {
        compositionDate: { from: null, to: compositionDate },
        projectCode: { from: null, to: project.code },
        teamName: { from: null, to: team.name },
        members: { from: null, to: `${memberRows.length} integrante(s)` },
      }
      : changes,
    metadata: { memberCount: memberRows.length },
  });

  const detail = await fetchCompositionById(supabase, appUser.tenant_id, persistedId);
  const members = await loadCompositionMembers(supabase, appUser.tenant_id, [persistedId]);
  return NextResponse.json({
    success: true,
    id: persistedId,
    updatedAt: saveResult.updated_at ?? null,
    composition: detail && members ? mapComposition(detail, members, new Map()) : null,
    message: saveResult.message ?? (method === "POST" ? "Composicao cadastrada com sucesso." : "Composicao atualizada com sucesso."),
  });
}

export async function POST(request: NextRequest) {
  return saveComposition(request, "POST");
}

export async function PUT(request: NextRequest) {
  return saveComposition(request, "PUT");
}
