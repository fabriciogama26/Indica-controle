import type {
  AppUserLookupRow,
  BatchCreateProgrammingPayload,
  ProjectConcludedProgrammingContext,
  ProgrammingRow,
  SaveProgrammingPayload,
} from "./types";

export function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

export function resolveAppUserName(user: AppUserLookupRow | undefined) {
  if (!user) {
    return "Nao identificado";
  }

  return normalizeText(user.login_name) || normalizeText(user.display) || "Nao identificado";
}

export function isMissingRpcFunctionError(errorMessage: string, functionName: string) {
  const normalizedError = normalizeText(errorMessage).toLowerCase();
  const normalizedFunctionName = functionName.toLowerCase();
  return (
    normalizedError.includes("could not find the function")
    && normalizedError.includes(normalizedFunctionName)
    || normalizedError.includes("function")
    && normalizedError.includes(normalizedFunctionName)
    && normalizedError.includes("does not exist")
    || normalizedError.includes(normalizedFunctionName)
    && normalizedError.includes("schema cache")
  );
}

export function isMissingProjectTestColumn(message: string) {
  return normalizeText(message).toLowerCase().includes("is_test");
}

export function isNegativeNumericLikeText(value: string | null) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }

  return /^-\d+([.,]\d+)?$/.test(normalized);
}

export function getInvalidRequestedDateLabel(
  documents: SaveProgrammingPayload["documents"] | BatchCreateProgrammingPayload["documents"] | undefined,
) {
  const entries: Array<{ key: "sgd" | "pi" | "pep"; label: string }> = [
    { key: "sgd", label: "SGD" },
    { key: "pi", label: "PI" },
    { key: "pep", label: "PEP" },
  ];

  for (const entry of entries) {
    const approvedAt = normalizeIsoDate(documents?.[entry.key]?.approvedAt ?? documents?.[entry.key]?.includedAt);
    const requestedAt = normalizeIsoDate(documents?.[entry.key]?.requestedAt ?? documents?.[entry.key]?.deliveredAt);
    if (approvedAt && requestedAt && requestedAt > approvedAt) {
      return entry.label;
    }
  }

  return null;
}

export function normalizeNullableText(value: unknown) {
  const normalized = normalizeText(value);
  return normalized || null;
}

export function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return null;
  }

  if (["true", "1", "sim", "yes"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "nao", "não", "no"].includes(normalized)) {
    return false;
  }

  return null;
}

export function normalizeElectricalEqNumber(value: unknown) {
  const normalized = normalizeText(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!normalized) {
    return null;
  }

  return /^[A-Z0-9]+$/.test(normalized) ? normalized : null;
}

export function normalizeSgdNumber(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const segments = normalized
    .split("/")
    .map((segment) => normalizeText(segment))
    .filter(Boolean);

  if (!segments.length) {
    return null;
  }

  return segments.join(" / ");
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
  if (!normalized) {
    return null;
  }

  return normalizeTime(normalized);
}

export function normalizeWorkCompletionStatus(value: unknown) {
  const normalized = normalizeText(value).toUpperCase();
  return normalized || null;
}

export function normalizeStatusToken(value: unknown) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
}

export function isCompletedWorkStatus(value: unknown) {
  const token = normalizeStatusToken(value);
  return token === "CONCLUIDO" || token === "COMPLETO" || token.startsWith("CONCLUIDO");
}

export function formatTime(value: string | null) {
  return normalizeText(value).slice(0, 5);
}

export function formatDatePtBr(value: string | null | undefined) {
  const raw = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw || "-";
  }

  const [year, month, day] = raw.split("-");
  return `${day}/${month}/${year}`;
}

