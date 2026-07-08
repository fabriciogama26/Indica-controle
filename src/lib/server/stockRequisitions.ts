import { SupabaseClient } from "@supabase/supabase-js";

import { formatInsufficientStockMessage } from "@/lib/server/stockTransfers";

export type StockRequisitionItemInput = {
  materialId: string;
  quantity: number;
};

export type CreateStockRequisitionPayload = {
  tenantId: string;
  actorUserId: string;
  requestedByName?: string | null;
  stockCenterId: string;
  teamId: string;
  projectId: string;
  requestDate: string;
  notes?: string | null;
  items: StockRequisitionItemInput[];
};

export type StockRequisitionDecisionInput = {
  itemId: string;
  decision: "ACCEPT" | "REDUCE" | "REJECT";
  quantity?: number | null;
  reasonCode?: string | null;
  serialNumber?: string | null;
  lotCode?: string | null;
  entryType?: string | null;
  notes?: string | null;
};

export type FulfillStockRequisitionPayload = {
  tenantId: string;
  actorUserId: string;
  requestId: string;
  decisions: StockRequisitionDecisionInput[];
};

type StockRequisitionRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  request_id?: string;
  resultado?: string;
  batch_id?: string;
  accepted?: number;
  reduced?: number;
  rejected?: number;
  claim_expires_at?: string;
  details?: unknown;
};

function mapStockRequisitionReason(reason: string) {
  switch (reason) {
    case "ACTOR_NOT_ALLOWED":
      return "Usuario nao autorizado para esta operacao neste tenant.";
    case "DUPLICATE_MATERIAL_IN_OPEN_REQUEST":
      return "Ja existe pedido em aberto para esta equipe/projeto/data com este material.";
    case "DUPLICATE_MATERIAL_IN_REQUEST":
      return "Material repetido na mesma solicitacao.";
    case "REQUEST_CLAIMED_BY_OTHER":
      return "Pedido em atendimento por outro usuario.";
    case "REQUEST_NOT_CLAIMED":
      return "Assuma o pedido antes de atender.";
    case "REQUEST_NOT_OPEN":
      return "Este pedido ja foi encerrado ou cancelado.";
    case "ITEM_DECISION_MISSING":
      return "Todos os itens do pedido precisam de decisao antes de confirmar.";
    case "SERIAL_REDUCE_NOT_ALLOWED":
      return "Material rastreavel por serial nao pode ser reduzido. Use Aceitar ou Recusar.";
    default:
      return "";
  }
}

function normalizeResult(data: unknown) {
  return (data ?? {}) as StockRequisitionRpcResult;
}

export async function createStockRequisitionViaRpc(
  supabase: SupabaseClient,
  payload: CreateStockRequisitionPayload,
) {
  const { data, error } = await supabase.rpc("create_stock_requisition_request", {
    p_tenant_id: payload.tenantId,
    p_actor_user_id: payload.actorUserId,
    p_requested_by_name: payload.requestedByName ?? null,
    p_stock_center_id: payload.stockCenterId,
    p_team_id: payload.teamId,
    p_project_id: payload.projectId,
    p_request_date: payload.requestDate,
    p_notes: payload.notes ?? null,
    p_items: payload.items,
  });

  if (error) {
    return { ok: false, status: 500, reason: "RPC_ERROR", message: "Falha ao registrar a solicitacao.", details: error.message } as const;
  }

  const result = normalizeResult(data);
  const reason = String(result.reason ?? "").trim().toUpperCase();
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 500),
      reason: reason || "UNKNOWN_ERROR",
      message: mapStockRequisitionReason(reason) || String(result.message ?? "").trim() || "Falha ao registrar a solicitacao.",
      details: result.details,
    } as const;
  }

  return { ok: true, requestId: String(result.request_id ?? ""), message: String(result.message ?? "Solicitacao registrada com sucesso.") } as const;
}

