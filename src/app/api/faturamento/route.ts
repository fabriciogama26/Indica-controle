import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { authorizePageAction } from "@/lib/server/routeAuthorization";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { loadAllRows, loadRowsInChunks, normalizeText, parsePagination } from "@/lib/server/apiHelpers";
import { withIdempotency } from "@/lib/server/idempotency";
import { BILLING_PAGE_KEY, resolveBillingContext } from "@/server/modules/faturamento";

type BillingStatus = "ABERTA" | "FECHADA" | "CANCELADA";
type BillingKind = "COM_PRODUCAO" | "SEM_PRODUCAO";

// Quantos `billing_order_id` por lote no filtro `.in(...)`. Limita a LARGURA da
// consulta (tamanho da URL do PostgREST); o numero de LINHAS de cada lote e
// paginado separadamente por `loadRowsInChunks`.
const BILLING_RELATION_CHUNK_SIZE = 100;

// Historico exibido em modal: teto de 50 registros (guia_backend.md regra 26).
const BILLING_HISTORY_LIMIT = 50;

type BillingOrderRow = {
  id: string;
  billing_number: string;
  project_id: string;
  billing_kind: BillingKind;
  no_production_reason_id: string | null;
  no_production_reason_name_snapshot: string | null;
  status: BillingStatus;
  ingresso_date: string | null;
  notes: string | null;
  project_code_snapshot: string;
  is_active: boolean;
  cancellation_reason: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

type BillingOrderItemRow = {
  id: string;
  billing_order_id: string;
  service_activity_id: string;
  activity_code: string;
  activity_description: string;
  activity_unit: string;
  voice_point?: number | string | null;
  quantity: number | string;
  rate: number | string;
  unit_value: number | string;
  activity_active_snapshot?: boolean | null;
  total_value: number | string;
  observation: string | null;
  is_active: boolean;
  updated_at: string;
};

type BillingHistoryRow = {
  id: string;
  action_type: string;
  reason: string | null;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
};

type BillingAggregateItem = {
  billing_order_id: string;
  total_value: number | string;
};

type BillingSummaryRow = {
  total_orders: number | string | null;
  total_amount: number | string | null;
};

type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

type ActivityVoicePointRow = {
  id: string;
  voice_point: number | string | null;
};

type SaveBillingPayload = {
  action?: string;
  id?: string;
  projectId?: string;
  billingKind?: string;
  noProductionReasonId?: string;
  ingressoDate?: string;
  notes?: string;
  expectedUpdatedAt?: string;
  items?: Array<{
    activityId?: string;
    quantity?: string | number;
    rate?: string | number;
    observation?: string;
  }>;
};

type SaveBillingBatchPayload = {
  action?: "BATCH_IMPORT_PARTIAL";
  rows?: Array<Omit<SaveBillingPayload, "action" | "id" | "expectedUpdatedAt"> & {
    rowNumbers?: number[];
  }>;
};

type UpdateStatusPayload = {
  id?: string;
  action?: "FECHAR" | "CANCELAR" | "ABRIR";
  reason?: string;
  expectedUpdatedAt?: string;
};

type SaveBillingRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  billing_order_id?: string;
  updated_at?: string;
  currentUpdatedAt?: string;
};

type SaveBillingBatchRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  savedCount?: number;
  errorCount?: number;
  results?: Array<{
    rowNumbers?: number[];
    success?: boolean;
    reason?: string | null;
    message?: string;
    billingOrderId?: string;
  }>;
};

type SetBillingStatusRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  billing_order_id?: string;
  updated_at?: string;
  billing_status?: BillingStatus;
  currentUpdatedAt?: string;
};

// Formato real de UUID, nao "36 caracteres hex ou hifen": a regex antiga aceitava
// coisas como 36 hifens, que passavam pela validacao da rota e so estouravam no
// cast `::uuid` do Postgres — devolvendo 500 onde o certo e 400.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeUuid(value: unknown) {
  const normalized = normalizeText(value);
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeIsoDate(value: unknown): string | null {
  const text = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(text + "T00:00:00Z");
  return isNaN(date.getTime()) ? null : text;
}

function normalizeBillingKind(value: unknown): BillingKind {
  const normalized = normalizeText(value).toUpperCase();
  return normalized === "SEM_PRODUCAO" ? "SEM_PRODUCAO" : "COM_PRODUCAO";
}

