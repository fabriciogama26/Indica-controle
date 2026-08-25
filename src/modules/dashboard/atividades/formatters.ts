import { formatDateTime } from "@/lib/utils/formatters";

export function formatMoney(value: number) {
  return Number(value ?? 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPoints(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  return Number(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

export function toInputMoney(value: number) {
  return String(Number(value ?? 0).toFixed(2));
}

export function toInputPoints(value: number | null | undefined) {
  const numericValue = Number(value ?? "");
  return Number.isFinite(numericValue) && numericValue > 0 ? String(numericValue) : "";
}

export function formatHistoryValue(field: string, value: string | null) {
  if (!value) {
    return "-";
  }

  if (field === "value") {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? formatMoney(numericValue) : value;
  }

  if (field === "voicePoint") {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? formatPoints(numericValue) : value;
  }

  if (field === "isActive") {
    return value === "true" ? "Ativo" : "Inativo";
  }

  if (field === "canceledAt") {
    return formatDateTime(value);
  }

  return value;
}
