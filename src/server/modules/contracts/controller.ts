import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { normalizeExpectedUpdatedAt } from "@/lib/server/concurrency";
import {
  buildUserDisplayMap,
  buildUserLoginNameMap,
  normalizeHistoryChanges,
  normalizeText,
  parsePagination,
  parsePositiveInteger,
} from "@/lib/server/apiHelpers";
import { authorizePageAction } from "@/lib/server/routeAuthorization";

type ContractRow = {
  id: string;
  name: string;
  empresa: string | null;
  nome_gestor: string | null;
  email: string | null;
  telefone_corporativo: number | string | null;
  number: string | null;
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

type ContractHistoryRow = {
  id: string;
  change_type: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason: string | null;
  changes: unknown;
  created_at: string;
  created_by: string | null;
};

type SaveContractPayload = {
  id?: string | null;
  name?: string | null;
  empresa?: string | null;
  nomeGestor?: string | null;
  email?: string | null;
  telefoneCorporativo?: string | null;
  numeroContrato?: string | null;
  expectedUpdatedAt?: string | null;
};

type ContractSaveRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  contract_id?: string;
  updated_at?: string;
};

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

function normalizeNullableText(value: unknown) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function mapContractRow(row: ContractRow, userDisplayMap: Map<string, string>, userLoginNameMap: Map<string, string>) {
  const telefoneCorporativo = row.telefone_corporativo === null ? null : String(row.telefone_corporativo);

  return {
    id: row.id,
    name: row.name,
    empresa: row.empresa,
    nomeGestor: row.nome_gestor,
    email: row.email,
    telefoneCorporativo,
    numeroContrato: row.number,
    isActive: Boolean(row.ativo),
    createdByName: row.created_by ? userLoginNameMap.get(row.created_by) ?? "Nao identificado" : "Nao identificado",
    updatedByName: row.updated_by ? userDisplayMap.get(row.updated_by) ?? "Nao identificado" : "Nao identificado",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function fetchContractById(supabase: SupabaseClient, tenantId: string, contractId: string) {
  const { data, error } = await supabase
    .from("contract")
    .select("id, name, empresa, nome_gestor, email, telefone_corporativo, number, ativo, created_by, updated_by, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("id", contractId)
    .maybeSingle<ContractRow>();

  if (error || !data) {
    return null;
  }

  return data;
}

async function fetchUsersByIds(supabase: SupabaseClient, tenantId: string, userIds: string[]) {
  if (userIds.length === 0) {
    return [] as AppUserRow[];
  }

  const { data, error } = await supabase
    .from("app_users")
    .select("id, display, login_name")
    .eq("tenant_id", tenantId)
    .in("id", userIds)
    .returns<AppUserRow[]>();

  if (error) {
    return [] as AppUserRow[];
  }

  return data ?? [];
}

async function saveContractViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  contractId: string | null;
  name: string;
  empresa: string | null;
  nomeGestor: string | null;
  email: string | null;
  telefoneCorporativo: string | null;
  numeroContrato: string | null;
  expectedUpdatedAt: string | null;
}) {
  const { data, error } = await params.supabase.rpc("save_contract_control_record", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_contract_id: params.contractId,
    p_name: params.name,
    p_empresa: params.empresa,
    p_nome_gestor: params.nomeGestor,
    p_email: params.email,
    p_telefone_corporativo: params.telefoneCorporativo,
    p_number: params.numeroContrato,
    p_expected_updated_at: params.expectedUpdatedAt,
  });

  if (error) {
    return { ok: false, status: 500, message: "Falha ao salvar contrato.", reason: null } as const;
  }

  const result = (data ?? {}) as ContractSaveRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar contrato.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    contractId: result.contract_id ?? null,
    updatedAt: result.updated_at ?? null,
    message: result.message ?? "Contrato salvo com sucesso.",
  } as const;
}

function validateContractPayload(body: SaveContractPayload) {
  const name = normalizeText(body.name);
  const empresa = normalizeNullableText(body.empresa);
  const nomeGestor = normalizeNullableText(body.nomeGestor);
  const email = normalizeNullableText(body.email);
  const telefoneCorporativo = normalizeNullableText(body.telefoneCorporativo);
  const numeroContrato = normalizeNullableText(body.numeroContrato);

  if (!name) {
    return { ok: false, message: "Informe o nome do contrato." } as const;
  }

  if (email && !email.includes("@")) {
    return { ok: false, message: "Informe um e-mail valido." } as const;
  }

  return {
    ok: true,
    data: {
      name,
      empresa,
      nomeGestor,
      email,
      telefoneCorporativo,
      numeroContrato,
    },
  } as const;
}

async function buildCurrentRecordPayload(supabase: SupabaseClient, tenantId: string, contractId: string) {
  const current = await fetchContractById(supabase, tenantId, contractId);
  if (!current) {
    return {};
  }

  const userIds = [current.created_by, current.updated_by].filter((value): value is string => Boolean(value));
  const users = await fetchUsersByIds(supabase, tenantId, userIds);
  const userDisplayMap = buildUserDisplayMap(users);
  const userLoginNameMap = buildUserLoginNameMap(users);

  return {
    currentRecord: mapContractRow(current, userDisplayMap, userLoginNameMap),
    currentUpdatedAt: current.updated_at,
    updatedBy: current.updated_by ? userDisplayMap.get(current.updated_by) ?? "Nao identificado" : "Nao identificado",
  };
}

