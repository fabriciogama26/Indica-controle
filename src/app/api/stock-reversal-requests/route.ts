import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser, type AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { parsePagination } from "@/lib/server/apiHelpers";
import { withIdempotency } from "@/lib/server/idempotency";
import { requirePageAction, type PageAction } from "@/lib/server/pageAuthorization";
import { normalizeDateInput, normalizeText } from "@/lib/server/stockTransfers";
import {
  approveStockReversalRequestViaRpc,
  claimStockReversalRequestViaRpc,
  rejectStockReversalRequestViaRpc,
} from "@/lib/server/stockReversalRequests";

const PAGE_KEY = "estorno-atendimento";
const OPEN_STATUSES = ["PENDENTE", "EM_ANALISE"] as const;

type RequestRow = {
  id: string;
  source: "STOCK_TRANSFER" | "TEAM_OPERATION";
  mode: "ITEM" | "BATCH" | "FULL";
  original_stock_transfer_id: string;
  original_stock_transfer_item_id: string | null;
  status: string;
  requested_by: string;
  requested_by_name_snapshot: string | null;
  requested_at: string;
  claimed_by: string | null;
  claimed_by_name_snapshot: string | null;
  claim_expires_at: string | null;
  reversal_reason_code: string;
  reversal_reason_notes: string | null;
  reversal_date: string;
  decision_notes: string | null;
  decided_by: string | null;
  decided_at: string | null;
  executed_at: string | null;
  reversal_stock_transfer_id: string | null;
  reversed_item_count: number;
  failure_reason: string | null;
  updated_at: string;
};

type RequestItemRow = {
  id: string;
  request_id: string;
  original_stock_transfer_id: string;
  original_stock_transfer_item_id: string;
  request_status: string;
  reversal_stock_transfer_id: string | null;
  reversal_stock_transfer_item_id: string | null;
};

type TransferRow = {
  id: string;
  movement_type: string;
  from_stock_center_id: string;
  to_stock_center_id: string;
  project_id: string | null;
  entry_date: string;
  entry_type: string;
};

type TransferItemRow = {
  id: string;
  stock_transfer_id: string;
  material_id: string;
  quantity: number | string | null;
  serial_number: string | null;
  lot_code: string | null;
};

type TeamOperationRow = {
  transfer_id: string;
  operation_kind: string | null;
  team_id: string | null;
  team_name_snapshot: string | null;
  foreman_name_snapshot: string | null;
};

type LookupRow = {
  id: string;
  name?: string | null;
  sob?: string | null;
  codigo?: string | null;
  descricao?: string | null;
  umb?: string | null;
  display?: string | null;
  login_name?: string | null;
};

type ReasonRow = {
  code: string;
  label_pt: string;
};

type ActionPayload = {
  action?: unknown;
  requestId?: unknown;
  decisionNotes?: unknown;
};

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean)));
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sourceLabel(source: RequestRow["source"]) {
  return source === "TEAM_OPERATION" ? "Operacoes de Equipe" : "Movimentacao de Estoque";
}

function modeLabel(mode: RequestRow["mode"]) {
  if (mode === "ITEM") return "Por item";
  if (mode === "BATCH") return "Lote";
  return "Integral";
}

async function resolveContext(request: NextRequest, action: PageAction) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para acessar Atendimento de Estornos.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return {
      error: NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status }),
    } as const;
  }

  const authorization = await requirePageAction({ context: resolution, pageKey: PAGE_KEY, action });
  if (!authorization.allowed) {
    return {
      error: NextResponse.json(
        { message: authorization.error.message, reason: authorization.error.code },
        { status: authorization.error.status },
      ),
    } as const;
  }

  return { resolution } as const;
}

async function loadLookupMap(context: AuthenticatedAppUserContext, tableName: string, ids: string[], select: string) {
  if (ids.length === 0) return new Map<string, LookupRow>();
  const { data, error } = await context.supabase
    .from(tableName)
    .select(select)
    .eq("tenant_id", context.appUser.tenant_id)
    .in("id", ids)
    .returns<LookupRow[]>();

  if (error) throw new Error(`Falha ao carregar ${tableName}.`);
  return new Map((data ?? []).map((row) => [row.id, row]));
}

