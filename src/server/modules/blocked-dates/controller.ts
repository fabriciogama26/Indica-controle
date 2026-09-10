import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { normalizeExpectedUpdatedAt } from "@/lib/server/concurrency";
import {
  buildUserDisplayMap,
  buildUserLoginNameMap,
  fetchTenantLinkedAppUsers,
  loadAllRows,
  normalizeHistoryChanges,
  normalizeText,
  parsePagination,
  parsePositiveInteger,
} from "@/lib/server/apiHelpers";
import { authorizeAnyPageAction, authorizePageAction } from "@/lib/server/routeAuthorization";

export const BLOCKED_DATES_PAGE_KEY = "datas-bloqueadas";

// Telas que apenas EXIBEM o catalogo. Ver `authorizeAnyPageAction`: quem abre o
// Mapa ou a Visualizacao nao precisa da permissao do cadastro para ver o aviso.
export const BLOCKED_DATES_CONSUMER_PAGE_KEYS = [
  BLOCKED_DATES_PAGE_KEY,
  "programacao-normalizada",
  "programacao-visualizacao",
  "mapa-programacao",
] as const;

export const BLOCKED_DATE_SCOPES = ["NACIONAL", "MUNICIPAL"] as const;
export const BLOCKED_DATE_KINDS = ["FERIADO", "PONTO_FACULTATIVO", "OUTRO"] as const;

type BlockedDateScope = (typeof BLOCKED_DATE_SCOPES)[number];
type BlockedDateKind = (typeof BLOCKED_DATE_KINDS)[number];

type BlockedDateRow = {
  id: string;
  blocked_date: string;
  description: string;
  scope: string;
  municipality_id: string | null;
  kind: string;
  is_active: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type MunicipalityRow = {
  id: string;
  name: string;
};

type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

type BlockedDateHistoryRow = {
  id: string;
  change_type: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason: string | null;
  changes: unknown;
  created_at: string;
  created_by: string | null;
};

type SaveBlockedDatePayload = {
  id?: string | null;
  blockedDate?: string | null;
  description?: string | null;
  scope?: string | null;
  municipalityId?: string | null;
  kind?: string | null;
  expectedUpdatedAt?: string | null;
};

type UpdateBlockedDateStatusPayload = {
  id?: string | null;
  reason?: string | null;
  action?: "cancel" | "activate";
  expectedUpdatedAt?: string | null;
};

type BlockedDateRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  blocked_date_id?: string;
  updated_at?: string;
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!ISO_DATE_PATTERN.test(normalized)) {
    return null;
  }
  // `2026-02-31` casa com o regex mas nao existe; o Date confirma o calendario.
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    return null;
  }
  return normalized;
}

function parseScope(value: string | null | undefined): BlockedDateScope | null {
  const normalized = normalizeText(value).toUpperCase();
  return (BLOCKED_DATE_SCOPES as readonly string[]).includes(normalized)
    ? (normalized as BlockedDateScope)
    : null;
}