export async function handleGetContracts(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para consultar contratos.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const params = request.nextUrl.searchParams;
    const historyContractId = normalizeText(params.get("historyContractId"));
    const isExport = normalizeText(params.get("mode")).toLowerCase() === "export";
    const authorizationError = await authorizePageAction(resolution, "contrato", isExport ? "export" : "read");

    if (authorizationError) {
      return authorizationError;
    }

    const { supabase, appUser } = resolution;

    if (historyContractId) {
      const contract = await fetchContractById(supabase, appUser.tenant_id, historyContractId);
      if (!contract) {
        return NextResponse.json({ message: "Contrato nao encontrado." }, { status: 404 });
      }

      const historyPage = parsePositiveInteger(params.get("historyPage"), 1);
      const historyPageSize = Math.min(parsePositiveInteger(params.get("historyPageSize"), 5), 30);
      const historyFrom = (historyPage - 1) * historyPageSize;
      const historyTo = historyFrom + historyPageSize - 1;

      const { data: historyData, error: historyError, count: historyCount } = await supabase
        .from("app_entity_history")
        .select("id, change_type, reason, changes, created_at, created_by", { count: "exact" })
        .eq("tenant_id", appUser.tenant_id)
        .eq("module_key", "contrato")
        .eq("entity_table", "contract")
        .eq("entity_id", historyContractId)
        .order("created_at", { ascending: false })
        .range(historyFrom, historyTo)
        .returns<ContractHistoryRow[]>();

      if (historyError) {
        return NextResponse.json({ message: "Falha ao carregar historico do contrato." }, { status: 500 });
      }

      const userIds = Array.from(
        new Set((historyData ?? []).map((entry) => entry.created_by).filter((value): value is string => Boolean(value))),
      );
      const users = await fetchUsersByIds(supabase, appUser.tenant_id, userIds);
      const userDisplayMap = buildUserDisplayMap(users);

      return NextResponse.json({
        contract: {
          id: contract.id,
          name: contract.name,
          empresa: contract.empresa,
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
    const empresa = normalizeText(params.get("empresa"));
    const nomeGestor = normalizeText(params.get("nomeGestor"));
    const statusFilter = parseStatusFilter(params.get("status"));
    const { page, pageSize, from, to } = parsePagination(params, { maxPageSize: 100 });

    let query = supabase
      .from("contract")
      .select("id, name, empresa, nome_gestor, email, telefone_corporativo, number, ativo, created_by, updated_by, created_at, updated_at", { count: "exact" })
      .eq("tenant_id", appUser.tenant_id);

    if (name) {
      query = query.ilike("name", `%${name}%`);
    }

    if (empresa) {
      query = query.ilike("empresa", `%${empresa}%`);
    }

    if (nomeGestor) {
      query = query.ilike("nome_gestor", `%${nomeGestor}%`);
    }

    if (statusFilter !== null) {
      query = query.eq("ativo", statusFilter);
    }

    const { data, error, count } = await query
      .order("ativo", { ascending: false })
      .order("name", { ascending: true })
      .range(from, to)
      .returns<ContractRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao listar contratos." }, { status: 500 });
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
      contracts: (data ?? []).map((row) => mapContractRow(row, userDisplayMap, userLoginNameMap)),
      pagination: {
        page,
        pageSize,
        total: count ?? 0,
      },
    });
  } catch {
    return NextResponse.json({ message: "Falha ao listar contratos." }, { status: 500 });
  }
}

export async function handleCreateContract(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para cadastrar contrato.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorizationError = await authorizePageAction(resolution, "contrato", "create");
    if (authorizationError) {
      return authorizationError;
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as SaveContractPayload;
    const validation = validateContractPayload(body);

    if (!validation.ok) {
      return NextResponse.json({ message: validation.message }, { status: 400 });
    }

    const saveResult = await saveContractViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      contractId: null,
      expectedUpdatedAt: null,
      ...validation.data,
    });

    if (!saveResult.ok) {
      return NextResponse.json(
        { message: saveResult.message, reason: saveResult.reason, code: saveResult.reason },
        { status: saveResult.status },
      );
    }

    return NextResponse.json({
      success: true,
      contractId: saveResult.contractId,
      updatedAt: saveResult.updatedAt,
      message: saveResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao cadastrar contrato." }, { status: 500 });
  }
}

export async function handleUpdateContract(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para editar contrato.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorizationError = await authorizePageAction(resolution, "contrato", "update");
    if (authorizationError) {
      return authorizationError;
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as SaveContractPayload;
    const contractId = normalizeText(body.id);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);
    const validation = validateContractPayload(body);

    if (!contractId) {
      return NextResponse.json({ message: "Contrato invalido para edicao." }, { status: 400 });
    }

    if (!expectedUpdatedAt) {
      return NextResponse.json({ message: "Atualize a lista antes de editar o contrato." }, { status: 400 });
    }

    if (!validation.ok) {
      return NextResponse.json({ message: validation.message }, { status: 400 });
    }

    const saveResult = await saveContractViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      contractId,
      expectedUpdatedAt,
      ...validation.data,
    });

    if (!saveResult.ok) {
      const conflictPayload =
        saveResult.reason === "CONCURRENT_MODIFICATION"
          ? await buildCurrentRecordPayload(supabase, appUser.tenant_id, contractId)
          : {};

      return NextResponse.json(
        { message: saveResult.message, reason: saveResult.reason, code: saveResult.reason, ...conflictPayload },
        { status: saveResult.status },
      );
    }

    return NextResponse.json({
      success: true,
      contractId: saveResult.contractId,
      updatedAt: saveResult.updatedAt,
      message: saveResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao editar contrato." }, { status: 500 });
  }
}
