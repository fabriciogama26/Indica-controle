import { SupabaseClient } from "@supabase/supabase-js";

export type StockTransferItemInput = {
  materialId: string;
  quantity: number;
  serialNumber?: string | null;
  lotCode?: string | null;
};

export type SaveStockTransferPayload = {
  tenantId: string;
  actorUserId: string;
  movementType: "ENTRY" | "EXIT" | "TRANSFER";
  fromStockCenterId: string;
  toStockCenterId: string;
  projectId: string;
  entryDate: string;
  entryType: "SUCATA" | "NOVO";
  notes?: string | null;
  items: StockTransferItemInput[];
};

export type ReverseStockTransferPayload = {
  tenantId: string;
  actorUserId: string;
  originalTransferId: string;
  reversalReasonCode: string;
  reversalReasonNotes?: string | null;
  reversalDate?: string | null;
};

type StockTransferRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  transfer_id?: string;
  details?: unknown;
};

function mapStockTransferValidationMessage(details: unknown) {
  if (!Array.isArray(details) || details.length === 0) {
    return "";
  }

  const firstDetail = details[0];
  if (!firstDetail || typeof firstDetail !== "object") {
    return "";
  }

  const normalizedReason = String((firstDetail as { reason?: unknown }).reason ?? "").trim().toUpperCase();
  if (normalizedReason === "TRANSFORMER_SERIAL_OR_LOT_REQUIRED") {
    return "Serial e LP sao obrigatorios para material TRAFO.";
  }
  if (normalizedReason === "TRANSFORMER_QUANTITY_MUST_BE_ONE") {
    return "Material TRAFO permite somente quantidade 1 por movimentacao.";
  }
  if (normalizedReason === "DUPLICATE_TRANSFORMER_UNIT_IN_PAYLOAD") {
    return "A mesma unidade de TRAFO nao pode ser enviada mais de uma vez na mesma movimentacao.";
  }
  if (normalizedReason === "TRANSFORMER_UNIT_ALREADY_IN_OWN_STOCK") {
    return "Ja existe um TRAFO com o mesmo material, Serial e LP registrado em um centro OWN.";
  }
  if (normalizedReason === "TRANSFORMER_UNIT_BALANCE_INCONSISTENT") {
    return "A unidade de TRAFO informada esta com saldo inconsistente. Revise o historico antes de movimentar.";
  }
  if (normalizedReason === "DUPLICATE_TRANSFORMER_UNIT_IN_IMPORT") {
    return "Ja existe outra linha na importacao com o mesmo material, Serial e LP.";
  }
  return "";
}

export async function saveStockTransferViaRpc(
  supabase: SupabaseClient,
  payload: SaveStockTransferPayload,
) {
  const { data, error } = await supabase.rpc("save_stock_transfer_record", {
    p_tenant_id: payload.tenantId,
    p_actor_user_id: payload.actorUserId,
    p_movement_type: payload.movementType,
    p_from_stock_center_id: payload.fromStockCenterId,
    p_to_stock_center_id: payload.toStockCenterId,
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
      message: "Falha ao salvar movimentacao de estoque.",
      details: error.message,
    } as const;
  }

  const result = (data ?? {}) as StockTransferRpcResult;
  const normalizedReason = String(result.reason ?? "").trim().toUpperCase();
  const normalizedMessage = String(result.message ?? "").trim();
  const mappedErrorMessage =
    normalizedReason === "INSUFFICIENT_STOCK"
      ? "Saldo insuficiente no centro de estoque de origem."
      : normalizedReason === "TRANSFORMER_UNIT_NOT_IN_FROM_CENTER"
        ? "O TRAFO informado nao esta disponivel no centro de origem com o Serial e LP informados."
        : normalizedReason === "TRANSFORMER_UNIT_ALREADY_IN_OWN_STOCK"
          ? "Ja existe um TRAFO com o mesmo material, Serial e LP registrado em um centro OWN."
          : normalizedReason === "TRANSFORMER_UNIT_BALANCE_INCONSISTENT"
            ? "A unidade de TRAFO informada esta com saldo inconsistente. Revise o historico antes de movimentar."
      : normalizedReason === "DUPLICATE_STOCK_CENTER"
        ? "Centro DE e Centro PARA devem ser diferentes."
        : normalizedReason === "INVALID_MOVEMENT_RULE"
          ? "Combinacao de origem e destino invalida para o tipo de operacao selecionado."
          : normalizedReason === "ENTRY_DATE_IN_FUTURE"
            ? "Data da movimentacao nao pode ser futura."
            : normalizedReason === "EDIT_BLOCKED"
              ? "Edicao direta bloqueada por regra de negocio. Utilize estorno."
        : normalizedReason === "VALIDATION_ERROR"
          ? mapStockTransferValidationMessage(result.details)
        : "";
  const fallbackErrorMessage = "Falha ao salvar movimentacao de estoque.";

  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 500),
      reason: normalizedReason || "UNKNOWN_ERROR",
      message: mappedErrorMessage || normalizedMessage || fallbackErrorMessage,
      details: result.details,
    } as const;
  }

  return {
    ok: true,
    transferId: String(result.transfer_id ?? ""),
    message: "Movimentacao de estoque salva com sucesso.",
  } as const;
}