async function buildResponseRows(context: AuthenticatedAppUserContext, requestRows: RequestRow[]) {
  const requestIds = requestRows.map((row) => row.id);
  if (requestIds.length === 0) return [];

  const { data: itemRows, error: itemsError } = await context.supabase
    .from("stock_reversal_request_items")
    .select("id, request_id, original_stock_transfer_id, original_stock_transfer_item_id, request_status, reversal_stock_transfer_id, reversal_stock_transfer_item_id")
    .eq("tenant_id", context.appUser.tenant_id)
    .in("request_id", requestIds)
    .order("created_at", { ascending: true })
    .returns<RequestItemRow[]>();

  if (itemsError) throw new Error("Falha ao carregar itens dos pedidos de estorno.");

  const transferIds = unique([
    ...requestRows.map((row) => row.original_stock_transfer_id),
    ...(itemRows ?? []).map((row) => row.original_stock_transfer_id),
  ]);
  const itemIds = unique((itemRows ?? []).map((row) => row.original_stock_transfer_item_id));

  const [transfersResult, transferItemsResult, teamOperationsResult, reasonsResult] = await Promise.all([
    transferIds.length
      ? context.supabase
          .from("stock_transfers")
          .select("id, movement_type, from_stock_center_id, to_stock_center_id, project_id, entry_date, entry_type")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", transferIds)
          .returns<TransferRow[]>()
      : Promise.resolve({ data: [], error: null }),
    itemIds.length
      ? context.supabase
          .from("stock_transfer_items")
          .select("id, stock_transfer_id, material_id, quantity, serial_number, lot_code")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", itemIds)
          .returns<TransferItemRow[]>()
      : Promise.resolve({ data: [], error: null }),
    transferIds.length
      ? context.supabase
          .from("stock_transfer_team_operations")
          .select("transfer_id, operation_kind, team_id, team_name_snapshot, foreman_name_snapshot")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("transfer_id", transferIds)
          .returns<TeamOperationRow[]>()
      : Promise.resolve({ data: [], error: null }),
    context.supabase
      .from("stock_transfer_reversal_reason_catalog")
      .select("code, label_pt")
      .returns<ReasonRow[]>(),
  ]);

  if (transfersResult.error || transferItemsResult.error || teamOperationsResult.error || reasonsResult.error) {
    throw new Error("Falha ao carregar dados vinculados aos pedidos de estorno.");
  }

  const transferMap = new Map((transfersResult.data ?? []).map((row) => [row.id, row]));
  const transferItemMap = new Map((transferItemsResult.data ?? []).map((row) => [row.id, row]));
  const teamOperationMap = new Map((teamOperationsResult.data ?? []).map((row) => [row.transfer_id, row]));
  const reasonMap = new Map((reasonsResult.data ?? []).map((row) => [row.code, row.label_pt]));

  const stockCenterIds = unique((transfersResult.data ?? []).flatMap((row) => [row.from_stock_center_id, row.to_stock_center_id]));
  const projectIds = unique((transfersResult.data ?? []).map((row) => row.project_id));
  const materialIds = unique((transferItemsResult.data ?? []).map((row) => row.material_id));
  const userIds = unique([
    ...requestRows.map((row) => row.requested_by),
    ...requestRows.map((row) => row.claimed_by),
    ...requestRows.map((row) => row.decided_by),
  ]);

  const [stockCenterMap, projectMap, materialMap, userMap] = await Promise.all([
    loadLookupMap(context, "stock_centers", stockCenterIds, "id, name"),
    loadLookupMap(context, "project", projectIds, "id, sob"),
    loadLookupMap(context, "materials", materialIds, "id, codigo, descricao, umb"),
    loadLookupMap(context, "app_users", userIds, "id, display, login_name"),
  ]);

  const itemsByRequest = new Map<string, RequestItemRow[]>();
  for (const item of itemRows ?? []) {
    const current = itemsByRequest.get(item.request_id) ?? [];
    current.push(item);
    itemsByRequest.set(item.request_id, current);
  }

  return requestRows.map((requestRow) => {
    const transfer = transferMap.get(requestRow.original_stock_transfer_id) ?? null;
    const teamOperation = transfer ? teamOperationMap.get(transfer.id) ?? null : null;
    const requestItems = itemsByRequest.get(requestRow.id) ?? [];
    const firstItem = requestItems[0] ? transferItemMap.get(requestItems[0].original_stock_transfer_item_id) ?? null : null;
    const material = firstItem ? materialMap.get(firstItem.material_id) ?? null : null;
    const requestedBy = userMap.get(requestRow.requested_by) ?? null;
    const claimedBy = requestRow.claimed_by ? userMap.get(requestRow.claimed_by) ?? null : null;

    return {
      id: requestRow.id,
      source: requestRow.source,
      sourceLabel: sourceLabel(requestRow.source),
      mode: requestRow.mode,
      modeLabel: modeLabel(requestRow.mode),
      status: requestRow.status,
      originalTransferId: requestRow.original_stock_transfer_id,
      originalTransferItemId: requestRow.original_stock_transfer_item_id,
      operationCode: teamOperation?.operation_kind ?? transfer?.movement_type ?? "-",
      projectCode: transfer?.project_id ? normalizeText(projectMap.get(transfer.project_id)?.sob) || "-" : "-",
      teamName: normalizeText(teamOperation?.team_name_snapshot) || null,
      foremanName: normalizeText(teamOperation?.foreman_name_snapshot) || null,
      fromStockCenterName: transfer ? normalizeText(stockCenterMap.get(transfer.from_stock_center_id)?.name) || "-" : "-",
      toStockCenterName: transfer ? normalizeText(stockCenterMap.get(transfer.to_stock_center_id)?.name) || "-" : "-",
      materialCode: normalizeText(material?.codigo) || "-",
      materialDescription: normalizeText(material?.descricao) || "-",
      itemCount: requestItems.length,
      requestedAt: requestRow.requested_at,
      requestedByName: normalizeText(requestRow.requested_by_name_snapshot ?? requestedBy?.display ?? requestedBy?.login_name) || "-",
      requestedById: requestRow.requested_by,
      claimedByName: normalizeText(requestRow.claimed_by_name_snapshot ?? claimedBy?.display ?? claimedBy?.login_name) || null,
      claimedById: requestRow.claimed_by,
      claimExpiresAt: requestRow.claim_expires_at,
      reversalReasonCode: requestRow.reversal_reason_code,
      reversalReasonLabel: reasonMap.get(requestRow.reversal_reason_code) ?? requestRow.reversal_reason_code,
      reversalReasonNotes: requestRow.reversal_reason_notes,
      reversalDate: requestRow.reversal_date,
      decisionNotes: requestRow.decision_notes,
      executedAt: requestRow.executed_at,
      reversalTransferId: requestRow.reversal_stock_transfer_id,
      reversedItemCount: Number(requestRow.reversed_item_count ?? 0),
      failureReason: requestRow.failure_reason,
      updatedAt: requestRow.updated_at,
      items: requestItems.map((item) => {
        const transferItem = transferItemMap.get(item.original_stock_transfer_item_id) ?? null;
        const itemTransfer = transferItem ? transferMap.get(transferItem.stock_transfer_id) ?? transfer : transfer;
        const itemMaterial = transferItem ? materialMap.get(transferItem.material_id) ?? null : null;
        return {
          id: item.id,
          originalTransferId: item.original_stock_transfer_id,
          originalTransferItemId: item.original_stock_transfer_item_id,
          requestStatus: item.request_status,
          materialCode: normalizeText(itemMaterial?.codigo) || "-",
          description: normalizeText(itemMaterial?.descricao) || "-",
          unit: normalizeText(itemMaterial?.umb) || "-",
          quantity: numberValue(transferItem?.quantity),
          serialNumber: normalizeText(transferItem?.serial_number) || null,
          lotCode: normalizeText(transferItem?.lot_code) || null,
          operationDate: itemTransfer?.entry_date ?? null,
          reversalTransferId: item.reversal_stock_transfer_id,
          reversalItemId: item.reversal_stock_transfer_item_id,
        };
      }),
    };
  });
}

