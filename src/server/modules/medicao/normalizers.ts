// Normalizadores e helpers puros do dominio de Medicao.
// Sem acesso a banco: nao importam supabase.

import type { AppUserRow, MeasurementKind, ProgrammingWorkCompletionStatus, SaveMeasurementPayload } from "./types";

export function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeUuid(value: unknown) {
  const normalized = normalizeText(value);
  return /^[0-9a-f-]{36}$/i.test(normalized) ? normalized : null;
}

export function normalizeIsoDate(value: unknown) {
  const normalized = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

export function createUtcDate(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day));
}

export function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map((item) => Number(item));
  return createUtcDate(year, month - 1, day);
}

export function toUtcIsoDate(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addMonths(value: Date, months: number) {
  return createUtcDate(value.getUTCFullYear(), value.getUTCMonth() + months, value.getUTCDate());
}

export function resolveCycleStart(reference: Date) {
  const year = reference.getUTCFullYear();
  const monthIndex = reference.getUTCMonth();
  const day = reference.getUTCDate();
  return day >= 21 ? createUtcDate(year, monthIndex, 21) : createUtcDate(year, monthIndex - 1, 21);
}

export function buildMeasurementCycleStart(value: string) {
  const measurementDate = parseIsoDate(value);
  const start = resolveCycleStart(measurementDate);
  const end = addMonths(start, 1);
  end.setUTCDate(20);
  return toUtcIsoDate(start);
}

export function normalizeTeamTypeToken(value: unknown) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function measurementScoreTypeLabel(value: unknown) {
  const original = normalizeText(value);
  const token = normalizeTeamTypeToken(original);
  if (token === "MK" || token === "LM" || token === "LINHA_MORTA") return "MK";
  if (token === "LV" || token === "LINHA_VIVA") return "LV";
  if (token === "CESTO" || token === "CETO") return "CESTO";
  return original || "Nao identificado";
}

export function normalizeMeasurementKind(value: unknown): MeasurementKind {
  const normalized = normalizeText(value).toUpperCase();
  return normalized === "SEM_PRODUCAO" ? "SEM_PRODUCAO" : "COM_PRODUCAO";
}

export function normalizePositiveNumber(value: unknown) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Number(parsed.toFixed(6));
}

export function normalizeOptionalNonNegativeNumber(value: unknown) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Number(parsed.toFixed(6));
}

export function normalizePositiveIntegerArray(values: unknown) {
  if (!Array.isArray(values)) return [] as number[];
  const normalized = values
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0)
    .map((item) => Number(item));
  return Array.from(new Set(normalized));
}

export function normalizeMeasurementItems(itemsInput: SaveMeasurementPayload["items"] | undefined) {
  const source = Array.isArray(itemsInput) ? itemsInput : [];
  return source
    .map((item) => ({
      activityId: normalizeUuid(item.activityId),
      programmingActivityId: normalizeUuid(item.programmingActivityId),
      projectActivityForecastId: normalizeUuid(item.projectActivityForecastId),
      quantity: normalizePositiveNumber(item.quantity),
      mvaQuantity: normalizePositiveNumber(item.mvaQuantity),
      workedHours: normalizePositiveNumber(item.workedHours),
      unitValue: normalizeOptionalNonNegativeNumber(item.unitValue),
      voicePoint: normalizeOptionalNonNegativeNumber(item.voicePoint),
      observation: normalizeText(item.observation) || null,
    }))
    .filter((item) => item.activityId && (item.quantity !== null || (item.mvaQuantity !== null && item.workedHours !== null)))
    .map((item) => ({
      activityId: item.activityId as string,
      programmingActivityId: item.programmingActivityId,
      projectActivityForecastId: item.projectActivityForecastId,
      quantity: item.quantity,
      mvaQuantity: item.mvaQuantity,
      workedHours: item.workedHours,
      unitValue: item.unitValue,
      voicePoint: item.voicePoint,
      observation: item.observation,
    }));
}

export function findDuplicateMeasurementActivityId(
  items: Array<{
    activityId: string;
  }>,
) {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.activityId)) {
      return item.activityId;
    }
    seen.add(item.activityId);
  }
  return null;
}

export function resolveAppUserName(user: AppUserRow | undefined) {
  if (!user) {
    return "Nao identificado";
  }

  return normalizeText(user.login_name) || normalizeText(user.display) || "Nao identificado";
}

export function normalizeWorkCompletionStatusToken(value: unknown) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, "_");
}

export function resolveMeasurementWorkCompletionStatus(value: unknown): ProgrammingWorkCompletionStatus {
  const token = normalizeWorkCompletionStatusToken(value);
  if (!token || token === "NAO_INFORMADO") {
    return null;
  }

  if (
    token === "CONCLUIDO"
    || token === "COMPLETO"
    || token.startsWith("CONCLUIDO")
  ) {
    return "CONCLUIDO";
  }

  if (token === "PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO" || token === "PARCIAL_PLANEJADO_BENFICIO_ATINGIDO") {
    return "PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO";
  }

  if (token === "PARCIAL" || token.startsWith("PARCIAL")) {
    return "PARCIAL";
  }

  return token;
}

export function programmingStatusPriority(status: unknown) {
  const normalized = normalizeText(status).toUpperCase();
  if (normalized === "PROGRAMADA") return 0;
  if (normalized === "REPROGRAMADA") return 1;
  if (normalized === "ADIADA") return 2;
  if (normalized === "CANCELADA") return 3;
  return 4;
}

export function isCanceledProgrammingStatus(status: unknown) {
  return normalizeText(status).toUpperCase() === "CANCELADA";
}

export function buildProgrammingMatchKey(projectId: string, teamId: string, executionDate: string) {
  return `${projectId}|${teamId}|${executionDate}`;
}

export function buildProgrammingProjectDateKey(projectId: string, executionDate: string) {
  return `${projectId}|${executionDate}`;
}