function parseKind(value: string | null | undefined): BlockedDateKind | null {
  const normalized = normalizeText(value).toUpperCase();
  if (!normalized) {
    return "FERIADO";
  }
  return (BLOCKED_DATE_KINDS as readonly string[]).includes(normalized)
    ? (normalized as BlockedDateKind)
    : null;
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

async function fetchMunicipalityNames(supabase: SupabaseClient, tenantId: string, municipalityIds: string[]) {
  if (!municipalityIds.length) {
    return new Map<string, string>();
  }

  const { data, error } = await supabase
    .from("project_municipalities")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .in("id", municipalityIds)
    .returns<MunicipalityRow[]>();

  if (error) {
    return new Map<string, string>();
  }

  return new Map((data ?? []).map((row) => [row.id, row.name]));
}

// Opcoes do select de Municipio do formulario. Vem junto da listagem para nao
// obrigar a tela a chamar `/api/municipalities`, que exige o page_key `municipio`.
async function fetchActiveMunicipalities(supabase: SupabaseClient, tenantId: string) {
  const { data, error } = await loadAllRows<MunicipalityRow>((from, to) =>
    supabase
      .from("project_municipalities")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .order("name", { ascending: true })
      .range(from, to)
      .returns<MunicipalityRow[]>(),
  );

  if (error) {
    return [] as MunicipalityRow[];
  }

  return data ?? [];
}

async function fetchBlockedDateById(supabase: SupabaseClient, tenantId: string, blockedDateId: string) {
  const { data, error } = await supabase
    .from("programming_blocked_dates")
    .select(
      "id, blocked_date, description, scope, municipality_id, kind, is_active, created_by, updated_by, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("id", blockedDateId)
    .maybeSingle<BlockedDateRow>();

  if (error || !data) {
    return null;
  }

  return data;
}

async function saveBlockedDateViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  blockedDateId: string | null;
  blockedDate: string;
  description: string;
  scope: BlockedDateScope;
  municipalityId: string | null;
  kind: BlockedDateKind;
  expectedUpdatedAt: string | null;
}) {
  const { data, error } = await params.supabase.rpc("save_blocked_date_record", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_blocked_date_id: params.blockedDateId,
    p_blocked_date: params.blockedDate,
    p_description: params.description,
    p_scope: params.scope,
    p_municipality_id: params.municipalityId,
    p_kind: params.kind,
    p_expected_updated_at: params.expectedUpdatedAt,
  });

  if (error) {
    return { ok: false, status: 500, message: "Falha ao salvar data bloqueada.", reason: null } as const;
  }

  const result = (data ?? {}) as BlockedDateRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar data bloqueada.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    blockedDateId: result.blocked_date_id ?? null,
    updatedAt: result.updated_at ?? null,
    message: result.message ?? "Data bloqueada salva com sucesso.",
  } as const;
}

async function setBlockedDateStatusViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  blockedDateId: string;
  action: "ACTIVATE" | "CANCEL";
  reason: string;
  expectedUpdatedAt: string | null;
}) {
  const { data, error } = await params.supabase.rpc("set_blocked_date_record_status", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_blocked_date_id: params.blockedDateId,
    p_action: params.action,
    p_reason: params.reason,
    p_expected_updated_at: params.expectedUpdatedAt,
  });

  if (error) {
    return { ok: false, status: 500, message: "Falha ao atualizar status da data bloqueada.", reason: null } as const;
  }

  const result = (data ?? {}) as BlockedDateRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao atualizar status da data bloqueada.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    blockedDateId: result.blocked_date_id ?? null,
    updatedAt: result.updated_at ?? null,
    message: result.message ?? "Status da data bloqueada atualizado com sucesso.",
  } as const;
}

async function fetchUsersByIds(supabase: SupabaseClient, tenantId: string, userIds: string[]) {
  return fetchTenantLinkedAppUsers<AppUserRow>(supabase, tenantId, userIds);
}

/**
 * Leitura consumida pela Programacao, pelo Mapa de Programacao e pela
 * Visualizacao de Programacao: so as datas ATIVAS dentro da janela pedida.
 *
 * A janela e obrigatoria e limitada a 400 dias porque as tres telas trabalham
 * com mes ou semana; sem teto, um `from`/`to` errado varreria o catalogo
 * inteiro do tenant.
 */
