import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { normalizeExpectedUpdatedAt } from "@/lib/server/concurrency";
import { parsePagination } from "@/lib/server/apiHelpers";
import { MASS_IMPORT_ROW_LIMIT } from "@/lib/constants/massImport";

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

type JobTitleBatchImportRow = {
  rowNumber?: number;
  code?: string | null;
  name?: string | null;
  types?: string[] | string | null;
  levels?: string[] | string | null;
};

type JobTitleBatchImportPayload = {
  action?: "BATCH_IMPORT";
  rows?: JobTitleBatchImportRow[];
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

type SaveJobTitleRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  job_title_id?: string;
  updated_at?: string;
};

type SetJobTitleStatusRpcResult = SaveJobTitleRpcResult;

async function saveJobTitleViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  jobTitleId: string | null;
  code: string;
  name: string;
  typeNames: string[];
  levelNames: string[];
  expectedUpdatedAt: string | null;
}) {
  const { data, error } = await params.supabase.rpc("save_job_title_record", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_job_title_id: params.jobTitleId,
    p_code: params.code,
    p_name: params.name,
    p_types: params.typeNames.map((name) => ({ code: normalizeCode(name), name })),
    p_levels: params.levelNames,
    p_expected_updated_at: params.expectedUpdatedAt,
  });

  if (error) {
    return { ok: false, status: 500, message: `Falha ao salvar cargo. ${error.message}`.trim(), reason: null } as const;
  }

  const result = (data ?? {}) as SaveJobTitleRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar cargo.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    jobTitleId: result.job_title_id ?? null,
    updatedAt: result.updated_at ?? null,
    message: result.message ?? "Cargo salvo com sucesso.",
  } as const;
}

async function importJobTitleBatch(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  rows: JobTitleBatchImportRow[];
}) {
  const results: Array<{ rowNumber: number; success: boolean; message: string; code?: string }> = [];
  let savedCount = 0;

  for (const [index, row] of params.rows.entries()) {
    const rowNumber = Number.isInteger(Number(row.rowNumber)) && Number(row.rowNumber) > 0 ? Number(row.rowNumber) : index + 2;
    const input = {
      code: normalizeCode(row.code),
      name: normalizeText(row.name),
      typeNames: normalizeList(row.types),
      levelNames: normalizeList(row.levels),
    };

    if (!input.code || !input.name || input.typeNames.length === 0) {
      results.push({
        rowNumber,
        success: false,
        message: "Preencha codigo, nome e ao menos um tipo do cargo.",
        code: "INVALID_JOB_TITLE",
      });
      continue;
    }

    const saveResult = await saveJobTitleViaRpc({
      supabase: params.supabase,
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      jobTitleId: null,
      code: input.code,
      name: input.name,
      typeNames: input.typeNames,
      levelNames: input.levelNames,
      expectedUpdatedAt: null,
    });

    if (!saveResult.ok) {
      results.push({ rowNumber, success: false, message: saveResult.message, code: saveResult.reason ?? undefined });
      continue;
    }

    savedCount += 1;
    results.push({ rowNumber, success: true, message: `Cargo ${input.code} cadastrado com sucesso.` });
  }

  return {
    success: true,
    savedCount,
    errorCount: results.filter((result) => !result.success).length,
    results,
  };
}

async function saveJobTitle(request: NextRequest, method: "POST" | "PUT", parsedBody?: SaveJobTitlePayload) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: method === "POST" ? "Sessao invalida para cadastrar cargo." : "Sessao invalida para editar cargo.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = parsedBody ?? ((await request.json().catch(() => ({}))) as SaveJobTitlePayload);
    const jobTitleId = method === "PUT" ? normalizeText(body.id) : null;
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);
    const input = {
      code: normalizeCode(body.code),
      name: normalizeText(body.name),
      typeNames: normalizeList(body.types),
      levelNames: normalizeList(body.levels),
    };

    if (method === "PUT" && !jobTitleId) {
      return NextResponse.json({ message: "Cargo invalido para edicao." }, { status: 400 });
    }
    if (method === "PUT" && !expectedUpdatedAt) {
      return NextResponse.json({ message: "Atualize a lista antes de editar o cargo." }, { status: 400 });
    }
    if (!input.code || !input.name || input.typeNames.length === 0) {
      return NextResponse.json({ message: "Preencha codigo, nome e ao menos um tipo do cargo." }, { status: 400 });
    }

    const saveResult = await saveJobTitleViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      jobTitleId,
      code: input.code,
      name: input.name,
      typeNames: input.typeNames,
      levelNames: input.levelNames,
      expectedUpdatedAt,
    });

    if (!saveResult.ok) {
      return NextResponse.json({ message: saveResult.message, reason: saveResult.reason }, { status: saveResult.status });
    }

    return NextResponse.json({
      success: true,
      jobTitleId: saveResult.jobTitleId,
      updatedAt: saveResult.updatedAt,
      message: saveResult.message,
    });
  } catch {
    return NextResponse.json({ message: method === "POST" ? "Falha ao cadastrar cargo." : "Falha ao editar cargo." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as SaveJobTitlePayload & JobTitleBatchImportPayload;

  if (normalizeText(body.action).toUpperCase() !== "BATCH_IMPORT") {
    return saveJobTitle(request, "POST", body);
  }

  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para cadastrar cargo.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
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

    const result = await importJobTitleBatch({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      actorUserId: resolution.appUser.id,
      rows,
    });

    return NextResponse.json({
      ...result,
      message:
        result.errorCount > 0
          ? `Cadastro em massa processado com ${result.savedCount} cargos salvos e ${result.errorCount} linhas com erro.`
          : `Cadastro em massa concluido com ${result.savedCount} cargos salvos.`,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao cadastrar cargos em massa." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  return saveJobTitle(request, "PUT");
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

    const { data, error } = await supabase.rpc("set_job_title_record_status", {
      p_tenant_id: appUser.tenant_id,
      p_actor_user_id: appUser.id,
      p_job_title_id: jobTitleId,
      p_action: action,
      p_reason: reason,
      p_expected_updated_at: expectedUpdatedAt,
    });

    if (error) {
      return NextResponse.json({ message: "Falha ao atualizar status do cargo." }, { status: 500 });
    }

    const result = (data ?? {}) as SetJobTitleStatusRpcResult;
    if (result.success !== true) {
      return NextResponse.json({ message: result.message ?? "Falha ao atualizar status do cargo.", reason: result.reason ?? null }, { status: Number(result.status ?? 400) });
    }

    return NextResponse.json({
      success: true,
      jobTitleId: result.job_title_id,
      updatedAt: result.updated_at,
      message: result.message ?? "Status do cargo atualizado com sucesso.",
    });
  } catch {
    return NextResponse.json({ message: "Falha ao atualizar status do cargo." }, { status: 500 });
  }
}