function normalizePositiveDecimal(value: unknown) {
  const normalized = normalizeDecimalText(value);
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Number(parsed.toFixed(6));
}

function normalizeDecimalText(value: unknown) {
  const raw = String(value ?? "").trim().replace(/\s/g, "");
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    return raw.split(thousandsSeparator).join("").replace(decimalSeparator, ".");
  }

  if (lastComma >= 0) {
    return raw.replace(/\./g, "").replace(",", ".");
  }

  return raw.replace(/,/g, "");
}

function normalizePositiveIntegerArray(values: unknown) {
  if (!Array.isArray(values)) return [] as number[];
  return Array.from(new Set(values.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)));
}

function normalizeBillingItems(itemsInput: SaveBillingPayload["items"] | undefined) {
  const source = Array.isArray(itemsInput) ? itemsInput : [];
  return source
    .map((item) => ({
      activityId: normalizeUuid(item.activityId),
      quantity: normalizePositiveDecimal(item.quantity),
      rate: normalizePositiveDecimal(item.rate),
      observation: normalizeText(item.observation) || null,
    }))
    .filter((item) => item.activityId && item.quantity !== null && item.rate !== null)
    .map((item) => ({
      activityId: item.activityId as string,
      quantity: item.quantity as number,
      rate: item.rate as number,
      observation: item.observation,
    }));
}

function hasInvalidBillingItemValues(itemsInput: SaveBillingPayload["items"] | undefined) {
  const source = Array.isArray(itemsInput) ? itemsInput : [];
  return source.some((item) => (
    normalizePositiveDecimal(item.quantity) === null
    || normalizePositiveDecimal(item.rate) === null
  ));
}

function findDuplicateActivityId(items: Array<{ activityId: string }>) {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.activityId)) return item.activityId;
    seen.add(item.activityId);
  }
  return null;
}

function resolveAppUserName(user: AppUserRow | undefined) {
  if (!user) return "Nao identificado";
  return normalizeText(user.login_name) || normalizeText(user.display) || "Nao identificado";
}

function billingModuleMigrationHint(message: string | undefined) {
  const normalized = String(message ?? "").toLowerCase();
  if (
    normalized.includes("project_billing_orders")
    || normalized.includes("project_billing_order_items")
    || normalized.includes("project_billing_order_history")
    || normalized.includes("save_project_billing_order")
    || normalized.includes("set_project_billing_order_status")
  ) {
    return " Verifique se a migration 176_create_project_billing_module.sql foi aplicada.";
  }
  if (normalized.includes("project_billing_orders_summary")) {
    return " Verifique se a migration 360_project_billing_orders_summary_rpc.sql foi aplicada.";
  }
  return "";
}

function serializeDbError(error: unknown, operation: string) {
  const source = error && typeof error === "object" ? error as Record<string, unknown> : {};
  return {
    operation,
    code: normalizeText(source.code),
    message: normalizeText(source.message) || normalizeText(error),
    details: source.details ?? null,
    hint: source.hint ?? null,
    name: normalizeText(source.name),
  };
}

function dbErrorResponse(params: {
  error: unknown;
  operation: string;
  message: string;
  tenantId?: string;
  userId?: string;
}) {
  const dbError = serializeDbError(params.error, params.operation);
  const hint = billingModuleMigrationHint(dbError.message);

  // O erro completo (code/details/hint do Postgres) fica no log do servidor com o
  // contexto de tenant/usuario. Devolver `details`/`hint` ao cliente expunha nome
  // de tabela, constraint e trecho de payload para qualquer usuario da tela, entao
  // o corpo so carrega o diagnostico fora de producao.
  console.error("[FATURAMENTO][DB]", {
    ...dbError,
    tenantId: params.tenantId ?? null,
    userId: params.userId ?? null,
  });

  return NextResponse.json(
    {
      message: `${params.message}${hint}`.trim(),
      ...(process.env.NODE_ENV === "production" ? {} : { dbError }),
    },
    { status: 500 },
  );
}