export function normalizePositiveInteger(value: unknown) {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export function normalizePositiveNumber(value: unknown) {
  const raw = String(value ?? "").trim().replace(",", ".");
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Number(parsed.toFixed(2));
}

export function normalizeNonNegativeDecimal(value: unknown) {
  const raw = normalizeText(value).replace(",", ".");
  if (!raw) {
    return 0;
  }

  if (!/^\d+(\.\d+)?$/.test(raw)) {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

export function normalizeQuestionnaireAnswers(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => normalizeText(item)).filter(Boolean);
}

export function normalizeProgrammingStructureFields<T extends Record<string, unknown>>(row: T): ProgrammingRow {
  const normalized = {
    ...row,
    outage_start_time: normalizeNullableText(row.outage_start_time),
    outage_end_time: normalizeNullableText(row.outage_end_time),
    campo_eletrico: normalizeNullableText(row.campo_eletrico),
    service_description: normalizeNullableText(row.service_description),
    poste_qty: Number(row.poste_qty ?? 0),
    estrutura_qty: Number(row.estrutura_qty ?? 0),
    trafo_qty: Number(row.trafo_qty ?? 0),
    rede_qty: Number(row.rede_qty ?? 0),
    etapa_number: row.etapa_number === null || row.etapa_number === undefined ? null : Number(row.etapa_number),
    etapa_unica: Boolean(row.etapa_unica ?? false),
    etapa_final: Boolean((row as { etapa_final?: unknown }).etapa_final ?? false),
    work_completion_status: normalizeWorkCompletionStatus(row.work_completion_status),
    affected_customers: Number(row.affected_customers ?? 0),
    sgd_type_id: normalizeNullableText(row.sgd_type_id),
    electrical_eq_catalog_id: normalizeNullableText(row.electrical_eq_catalog_id),
  };

  return normalized as unknown as ProgrammingRow;
}

export function normalizeNonNegativeInteger(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return 0;
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

export function normalizeUniqueTextArray(value: unknown) {
  return Array.from(new Set(normalizeStringArray(value)));
}

export function normalizeProgrammingDocuments(
  documents: SaveProgrammingPayload["documents"] | BatchCreateProgrammingPayload["documents"] | undefined,
) {
  return {
    sgd: {
      number: normalizeSgdNumber(documents?.sgd?.number) ?? undefined,
      approvedAt: normalizeIsoDate(documents?.sgd?.approvedAt ?? documents?.sgd?.includedAt) ?? undefined,
      requestedAt: normalizeIsoDate(documents?.sgd?.requestedAt ?? documents?.sgd?.deliveredAt) ?? undefined,
    },
    pi: {
      number: normalizeNullableText(documents?.pi?.number) ?? undefined,
      approvedAt: normalizeIsoDate(documents?.pi?.approvedAt ?? documents?.pi?.includedAt) ?? undefined,
      requestedAt: normalizeIsoDate(documents?.pi?.requestedAt ?? documents?.pi?.deliveredAt) ?? undefined,
    },
    pep: {
      number: normalizeNullableText(documents?.pep?.number) ?? undefined,
      approvedAt: normalizeIsoDate(documents?.pep?.approvedAt ?? documents?.pep?.includedAt) ?? undefined,
      requestedAt: normalizeIsoDate(documents?.pep?.requestedAt ?? documents?.pep?.deliveredAt) ?? undefined,
    },
  };
}

export function startOfWeekMonday(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const dayOfWeek = date.getDay();
  const offset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  date.setDate(date.getDate() + offset);
  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

export function normalizePeriod(value: unknown) {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === "INTEGRAL") {
    return "INTEGRAL";
  }

  if (normalized === "PARCIAL" || normalized === "PARTIAL") {
    return "PARCIAL";
  }

  return null;
}

export function buildHistoryChangesWithDerivedExecutionDate(
  changes: Record<string, unknown> | null,
  metadata: Record<string, unknown> | null,
) {
  const normalizedChanges = { ...(changes ?? {}) };
  const action = normalizeText(metadata?.action).toUpperCase();

  if (action === "ADIADA" && !normalizedChanges.executionDate) {
    const fromDate = normalizeIsoDate(metadata?.executionDate);
    const toDate = normalizeIsoDate(metadata?.newExecutionDate);

    if (fromDate && toDate && fromDate !== toDate) {
      normalizedChanges.executionDate = {
        from: fromDate,
        to: toDate,
      };
    }
  }

  return normalizedChanges;
}

export function buildProjectCompletedConflictResponse(params: {
  message: string;
  context: ProjectConcludedProgrammingContext;
}) {
  const detail = `Registro CONCLUIDO encontrado em ${formatDatePtBr(params.context.executionDate)} na equipe ${params.context.teamName} (Encarregado: ${params.context.foremanName}).`;

  return {
    error: "conflict" as const,
    reason: "PROJECT_COMPLETED_REQUIRES_REOPEN",
    message: params.message,
    detail,
    currentRecord: {
      id: params.context.programmingId,
      executionDate: params.context.executionDate,
      startTime: "",
      endTime: "",
      updatedAt: params.context.updatedAt,
    },
  };
}
