import { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { formatInsufficientStockMessage, StockTransferItemInput } from "@/lib/server/stockTransfers";

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
  originalTransferItemId?: string | null;
  reverseBatch?: boolean;
  reversalReasonCode: string;
  reversalReasonNotes?: string | null;
  reversalDate?: string | null;
};

export type SaveTeamStockOperationBatchEntry = {
  rowNumber: number;
  operationBatchId?: string;
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
  reversed_item_count?: number;
  results?: Array<{
    item_id?: string;
    reversal_transfer_id?: string;
    reversal_item_id?: string | null;
  }>;
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
    operationBatchId?: string;
    message?: string;
  }>;
};

function mapTeamOperationErrorMessage(reason: string) {
  const serialTrackedMessage = mapSerialTrackedDatabaseError(reason);
  if (serialTrackedMessage) {
    return serialTrackedMessage;
  }

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
    case "PENDING_SERIAL_INSUFFICIENT_BALANCE":
      return "Nao existe saldo pendente de serial suficiente no centro de origem para identificar esta unidade.";
    case "PENDING_SERIAL_NOT_ALLOWED":
      return "Este material nao aceita identificacao de serial pendente para Operacoes de Equipe.";
    case "PENDING_SERIAL_INVALID_ENTRY_TYPE":
      return "Tipo do material deve ser NOVO ou SUCATA para identificar o serial pendente.";
    case "PENDING_SERIAL_REQUIRED_FIELDS":
      return "Material, centro, tipo e serial sao obrigatorios para identificar a pendencia.";
    case "ITEM_ALREADY_REVERSED":
      return "Este item da operacao de equipe ja foi estornado.";
    case "FULL_TRANSFER_ALREADY_REVERSED":
      return "Esta operacao de equipe ja foi estornada integralmente.";
    case "PARTIAL_REVERSAL_EXISTS":
      return "Esta operacao de equipe ja possui estorno por item. Estorne os itens restantes individualmente.";
    case "ORIGINAL_ITEM_NOT_FOUND":
      return "Item da operacao de equipe original nao encontrado.";
    case "REVERSAL_OF_REVERSAL_NOT_ALLOWED":
      return "Nao e permitido estornar uma operacao de estorno.";
    case "ALL_ITEMS_ALREADY_REVERSED":
      return "Todos os materiais desta operacao ja foram estornados.";
    case "ACTOR_NOT_ALLOWED":
      return "Usuario nao autorizado para estornar operacoes deste tenant.";
    default:
      return "";
  }
}

function mapSerialTrackedDatabaseError(message: unknown) {
  const normalized = String(message ?? "").trim().toUpperCase();
  if (normalized.includes("SERIAL_TRACKED_QUANTITY_MUST_BE_ONE")) {
    return "Material rastreavel por serial permite somente quantidade 1 por movimentacao.";
  }
  if (normalized.includes("SERIAL_TRACKED_SERIAL_REQUIRED")) {
    return "Serial e obrigatorio para material rastreavel por serial.";
  }
  if (normalized.includes("SERIAL_TRACKED_UNIT_ALREADY_IN_STOCK")) {
    return "A unidade por serial informada ja esta registrada em estoque proprio ou vinculada a outra operacao.";
  }
  if (normalized.includes("SERIAL_TRACKED_UNIT_NOT_IN_FROM_CENTER")) {
    return "A unidade por serial informada nao esta disponivel no centro DE informado.";
  }
  return "";
}