async function fetchAppUserMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  ids: string[];
}) {
  if (!params.ids.length) {
    return new Map<string, AppUserRow>();
  }

  const { data } = await params.supabase
    .from("app_users")
    .select("id, display, login_name")
    .eq("tenant_id", params.tenantId)
    .in("id", params.ids)
    .returns<AppUserRow[]>();

  return new Map((data ?? []).map((item) => [item.id, item]));
}

async function fetchActivityVoicePointMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  activityIds: string[];
}) {
  const activityIds = Array.from(new Set(params.activityIds.filter(Boolean)));
  if (!activityIds.length) {
    return new Map<string, number>();
  }

  const { data } = await params.supabase
    .from("service_activities")
    .select("id, voice_point")
    .eq("tenant_id", params.tenantId)
    .in("id", activityIds)
    .returns<ActivityVoicePointRow[]>();

  return new Map((data ?? []).map((item) => [item.id, Number(item.voice_point ?? 1)]));
}

async function fetchBillingOrderDetail(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  orderId: string;
}) {
  const { data: order, error: orderError } = await params.supabase
    .from("project_billing_orders")
    .select("id, billing_number, project_id, billing_kind, no_production_reason_id, no_production_reason_name_snapshot, status, ingresso_date, notes, project_code_snapshot, is_active, cancellation_reason, canceled_at, created_at, updated_at, created_by, updated_by")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.orderId)
    .maybeSingle<BillingOrderRow>();

  if (orderError || !order) {
    return null;
  }

  // `loadAllRows` em vez da consulta direta: o `total_value` do detalhe e a soma
  // destes itens, entao um corte silencioso em 1.000 linhas devolveria um valor
  // menor apresentado como total. A ordem por `id` e o desempate exigido pela
  // paginacao por offset; `activity_code` continua definindo a ordem de exibicao.
  const loadItems = (columns: string) => loadAllRows<BillingOrderItemRow>((from, to) => params.supabase
    .from("project_billing_order_items")
    .select(columns)
    .eq("tenant_id", params.tenantId)
    .eq("billing_order_id", params.orderId)
    .eq("is_active", true)
    .order("activity_code", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to)
    .returns<BillingOrderItemRow[]>());

  let { data: items, error: itemsError } = await loadItems(
    "id, billing_order_id, service_activity_id, activity_code, activity_description, activity_unit, voice_point, quantity, rate, unit_value, activity_active_snapshot, total_value, observation, is_active, updated_at",
  );

  if (itemsError && (
    String(itemsError.message ?? "").includes("activity_active_snapshot")
    || String(itemsError.message ?? "").includes("voice_point")
  )) {
    const fallback = await loadItems(
      "id, billing_order_id, service_activity_id, activity_code, activity_description, activity_unit, quantity, rate, unit_value, total_value, observation, is_active, updated_at",
    );
    items = fallback.data ?? [];
    itemsError = fallback.error;
  }

  if (itemsError) {
    return null;
  }

  const voicePointMap = await fetchActivityVoicePointMap({
    supabase: params.supabase,
    tenantId: params.tenantId,
    activityIds: (items ?? []).map((item) => item.service_activity_id),
  });

  const userIds = [order.created_by, order.updated_by].filter((item): item is string => Boolean(item));
  const userMap = await fetchAppUserMap({
    supabase: params.supabase,
    tenantId: params.tenantId,
    ids: Array.from(new Set(userIds)),
  });

  const normalizedItems = (items ?? []).map((item) => ({
    id: item.id,
    activityId: item.service_activity_id,
    code: normalizeText(item.activity_code),
    description: normalizeText(item.activity_description),
    unit: normalizeText(item.activity_unit),
    voicePoint: Number(item.voice_point ?? voicePointMap.get(item.service_activity_id) ?? 1),
    unitValue: Number(item.unit_value ?? 0),
    activityIsActive: item.activity_active_snapshot !== false,
    quantity: Number(item.quantity ?? 0),
    rate: Number(item.rate ?? 0),
    totalValue: Number(item.total_value ?? 0),
    observation: normalizeText(item.observation),
  }));

  return {
    id: order.id,
    billingNumber: normalizeText(order.billing_number),
    projectId: order.project_id,
    projectCode: normalizeText(order.project_code_snapshot),
    billingKind: normalizeBillingKind(order.billing_kind),
    noProductionReasonId: order.no_production_reason_id,
    noProductionReasonName: normalizeText(order.no_production_reason_name_snapshot),
    status: order.status,
    ingressoDate: normalizeText(order.ingresso_date),
    notes: normalizeText(order.notes),
    cancellationReason: normalizeText(order.cancellation_reason),
    canceledAt: order.canceled_at,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    createdByName: resolveAppUserName(userMap.get(order.created_by ?? "")),
    updatedByName: resolveAppUserName(userMap.get(order.updated_by ?? "")),
    itemCount: normalizedItems.length,
    totalAmount: normalizedItems.reduce((sum, item) => sum + item.totalValue, 0),
    items: normalizedItems,
  };
}

