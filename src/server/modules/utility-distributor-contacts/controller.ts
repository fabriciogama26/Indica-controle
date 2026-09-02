import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { normalizeExpectedUpdatedAt } from "@/lib/server/concurrency";
import {
  buildUserDisplayMap,
  buildUserLoginNameMap,
  normalizeHistoryChanges,
  normalizeText,
  parsePagination,
  parsePositiveInteger,
} from "@/lib/server/apiHelpers";
import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { authorizePageAction } from "@/lib/server/routeAuthorization";

type UtilityContactKind = "responsible" | "fieldManager";

type UtilityContactConfig = {
  kind: UtilityContactKind;
  table: "project_utility_responsibles" | "project_utility_field_managers";
  singularLabel: string;
  pluralLabel: string;
  notFoundMessage: string;
};

type UtilityContactRow = {
  id: string;
  name: string;
  ativo: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

type UtilityContactHistoryRow = {
  id: string;
  change_type: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason: string | null;
  changes: unknown;
  created_at: string;
  created_by: string | null;
};

type SaveUtilityContactPayload = {
  id?: string | null;
  kind?: string | null;
  name?: string | null;
  expectedUpdatedAt?: string | null;
};

type UpdateUtilityContactStatusPayload = {
  id?: string | null;
  kind?: string | null;
  reason?: string | null;
  action?: "cancel" | "activate";
  expectedUpdatedAt?: string | null;
};

type UtilityContactRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  contact_id?: string;
  updated_at?: string;
};

const PAGE_KEY = "responsavel-distribuidora";

const CONTACT_CONFIGS: Record<UtilityContactKind, UtilityContactConfig> = {
  responsible: {
    kind: "responsible",
    table: "project_utility_responsibles",
    singularLabel: "responsavel da distribuidora",
    pluralLabel: "responsaveis da distribuidora",
    notFoundMessage: "Responsavel da distribuidora nao encontrado.",
  },
  fieldManager: {
    kind: "fieldManager",
    table: "project_utility_field_managers",
    singularLabel: "gestor de campo da distribuidora",
    pluralLabel: "gestores de campo da distribuidora",
    notFoundMessage: "Gestor de campo da distribuidora nao encontrado.",
  },
};

function parseKind(value: string | null | undefined): UtilityContactKind | null {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "responsible") return "responsible";
  if (normalized === "fieldmanager" || normalized === "field-manager" || normalized === "field_manager") {
    return "fieldManager";
  }
  return null;
}

function parseStatusFilter(value: string | null) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "ativo") return true;
  if (normalized === "inativo") return false;
  return null;
}

async function fetchUtilityContactById(
  supabase: SupabaseClient,
  tenantId: string,
  config: UtilityContactConfig,
  contactId: string,
) {
  const { data, error } = await supabase
    .from(config.table)
    .select("id, name, ativo, created_by, updated_by, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("id", contactId)
    .maybeSingle<UtilityContactRow>();

  if (error || !data) return null;
  return data;
}

async function fetchUsersByIds(supabase: SupabaseClient, tenantId: string, userIds: string[]) {
  if (userIds.length === 0) return [] as AppUserRow[];

  const { data, error } = await supabase
    .from("app_users")
    .select("id, display, login_name")
    .eq("tenant_id", tenantId)
    .in("id", userIds)
    .returns<AppUserRow[]>();

  if (error) return [] as AppUserRow[];
  return data ?? [];
}

async function saveUtilityContactViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  kind: UtilityContactKind;
  contactId: string | null;
  name: string;
  expectedUpdatedAt: string | null;
}) {
  const { data, error } = await params.supabase.rpc("save_utility_distributor_contact_record", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_kind: params.kind,
    p_contact_id: params.contactId,
    p_name: params.name,
    p_expected_updated_at: params.expectedUpdatedAt,
  });

  if (error) {
    return { ok: false, status: 500, message: "Falha ao salvar cadastro da distribuidora.", reason: null } as const;
  }

  const result = (data ?? {}) as UtilityContactRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar cadastro da distribuidora.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    contactId: result.contact_id ?? null,
    updatedAt: result.updated_at ?? null,
    message: result.message ?? "Cadastro da distribuidora salvo com sucesso.",
  } as const;
}

