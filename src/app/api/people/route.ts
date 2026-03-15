import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import {
  buildConcurrencyConflictResponse,
  hasUpdatedAtConflict,
  normalizeExpectedUpdatedAt,
} from "@/lib/server/concurrency";

type PeopleRow = {
  id: string;
  nome: string;
  matriculation: string | null;
  job_title_id: string;
  job_title_type_id: string | null;
  job_level: string | null;
  ativo: boolean;
  cancellation_reason: string | null;
  canceled_at: string | null;
  canceled_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type JobTitleRow = {
  id: string;
  code: string;
  name: string;
};

type JobTitleTypeRow = {
  id: string;
  job_title_id: string;
  name: string;
};

type JobLevelRow = {
  level: string;
};

type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

type DuplicatePersonRow = {
  id: string;
  nome: string;
};

type PeopleHistoryRow = {
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

type CreatePersonPayload = {
  name: string;
  matriculation?: string | null;
  jobTitleId: string;
  jobTitleTypeId?: string | null;
  jobLevel?: string | null;
};

type UpdatePersonPayload = CreatePersonPayload & {
  id: string;
  expectedUpdatedAt?: string | null;
};

type UpdatePersonStatusPayload = {
  id: string;
  reason: string;
  action?: "cancel" | "activate";
  expectedUpdatedAt?: string | null;
};

type PersonSaveRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  person_id?: string;
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

function normalizeMatriculation(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function normalizeNullableText(value: unknown) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeNullableMatriculation(value: unknown) {
  const normalized = normalizeMatriculation(value);
  return normalized || null;
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

function buildJobTitleMap(jobTitles: JobTitleRow[]) {
  return new Map(jobTitles.map((item) => [item.id, normalizeText(item.name) || "Nao identificado"]));
}

function buildJobTitleTypeMap(jobTitleTypes: JobTitleTypeRow[]) {
  return new Map(jobTitleTypes.map((item) => [item.id, normalizeText(item.name) || "Nao identificado"]));
}

async function fetchJobTitleById(
  supabase: SupabaseClient,
  tenantId: string,
  jobTitleId: string,
) {
  const { data, error } = await supabase
    .from("job_titles")
    .select("id, code, name")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .eq("id", jobTitleId)
    .maybeSingle<JobTitleRow>();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    name: normalizeText(data.name),
  };
}

async function fetchJobTitleTypeById(
  supabase: SupabaseClient,
  tenantId: string,
  jobTitleId: string,
  jobTitleTypeId: string | null,
) {
  if (!jobTitleTypeId) {
    return null;
  }

  const { data, error } = await supabase
    .from("job_title_types")
    .select("id, name, job_title_id")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .eq("job_title_id", jobTitleId)
    .eq("id", jobTitleTypeId)
    .maybeSingle<JobTitleTypeRow>();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    name: normalizeText(data.name),
  };
}

async function fetchJobLevelByValue(
  supabase: SupabaseClient,
  tenantId: string,
  jobLevel: string | null,
) {
  if (!jobLevel) {
    return null;
  }

  const { data, error } = await supabase
    .from("job_levels")
    .select("level")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .eq("level", jobLevel)
    .maybeSingle<JobLevelRow>();

  if (error || !data) {
    return null;
  }

  return data.level;
}

async function fetchPersonById(
  supabase: SupabaseClient,
  tenantId: string,
  personId: string,
) {
  const { data, error } = await supabase
    .from("people")
    .select(
      "id, nome, matriculation, job_title_id, job_title_type_id, job_level, ativo, cancellation_reason, canceled_at, canceled_by, created_by, updated_by, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("id", personId)
    .maybeSingle<PeopleRow>();

  if (error || !data) {
    return null;
  }

  return data;
}

async function findDuplicatePerson(
  supabase: SupabaseClient,
  tenantId: string,
  input: {
    name: string;
    matriculation: string | null;
    jobTitleId: string;
    jobTitleTypeId: string | null;
    jobLevel: string | null;
  },
  excludeId?: string,
) {
  let query = supabase
    .from("people")
    .select("id, nome")
    .eq("tenant_id", tenantId)
    .ilike("nome", input.name)
    .eq("job_title_id", input.jobTitleId);

  if (input.matriculation) {
    query = query.eq("matriculation", input.matriculation);
  } else {
    query = query.is("matriculation", null);
  }

  if (input.jobTitleTypeId) {
    query = query.eq("job_title_type_id", input.jobTitleTypeId);
  } else {
    query = query.is("job_title_type_id", null);
  }

  if (input.jobLevel) {
    query = query.eq("job_level", input.jobLevel);
  } else {
    query = query.is("job_level", null);
  }

  if (excludeId) {
    query = query.neq("id", excludeId);
  }

  const { data, error } = await query.limit(1).returns<DuplicatePersonRow[]>();
  if (error || !data || data.length === 0) {
    return null;
  }

  return data[0];
}

async function savePersonViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  personId: string | null;
  name: string;
  matriculation: string | null;
  jobTitleId: string;
  jobTitleTypeId: string | null;
  jobLevel: string | null;
  changes?: Record<string, HistoryChange>;
  expectedUpdatedAt?: string | null;
}) {
  const { data, error } = await params.supabase.rpc("save_person_record", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_person_id: params.personId,
    p_name: params.name,
    p_matriculation: params.matriculation,
    p_job_title_id: params.jobTitleId,
    p_job_title_type_id: params.jobTitleTypeId,
    p_job_level: params.jobLevel,
    p_changes: params.changes ?? {},
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
  });

  if (error) {
    return { ok: false, status: 500, message: "Falha ao salvar pessoa." } as const;
  }

  const result = (data ?? {}) as PersonSaveRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 500),
      message: result.message ?? "Falha ao salvar pessoa.",
      reason: result.reason ?? null,
    } as const;
  }

  return { ok: true, updatedAt: result.updated_at ?? null } as const;
}