async function loadHistory(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  orderId: string;
}) {
  const { data, error } = await params.supabase
    .from("project_billing_order_history")
    .select("id, action_type, reason, changes, metadata, created_by, created_at")
    .eq("tenant_id", params.tenantId)
    .eq("billing_order_id", params.orderId)
    .order("created_at", { ascending: false })
    .limit(BILLING_HISTORY_LIMIT)
    .returns<BillingHistoryRow[]>();

  if (error) {
    return null;
  }

  const userIds = Array.from(new Set((data ?? []).map((item) => item.created_by).filter((item): item is string => Boolean(item))));
  const userMap = await fetchAppUserMap({
    supabase: params.supabase,
    tenantId: params.tenantId,
    ids: userIds,
  });

  return (data ?? []).map((item) => ({
    id: item.id,
    action: normalizeText(item.action_type),
    reason: normalizeText(item.reason),
    changes: item.changes ?? {},
    metadata: item.metadata ?? {},
    changedAt: item.created_at,
    changedByName: resolveAppUserName(userMap.get(item.created_by ?? "")),
  }));
}

export async function GET(request: NextRequest) {
  // A exportacao consome esta mesma rota (listagem paginada e detalhe por ordem),
  // entao a permissao `export` e cobrada aqui, no modo `mode=export`. Sem isso,
  // `can_export = false` nao bloqueava nada em Faturamento — ao contrario de
  // medicao/estornos/stock-balance, que ja separam as duas acoes.
  const isExportRequest = normalizeText(request.nextUrl.searchParams.get("mode")).toLowerCase() === "export";
  const resolved = await resolveBillingContext(request, {
    invalidSessionMessage: "Sessao invalida para consultar faturamento.",
    action: isExportRequest ? "export" : "read",
  });
  if ("errorResponse" in resolved) {
    return resolved.errorResponse;
  }
  const resolution = resolved.context;

  const historyOrderId = normalizeUuid(request.nextUrl.searchParams.get("historyOrderId"));
  if (historyOrderId) {
    const history = await loadHistory({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      orderId: historyOrderId,
    });

    if (history === null) {
      return NextResponse.json({ message: "Falha ao carregar historico do faturamento." }, { status: 500 });
    }

    return NextResponse.json({ history });
  }

  const orderId = normalizeUuid(request.nextUrl.searchParams.get("orderId"));
  if (orderId) {
    const detail = await fetchBillingOrderDetail({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      orderId,
    });

    if (!detail) {
      return NextResponse.json({ message: "Faturamento nao encontrado." }, { status: 404 });
    }

    return NextResponse.json({ order: detail });
  }

  const projectId = normalizeUuid(request.nextUrl.searchParams.get("projectId"));
  const statusFilter = normalizeText(request.nextUrl.searchParams.get("status")).toUpperCase();
  const billingKindFilter = normalizeText(request.nextUrl.searchParams.get("billingKind")).toUpperCase();
  const noProductionReasonIdFilter = normalizeUuid(request.nextUrl.searchParams.get("noProductionReasonId"));
  const { page, pageSize } = parsePagination(request.nextUrl.searchParams, {
    defaultPageSize: 20,
    maxPageSize: 500,
    maxPage: 10_000,
  });

  const statusParam = statusFilter && statusFilter !== "TODOS" ? statusFilter : null;
  const billingKindParam = billingKindFilter === "COM_PRODUCAO" || billingKindFilter === "SEM_PRODUCAO" ? billingKindFilter : null;

  // C1: count e valor total agregados no banco com os mesmos filtros da listagem
  // (evita buscar todos os registros em memoria). O valor total cobre TODOS os
  // faturamentos filtrados, nao apenas a pagina retornada.
  const { data: summaryData, error: summaryError } = await resolution.supabase.rpc("project_billing_orders_summary", {
    p_tenant_id: resolution.appUser.tenant_id,
    p_project_id: projectId,
    p_status: statusParam,
    p_billing_kind: billingKindParam,
    p_no_production_reason_id: noProductionReasonIdFilter,
  });

  if (summaryError) {
    return dbErrorResponse({
      error: summaryError,
      operation: "faturamento.list.summary",
      message: "Falha ao listar faturamentos.",
      tenantId: resolution.appUser.tenant_id,
      userId: resolution.appUser.id,
    });
  }

  const summaryRow = (Array.isArray(summaryData) ? summaryData[0] : summaryData) as BillingSummaryRow | null | undefined;
  const total = Number(summaryRow?.total_orders ?? 0);
  const totalAmount = Number(summaryRow?.total_amount ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;

  // C1: busca apenas a pagina solicitada diretamente no banco
  let dataQuery = resolution.supabase
    .from("project_billing_orders")
    .select("id, billing_number, project_id, billing_kind, no_production_reason_id, no_production_reason_name_snapshot, status, ingresso_date, notes, project_code_snapshot, is_active, cancellation_reason, canceled_at, created_at, updated_at, created_by, updated_by")
    .eq("tenant_id", resolution.appUser.tenant_id)
    // `id` como desempate garante ordem TOTAL. Sem ele a paginacao por offset e
    // indeterminada sempre que varias linhas compartilham `updated_at` — e a
    // importacao em lote garante esse empate: `now()` e constante na transacao,
    // entao as 500 ordens de um mesmo lote nascem com o mesmo `updated_at`, e o
    // loop de exportacao repetia e pulava registros entre as paginas.
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .range(startIndex, startIndex + pageSize - 1);

  if (projectId) dataQuery = dataQuery.eq("project_id", projectId);
  if (statusParam) dataQuery = dataQuery.eq("status", statusParam);
  if (billingKindParam) dataQuery = dataQuery.eq("billing_kind", billingKindParam);
  if (noProductionReasonIdFilter) dataQuery = dataQuery.eq("no_production_reason_id", noProductionReasonIdFilter);

  const { data: pagedBaseOrders, error } = await dataQuery.returns<BillingOrderRow[]>();
  if (error) {
    return dbErrorResponse({
      error,
      operation: "faturamento.list.data",
      message: "Falha ao listar faturamentos.",
      tenantId: resolution.appUser.tenant_id,
      userId: resolution.appUser.id,
    });
  }

  const pagedOrderIds = (pagedBaseOrders ?? []).map((item) => item.id);

  // O `.in(...)` cru cortava em 1.000 linhas sem sinalizar: com `pageSize` de ate
  // 500 ordens (o export pede exatamente 500), qualquer pagina com mais de 1.000
  // itens somados perdia o resto em silencio e as ordens que ficavam de fora
  // apareciam com `valor_total` e `itens` zerados — na tela e no CSV.
  const { data: aggregateItems, error: aggregateError } = await loadRowsInChunks<BillingAggregateItem>(
    pagedOrderIds,
    (chunk, from, to) => resolution.supabase
      .from("project_billing_order_items")
      .select("billing_order_id, total_value")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("is_active", true)
      .in("billing_order_id", chunk)
      .order("id", { ascending: true })
      .range(from, to)
      .returns<BillingAggregateItem[]>(),
    { chunkSize: BILLING_RELATION_CHUNK_SIZE },
  );

  if (aggregateError) {
    return dbErrorResponse({
      error: aggregateError,
      operation: "faturamento.list.items",
      message: "Falha ao listar faturamentos.",
      tenantId: resolution.appUser.tenant_id,
      userId: resolution.appUser.id,
    });
  }

  // M1: userIds apenas dos registros da pagina atual
  const userIds = Array.from(new Set((pagedBaseOrders ?? []).flatMap((item) => [item.created_by, item.updated_by]).filter((item): item is string => Boolean(item))));
  const userMap = await fetchAppUserMap({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    ids: userIds,
  });

  const aggregateMap = new Map<string, { totalAmount: number; itemCount: number }>();
  for (const item of aggregateItems ?? []) {
    const current = aggregateMap.get(item.billing_order_id) ?? { totalAmount: 0, itemCount: 0 };
    current.totalAmount += Number(item.total_value ?? 0);
    current.itemCount += 1;
    aggregateMap.set(item.billing_order_id, current);
  }

  const pagedOrders = (pagedBaseOrders ?? []).map((item) => {
    const aggregate = aggregateMap.get(item.id) ?? { totalAmount: 0, itemCount: 0 };
    return {
      id: item.id,
      billingNumber: normalizeText(item.billing_number),
      projectId: item.project_id,
      projectCode: normalizeText(item.project_code_snapshot),
      billingKind: normalizeBillingKind(item.billing_kind),
      noProductionReasonId: item.no_production_reason_id,
      noProductionReasonName: normalizeText(item.no_production_reason_name_snapshot),
      status: item.status,
      ingressoDate: normalizeText(item.ingresso_date),
      notes: normalizeText(item.notes),
      cancellationReason: normalizeText(item.cancellation_reason),
      canceledAt: item.canceled_at,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      createdByName: resolveAppUserName(userMap.get(item.created_by ?? "")),
      updatedByName: resolveAppUserName(userMap.get(item.updated_by ?? "")),
      totalAmount: aggregate.totalAmount,
      itemCount: aggregate.itemCount,
    };
  });

  return NextResponse.json({
    orders: pagedOrders,
    pagination: {
      page: safePage,
      pageSize,
      total,
    },
    summary: {
      totalAmount,
    },
  });
}

async function saveBillingOrder(request: NextRequest, method: "POST" | "PUT") {
  const resolved = await resolveBillingContext(request, {
    invalidSessionMessage: "Sessao invalida para salvar faturamento.",
    action: method === "POST" ? "create" : "update",
  });
  if ("errorResponse" in resolved) {
    return resolved.errorResponse;
  }
  const resolution = resolved.context;

  const payload = (await request.json().catch(() => null)) as SaveBillingPayload | null;
  const orderId = normalizeUuid(payload?.id);
  const projectId = normalizeUuid(payload?.projectId);
  const billingKind = normalizeBillingKind(payload?.billingKind);
  const noProductionReasonId = normalizeUuid(payload?.noProductionReasonId);
  const ingressoDate = normalizeIsoDate(payload?.ingressoDate);
  const notes = normalizeText(payload?.notes) || null;
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt) || null;
  const invalidItemValues = hasInvalidBillingItemValues(payload?.items);
  const items = normalizeBillingItems(payload?.items);

  if (method === "PUT" && !orderId) {
    return NextResponse.json({ message: "Faturamento invalido para edicao." }, { status: 400 });
  }

  if (method === "PUT" && !expectedUpdatedAt) {
    return NextResponse.json({ message: "Atualize a lista antes de editar o faturamento." }, { status: 409 });
  }

  if (!projectId) {
    return NextResponse.json({ message: "Projeto e obrigatorio para cadastrar faturamento." }, { status: 400 });
  }

  if (!ingressoDate) {
    return NextResponse.json({ message: "Data Ingresso e obrigatoria para o faturamento (formato AAAA-MM-DD)." }, { status: 400 });
  }

  if (billingKind === "SEM_PRODUCAO" && !noProductionReasonId) {
    return NextResponse.json({ message: "Selecione o motivo de sem producao." }, { status: 400 });
  }

  if (billingKind === "COM_PRODUCAO" && noProductionReasonId) {
    return NextResponse.json({ message: "Motivo sem producao so pode ser informado para tipo Sem producao." }, { status: 400 });
  }

  if (invalidItemValues) {
    return NextResponse.json({ message: "Revise quantidades e taxas do faturamento." }, { status: 400 });
  }

  if (!items.length) {
    return NextResponse.json({ message: "Informe ao menos uma atividade com quantidade e taxa." }, { status: 400 });
  }

  if (findDuplicateActivityId(items)) {
    return NextResponse.json({ message: "A mesma atividade nao pode ser repetida no faturamento.", reason: "DUPLICATE_BILLING_ACTIVITY" }, { status: 400 });
  }

  const { data, error } = await resolution.supabase.rpc("save_project_billing_order", {
    p_tenant_id: resolution.appUser.tenant_id,
    p_actor_user_id: resolution.appUser.id,
    p_billing_order_id: method === "PUT" ? orderId : null,
    p_project_id: projectId,
    p_billing_kind: billingKind,
    p_no_production_reason_id: billingKind === "SEM_PRODUCAO" ? noProductionReasonId : null,
    p_notes: notes,
    p_items: items,
    p_expected_updated_at: expectedUpdatedAt,
    p_ingresso_date: ingressoDate,
  });

  if (error) {
    return dbErrorResponse({
      error,
      operation: method === "PUT" ? "faturamento.save.update" : "faturamento.save.create",
      message: "Falha ao salvar faturamento.",
      tenantId: resolution.appUser.tenant_id,
      userId: resolution.appUser.id,
    });
  }

  const result = (data ?? {}) as SaveBillingRpcResult;
  if (result.success !== true) {
    return NextResponse.json(
      {
        message: result.message ?? "Falha ao salvar faturamento.",
        reason: result.reason ?? null,
        currentUpdatedAt: result.currentUpdatedAt ?? null,
      },
      { status: Number(result.status ?? 400) },
    );
  }

  const persistedOrderId = normalizeUuid(result.billing_order_id ?? "");
  if (!persistedOrderId) {
    return NextResponse.json({ message: "Faturamento salvo, mas sem identificador de retorno." }, { status: 500 });
  }

  const detail = await fetchBillingOrderDetail({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    orderId: persistedOrderId,
  });

  return NextResponse.json({
    success: true,
    id: persistedOrderId,
    updatedAt: result.updated_at ?? null,
    order: detail,
    message: result.message ?? "Faturamento salvo com sucesso.",
  });
}

