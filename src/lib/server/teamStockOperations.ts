import { SupabaseClient } from "@supabase/supabase-js";

import { StockTransferItemInput } from "@/lib/server/stockTransfers";

export type TeamOperationKind = "REQUISITION" | "RETURN" | "FIELD_RETURN";

export type SaveTeamStockOperationPayload = {
  tenantId: string;
  actorUserId: string;
  operationKind: TeamOperationKind;
  stockCenterId: string;
  teamId: string;
  projectId: string;
  entryDate: string;
  entryType: "SUCATA" | "NOVO";
  notes?: string | null;
  items: StockTransferItemInput[];
};

export type ReverseTeamStockOperationPayload = {
  tenantId: string;
  actorUserId: string;
  originalTransferId: string;
  reversalReasonCode: string;
  reversalReasonNotes?: string | null;
  reversalDate?: string | null;
};

export type SaveTeamStockOperationBatchEntry = {
  rowNumber: number;
  operationKind: TeamOperationKind;
  stockCenterId: string;
  teamId: string;
  projectId: string;
  entryDate: string;
  entryType: "SUCATA" | "NOVO";
  notes?: string | null;
  items: StockTransferItemInput[];
};

export type SaveTeamStockOperationBatchPayload = {
  tenantId: string;
  actorUserId: string;
  entries: SaveTeamStockOperationBatchEntry[];
};

type TeamOperationRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  transfer_id?: string;
  details?: unknown;
};

type TeamOperationBatchRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  failed_row_number?: number;
  details?: unknown;
  summary?: {
    total?: number;
    successCount?: number;
    errorCount?: number;
  };
  results?: Array<{
    rowNumber?: number;
    success?: boolean;
    transferId?: string;
    message?: string;
  }>;
};

function mapTeamOperationErrorMessage(reason: string) {
  switch (reason) {
    case "TEAM_NOT_FOUND":
      return "Equipe nao encontrada ou inativa para este tenant.";
    case "TEAM_STOCK_CENTER_NOT_LINKED":
      return "A equipe selecionada nao possui centro de estoque proprio vinculado.";
    case "TEAM_STOCK_CENTER_INVALID":
      return "O centro de estoque proprio vinculado a equipe esta inativo ou invalido.";
    case "STOCK_CENTER_NOT_FOUND":
      return "Centro de estoque proprio nao encontrado ou inativo para este tenant.";
    case "TEAM_STOCK_CENTER_AS_MAIN_NOT_ALLOWED":
      return "Centro de estoque principal nao pode ser um centro vinculado a equipe.";
    case "INVALID_TEAM_OPERATION_KIND":
      return "Operacao de equipe invalida.";
    case "FIELD_RETURN_CENTER_UNAVAILABLE":
      return "Nao foi possivel preparar o centro tecnico CAMPO / INSTALADO.";
    case "TEAM_OPERATION_REQUIRED_FIELDS":
      return "Centro de estoque e equipe sao obrigatorios para a operacao.";
    default:
      return "";
  }
}

export async function saveTeamStockOperationViaRpc(
  supabase: SupabaseClient,
  payload: SaveTeamStockOperationPayload,
) {
  const { data, error } = await supabase.rpc("save_team_stock_operation_record", {
    p_tenant_id: payload.tenantId,
    p_actor_user_id: payload.actorUserId,
    p_operation_kind: payload.operationKind,
    p_stock_center_id: payload.stockCenterId,
    p_team_id: payload.teamId,
    p_project_id: payload.projectId,
    p_entry_date: payload.entryDate,
    p_entry_type: payload.entryType,
    p_notes: payload.notes ?? null,
    p_items: payload.items,
  });

  if (error) {
    return {
      ok: false,
      status: 500,
      reason: "RPC_ERROR",
      message: "Falha ao salvar operacao de equipe.",
      details: error.message,
    } as const;
  }

  const result = (data ?? {}) as TeamOperationRpcResult;
  const normalizedReason = String(result.reason ?? "").trim().toUpperCase();
  const normalizedMessage = String(result.message ?? "").trim();
  const mappedMessage = mapTeamOperationErrorMessage(normalizedReason);

  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 500),
      reason: normalizedReason || "UNKNOWN_ERROR",
      message: mappedMessage || normalizedMessage || "Falha ao salvar operacao de equipe.",
      details: result.details,
    } as const;
  }

  return {
    ok: true,
    transferId: String(result.transfer_id ?? ""),
    message: normalizedMessage || "Operacao de equipe salva com sucesso.",
  } as const;
}