export async function GET(request: NextRequest) {
  const context = await resolveContext(request, "read");
  if ("error" in context) return context.error;

  try {
    const requestId = normalizeText(request.nextUrl.searchParams.get("requestId"));
    if (requestId) {
      const { data, error } = await context.resolution.supabase
        .from("stock_reversal_requests")
        .select("id, source, mode, original_stock_transfer_id, original_stock_transfer_item_id, status, requested_by, requested_by_name_snapshot, requested_at, claimed_by, claimed_by_name_snapshot, claim_expires_at, reversal_reason_code, reversal_reason_notes, reversal_date, decision_notes, decided_by, decided_at, executed_at, reversal_stock_transfer_id, reversed_item_count, failure_reason, updated_at")
        .eq("tenant_id", context.resolution.appUser.tenant_id)
        .eq("id", requestId)
        .maybeSingle<RequestRow>();

      if (error) return NextResponse.json({ message: "Falha ao carregar pedido de estorno." }, { status: 500 });
      if (!data) return NextResponse.json({ message: "Pedido de estorno nao encontrado." }, { status: 404 });

      const rows = await buildResponseRows(context.resolution, [data]);
      return NextResponse.json(rows[0] ?? null);
    }

    const { page, pageSize, from, to } = parsePagination(request.nextUrl.searchParams, { maxPageSize: 100 });
    const status = normalizeText(request.nextUrl.searchParams.get("status")).toUpperCase();
    const source = normalizeText(request.nextUrl.searchParams.get("source")).toUpperCase();
    const startDate = normalizeDateInput(request.nextUrl.searchParams.get("startDate"));
    const endDate = normalizeDateInput(request.nextUrl.searchParams.get("endDate"));

    let query = context.resolution.supabase
      .from("stock_reversal_requests")
      .select("id, source, mode, original_stock_transfer_id, original_stock_transfer_item_id, status, requested_by, requested_by_name_snapshot, requested_at, claimed_by, claimed_by_name_snapshot, claim_expires_at, reversal_reason_code, reversal_reason_notes, reversal_date, decision_notes, decided_by, decided_at, executed_at, reversal_stock_transfer_id, reversed_item_count, failure_reason, updated_at", { count: "exact" })
      .eq("tenant_id", context.resolution.appUser.tenant_id)
      .order("requested_at", { ascending: false })
      .range(from, to);

    if (status && status !== "TODOS") {
      query = status === "ABERTOS" ? query.in("status", [...OPEN_STATUSES]) : query.eq("status", status);
    } else {
      query = query.in("status", [...OPEN_STATUSES]);
    }
    if (source === "STOCK_TRANSFER" || source === "TEAM_OPERATION") query = query.eq("source", source);
    if (startDate) query = query.gte("requested_at", `${startDate}T00:00:00`);
    if (endDate) query = query.lte("requested_at", `${endDate}T23:59:59.999`);

    const { data, error, count } = await query.returns<RequestRow[]>();
    if (error) return NextResponse.json({ message: "Falha ao carregar fila de estornos." }, { status: 500 });

    const rows = await buildResponseRows(context.resolution, data ?? []);
    return NextResponse.json({
      rows,
      pagination: { page, pageSize, total: count ?? rows.length },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar fila de estornos.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const preAuth = await resolveAuthenticatedAppUser(request);
  const tenantId = "appUser" in preAuth ? preAuth.appUser.tenant_id : null;
  const actorUserId = "appUser" in preAuth ? preAuth.appUser.id : null;

  return withIdempotency(request, tenantId, actorUserId, "/api/stock-reversal-requests:ACTION", () => handleAction(request));
}

async function handleAction(request: NextRequest): Promise<Response> {
  const payload = (await request.json().catch(() => ({}))) as ActionPayload;
  const action = normalizeText(payload.action).toUpperCase();
  const requestId = normalizeText(payload.requestId);
  const decisionNotes = normalizeText(payload.decisionNotes) || null;
  const requiredAction: PageAction | null = action === "APPROVE"
    ? "reverse"
    : action === "CLAIM" || action === "REJECT"
      ? "update"
      : null;

  if (!requiredAction) {
    return NextResponse.json({ message: "Acao invalida para pedido de estorno." }, { status: 400 });
  }

  const context = await resolveContext(request, requiredAction);
  if ("error" in context) return context.error ?? NextResponse.json({ message: "Acesso negado para Atendimento de Estornos." }, { status: 403 });

  if (!requestId) {
    return NextResponse.json({ message: "requestId e obrigatorio." }, { status: 400 });
  }

  const { supabase, appUser } = context.resolution;
  const actorName = appUser.display ?? appUser.login_name;
  const result = action === "CLAIM"
    ? await claimStockReversalRequestViaRpc(supabase, {
        tenantId: appUser.tenant_id,
        actorUserId: appUser.id,
        actorName,
        requestId,
      })
    : action === "APPROVE"
      ? await approveStockReversalRequestViaRpc(supabase, {
          tenantId: appUser.tenant_id,
          actorUserId: appUser.id,
          requestId,
          decisionNotes,
        })
      : await rejectStockReversalRequestViaRpc(supabase, {
          tenantId: appUser.tenant_id,
          actorUserId: appUser.id,
          requestId,
          decisionNotes,
        });

  if (!result.ok) {
    return NextResponse.json(
      { message: result.message, reason: result.reason, details: result.details },
      { status: result.status },
    );
  }

  return NextResponse.json(result);
}
