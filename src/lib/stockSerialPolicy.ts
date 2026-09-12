import { allowsPendingSerialIdentification } from "@/lib/materialSerialTracking";

export type StockMovementType = "ENTRY" | "EXIT" | "TRANSFER";

export type StockSerialPolicy = {
  allowPendingOnEntry: boolean;
  allowPendingOnTransfer: boolean;
  allowPendingOnExit: boolean;
};

/**
 * Regra que estava fixa no codigo antes da migration 421 e que continua sendo o
 * default quando o contrato nao tem linha de politica. Mudar este objeto muda o
 * comportamento de todo contrato sem configuracao propria.
 */
export const DEFAULT_STOCK_SERIAL_POLICY: StockSerialPolicy = {
  allowPendingOnEntry: true,
  allowPendingOnTransfer: true,
  allowPendingOnExit: false,
};

export function normalizeStockSerialPolicy(value: Partial<StockSerialPolicy> | null | undefined): StockSerialPolicy {
  return {
    allowPendingOnEntry: value?.allowPendingOnEntry ?? DEFAULT_STOCK_SERIAL_POLICY.allowPendingOnEntry,
    allowPendingOnTransfer: value?.allowPendingOnTransfer ?? DEFAULT_STOCK_SERIAL_POLICY.allowPendingOnTransfer,
    allowPendingOnExit: value?.allowPendingOnExit ?? DEFAULT_STOCK_SERIAL_POLICY.allowPendingOnExit,
  };
}

export function policyAllowsPendingOnMovement(
  policy: StockSerialPolicy | null | undefined,
  movementType: StockMovementType,
) {
  const normalized = normalizeStockSerialPolicy(policy);
  if (movementType === "ENTRY") return normalized.allowPendingOnEntry;
  if (movementType === "TRANSFER") return normalized.allowPendingOnTransfer;
  return normalized.allowPendingOnExit;
}

/**
 * Composicao das duas camadas de configuracao, em AND: a pendencia so e aceita
 * quando o material permite (migration 414) E o contrato permite aquele movimento
 * (migration 421). Contrato rigido nunca e furado por material mal cadastrado.
 */
export function canCreatePendingSerial(params: {
  serialTrackingType: unknown;
  allowPendingSerialIdentification: unknown;
  movementType: StockMovementType;
  policy: StockSerialPolicy | null | undefined;
}) {
  return allowsPendingSerialIdentification(params.serialTrackingType, params.allowPendingSerialIdentification)
    && policyAllowsPendingOnMovement(params.policy, params.movementType);
}

export function movementTypeLabel(movementType: StockMovementType) {
  if (movementType === "ENTRY") return "Entrada";
  if (movementType === "TRANSFER") return "Transferencia";
  return "Saida";
}