export async function saveTeamStockOperationBatchViaRpc(
  supabase: SupabaseClient,
  payload: SaveTeamStockOperationBatchPayload,
) {
  const { data, error } = await supabase.rpc("save_team_stock_operation_batch_full", {
    p_tenant_id: payload.tenantId,
    p_actor_user_id: payload.actorUserId,
    p_entries: payload.entries,
  });

  if (error) {
    return {
      ok: false,
      status: 500,
      reason: "RPC_ERROR",
      message: "Falha ao salvar o cadastro em massa das operacoes de equipe.",
      details: error.message,
      failedRowNumber: null,
    } as const;
  }

  const result = (data ?? {}) as TeamOperationBatchRpcResult;
  const normalizedReason = String(result.reason ?? "").trim().toUpperCase();
  const normalizedMessage = String(result.message ?? "").trim();

  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 500),
      reason: normalizedReason || "UNKNOWN_ERROR",
      message: normalizedMessage || "Falha ao salvar o cadastro em massa das operacoes de equipe.",
      details: result.details,
      failedRowNumber: Number(result.failed_row_number ?? 0) || null,
    } as const;
  }

  return {
    ok: true,
    message: normalizedMessage || "Cadastro em massa concluido com sucesso.",
    summary: {
      total: Number(result.summary?.total ?? payload.entries.length),
      successCount: Number(result.summary?.successCount ?? payload.entries.length),
      errorCount: Number(result.summary?.errorCount ?? 0),
    },
    results: (result.results ?? []).map((item) => ({
      rowNumber: Number(item.rowNumber ?? 0),
      success: Boolean(item.success),
      transferId: String(item.transferId ?? "").trim(),
      message: String(item.message ?? "").trim(),
    })),
  } as const;
}

export async function reverseTeamStockOperationViaRpc(
  supabase: SupabaseClient,
  payload: ReverseTeamStockOperationPayload,
) {
  const { data, error } = await supabase.rpc("reverse_team_stock_operation_record_v2", {
    p_tenant_id: payload.tenantId,
    p_actor_user_id: payload.actorUserId,
    p_original_stock_transfer_id: payload.originalTransferId,
    p_reversal_reason_code: payload.reversalReasonCode,
    p_reversal_reason_notes: payload.reversalReasonNotes ?? null,
    p_reversal_date: payload.reversalDate ?? null,
  });

  if (error) {
    return {
      ok: false,
      status: 500,
      reason: "RPC_ERROR",
      message: "Falha ao estornar operacao de equipe.",
      details: error.message,
    } as const;
  }

  const result = (data ?? {}) as TeamOperationRpcResult;
  const normalizedReason = String(result.reason ?? "").trim().toUpperCase();
  const normalizedMessage = String(result.message ?? "").trim();

  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 500),
      reason: normalizedReason || "UNKNOWN_ERROR",
      message: mapTeamOperationErrorMessage(normalizedReason) || normalizedMessage || "Falha ao estornar operacao de equipe.",
      details: result.details,
    } as const;
  }

  return {
    ok: true,
    transferId: String(result.transfer_id ?? ""),
    message: normalizedMessage || "Estorno realizado com sucesso.",
  } as const;
}

export function normalizeTeamOperationKind(value: unknown) {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (normalized === "REQUISITION" || normalized === "REQUISICAO" || normalized === "REQUISICAO") {
    return "REQUISITION" as const;
  }

  if (normalized === "RETURN" || normalized === "DEVOLUCAO") {
    return "RETURN" as const;
  }

  if (
    normalized === "FIELD_RETURN"
    || normalized === "RETORNO_DE_CAMPO"
    || normalized === "RETORNO_CAMPO"
    || normalized === "RETORNO DE CAMPO"
    || normalized === "RETORNOCAMPO"
  ) {
    return "FIELD_RETURN" as const;
  }

  return null;
}
