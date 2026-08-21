import type { SupabaseClient } from "@supabase/supabase-js";

type StockReversalRequestRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  request_id?: string;
  transfer_id?: string;
  item_count?: number;
  reversed_item_count?: number;
  results?: Array<{
    item_id?: string;
    reversal_transfer_id?: string;
    reversal_item_id?: string | null;
  }>;
  details?: unknown;
};

export type StockReversalRequestSource = "STOCK_TRANSFER" | "TEAM_OPERATION";
export type StockReversalRequestMode = "ITEM" | "BATCH" | "FULL";

export type CreateStockReversalRequestPayload = {
  tenantId: string;
  actorUserId: string;
  actorName: string | null;
  source: StockReversalRequestSource;
  mode: StockReversalRequestMode;
  originalTransferId: string;
  originalTransferItemId?: string | null;
  reversalReasonCode: string;
  reversalReasonNotes?: string | null;
  reversalDate?: string | null;
  itemIds?: string[];
  requestNotes?: string | null;
};

export type ClaimStockReversalRequestPayload = {
  tenantId: string;
  actorUserId: string;
  actorName: string | null;
  requestId: string;
};

export type DecideStockReversalRequestPayload = {
  tenantId: string;
  actorUserId: string;
  requestId: string;
  decisionNotes?: string | null;
};

function normalizeRpcResult(data: unknown): StockReversalRequestRpcResult {
  return (data ?? {}) as StockReversalRequestRpcResult;
}

function mapRequestErrorMessage(reason: string, fallback: string) {
  switch (reason) {
    case "OPEN_REQUEST_EXISTS":
      return "Ja existe pedido de estorno aberto para um ou mais itens selecionados.";
    case "ITEM_ALREADY_REVERSED":
      return "Um ou mais itens selecionados ja foram estornados.";
    case "FULL_TRANSFER_ALREADY_REVERSED":
      return "Esta movimentacao ja foi estornada integralmente.";
    case "REVERSAL_OF_REVERSAL_NOT_ALLOWED":
      return "Nao e permitido solicitar estorno de uma movimentacao que ja e estorno.";
    case "REVERSAL_REASON_NOTES_REQUIRED":
      return "Observacao do motivo e obrigatoria para o motivo selecionado.";
    case "REVERSAL_DATE_IN_FUTURE":
      return "Data do estorno nao pode ser futura.";
    case "INVALID_REVERSAL_REASON_CODE":
      return "Motivo padrao do estorno invalido para este fluxo operacional.";
    case "NO_ITEMS_SELECTED":
      return "Nenhum item valido foi selecionado para estorno.";
    case "REQUEST_CLAIMED_BY_OTHER":
      return "Pedido de estorno em analise por outro usuario.";
    case "REQUEST_CLOSED":
      return "Pedido de estorno ja esta encerrado.";
    case "DECISION_NOTES_REQUIRED":
      return "Informe o motivo da recusa.";
    default:
      return fallback;
  }
}

function toFailure(result: StockReversalRequestRpcResult, fallback: string) {
  const reason = String(result.reason ?? "").trim().toUpperCase() || "UNKNOWN_ERROR";
  const message = String(result.message ?? "").trim();
  return {
    ok: false,
    status: Number(result.status ?? 500),
    reason,
    message: mapRequestErrorMessage(reason, message || fallback),
    details: result.details,
  } as const;
}

