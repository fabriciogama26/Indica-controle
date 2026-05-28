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
  operationPurpose?: "NORMAL" | "BALANCE_CORRECTION";
  fromStockCenterId: string;
  toStockCenterId: string;
  projectId: string | null;
  directPurchase?: boolean;
  entryDate: string;
  entryType: "SUCATA" | "NOVO";
  balanceCorrectionReason?: string | null;
  notes?: string | null;
  items: StockTransferItemInput[];
};

export type ReverseStockTransferPayload = {
  tenantId: string;
  actorUserId: string;
  originalTransferId: string;
  originalTransferItemId?: string | null;
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

export function formatStockQuantity(value: unknown) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return String(value ?? "0");
  }

  return numeric.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

export function formatInsufficientStockMessage(details: unknown, sourceLabel = "centro de estoque de origem") {
  if (!Array.isArray(details) || details.length === 0) {
    return "";
  }

  const stockIssues = details
    .map((detail) => {
      if (!detail || typeof detail !== "object") {
        return "";
      }

      const item = detail as {
        materialCode?: unknown;
        materialId?: unknown;
        availableQuantity?: unknown;
        requestedQuantity?: unknown;
      };
      const materialCode = String(item.materialCode ?? item.materialId ?? "").trim();
      const availableQuantity = Number(item.availableQuantity ?? 0);
      const requestedQuantity = Number(item.requestedQuantity ?? 0);
      const missingQuantity = Math.max(requestedQuantity - availableQuantity, 0);

      if (!materialCode) {
        return "";
      }

      if (availableQuantity <= 0) {
        return `Material ${materialCode}: saldo zerado no ${sourceLabel}; solicitado: ${formatStockQuantity(requestedQuantity)}.`;
      }

      return `Material ${materialCode}: saldo atual ${formatStockQuantity(availableQuantity)} no ${sourceLabel}; solicitado: ${formatStockQuantity(requestedQuantity)}; falta: ${formatStockQuantity(missingQuantity)}.`;
    })
    .filter(Boolean);

  if (stockIssues.length === 0) {
    return "";
  }

  return `Saldo indisponivel. ${stockIssues.join(" ")}`;
}

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
    p_direct_purchase: payload.directPurchase ?? false,
    p_operation_purpose: payload.operationPurpose ?? "NORMAL",
    p_balance_correction_reason: payload.balanceCorrectionReason ?? null,
  });

  if (error) {
    const mappedDatabaseError = mapSerialTrackedDatabaseError(error.message);
    return {
      ok: false,
      status: 500,
      reason: "RPC_ERROR",
      message: mappedDatabaseError || "Falha ao salvar movimentacao de estoque.",
      details: error.message,
    } as const;
  }

  const result = (data ?? {}) as StockTransferRpcResult;
  const normalizedReason = String(result.reason ?? "").trim().toUpperCase();
  const normalizedMessage = String(result.message ?? "").trim();
  const mappedSerialTrackedReasonMessage = mapSerialTrackedDatabaseError(normalizedReason);
  const mappedErrorMessage =
    normalizedReason === "INSUFFICIENT_STOCK"
      ? formatInsufficientStockMessage(result.details) || "Saldo insuficiente no centro de estoque de origem."
      : mappedSerialTrackedReasonMessage
        ? mappedSerialTrackedReasonMessage
      : normalizedReason === "BALANCE_CORRECTION_REASON_REQUIRED"
        ? "Motivo da correcao de saldo e obrigatorio."
        : normalizedReason === "INVALID_OPERATION_PURPOSE"
          ? "Finalidade da operacao invalida."
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
  const rpcName = payload.originalTransferItemId
    ? "reverse_stock_transfer_item_record_v1"
    : "reverse_stock_transfer_record_v2";
  const rpcPayload = payload.originalTransferItemId
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
      : normalizedReason === "ITEM_ALREADY_REVERSED"
        ? "Este item da movimentacao ja foi estornado."
        : normalizedReason === "FULL_TRANSFER_ALREADY_REVERSED"
          ? "Esta movimentacao ja foi estornada integralmente."
          : normalizedReason === "PARTIAL_REVERSAL_EXISTS"
            ? "Esta movimentacao ja possui estorno por item. Estorne os itens restantes individualmente."
      : normalizedReason === "ORIGINAL_TRANSFER_NOT_FOUND"
        ? "Movimentacao original nao encontrada."
        : normalizedReason === "ORIGINAL_ITEM_NOT_FOUND"
          ? "Item da movimentacao original nao encontrado."
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

function buildIsoDateFromParts(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizeDateInput(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const normalized = raw.replace(/\s+/g, " ");
  const isoPattern = normalized.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/);
  if (isoPattern) {
    return buildIsoDateFromParts(
      Number(isoPattern[1]),
      Number(isoPattern[2]),
      Number(isoPattern[3]),
    );
  }

  const brPattern = normalized.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[T\s].*)?$/);
  if (brPattern) {
    return buildIsoDateFromParts(
      Number(brPattern[3]),
      Number(brPattern[2]),
      Number(brPattern[1]),
    );
  }

  return null;
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
  const normalized = String(value ?? "").trim().replace(/\s+/g, "");
  if (!/^\d+(?:[,.]\d{1,3})?$/.test(normalized)) {
    return null;
  }

  const numeric = Number(normalized.replace(",", "."));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return Number(numeric.toFixed(3));
}