async function saveBillingOrderBatchPartial(request: NextRequest) {
  const resolved = await resolveBillingContext(request, {
    invalidSessionMessage: "Sessao invalida para importar faturamento em lote.",
    action: "import",
  });
  if ("errorResponse" in resolved) {
    return resolved.errorResponse;
  }
  const resolution = resolved.context;

  const payload = (await request.json().catch(() => null)) as SaveBillingBatchPayload | null;
  const rowsInput = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!rowsInput.length) {
    return NextResponse.json({ message: "Nenhuma linha valida enviada para importacao em massa." }, { status: 400 });
  }

  // C3: limite no route antes de chegar na RPC
  const MAX_BATCH_ROWS = 500;
  if (rowsInput.length > MAX_BATCH_ROWS) {
    return NextResponse.json({ message: `Maximo de ${MAX_BATCH_ROWS} faturamentos por importacao em lote.` }, { status: 400 });
  }

  const rows = rowsInput.map((row, index) => ({
    rowNumbers: normalizePositiveIntegerArray(row.rowNumbers).length ? normalizePositiveIntegerArray(row.rowNumbers) : [index + 2],
    projectId: normalizeUuid(row.projectId),
    billingKind: normalizeBillingKind(row.billingKind),
    noProductionReasonId: normalizeUuid(row.noProductionReasonId),
    ingressoDate: normalizeIsoDate(row.ingressoDate) ?? null,
    notes: normalizeText(row.notes) || null,
    items: hasInvalidBillingItemValues(row.items) ? [] : normalizeBillingItems(row.items),
  }));

  const { data, error } = await resolution.supabase.rpc("save_project_billing_order_batch_partial", {
    p_tenant_id: resolution.appUser.tenant_id,
    p_actor_user_id: resolution.appUser.id,
    p_rows: rows,
  });

  if (error) {
    return dbErrorResponse({
      error,
      operation: "faturamento.batch_import",
      message: "Falha ao importar faturamento em lote.",
      tenantId: resolution.appUser.tenant_id,
      userId: resolution.appUser.id,
    });
  }

  const result = (data ?? {}) as SaveBillingBatchRpcResult;
  if (result.success !== true) {
    return NextResponse.json({ message: result.message ?? "Falha ao importar faturamento em lote.", reason: result.reason ?? null }, { status: Number(result.status ?? 400) });
  }

  return NextResponse.json({
    success: true,
    savedCount: Number(result.savedCount ?? 0),
    errorCount: Number(result.errorCount ?? 0),
    results: (Array.isArray(result.results) ? result.results : []).map((item) => ({
      rowNumbers: normalizePositiveIntegerArray(item.rowNumbers),
      success: item.success === true,
      reason: normalizeText(item.reason) || null,
      message: normalizeText(item.message) || "Falha ao processar linha do lote.",
      billingOrderId: normalizeUuid(item.billingOrderId ?? "") ?? null,
    })),
    message: normalizeText(result.message) || "Importacao parcial de faturamento concluida.",
  });
}

