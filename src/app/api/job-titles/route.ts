import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import {
  buildConcurrencyConflictResponse,
  hasUpdatedAtConflict,
  normalizeExpectedUpdatedAt,
} from "@/lib/server/concurrency";
import { parsePagination } from "@/lib/server/apiHelpers";

type JobTitleRow = {
  id: string;
  code: string;
  name: string;
  ativo: boolean;
  cancellation_reason: string | null;
  canceled_at: string | null;
  canceled_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type JobTitleTypeRow = {
  id: string;
  job_title_id: string;
  code: string;
  name: string;
  ativo: boolean;
};

type JobLevelRow = {
  level: string;
  ativo: boolean;
};

type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

type JobTitleHistoryRow = {
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

type SaveJobTitlePayload = {
  id?: string | null;
  code?: string | null;
  name?: string | null;
  types?: string[] | string | null;
  levels?: string[] | string | null;
  expectedUpdatedAt?: string | null;
};

type UpdateJobTitleStatusPayload = {
  id?: string | null;
  reason?: string | null;
  action?: "cancel" | "activate";
  expectedUpdatedAt?: string | null;
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

function normalizeCode(value: unknown) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function parseStatusFilter(value: string | null) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "ativo") {
    return true;
  }
  if (normalized === "inativo") {
    return false;
  }
  return null;
}

function normalizeList(value: unknown) {
  const rawItems = Array.isArray(value)
    ? value
    : String(value ?? "")
      .split(/\r?\n|;|,/g);

  const items = rawItems
    .map((item) => normalizeText(item))
    .filter(Boolean);

  return Array.from(new Map(items.map((item) => [item.toLocaleUpperCase("pt-BR"), item])).values());
}

function toPostgrestTextList(values: string[]) {
  return `(${values.map((value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")})`;
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

function formatComparableValue(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalizeText(item)).filter(Boolean).sort().join(", ");
    return normalized || null;
  }
  const normalized = normalizeText(value);
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

function buildUserDisplayMap(users: AppUserRow[]) {
  return new Map(
    users.map((user) => [
      user.id,
      normalizeText(user.display ?? user.login_name) || "Nao identificado",
    ]),
  );
}

function buildUserLoginNameMap(users: AppUserRow[]) {
  return new Map(
    users.map((user) => [user.id, normalizeText(user.login_name) || "Nao identificado"]),
  );
}

function mapDbError(error: unknown, fallbackMessage: string) {
  const details = [
    (error as { message?: string | null })?.message,
    (error as { hint?: string | null })?.hint,
    (error as { details?: string | null })?.details,
  ]
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .join(" | ");

  const normalized = details.toLowerCase();
  if (normalized.includes("duplicate key") || normalized.includes("job_titles_tenant_id_code_key")) {
    return { status: 409, message: "Ja existe cargo com este codigo no tenant atual." } as const;
  }
  if (normalized.includes("job_title_types")) {
    return { status: 409, message: "Ja existe tipo duplicado para este cargo." } as const;
  }
  return { status: 500, message: details ? `${fallbackMessage} ${details}` : fallbackMessage } as const;
}

async function fetchJobTitleById(
  supabase: SupabaseClient,
  tenantId: string,
  jobTitleId: string,
) {
  const { data, error } = await supabase
    .from("job_titles")
    .select("id, code, name, ativo, cancellation_reason, canceled_at, canceled_by, created_by, updated_by, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("id", jobTitleId)
    .maybeSingle<JobTitleRow>();

  if (error || !data) {
    return null;
  }

  return data;
}

async function fetchActiveTypes(
  supabase: SupabaseClient,
  tenantId: string,
  jobTitleId: string,
) {
  const { data, error } = await supabase
    .from("job_title_types")
    .select("id, job_title_id, code, name, ativo")
    .eq("tenant_id", tenantId)
    .eq("job_title_id", jobTitleId)
    .eq("ativo", true)
    .order("name", { ascending: true })
    .returns<JobTitleTypeRow[]>();

  if (error) {
    return [] as JobTitleTypeRow[];
  }

  return data ?? [];
}

async function fetchActiveLevels(supabase: SupabaseClient, tenantId: string) {
  const { data, error } = await supabase
    .from("job_levels")
    .select("level, ativo")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .order("level", { ascending: true })
    .returns<JobLevelRow[]>();

  if (error) {
    return [] as JobLevelRow[];
  }

  return data ?? [];
}

async function syncJobTitleTypes(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  jobTitleId: string;
  typeNames: string[];
}) {
  const { supabase, tenantId, actorUserId, jobTitleId, typeNames } = params;
  const typeRows = typeNames.map((name) => ({
    tenant_id: tenantId,
    job_title_id: jobTitleId,
    code: normalizeCode(name),
    name,
    ativo: true,
    updated_by: actorUserId,
  }));
  const typeCodes = typeRows.map((item) => item.code);

  if (typeRows.length > 0) {
    const { error } = await supabase
      .from("job_title_types")
      .upsert(typeRows, { onConflict: "tenant_id,job_title_id,code" });
    if (error) {
      return { ok: false, error } as const;
    }
  }

  let deactivateQuery = supabase
    .from("job_title_types")
    .update({ ativo: false, updated_by: actorUserId })
    .eq("tenant_id", tenantId)
    .eq("job_title_id", jobTitleId);

  if (typeCodes.length > 0) {
    deactivateQuery = deactivateQuery.not("code", "in", toPostgrestTextList(typeCodes));
  }

  const { error: deactivateError } = await deactivateQuery;
  if (deactivateError) {
    return { ok: false, error: deactivateError } as const;
  }

  return { ok: true } as const;
}

async function syncJobLevels(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  levelNames: string[];
}) {
  const { supabase, tenantId, actorUserId, levelNames } = params;
  const levelRows = levelNames.map((level) => ({
    tenant_id: tenantId,
    level,
    ativo: true,
    updated_by: actorUserId,
  }));

  if (levelRows.length > 0) {
    const { error } = await supabase
      .from("job_levels")
      .upsert(levelRows, { onConflict: "tenant_id,level" });
    if (error) {
      return { ok: false, error } as const;
    }
  }

  let deactivateQuery = supabase
    .from("job_levels")
    .update({ ativo: false, updated_by: actorUserId })
    .eq("tenant_id", tenantId);

  if (levelNames.length > 0) {
    deactivateQuery = deactivateQuery.not("level", "in", toPostgrestTextList(levelNames));
  }

  const { error: deactivateError } = await deactivateQuery;
  if (deactivateError) {
    return { ok: false, error: deactivateError } as const;
  }

  return { ok: true } as const;
}