async function setPersonStatusViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  personId: string;
  action: "ACTIVATE" | "CANCEL";
  reason: string;
  expectedUpdatedAt: string | null;
}) {
  const { data, error } = await params.supabase.rpc("set_person_record_status", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_person_id: params.personId,
    p_action: params.action,
    p_reason: params.reason,
    p_expected_updated_at: params.expectedUpdatedAt,
  });

  if (error) {
    return { ok: false, status: 500, message: "Falha ao atualizar status da pessoa." } as const;
  }

  const result = (data ?? {}) as PersonSaveRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 500),
      message: result.message ?? "Falha ao atualizar status da pessoa.",
      reason: result.reason ?? null,
    } as const;
  }

  return { ok: true, updatedAt: result.updated_at ?? null } as const;
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para consultar pessoas.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const params = request.nextUrl.searchParams;
    const historyPersonId = normalizeText(params.get("historyPersonId"));

    if (historyPersonId) {
      const person = await fetchPersonById(supabase, appUser.tenant_id, historyPersonId);
      if (!person) {
        return NextResponse.json({ message: "Pessoa nao encontrada." }, { status: 404 });
      }

      const historyPage = parsePositiveInteger(params.get("historyPage"), 1);
      const historyPageSize = Math.min(parsePositiveInteger(params.get("historyPageSize"), 5), 30);
      const historyFrom = (historyPage - 1) * historyPageSize;
      const historyTo = historyFrom + historyPageSize - 1;

      const { data: historyData, error: historyError, count: historyCount } = await supabase
        .from("app_entity_history")
        .select("id, change_type, reason, changes, created_at, created_by", { count: "exact" })
        .eq("tenant_id", appUser.tenant_id)
        .eq("module_key", "pessoas")
        .eq("entity_table", "people")
        .eq("entity_id", historyPersonId)
        .order("created_at", { ascending: false })
        .range(historyFrom, historyTo)
        .returns<PeopleHistoryRow[]>();

      if (historyError) {
        return NextResponse.json({ message: "Falha ao carregar historico da pessoa." }, { status: 500 });
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
        person: {
          id: person.id,
          name: person.nome,
          isActive: person.ativo,
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
    const matriculation = normalizeText(params.get("matriculation"));
    const jobTitleId = normalizeText(params.get("jobTitleId"));
    const jobTitleTypeId = normalizeText(params.get("jobTitleTypeId"));
    const jobLevel = normalizeText(params.get("jobLevel"));
    const status = normalizeText(params.get("status")).toLowerCase();
    const page = parsePositiveInteger(params.get("page"), 1);
    const pageSize = Math.min(parsePositiveInteger(params.get("pageSize"), 20), 100);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("people")
      .select(
        "id, nome, matriculation, job_title_id, job_title_type_id, job_level, ativo, cancellation_reason, canceled_at, canceled_by, created_by, updated_by, created_at, updated_at",
        { count: "exact" },
      )
      .eq("tenant_id", appUser.tenant_id);

    if (name) {
      query = query.ilike("nome", `%${name}%`);
    }

    if (matriculation) {
      query = query.ilike("matriculation", `%${matriculation}%`);
    }

    if (jobTitleId) {
      query = query.eq("job_title_id", jobTitleId);
    }

    if (jobTitleTypeId) {
      query = query.eq("job_title_type_id", jobTitleTypeId);
    }

    if (jobLevel) {
      query = query.eq("job_level", jobLevel);
    }

    if (status === "ativo") {
      query = query.eq("ativo", true);
    } else if (status === "inativo") {
      query = query.eq("ativo", false);
    }

    const { data, error, count } = await query
      .order("ativo", { ascending: false })
      .order("nome", { ascending: true })
      .range(from, to)
      .returns<PeopleRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao listar pessoas." }, { status: 500 });
    }

    const userIds = Array.from(
      new Set(
        (data ?? [])
          .flatMap((item) => [item.created_by, item.updated_by, item.canceled_by])
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const jobTitleIds = Array.from(
      new Set((data ?? []).map((item) => item.job_title_id).filter((value): value is string => Boolean(value))),
    );
    const jobTitleTypeIds = Array.from(
      new Set((data ?? []).map((item) => item.job_title_type_id).filter((value): value is string => Boolean(value))),
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

    let jobTitles: JobTitleRow[] = [];
    if (jobTitleIds.length > 0) {
      const jobTitlesResult = await supabase
        .from("job_titles")
        .select("id, code, name")
        .eq("tenant_id", appUser.tenant_id)
        .in("id", jobTitleIds)
        .returns<JobTitleRow[]>();

      if (!jobTitlesResult.error) {
        jobTitles = jobTitlesResult.data ?? [];
      }
    }

    let jobTitleTypes: JobTitleTypeRow[] = [];
    if (jobTitleTypeIds.length > 0) {
      const jobTitleTypesResult = await supabase
        .from("job_title_types")
        .select("id, name, job_title_id")
        .eq("tenant_id", appUser.tenant_id)
        .in("id", jobTitleTypeIds)
        .returns<JobTitleTypeRow[]>();

      if (!jobTitleTypesResult.error) {
        jobTitleTypes = jobTitleTypesResult.data ?? [];
      }
    }

    const userDisplayMap = buildUserDisplayMap(users);
    const userLoginNameMap = buildUserLoginNameMap(users);
    const jobTitleMap = buildJobTitleMap(jobTitles);
    const jobTitleTypeMap = buildJobTitleTypeMap(jobTitleTypes);

    return NextResponse.json({
      people: (data ?? []).map((row) => ({
        id: row.id,
        name: row.nome,
        matriculation: row.matriculation,
        jobTitleId: row.job_title_id,
        jobTitleName: jobTitleMap.get(row.job_title_id) ?? "Nao identificado",
        jobTitleTypeId: row.job_title_type_id,
        jobTitleTypeName: row.job_title_type_id
          ? jobTitleTypeMap.get(row.job_title_type_id) ?? "Nao identificado"
          : null,
        jobLevel: row.job_level,
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
    return NextResponse.json({ message: "Falha ao listar pessoas." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para cadastrar pessoas.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as Partial<CreatePersonPayload>;
    const input = {
      name: normalizeText(body.name),
      matriculation: normalizeNullableMatriculation(body.matriculation),
      jobTitleId: normalizeText(body.jobTitleId),
      jobTitleTypeId: normalizeNullableText(body.jobTitleTypeId),
      jobLevel: normalizeNullableText(body.jobLevel),
    };

    if (!input.name || !input.jobTitleId) {
      return NextResponse.json({ message: "Preencha os campos obrigatorios da pessoa." }, { status: 400 });
    }

    const jobTitle = await fetchJobTitleById(supabase, appUser.tenant_id, input.jobTitleId);
    if (!jobTitle) {
      return NextResponse.json({ message: "Cargo invalido para o tenant atual." }, { status: 422 });
    }

    if (input.jobTitleTypeId) {
      const jobTitleType = await fetchJobTitleTypeById(
        supabase,
        appUser.tenant_id,
        input.jobTitleId,
        input.jobTitleTypeId,
      );
      if (!jobTitleType) {
        return NextResponse.json({ message: "Tipo invalido para o cargo selecionado." }, { status: 422 });
      }
    }

    if (input.jobLevel) {
      const jobLevel = await fetchJobLevelByValue(supabase, appUser.tenant_id, input.jobLevel);
      if (!jobLevel) {
        return NextResponse.json({ message: "Nivel invalido para o tenant atual." }, { status: 422 });
      }
    }

    const duplicatedPerson = await findDuplicatePerson(supabase, appUser.tenant_id, input);
    if (duplicatedPerson) {
      return NextResponse.json(
        { message: "Ja existe pessoa com o mesmo nome, matricula, cargo, tipo e nivel no tenant atual." },
        { status: 409 },
      );
    }

    const saveResult = await savePersonViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      personId: null,
      name: input.name,
      matriculation: input.matriculation,
      jobTitleId: input.jobTitleId,
      jobTitleTypeId: input.jobTitleTypeId,
      jobLevel: input.jobLevel,
    });

    if (!saveResult.ok) {
      return NextResponse.json({ message: saveResult.message, code: saveResult.reason ?? undefined }, { status: saveResult.status });
    }

    return NextResponse.json({
      success: true,
      message: `Pessoa ${input.name} cadastrada com sucesso.`,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao cadastrar pessoa." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para editar pessoas.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as Partial<UpdatePersonPayload>;
    const personId = normalizeText(body.id);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);
    const input = {
      name: normalizeText(body.name),
      matriculation: normalizeNullableMatriculation(body.matriculation),
      jobTitleId: normalizeText(body.jobTitleId),
      jobTitleTypeId: normalizeNullableText(body.jobTitleTypeId),
      jobLevel: normalizeNullableText(body.jobLevel),
    };

    if (!personId) {
      return NextResponse.json({ message: "Pessoa invalida para edicao." }, { status: 400 });
    }

    if (!expectedUpdatedAt) {
      return NextResponse.json({ message: "Atualize a lista antes de editar a pessoa." }, { status: 400 });
    }

    if (!input.name || !input.jobTitleId) {
      return NextResponse.json({ message: "Preencha os campos obrigatorios da pessoa." }, { status: 400 });
    }

    const currentPerson = await fetchPersonById(supabase, appUser.tenant_id, personId);
    if (!currentPerson) {
      return NextResponse.json({ message: "Pessoa nao encontrada." }, { status: 404 });
    }

    if (hasUpdatedAtConflict(expectedUpdatedAt, currentPerson.updated_at)) {
      return buildConcurrencyConflictResponse(
        `A pessoa ${currentPerson.nome} foi alterada por outro usuario. Recarregue os dados antes de salvar novamente.`,
      );
    }

    if (!currentPerson.ativo) {
      return buildConcurrencyConflictResponse("Ative a pessoa antes de editar.", "RECORD_INACTIVE");
    }

    const currentJobTitle = await fetchJobTitleById(supabase, appUser.tenant_id, currentPerson.job_title_id);
    const nextJobTitle = await fetchJobTitleById(supabase, appUser.tenant_id, input.jobTitleId);
    if (!nextJobTitle) {
      return NextResponse.json({ message: "Cargo invalido para o tenant atual." }, { status: 422 });
    }

    const currentJobTitleType = await fetchJobTitleTypeById(
      supabase,
      appUser.tenant_id,
      currentPerson.job_title_id,
      currentPerson.job_title_type_id,
    );
    const nextJobTitleType = input.jobTitleTypeId
      ? await fetchJobTitleTypeById(supabase, appUser.tenant_id, input.jobTitleId, input.jobTitleTypeId)
      : null;

    if (input.jobTitleTypeId && !nextJobTitleType) {
      return NextResponse.json({ message: "Tipo invalido para o cargo selecionado." }, { status: 422 });
    }

    if (input.jobLevel) {
      const nextJobLevel = await fetchJobLevelByValue(supabase, appUser.tenant_id, input.jobLevel);
      if (!nextJobLevel) {
        return NextResponse.json({ message: "Nivel invalido para o tenant atual." }, { status: 422 });
      }
    }

    const duplicatedPerson = await findDuplicatePerson(supabase, appUser.tenant_id, input, personId);
    if (duplicatedPerson) {
      return NextResponse.json(
        { message: "Ja existe pessoa com o mesmo nome, matricula, cargo, tipo e nivel no tenant atual." },
        { status: 409 },
      );
    }

    const changes: Record<string, HistoryChange> = {};
    addChange(changes, "name", currentPerson.nome, input.name);
    addChange(changes, "matriculation", currentPerson.matriculation, input.matriculation);
    addChange(changes, "jobTitleName", currentJobTitle?.name ?? null, nextJobTitle.name);
    addChange(changes, "jobTitleTypeName", currentJobTitleType?.name ?? null, nextJobTitleType?.name ?? null);
    addChange(changes, "jobLevel", currentPerson.job_level, input.jobLevel);

    if (Object.keys(changes).length === 0) {
      return NextResponse.json({
        success: true,
        message: `Nenhuma alteracao detectada para ${currentPerson.nome}.`,
      });
    }

    const saveResult = await savePersonViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      personId,
      name: input.name,
      matriculation: input.matriculation,
      jobTitleId: input.jobTitleId,
      jobTitleTypeId: input.jobTitleTypeId,
      jobLevel: input.jobLevel,
      changes,
      expectedUpdatedAt,
    });

    if (!saveResult.ok) {
      return NextResponse.json({ message: saveResult.message, code: saveResult.reason ?? undefined }, { status: saveResult.status });
    }

    return NextResponse.json({
      success: true,
      message: `Pessoa ${input.name} atualizada com sucesso.`,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao editar pessoa." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para atualizar status de pessoas.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as Partial<UpdatePersonStatusPayload>;
    const personId = normalizeText(body.id);
    const reason = normalizeText(body.reason);
    const action = normalizeText(body.action).toLowerCase() === "activate" ? "ACTIVATE" : "CANCEL";
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);

    if (!personId) {
      return NextResponse.json({ message: "Pessoa invalida para atualizar status." }, { status: 400 });
    }

    if (!expectedUpdatedAt) {
      return NextResponse.json({ message: "Atualize a lista antes de alterar o status da pessoa." }, { status: 400 });
    }

    if (!reason) {
      return NextResponse.json(
        { message: action === "ACTIVATE" ? "Informe o motivo da ativacao." : "Informe o motivo do cancelamento." },
        { status: 400 },
      );
    }

    const currentPerson = await fetchPersonById(supabase, appUser.tenant_id, personId);
    if (!currentPerson) {
      return NextResponse.json({ message: "Pessoa nao encontrada." }, { status: 404 });
    }

    if (hasUpdatedAtConflict(expectedUpdatedAt, currentPerson.updated_at)) {
      return buildConcurrencyConflictResponse(
        `A pessoa ${currentPerson.nome} foi alterada por outro usuario. Recarregue os dados antes de alterar o status.`,
      );
    }

    if (action === "CANCEL" && !currentPerson.ativo) {
      return buildConcurrencyConflictResponse(`Pessoa ${currentPerson.nome} ja esta inativa.`, "STATUS_ALREADY_CHANGED");
    }

    if (action === "ACTIVATE" && currentPerson.ativo) {
      return buildConcurrencyConflictResponse(`Pessoa ${currentPerson.nome} ja esta ativa.`, "STATUS_ALREADY_CHANGED");
    }

    const statusResult = await setPersonStatusViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      personId,
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
          ? `Pessoa ${currentPerson.nome} ativada com sucesso.`
          : `Pessoa ${currentPerson.nome} cancelada com sucesso.`,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao atualizar status da pessoa." }, { status: 500 });
  }
}