function mapTeamOperationRpcErrorMessage(message: unknown) {
  const serialTrackedMessage = mapSerialTrackedDatabaseError(message);
  if (serialTrackedMessage) {
    return serialTrackedMessage;
  }

  const normalized = String(message ?? "").trim().toLowerCase();
  if (
    normalized.includes("save_stock_transfer_record")
    && (
      normalized.includes("could not choose")
      || normalized.includes("not unique")
      || normalized.includes("ambiguous")
      || normalized.includes("p_operation_purpose")
    )
  ) {
    return "Falha tecnica na regra de estoque da Operacao de Equipe. Aplique as migrations 208, 209 e 216 para atualizar as assinaturas das RPCs de estoque e tente novamente.";
  }

  if (
    normalized.includes("save_team_stock_operation_record")
    && (normalized.includes("schema cache") || normalized.includes("could not find"))
  ) {
    return "Falha tecnica na RPC de Operacoes de Equipe. Recarregue o schema cache do Supabase e tente novamente.";
  }

  if (
    (
      normalized.includes("reverse_team_stock_operation_batch_v1")
      || normalized.includes("reverse_team_stock_operation_batch_v2")
    )
    && (normalized.includes("schema cache") || normalized.includes("could not find"))
  ) {
    return "Estorno em lote ainda nao disponivel no banco. Aplique as migrations 236 e 237 e recarregue o schema cache do Supabase.";
  }

  return "";
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
    const mappedDatabaseError = mapTeamOperationRpcErrorMessage(error.message);
    return {
      ok: false,
      status: 500,
      reason: "RPC_ERROR",
      message: mappedDatabaseError || "Falha ao salvar operacao de equipe.",
      details: error.message,
    } as const;
  }

  const result = (data ?? {}) as TeamOperationRpcResult;
  const normalizedReason = String(result.reason ?? "").trim().toUpperCase();
  const normalizedMessage = String(result.message ?? "").trim();
  const mappedMessage = normalizedReason === "INSUFFICIENT_STOCK"
    ? formatInsufficientStockMessage(result.details, "estoque de origem")
    : mapTeamOperationErrorMessage(normalizedReason);

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
  const batchIdByContext = new Map<string, string>();
  const entries = payload.entries.map((entry) => {
    const contextKey = JSON.stringify([
      entry.operationKind,
      entry.stockCenterId,
      entry.teamId,
      entry.projectId,
      entry.entryDate,
      entry.entryType,
      entry.notes ?? null,
    ]);
    const operationBatchId = batchIdByContext.get(contextKey) ?? randomUUID();
    batchIdByContext.set(contextKey, operationBatchId);
    return {
      ...entry,
      operationBatchId,
    };
  });

  const { data, error } = await supabase.rpc("save_team_stock_operation_batch_full", {
    p_tenant_id: payload.tenantId,
    p_actor_user_id: payload.actorUserId,
    p_entries: entries,
  });

  if (error) {
    const mappedDatabaseError = mapSerialTrackedDatabaseError(error.message);
    return {
      ok: false,
      status: 500,
      reason: "RPC_ERROR",
      message: mappedDatabaseError || "Falha ao salvar o cadastro em massa das operacoes de equipe.",
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
      operationBatchId: String(item.operationBatchId ?? "").trim(),
      message: String(item.message ?? "").trim(),
    })),
  } as const;
}

export async function reverseTeamStockOperationViaRpc(
  supabase: SupabaseClient,
  payload: ReverseTeamStockOperationPayload,
) {
  const rpcName = payload.reverseBatch
    ? "reverse_team_stock_operation_batch_v2"
    : payload.originalTransferItemId
      ? "reverse_team_stock_operation_item_record_v1"
      : "reverse_team_stock_operation_record_v2";
  const rpcPayload = payload.reverseBatch
    ? {
        p_tenant_id: payload.tenantId,
        p_actor_user_id: payload.actorUserId,
        p_original_stock_transfer_id: payload.originalTransferId,
        p_reversal_reason_code: payload.reversalReasonCode,
        p_reversal_reason_notes: payload.reversalReasonNotes ?? null,
        p_reversal_date: payload.reversalDate ?? null,
      }
    : payload.originalTransferItemId
      ? {
          p_tenant_id: payload.tenantId,
          p_actor_user_id: payload.actorUserId,
          p_original_stock_transfer_item_id: payload.originalTransferItemId,
          p_reversal_reason_code: payload.reversalReasonCode,
          p_reversal_reason_notes: payload.reversalReasonNotes ?? null,
          p_reversal_date: payload.reversalDate ?? null,
        }
      : {
          p_tenant_id: payload.tenantId,
          p_actor_user_id: payload.actorUserId,
          p_original_stock_transfer_id: payload.originalTransferId,
          p_reversal_reason_code: payload.reversalReasonCode,
          p_reversal_reason_notes: payload.reversalReasonNotes ?? null,
          p_reversal_date: payload.reversalDate ?? null,
        };
  const { data, error } = await supabase.rpc(rpcName, rpcPayload);

  if (error) {
    const mappedDatabaseError = mapTeamOperationRpcErrorMessage(error.message);
    return {
      ok: false,
      status: 500,
      reason: "RPC_ERROR",
      message: mappedDatabaseError || "Falha ao estornar operacao de equipe.",
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
      message: (
        normalizedReason === "INSUFFICIENT_STOCK"
          ? formatInsufficientStockMessage(result.details, "estoque de origem")
          : mapTeamOperationErrorMessage(normalizedReason)
      ) || normalizedMessage || "Falha ao estornar operacao de equipe.",
      details: result.details,
    } as const;
  }

  return {
    ok: true,
    transferId: String(result.transfer_id ?? ""),
    reversedItemCount: Number(result.reversed_item_count ?? 0),
    results: (result.results ?? []).map((item) => ({
      itemId: String(item.item_id ?? ""),
      reversalTransferId: String(item.reversal_transfer_id ?? ""),
      reversalItemId: String(item.reversal_item_id ?? "") || null,
    })),
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