export async function POST(request: NextRequest) {
  const preAuth = await resolveAuthenticatedAppUser(request);
  const tenantId = "appUser" in preAuth ? preAuth.appUser.tenant_id : null;
  const actorUserId = "appUser" in preAuth ? preAuth.appUser.id : null;

  return withIdempotency(request, tenantId, actorUserId, "/api/faturamento:CREATE", async () => {
    const preview = (await request.clone().json().catch(() => null)) as { action?: string } | null;
    const action = normalizeText(preview?.action).toUpperCase();
    if (action === "BATCH_IMPORT_PARTIAL") {
      return saveBillingOrderBatchPartial(request);
    }
    return saveBillingOrder(request, "POST");
  });
}

export async function PUT(request: NextRequest) {
  return saveBillingOrder(request, "PUT");
}

export async function PATCH(request: NextRequest) {
  const resolved = await resolveBillingContext(request, {
    invalidSessionMessage: "Sessao invalida para alterar status do faturamento.",
    action: "read",
  });
  if ("errorResponse" in resolved) {
    return resolved.errorResponse;
  }
  const resolution = resolved.context;

  const payload = (await request.json().catch(() => null)) as UpdateStatusPayload | null;
  const orderId = normalizeUuid(payload?.id);
  const action = normalizeText(payload?.action).toUpperCase();
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt) || null;
  const reason = normalizeText(payload?.reason) || null;

  // Permissao granular por operacao: a acao especifica e cobrada depois de ler o
  // payload, dentro do fluxo da operacao, e nao no topo da rota.
  const authorizationError = await authorizePageAction(resolution, BILLING_PAGE_KEY, action === "CANCELAR" ? "cancel" : "update");
  if (authorizationError) {
    return authorizationError;
  }


  if (!orderId || (action !== "FECHAR" && action !== "CANCELAR" && action !== "ABRIR")) {
    return NextResponse.json({ message: "Informe faturamento e acao valida para atualizar o status." }, { status: 400 });
  }

  if (!expectedUpdatedAt) {
    return NextResponse.json({ message: "Atualize a lista antes de alterar o status do faturamento." }, { status: 409 });
  }

  if ((action === "CANCELAR" || action === "ABRIR") && (!reason || reason.length < 10)) {
    return NextResponse.json({ message: action === "ABRIR" ? "Informe motivo da reabertura com no minimo 10 caracteres." : "Informe motivo do cancelamento com no minimo 10 caracteres." }, { status: 400 });
  }

  const { data, error } = await resolution.supabase.rpc("set_project_billing_order_status", {
    p_tenant_id: resolution.appUser.tenant_id,
    p_actor_user_id: resolution.appUser.id,
    p_billing_order_id: orderId,
    p_action: action,
    p_reason: reason,
    p_expected_updated_at: expectedUpdatedAt,
  });

  if (error) {
    return dbErrorResponse({
      error,
      operation: "faturamento.status",
      message: "Falha ao alterar status do faturamento.",
      tenantId: resolution.appUser.tenant_id,
      userId: resolution.appUser.id,
    });
  }

  const result = (data ?? {}) as SetBillingStatusRpcResult;
  if (result.success !== true) {
    return NextResponse.json(
      {
        message: result.message ?? "Falha ao alterar status do faturamento.",
        reason: result.reason ?? null,
        currentUpdatedAt: result.currentUpdatedAt ?? null,
      },
      { status: Number(result.status ?? 400) },
    );
  }

  const detail = await fetchBillingOrderDetail({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    orderId,
  });

  return NextResponse.json({
    success: true,
    id: orderId,
    updatedAt: result.updated_at ?? null,
    status: result.billing_status ?? null,
    order: detail,
    message: result.message ?? "Status do faturamento atualizado com sucesso.",
  });
}