export async function reverseStockTransferViaRpc(
  supabase: SupabaseClient,
  payload: ReverseStockTransferPayload,
) {
  const { data, error } = await supabase.rpc("reverse_stock_transfer_record_v2", {
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
      message: "Falha ao estornar movimentacao de estoque.",
      details: error.message,
    } as const;
  }

  const result = (data ?? {}) as StockTransferRpcResult;
  const normalizedReason = String(result.reason ?? "").trim().toUpperCase();
  const normalizedMessage = String(result.message ?? "").trim();
  const mappedErrorMessage =
    normalizedReason === "ALREADY_REVERSED"
      ? "Esta movimentacao ja foi estornada."
      : normalizedReason === "ORIGINAL_TRANSFER_NOT_FOUND"
        ? "Movimentacao original nao encontrada."
        : normalizedReason === "REVERSAL_REASON_CODE_REQUIRED"
          ? "Motivo padrao do estorno e obrigatorio."
          : normalizedReason === "INVALID_REVERSAL_REASON_CODE"
            ? "Motivo padrao do estorno invalido, bloqueado ou inativo."
            : normalizedReason === "REVERSAL_REASON_NOTES_REQUIRED"
              ? "Observacao do motivo e obrigatoria para o motivo selecionado."
          : normalizedReason === "REVERSAL_OF_REVERSAL_NOT_ALLOWED"
            ? "Nao e permitido estornar uma movimentacao de estorno."
            : normalizedReason === "INSUFFICIENT_STOCK"
              ? "Saldo insuficiente no centro de estoque de origem para estorno."
              : normalizedReason === "REVERSAL_DATE_IN_FUTURE"
                ? "Data do estorno nao pode ser futura."
                : "";

  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 500),
      reason: normalizedReason || "UNKNOWN_ERROR",
      message: mappedErrorMessage || normalizedMessage || "Falha ao estornar movimentacao de estoque.",
      details: result.details,
    } as const;
  }

  return {
    ok: true,
    transferId: String(result.transfer_id ?? ""),
    message: normalizedMessage || "Estorno realizado com sucesso.",
  } as const;
}

export function normalizeDateInput(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return raw.slice(0, 10);
}

export function normalizeEntryType(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "SUCATA" || normalized === "NOVO") {
    return normalized as "SUCATA" | "NOVO";
  }
  return null;
}

export function normalizeMovementType(value: unknown) {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (normalized === "ENTRY" || normalized === "ENTRADA") {
    return "ENTRY" as const;
  }
  if (normalized === "EXIT" || normalized === "SAIDA") {
    return "EXIT" as const;
  }
  if (normalized === "TRANSFER" || normalized === "TRANSFERENCIA") {
    return "TRANSFER" as const;
  }

  return null;
}

export function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

export function parsePositiveNumber(value: unknown) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return Number(numeric.toFixed(3));
}