export async function createStockReversalRequestViaRpc(
  supabase: SupabaseClient,
  payload: CreateStockReversalRequestPayload,
) {
  const { data, error } = await supabase.rpc("create_stock_reversal_request", {
    p_tenant_id: payload.tenantId,
    p_actor_user_id: payload.actorUserId,
    p_actor_name: payload.actorName ?? null,
    p_source: payload.source,
    p_mode: payload.mode,
    p_original_stock_transfer_id: payload.originalTransferId,
    p_original_stock_transfer_item_id: payload.originalTransferItemId ?? null,
    p_reversal_reason_code: payload.reversalReasonCode,
    p_reversal_reason_notes: payload.reversalReasonNotes ?? null,
    p_reversal_date: payload.reversalDate ?? null,
    p_item_ids: payload.itemIds ?? [],
    p_request_notes: payload.requestNotes ?? null,
  });

  if (error) {
    return {
      ok: false,
      status: 500,
      reason: "RPC_ERROR",
      message: "Falha ao solicitar estorno.",
      details: error.message,
    } as const;
  }

  const result = normalizeRpcResult(data);
  if (result.success !== true) {
    return toFailure(result, "Falha ao solicitar estorno.");
  }

  return {
    ok: true,
    requestId: String(result.request_id ?? ""),
    itemCount: Number(result.item_count ?? 0),
    message: String(result.message ?? "").trim() || "Pedido de estorno enviado para atendimento.",
  } as const;
}

export async function claimStockReversalRequestViaRpc(
  supabase: SupabaseClient,
  payload: ClaimStockReversalRequestPayload,
) {
  const { data, error } = await supabase.rpc("claim_stock_reversal_request", {
    p_tenant_id: payload.tenantId,
    p_actor_user_id: payload.actorUserId,
    p_actor_name: payload.actorName ?? null,
    p_request_id: payload.requestId,
    p_claim_minutes: 15,
  });

  if (error) {
    return {
      ok: false,
      status: 500,
      reason: "RPC_ERROR",
      message: "Falha ao assumir pedido de estorno.",
      details: error.message,
    } as const;
  }

  const result = normalizeRpcResult(data);
  if (result.success !== true) {
    return toFailure(result, "Falha ao assumir pedido de estorno.");
  }

  return {
    ok: true,
    requestId: String(result.request_id ?? payload.requestId),
    message: String(result.message ?? "").trim() || "Pedido de estorno assumido.",
  } as const;
}

export async function approveStockReversalRequestViaRpc(
  supabase: SupabaseClient,
  payload: DecideStockReversalRequestPayload,
) {
  const { data, error } = await supabase.rpc("approve_stock_reversal_request", {
    p_tenant_id: payload.tenantId,
    p_actor_user_id: payload.actorUserId,
    p_request_id: payload.requestId,
    p_decision_notes: payload.decisionNotes ?? null,
  });

  if (error) {
    return {
      ok: false,
      status: 500,
      reason: "RPC_ERROR",
      message: "Falha ao aprovar pedido de estorno.",
      details: error.message,
    } as const;
  }

  const result = normalizeRpcResult(data);
  if (result.success !== true) {
    return toFailure(result, "Falha ao aprovar pedido de estorno.");
  }

  return {
    ok: true,
    requestId: String(result.request_id ?? payload.requestId),
    transferId: String(result.transfer_id ?? ""),
    reversedItemCount: Number(result.reversed_item_count ?? 0),
    results: (result.results ?? []).map((item) => ({
      itemId: String(item.item_id ?? ""),
      reversalTransferId: String(item.reversal_transfer_id ?? ""),
      reversalItemId: String(item.reversal_item_id ?? "") || null,
    })),
    message: String(result.message ?? "").trim() || "Pedido aprovado e estorno executado.",
  } as const;
}

export async function rejectStockReversalRequestViaRpc(
  supabase: SupabaseClient,
  payload: DecideStockReversalRequestPayload,
) {
  const { data, error } = await supabase.rpc("reject_stock_reversal_request", {
    p_tenant_id: payload.tenantId,
    p_actor_user_id: payload.actorUserId,
    p_request_id: payload.requestId,
    p_decision_notes: payload.decisionNotes ?? null,
  });

  if (error) {
    return {
      ok: false,
      status: 500,
      reason: "RPC_ERROR",
      message: "Falha ao recusar pedido de estorno.",
      details: error.message,
    } as const;
  }

  const result = normalizeRpcResult(data);
  if (result.success !== true) {
    return toFailure(result, "Falha ao recusar pedido de estorno.");
  }

  return {
    ok: true,
    requestId: String(result.request_id ?? payload.requestId),
    message: String(result.message ?? "").trim() || "Pedido de estorno recusado.",
  } as const;
}