export async function handleGetActiveBlockedDates(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para consultar datas bloqueadas.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorizationError = await authorizeAnyPageAction(resolution, BLOCKED_DATES_CONSUMER_PAGE_KEYS, "read");
    if (authorizationError) {
      return authorizationError;
    }

    const params = request.nextUrl.searchParams;
    const from = parseIsoDate(params.get("from"));
    const to = parseIsoDate(params.get("to"));

    if (!from || !to) {
      return NextResponse.json({ message: "Informe a janela de datas em formato AAAA-MM-DD." }, { status: 400 });
    }

    if (from > to) {
      return NextResponse.json({ message: "A data inicial nao pode ser maior que a final." }, { status: 400 });
    }

    const windowDays = Math.round(
      (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000,
    );

    if (windowDays > 400) {
      return NextResponse.json({ message: "A janela de datas bloqueadas nao pode passar de 400 dias." }, { status: 400 });
    }

    const { supabase, appUser } = resolution;

    const { data, error } = await loadAllRows<BlockedDateRow>((rangeFrom, rangeTo) =>
      supabase
        .from("programming_blocked_dates")
        .select(
          "id, blocked_date, description, scope, municipality_id, kind, is_active, created_by, updated_by, created_at, updated_at",
        )
        .eq("tenant_id", appUser.tenant_id)
        .eq("is_active", true)
        .gte("blocked_date", from)
        .lte("blocked_date", to)
        .order("blocked_date", { ascending: true })
        .range(rangeFrom, rangeTo)
        .returns<BlockedDateRow[]>(),
    );

    if (error) {
      return NextResponse.json({ message: "Falha ao carregar datas bloqueadas." }, { status: 500 });
    }

    const rows = data ?? [];
    const municipalityIds = Array.from(
      new Set(rows.map((row) => row.municipality_id).filter((value): value is string => Boolean(value))),
    );
    const municipalityNames = await fetchMunicipalityNames(supabase, appUser.tenant_id, municipalityIds);

    return NextResponse.json({
      blockedDates: rows.map((row) => ({
        id: row.id,
        blockedDate: row.blocked_date,
        description: row.description,
        scope: row.scope,
        kind: row.kind,
        municipalityId: row.municipality_id,
        municipalityName: row.municipality_id ? municipalityNames.get(row.municipality_id) ?? "" : "",
      })),
      from,
      to,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar datas bloqueadas." }, { status: 500 });
  }
}

export async function handleGetBlockedDates(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para consultar datas bloqueadas.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const params = request.nextUrl.searchParams;
    const historyBlockedDateId = normalizeText(params.get("historyBlockedDateId"));
    const isExport = normalizeText(params.get("mode")).toLowerCase() === "export";
    const authorizationError = await authorizePageAction(
      resolution,
      BLOCKED_DATES_PAGE_KEY,
      isExport ? "export" : "read",
    );

    if (authorizationError) {
      return authorizationError;
    }

    const { supabase, appUser } = resolution;

    if (historyBlockedDateId) {
      const blockedDate = await fetchBlockedDateById(supabase, appUser.tenant_id, historyBlockedDateId);
      if (!blockedDate) {
        return NextResponse.json({ message: "Data bloqueada nao encontrada." }, { status: 404 });
      }

      const historyPage = parsePositiveInteger(params.get("historyPage"), 1);
      const historyPageSize = Math.min(parsePositiveInteger(params.get("historyPageSize"), 5), 30);
      const historyFrom = (historyPage - 1) * historyPageSize;
      const historyTo = historyFrom + historyPageSize - 1;

      const { data: historyData, error: historyError, count: historyCount } = await supabase
        .from("app_entity_history")
        .select("id, change_type, reason, changes, created_at, created_by", { count: "exact" })
        .eq("tenant_id", appUser.tenant_id)
        .eq("module_key", BLOCKED_DATES_PAGE_KEY)
        .eq("entity_table", "programming_blocked_dates")
        .eq("entity_id", historyBlockedDateId)
        .order("created_at", { ascending: false })
        .range(historyFrom, historyTo)
        .returns<BlockedDateHistoryRow[]>();

      if (historyError) {
        return NextResponse.json({ message: "Falha ao carregar historico da data bloqueada." }, { status: 500 });
      }

      const userIds = Array.from(
        new Set((historyData ?? []).map((entry) => entry.created_by).filter((value): value is string => Boolean(value))),
      );
      const users = await fetchUsersByIds(supabase, appUser.tenant_id, userIds);
      const userDisplayMap = buildUserDisplayMap(users);

      return NextResponse.json({
        blockedDate: {
          id: blockedDate.id,
          blockedDate: blockedDate.blocked_date,
          description: blockedDate.description,
          scope: blockedDate.scope,
          isActive: blockedDate.is_active,
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

    const description = normalizeText(params.get("description"));
    const scopeFilter = parseScope(params.get("scope"));
    const dateFrom = parseIsoDate(params.get("dateFrom"));
    const dateTo = parseIsoDate(params.get("dateTo"));
    const statusFilter = parseStatusFilter(params.get("status"));
    const { page, pageSize, from, to } = parsePagination(params, { maxPageSize: 100 });

    let query = supabase
      .from("programming_blocked_dates")
      .select(
        "id, blocked_date, description, scope, municipality_id, kind, is_active, created_by, updated_by, created_at, updated_at",
        { count: "exact" },
      )
      .eq("tenant_id", appUser.tenant_id);

    if (description) {
      query = query.ilike("description", `%${description}%`);
    }

    if (scopeFilter) {
      query = query.eq("scope", scopeFilter);
    }

    if (dateFrom) {
      query = query.gte("blocked_date", dateFrom);
    }

    if (dateTo) {
      query = query.lte("blocked_date", dateTo);
    }

    if (statusFilter !== null) {
      query = query.eq("is_active", statusFilter);
    }

    const { data, error, count } = await query
      .order("is_active", { ascending: false })
      .order("blocked_date", { ascending: false })
      .order("description", { ascending: true })
      .range(from, to)
      .returns<BlockedDateRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao listar datas bloqueadas." }, { status: 500 });
    }

    const rows = data ?? [];
    const userIds = Array.from(
      new Set(
        rows
          .flatMap((item) => [item.created_by, item.updated_by])
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const [users, municipalities] = await Promise.all([
      fetchUsersByIds(supabase, appUser.tenant_id, userIds),
      fetchActiveMunicipalities(supabase, appUser.tenant_id),
    ]);
    const userDisplayMap = buildUserDisplayMap(users);
    const userLoginNameMap = buildUserLoginNameMap(users);

    // O municipio de uma linha inativa pode ter saido do catalogo ativo, entao a
    // lista de opcoes nao cobre todos os ids da pagina.
    const municipalityNames = new Map(municipalities.map((item) => [item.id, item.name]));
    const missingMunicipalityIds = Array.from(
      new Set(
        rows
          .map((row) => row.municipality_id)
          .filter((value): value is string => Boolean(value) && !municipalityNames.has(value as string)),
      ),
    );
    const extraMunicipalityNames = await fetchMunicipalityNames(
      supabase,
      appUser.tenant_id,
      missingMunicipalityIds,
    );
    for (const [id, name] of extraMunicipalityNames) {
      municipalityNames.set(id, name);
    }

    return NextResponse.json({
      blockedDates: rows.map((row) => ({
        id: row.id,
        blockedDate: row.blocked_date,
        description: row.description,
        scope: row.scope,
        kind: row.kind,
        municipalityId: row.municipality_id,
        municipalityName: row.municipality_id ? municipalityNames.get(row.municipality_id) ?? "Nao identificado" : "",
        isActive: Boolean(row.is_active),
        createdByName: row.created_by ? userLoginNameMap.get(row.created_by) ?? "Nao identificado" : "Nao identificado",
        updatedByName: row.updated_by ? userDisplayMap.get(row.updated_by) ?? "Nao identificado" : "Nao identificado",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      municipalities: municipalities.map((item) => ({ id: item.id, name: item.name })),
      pagination: {
        page,
        pageSize,
        total: count ?? 0,
      },
    });
  } catch {
    return NextResponse.json({ message: "Falha ao listar datas bloqueadas." }, { status: 500 });
  }
}

function validateSavePayload(body: SaveBlockedDatePayload) {
  const blockedDate = parseIsoDate(body.blockedDate);
  if (!blockedDate) {
    return { error: "Informe a data bloqueada em formato AAAA-MM-DD." } as const;
  }

  const description = normalizeText(body.description);
  if (!description) {
    return { error: "Informe a descricao da data bloqueada." } as const;
  }

  const scope = parseScope(body.scope);
  if (!scope) {
    return { error: "Informe a abrangencia da data bloqueada: NACIONAL ou MUNICIPAL." } as const;
  }

  const kind = parseKind(body.kind);
  if (!kind) {
    return { error: "Tipo invalido para a data bloqueada." } as const;
  }

  const municipalityId = scope === "MUNICIPAL" ? normalizeText(body.municipalityId) : "";
  if (scope === "MUNICIPAL" && !municipalityId) {
    return { error: "Informe o municipio da data bloqueada com abrangencia MUNICIPAL." } as const;
  }

  return {
    error: null,
    blockedDate,
    description,
    scope,
    kind,
    municipalityId: municipalityId || null,
  } as const;
}

export async function handleCreateBlockedDate(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para cadastrar data bloqueada.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorizationError = await authorizePageAction(resolution, BLOCKED_DATES_PAGE_KEY, "create");
    if (authorizationError) {
      return authorizationError;
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as SaveBlockedDatePayload;
    const parsed = validateSavePayload(body);

    if (parsed.error) {
      return NextResponse.json({ message: parsed.error }, { status: 400 });
    }

    const saveResult = await saveBlockedDateViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      blockedDateId: null,
      blockedDate: parsed.blockedDate,
      description: parsed.description,
      scope: parsed.scope,
      municipalityId: parsed.municipalityId,
      kind: parsed.kind,
      expectedUpdatedAt: null,
    });

    if (!saveResult.ok) {
      return NextResponse.json(
        { message: saveResult.message, reason: saveResult.reason, code: saveResult.reason },
        { status: saveResult.status },
      );
    }

    return NextResponse.json({
      success: true,
      blockedDateId: saveResult.blockedDateId,
      updatedAt: saveResult.updatedAt,
      message: saveResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao cadastrar data bloqueada." }, { status: 500 });
  }
}

export async function handleUpdateBlockedDate(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para editar data bloqueada.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorizationError = await authorizePageAction(resolution, BLOCKED_DATES_PAGE_KEY, "update");
    if (authorizationError) {
      return authorizationError;
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as SaveBlockedDatePayload;
    const blockedDateId = normalizeText(body.id);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);

    if (!blockedDateId) {
      return NextResponse.json({ message: "Data bloqueada invalida para edicao." }, { status: 400 });
    }

    if (!expectedUpdatedAt) {
      return NextResponse.json({ message: "Atualize a lista antes de editar a data bloqueada." }, { status: 400 });
    }

    const parsed = validateSavePayload(body);
    if (parsed.error) {
      return NextResponse.json({ message: parsed.error }, { status: 400 });
    }

    const saveResult = await saveBlockedDateViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      blockedDateId,
      blockedDate: parsed.blockedDate,
      description: parsed.description,
      scope: parsed.scope,
      municipalityId: parsed.municipalityId,
      kind: parsed.kind,
      expectedUpdatedAt,
    });

    if (!saveResult.ok) {
      return NextResponse.json(
        { message: saveResult.message, reason: saveResult.reason, code: saveResult.reason },
        { status: saveResult.status },
      );
    }

    return NextResponse.json({
      success: true,
      blockedDateId: saveResult.blockedDateId,
      updatedAt: saveResult.updatedAt,
      message: saveResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao editar data bloqueada." }, { status: 500 });
  }
}

export async function handleUpdateBlockedDateStatus(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para atualizar status da data bloqueada.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as UpdateBlockedDateStatusPayload;
    const blockedDateId = normalizeText(body.id);
    const reason = normalizeText(body.reason);
    const action = normalizeText(body.action).toLowerCase() === "activate" ? "ACTIVATE" : "CANCEL";

    const authorizationError = await authorizePageAction(
      resolution,
      BLOCKED_DATES_PAGE_KEY,
      action === "ACTIVATE" ? "update" : "cancel",
    );

    if (authorizationError) {
      return authorizationError;
    }

    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);

    if (!blockedDateId) {
      return NextResponse.json({ message: "Data bloqueada invalida para atualizar status." }, { status: 400 });
    }

    if (!expectedUpdatedAt) {
      return NextResponse.json({ message: "Atualize a lista antes de alterar o status da data bloqueada." }, { status: 400 });
    }

    if (!reason) {
      return NextResponse.json(
        { message: action === "ACTIVATE" ? "Informe o motivo da ativacao." : "Informe o motivo do cancelamento." },
        { status: 400 },
      );
    }

    const statusResult = await setBlockedDateStatusViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      blockedDateId,
      reason,
      action,
      expectedUpdatedAt,
    });

    if (!statusResult.ok) {
      return NextResponse.json(
        { message: statusResult.message, reason: statusResult.reason, code: statusResult.reason },
        { status: statusResult.status },
      );
    }

    return NextResponse.json({
      success: true,
      blockedDateId: statusResult.blockedDateId,
      updatedAt: statusResult.updatedAt,
      message: statusResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao atualizar status da data bloqueada." }, { status: 500 });
  }
}