export async function claimStockRequisitionViaRpc(
  supabase: SupabaseClient,
  payload: { tenantId: string; actorUserId: string; actorName?: string | null; requestId: string; claimMinutes?: number },
) {
  const { data, error } = await supabase.rpc("claim_stock_requisition_request", {
    p_tenant_id: payload.tenantId,
    p_actor_user_id: payload.actorUserId,
    p_actor_name: payload.actorName ?? null,
    p_request_id: payload.requestId,
    p_claim_minutes: payload.claimMinutes ?? 15,
  });

  if (error) {
    return { ok: false, status: 500, reason: "RPC_ERROR", message: "Falha ao assumir o pedido.", details: error.message } as const;
  }

  const result = normalizeResult(data);
  const reason = String(result.reason ?? "").trim().toUpperCase();
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 500),
      reason: reason || "UNKNOWN_ERROR",
      message: mapStockRequisitionReason(reason) || String(result.message ?? "").trim() || "Falha ao assumir o pedido.",
      details: result.details,
    } as const;
  }

  return { ok: true, requestId: String(result.request_id ?? ""), claimExpiresAt: String(result.claim_expires_at ?? ""), message: String(result.message ?? "Pedido assumido.") } as const;
}

export async function releaseStockRequisitionClaimViaRpc(
  supabase: SupabaseClient,
  payload: { tenantId: string; actorUserId: string; requestId: string; isSupervisor?: boolean },
) {
  const { data, error } = await supabase.rpc("release_stock_requisition_claim", {
    p_tenant_id: payload.tenantId,
    p_actor_user_id: payload.actorUserId,
    p_request_id: payload.requestId,
    p_is_supervisor: payload.isSupervisor ?? false,
  });

  if (error) {
    return { ok: false, status: 500, reason: "RPC_ERROR", message: "Falha ao liberar o atendimento.", details: error.message } as const;
  }

  const result = normalizeResult(data);
  const reason = String(result.reason ?? "").trim().toUpperCase();
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 500),
      reason: reason || "UNKNOWN_ERROR",
      message: mapStockRequisitionReason(reason) || String(result.message ?? "").trim() || "Falha ao liberar o atendimento.",
      details: result.details,
    } as const;
  }

  return { ok: true, requestId: String(result.request_id ?? ""), message: String(result.message ?? "Atendimento liberado.") } as const;
}

export async function fulfillStockRequisitionViaRpc(
  supabase: SupabaseClient,
  payload: FulfillStockRequisitionPayload,
) {
  const { data, error } = await supabase.rpc("fulfill_stock_requisition_request", {
    p_tenant_id: payload.tenantId,
    p_actor_user_id: payload.actorUserId,
    p_request_id: payload.requestId,
    p_decisions: payload.decisions,
  });

  if (error) {
    return { ok: false, status: 500, reason: "RPC_ERROR", message: "Falha ao atender a requisicao.", details: error.message } as const;
  }

  const result = normalizeResult(data);
  const reason = String(result.reason ?? "").trim().toUpperCase();
  if (result.success !== true) {
    const message = reason === "INSUFFICIENT_STOCK"
      ? formatInsufficientStockMessage(result.details, "estoque de origem")
      : mapStockRequisitionReason(reason) || String(result.message ?? "").trim();
    return {
      ok: false,
      status: Number(result.status ?? 500),
      reason: reason || "UNKNOWN_ERROR",
      message: message || "Falha ao atender a requisicao.",
      details: result.details,
    } as const;
  }

  return {
    ok: true,
    requestId: String(result.request_id ?? ""),
    resultado: String(result.resultado ?? ""),
    batchId: String(result.batch_id ?? ""),
    accepted: Number(result.accepted ?? 0),
    reduced: Number(result.reduced ?? 0),
    rejected: Number(result.rejected ?? 0),
    message: String(result.message ?? "Atendimento concluido."),
  } as const;
}

export async function cancelStockRequisitionViaRpc(
  supabase: SupabaseClient,
  payload: { tenantId: string; actorUserId: string; requestId: string },
) {
  const { data, error } = await supabase.rpc("cancel_stock_requisition_request", {
    p_tenant_id: payload.tenantId,
    p_actor_user_id: payload.actorUserId,
    p_request_id: payload.requestId,
  });

  if (error) {
    return { ok: false, status: 500, reason: "RPC_ERROR", message: "Falha ao cancelar o pedido.", details: error.message } as const;
  }

  const result = normalizeResult(data);
  const reason = String(result.reason ?? "").trim().toUpperCase();
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 500),
      reason: reason || "UNKNOWN_ERROR",
      message: mapStockRequisitionReason(reason) || String(result.message ?? "").trim() || "Falha ao cancelar o pedido.",
      details: result.details,
    } as const;
  }

  return { ok: true, requestId: String(result.request_id ?? ""), message: String(result.message ?? "Pedido cancelado.") } as const;
}
