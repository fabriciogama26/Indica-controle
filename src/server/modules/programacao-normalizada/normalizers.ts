import type { AppUserLookupRow } from "./types";

export function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeNullableText(value: unknown) {
  const normalized = normalizeText(value);
  return normalized || null;
}

export function resolveAppUserName(user: AppUserLookupRow | undefined) {
  if (!user) {
    return "Nao identificado";
  }

  return normalizeText(user.login_name) || normalizeText(user.display) || "Nao identificado";
}

export function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function normalizeIsoDate(value: unknown) {
  const normalized = normalizeText(value);
  return isIsoDate(normalized) ? normalized : null;
}

export function normalizeTime(value: unknown) {
  const normalized = normalizeText(value);
  if (/^\d{2}:\d{2}$/.test(normalized)) {
    return `${normalized}:00`;
  }

  if (/^\d{2}:\d{2}:\d{2}$/.test(normalized)) {
    return normalized;
  }

  return null;
}

export function normalizeOptionalTime(value: unknown) {
  const normalized = normalizeText(value);
  return normalized ? normalizeTime(normalized) : null;
}

export function formatTime(value: string | null) {
  return normalizeText(value).slice(0, 5);
}

export function normalizePeriod(value: unknown) {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === "INTEGRAL" || normalized === "PARCIAL") {
    return normalized;
  }

  return null;
}

export function normalizePositiveInteger(value: unknown) {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export function normalizeNonNegativeDecimal(value: unknown) {
  const raw = normalizeText(value).replace(",", ".");
  if (!raw) {
    return null;
  }

  if (!/^\d+(\.\d+)?$/.test(raw)) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => normalizeText(item)).filter(Boolean);
}

export function normalizeUniqueTextArray(value: unknown) {
  return Array.from(new Set(normalizeStringArray(value)));
}

export function isMissingRpcFunctionError(errorMessage: string, functionName: string) {
  const normalizedError = normalizeText(errorMessage).toLowerCase();
  const normalizedFunctionName = functionName.toLowerCase();
  return (
    (normalizedError.includes("could not find the function") && normalizedError.includes(normalizedFunctionName))
    || (normalizedError.includes("function") && normalizedError.includes(normalizedFunctionName) && normalizedError.includes("does not exist"))
    || (normalizedError.includes(normalizedFunctionName) && normalizedError.includes("schema cache"))
  );
}