async function setUtilityContactStatusViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  kind: UtilityContactKind;
  contactId: string;
  action: "ACTIVATE" | "CANCEL";
  reason: string;
  expectedUpdatedAt: string | null;
}) {
  const { data, error } = await params.supabase.rpc("set_utility_distributor_contact_status", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_kind: params.kind,
    p_contact_id: params.contactId,
    p_action: params.action,
    p_reason: params.reason,
    p_expected_updated_at: params.expectedUpdatedAt,
  });

  if (error) {
    return { ok: false, status: 500, message: "Falha ao atualizar status do cadastro da distribuidora.", reason: null } as const;
  }

  const result = (data ?? {}) as UtilityContactRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao atualizar status do cadastro da distribuidora.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    contactId: result.contact_id ?? null,
    updatedAt: result.updated_at ?? null,
    message: result.message ?? "Status do cadastro da distribuidora atualizado com sucesso.",
  } as const;
}

export async function handleGetUtilityDistributorContacts(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para consultar responsaveis da distribuidora.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const params = request.nextUrl.searchParams;
    const kind = parseKind(params.get("kind"));
    if (!kind) {
      return NextResponse.json({ message: "Tipo de cadastro da distribuidora invalido." }, { status: 400 });
    }

    const config = CONTACT_CONFIGS[kind];
    const isExport = normalizeText(params.get("mode")).toLowerCase() === "export";
    const authorizationError = await authorizePageAction(resolution, PAGE_KEY, isExport ? "export" : "read");
    if (authorizationError) return authorizationError;

    const { supabase, appUser } = resolution;
    const historyContactId = normalizeText(params.get("historyContactId"));

    if (historyContactId) {
      const contact = await fetchUtilityContactById(supabase, appUser.tenant_id, config, historyContactId);
      if (!contact) {
        return NextResponse.json({ message: config.notFoundMessage }, { status: 404 });
      }

      const historyPage = parsePositiveInteger(params.get("historyPage"), 1);
      const historyPageSize = Math.min(parsePositiveInteger(params.get("historyPageSize"), 5), 30);
      const historyFrom = (historyPage - 1) * historyPageSize;
      const historyTo = historyFrom + historyPageSize - 1;

      const { data: historyData, error: historyError, count: historyCount } = await supabase
        .from("app_entity_history")
        .select("id, change_type, reason, changes, created_at, created_by", { count: "exact" })
        .eq("tenant_id", appUser.tenant_id)
        .eq("module_key", PAGE_KEY)
        .eq("entity_table", config.table)
        .eq("entity_id", historyContactId)
        .order("created_at", { ascending: false })
        .range(historyFrom, historyTo)
        .returns<UtilityContactHistoryRow[]>();

      if (historyError) {
        return NextResponse.json({ message: `Falha ao carregar historico de ${config.singularLabel}.` }, { status: 500 });
      }

      const userIds = Array.from(
        new Set((historyData ?? []).map((entry) => entry.created_by).filter((value): value is string => Boolean(value))),
      );
      const users = await fetchUsersByIds(supabase, appUser.tenant_id, userIds);
      const userDisplayMap = buildUserDisplayMap(users);

      return NextResponse.json({
        contact: {
          id: contact.id,
          kind: config.kind,
          name: contact.name,
          isActive: contact.ativo,
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
    const statusFilter = parseStatusFilter(params.get("status"));
    const { page, pageSize, from, to } = parsePagination(params, { maxPageSize: 100 });

    let query = supabase
      .from(config.table)
      .select("id, name, ativo, created_by, updated_by, created_at, updated_at", { count: "exact" })
      .eq("tenant_id", appUser.tenant_id);

    if (name) {
      query = query.ilike("name", `%${name}%`);
    }

    if (statusFilter !== null) {
      query = query.eq("ativo", statusFilter);
    }

    const { data, error, count } = await query
      .order("ativo", { ascending: false })
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
      .returns<UtilityContactRow[]>();

    if (error) {
      return NextResponse.json({ message: `Falha ao listar ${config.pluralLabel}.` }, { status: 500 });
    }

    const userIds = Array.from(
      new Set(
        (data ?? [])
          .flatMap((item) => [item.created_by, item.updated_by])
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const users = await fetchUsersByIds(supabase, appUser.tenant_id, userIds);
    const userDisplayMap = buildUserDisplayMap(users);
    const userLoginNameMap = buildUserLoginNameMap(users);

    return NextResponse.json({
      contacts: (data ?? []).map((row) => ({
        id: row.id,
        kind: config.kind,
        name: row.name,
        isActive: Boolean(row.ativo),
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
    return NextResponse.json({ message: "Falha ao listar cadastros da distribuidora." }, { status: 500 });
  }
}

export async function handleCreateUtilityDistributorContact(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para cadastrar responsavel da distribuidora.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorizationError = await authorizePageAction(resolution, PAGE_KEY, "create");
    if (authorizationError) return authorizationError;

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as SaveUtilityContactPayload;
    const kind = parseKind(body.kind);
    if (!kind) {
      return NextResponse.json({ message: "Tipo de cadastro da distribuidora invalido." }, { status: 400 });
    }

    const config = CONTACT_CONFIGS[kind];
    const name = normalizeText(body.name);
    if (!name) {
      return NextResponse.json({ message: `Informe o nome do ${config.singularLabel}.` }, { status: 400 });
    }

    const saveResult = await saveUtilityContactViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      kind,
      contactId: null,
      name,
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
      contactId: saveResult.contactId,
      updatedAt: saveResult.updatedAt,
      message: saveResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao cadastrar responsavel da distribuidora." }, { status: 500 });
  }
}

export async function handleUpdateUtilityDistributorContact(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para editar responsavel da distribuidora.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorizationError = await authorizePageAction(resolution, PAGE_KEY, "update");
    if (authorizationError) return authorizationError;

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as SaveUtilityContactPayload;
    const kind = parseKind(body.kind);
    if (!kind) {
      return NextResponse.json({ message: "Tipo de cadastro da distribuidora invalido." }, { status: 400 });
    }

    const config = CONTACT_CONFIGS[kind];
    const contactId = normalizeText(body.id);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);
    const name = normalizeText(body.name);

    if (!contactId) {
      return NextResponse.json({ message: `${config.singularLabel} invalido para edicao.` }, { status: 400 });
    }

    if (!expectedUpdatedAt) {
      return NextResponse.json({ message: `Atualize a lista antes de editar o ${config.singularLabel}.` }, { status: 400 });
    }

    if (!name) {
      return NextResponse.json({ message: `Informe o nome do ${config.singularLabel}.` }, { status: 400 });
    }

    const saveResult = await saveUtilityContactViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      kind,
      contactId,
      name,
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
      contactId: saveResult.contactId,
      updatedAt: saveResult.updatedAt,
      message: saveResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao editar responsavel da distribuidora." }, { status: 500 });
  }
}

export async function handleUpdateUtilityDistributorContactStatus(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para atualizar status do responsavel da distribuidora.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const body = (await request.json().catch(() => ({}))) as UpdateUtilityContactStatusPayload;
    const kind = parseKind(body.kind);
    if (!kind) {
      return NextResponse.json({ message: "Tipo de cadastro da distribuidora invalido." }, { status: 400 });
    }

    const config = CONTACT_CONFIGS[kind];
    const action = normalizeText(body.action).toLowerCase() === "activate" ? "ACTIVATE" : "CANCEL";
    const authorizationError = await authorizePageAction(resolution, PAGE_KEY, action === "ACTIVATE" ? "update" : "cancel");
    if (authorizationError) return authorizationError;

    const { supabase, appUser } = resolution;
    const contactId = normalizeText(body.id);
    const reason = normalizeText(body.reason);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);

    if (!contactId) {
      return NextResponse.json({ message: `${config.singularLabel} invalido para atualizar status.` }, { status: 400 });
    }

    if (!expectedUpdatedAt) {
      return NextResponse.json({ message: `Atualize a lista antes de alterar o status do ${config.singularLabel}.` }, { status: 400 });
    }

    if (!reason) {
      return NextResponse.json(
        { message: action === "ACTIVATE" ? "Informe o motivo da ativacao." : "Informe o motivo do cancelamento." },
        { status: 400 },
      );
    }

    const statusResult = await setUtilityContactStatusViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      kind,
      contactId,
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
      contactId: statusResult.contactId,
      updatedAt: statusResult.updatedAt,
      message: statusResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao atualizar status do responsavel da distribuidora." }, { status: 500 });
  }
}