async function insertHistory(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  jobTitleId: string;
  entityCode: string;
  changeType: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason?: string | null;
  changes: Record<string, HistoryChange>;
}) {
  await params.supabase.from("app_entity_history").insert({
    tenant_id: params.tenantId,
    module_key: "cargo",
    entity_table: "job_titles",
    entity_id: params.jobTitleId,
    entity_code: params.entityCode,
    change_type: params.changeType,
    reason: params.reason ?? null,
    changes: params.changes,
    metadata: {},
    created_by: params.actorUserId,
    updated_by: params.actorUserId,
  });
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para consultar cargos.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const params = request.nextUrl.searchParams;
    const historyJobTitleId = normalizeText(params.get("historyJobTitleId"));

    if (historyJobTitleId) {
      const jobTitle = await fetchJobTitleById(supabase, appUser.tenant_id, historyJobTitleId);
      if (!jobTitle) {
        return NextResponse.json({ message: "Cargo nao encontrado." }, { status: 404 });
      }

      const historyPage = parsePositiveInteger(params.get("historyPage"), 1);
      const historyPageSize = Math.min(parsePositiveInteger(params.get("historyPageSize"), 5), 30);
      const historyFrom = (historyPage - 1) * historyPageSize;
      const historyTo = historyFrom + historyPageSize - 1;

      const { data: historyData, error: historyError, count: historyCount } = await supabase
        .from("app_entity_history")
        .select("id, change_type, reason, changes, created_at, created_by", { count: "exact" })
        .eq("tenant_id", appUser.tenant_id)
        .eq("module_key", "cargo")
        .eq("entity_table", "job_titles")
        .eq("entity_id", historyJobTitleId)
        .order("created_at", { ascending: false })
        .range(historyFrom, historyTo)
        .returns<JobTitleHistoryRow[]>();

      if (historyError) {
        return NextResponse.json({ message: "Falha ao carregar historico do cargo." }, { status: 500 });
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
        jobTitle: {
          id: jobTitle.id,
          code: jobTitle.code,
          name: jobTitle.name,
          isActive: jobTitle.ativo,
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
    const name = normalizeText(params.get("name"));
    const statusFilter = parseStatusFilter(params.get("status"));
    const { page, pageSize, from, to } = parsePagination(params, { maxPageSize: 100 });

    let query = supabase
      .from("job_titles")
      .select("id, code, name, ativo, cancellation_reason, canceled_at, canceled_by, created_by, updated_by, created_at, updated_at", {
        count: "exact",
      })
      .eq("tenant_id", appUser.tenant_id);

    if (code) {
      query = query.ilike("code", `%${code}%`);
    }
    if (name) {
      query = query.ilike("name", `%${name}%`);
    }
    if (statusFilter !== null) {
      query = query.eq("ativo", statusFilter);
    }

    const { data, error, count } = await query
      .order("ativo", { ascending: false })
      .order("name", { ascending: true })
      .range(from, to)
      .returns<JobTitleRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao listar cargos." }, { status: 500 });
    }

    const jobTitleIds = (data ?? []).map((item) => item.id);
    const userIds = Array.from(
      new Set(
        (data ?? [])
          .flatMap((item) => [item.created_by, item.updated_by, item.canceled_by])
          .filter((value): value is string => Boolean(value)),
      ),
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

    let types: JobTitleTypeRow[] = [];
    if (jobTitleIds.length > 0) {
      const typesResult = await supabase
        .from("job_title_types")
        .select("id, job_title_id, code, name, ativo")
        .eq("tenant_id", appUser.tenant_id)
        .in("job_title_id", jobTitleIds)
        .order("name", { ascending: true })
        .returns<JobTitleTypeRow[]>();

      if (!typesResult.error) {
        types = typesResult.data ?? [];
      }
    }

    const activeLevels = await fetchActiveLevels(supabase, appUser.tenant_id);
    const userDisplayMap = buildUserDisplayMap(users);
    const userLoginNameMap = buildUserLoginNameMap(users);
    const typesByJobTitle = new Map<string, JobTitleTypeRow[]>();

    for (const type of types) {
      const currentTypes = typesByJobTitle.get(type.job_title_id) ?? [];
      currentTypes.push(type);
      typesByJobTitle.set(type.job_title_id, currentTypes);
    }

    return NextResponse.json({
      jobTitles: (data ?? []).map((row) => {
        const rowTypes = typesByJobTitle.get(row.id) ?? [];
        const activeTypes = rowTypes.filter((type) => type.ativo);
        return {
          id: row.id,
          code: row.code,
          name: row.name,
          types: rowTypes.map((type) => ({
            id: type.id,
            code: type.code,
            name: type.name,
            isActive: type.ativo,
          })),
          activeTypeNames: activeTypes.map((type) => type.name),
          activeLevelNames: activeLevels.map((level) => level.level),
          isActive: Boolean(row.ativo),
          cancellationReason: row.cancellation_reason,
          canceledAt: row.canceled_at,
          canceledByName: row.canceled_by ? userDisplayMap.get(row.canceled_by) ?? "Nao identificado" : null,
          createdByName: row.created_by ? userLoginNameMap.get(row.created_by) ?? "Nao identificado" : "Nao identificado",
          updatedByName: row.updated_by ? userDisplayMap.get(row.updated_by) ?? "Nao identificado" : "Nao identificado",
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      }),
      activeLevels: activeLevels.map((level) => level.level),
      pagination: {
        page,
        pageSize,
        total: count ?? 0,
      },
    });
  } catch {
    return NextResponse.json({ message: "Falha ao listar cargos." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para cadastrar cargo.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as SaveJobTitlePayload;
    const input = {
      code: normalizeCode(body.code),
      name: normalizeText(body.name),
      typeNames: normalizeList(body.types),
      levelNames: normalizeList(body.levels),
    };

    if (!input.code || !input.name || input.typeNames.length === 0) {
      return NextResponse.json({ message: "Preencha codigo, nome e ao menos um tipo do cargo." }, { status: 400 });
    }

    const { data: insertedJobTitle, error: insertError } = await supabase
      .from("job_titles")
      .insert({
        tenant_id: appUser.tenant_id,
        code: input.code,
        name: input.name,
        ativo: true,
        cancellation_reason: null,
        canceled_at: null,
        canceled_by: null,
        created_by: appUser.id,
        updated_by: appUser.id,
      })
      .select("id, updated_at")
      .single<{ id: string; updated_at: string }>();

    if (insertError || !insertedJobTitle) {
      const mapped = mapDbError(insertError, "Falha ao cadastrar cargo.");
      return NextResponse.json({ message: mapped.message }, { status: mapped.status });
    }

    const typeResult = await syncJobTitleTypes({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      jobTitleId: insertedJobTitle.id,
      typeNames: input.typeNames,
    });
    if (!typeResult.ok) {
      const mapped = mapDbError(typeResult.error, "Falha ao salvar tipos do cargo.");
      return NextResponse.json({ message: mapped.message }, { status: mapped.status });
    }

    const levelResult = await syncJobLevels({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      levelNames: input.levelNames,
    });
    if (!levelResult.ok) {
      const mapped = mapDbError(levelResult.error, "Falha ao salvar niveis do tenant.");
      return NextResponse.json({ message: mapped.message }, { status: mapped.status });
    }

    return NextResponse.json({
      success: true,
      message: `Cargo ${input.name} cadastrado com sucesso.`,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao cadastrar cargo." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para editar cargo.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as SaveJobTitlePayload;
    const jobTitleId = normalizeText(body.id);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);
    const input = {
      code: normalizeCode(body.code),
      name: normalizeText(body.name),
      typeNames: normalizeList(body.types),
      levelNames: normalizeList(body.levels),
    };

    if (!jobTitleId) {
      return NextResponse.json({ message: "Cargo invalido para edicao." }, { status: 400 });
    }
    if (!expectedUpdatedAt) {
      return NextResponse.json({ message: "Atualize a lista antes de editar o cargo." }, { status: 400 });
    }
    if (!input.code || !input.name || input.typeNames.length === 0) {
      return NextResponse.json({ message: "Preencha codigo, nome e ao menos um tipo do cargo." }, { status: 400 });
    }

    const currentJobTitle = await fetchJobTitleById(supabase, appUser.tenant_id, jobTitleId);
    if (!currentJobTitle) {
      return NextResponse.json({ message: "Cargo nao encontrado." }, { status: 404 });
    }
    if (hasUpdatedAtConflict(expectedUpdatedAt, currentJobTitle.updated_at)) {
      return buildConcurrencyConflictResponse(
        `O cargo ${currentJobTitle.name} foi alterado por outro usuario. Recarregue os dados antes de salvar novamente.`,
      );
    }
    if (!currentJobTitle.ativo) {
      return buildConcurrencyConflictResponse("Ative o cargo antes de editar.", "RECORD_INACTIVE");
    }

    const [currentTypes, currentLevels] = await Promise.all([
      fetchActiveTypes(supabase, appUser.tenant_id, jobTitleId),
      fetchActiveLevels(supabase, appUser.tenant_id),
    ]);

    const changes: Record<string, HistoryChange> = {};
    addChange(changes, "code", currentJobTitle.code, input.code);
    addChange(changes, "name", currentJobTitle.name, input.name);
    addChange(changes, "types", currentTypes.map((item) => item.name), input.typeNames);
    addChange(changes, "levels", currentLevels.map((item) => item.level), input.levelNames);

    const { error: updateError } = await supabase
      .from("job_titles")
      .update({
        code: input.code,
        name: input.name,
        updated_by: appUser.id,
      })
      .eq("tenant_id", appUser.tenant_id)
      .eq("id", jobTitleId);

    if (updateError) {
      const mapped = mapDbError(updateError, "Falha ao editar cargo.");
      return NextResponse.json({ message: mapped.message }, { status: mapped.status });
    }

    const typeResult = await syncJobTitleTypes({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      jobTitleId,
      typeNames: input.typeNames,
    });
    if (!typeResult.ok) {
      const mapped = mapDbError(typeResult.error, "Falha ao salvar tipos do cargo.");
      return NextResponse.json({ message: mapped.message }, { status: mapped.status });
    }

    const levelResult = await syncJobLevels({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      levelNames: input.levelNames,
    });
    if (!levelResult.ok) {
      const mapped = mapDbError(levelResult.error, "Falha ao salvar niveis do tenant.");
      return NextResponse.json({ message: mapped.message }, { status: mapped.status });
    }

    if (Object.keys(changes).length > 0) {
      await insertHistory({
        supabase,
        tenantId: appUser.tenant_id,
        actorUserId: appUser.id,
        jobTitleId,
        entityCode: input.code,
        changeType: "UPDATE",
        changes,
      });
    }

    return NextResponse.json({
      success: true,
      message: Object.keys(changes).length > 0
        ? `Cargo ${input.name} atualizado com sucesso.`
        : `Nenhuma alteracao detectada para ${currentJobTitle.name}.`,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao editar cargo." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para atualizar status do cargo.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as UpdateJobTitleStatusPayload;
    const jobTitleId = normalizeText(body.id);
    const reason = normalizeText(body.reason);
    const action = normalizeText(body.action).toLowerCase() === "activate" ? "ACTIVATE" : "CANCEL";
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);

    if (!jobTitleId) {
      return NextResponse.json({ message: "Cargo invalido para atualizar status." }, { status: 400 });
    }
    if (!expectedUpdatedAt) {
      return NextResponse.json({ message: "Atualize a lista antes de alterar o status do cargo." }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json(
        { message: action === "ACTIVATE" ? "Informe o motivo da ativacao." : "Informe o motivo do cancelamento." },
        { status: 400 },
      );
    }

    const currentJobTitle = await fetchJobTitleById(supabase, appUser.tenant_id, jobTitleId);
    if (!currentJobTitle) {
      return NextResponse.json({ message: "Cargo nao encontrado." }, { status: 404 });
    }
    if (hasUpdatedAtConflict(expectedUpdatedAt, currentJobTitle.updated_at)) {
      return buildConcurrencyConflictResponse(
        `O cargo ${currentJobTitle.name} foi alterado por outro usuario. Recarregue os dados antes de alterar o status.`,
      );
    }
    if (action === "CANCEL" && !currentJobTitle.ativo) {
      return buildConcurrencyConflictResponse(`Cargo ${currentJobTitle.name} ja esta inativo.`, "STATUS_ALREADY_CHANGED");
    }
    if (action === "ACTIVATE" && currentJobTitle.ativo) {
      return buildConcurrencyConflictResponse(`Cargo ${currentJobTitle.name} ja esta ativo.`, "STATUS_ALREADY_CHANGED");
    }

    const now = new Date().toISOString();
    const nextIsActive = action === "ACTIVATE";
    const { error: updateError } = await supabase
      .from("job_titles")
      .update({
        ativo: nextIsActive,
        cancellation_reason: nextIsActive ? null : reason,
        canceled_at: nextIsActive ? null : now,
        canceled_by: nextIsActive ? null : appUser.id,
        updated_by: appUser.id,
      })
      .eq("tenant_id", appUser.tenant_id)
      .eq("id", jobTitleId);

    if (updateError) {
      const mapped = mapDbError(updateError, "Falha ao atualizar status do cargo.");
      return NextResponse.json({ message: mapped.message }, { status: mapped.status });
    }

    const changes: Record<string, HistoryChange> = {};
    addChange(changes, "isActive", currentJobTitle.ativo, nextIsActive);
    addChange(changes, "cancellationReason", currentJobTitle.cancellation_reason, nextIsActive ? null : reason);
    addChange(changes, "canceledAt", currentJobTitle.canceled_at, nextIsActive ? null : now);
    if (nextIsActive) {
      addChange(changes, "activationReason", null, reason);
    }

    await insertHistory({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      jobTitleId,
      entityCode: currentJobTitle.code,
      changeType: action,
      reason,
      changes,
    });

    return NextResponse.json({
      success: true,
      message: nextIsActive
        ? `Cargo ${currentJobTitle.name} ativado com sucesso.`
        : `Cargo ${currentJobTitle.name} cancelado com sucesso.`,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao atualizar status do cargo." }, { status: 500 });
  }
}
