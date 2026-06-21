type HistoryChange = { from: string | null; to: string | null };

export function parsePositiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function parsePagination(params: URLSearchParams, defaultPageSize = 20, maxPageSize = 100) {
  const page = parsePositiveInteger(params.get("page"), 1);
  const pageSize = Math.min(parsePositiveInteger(params.get("pageSize"), defaultPageSize), maxPageSize);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  return { page, pageSize, from, to };
}

export function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeNullableText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized || null;
}

export function formatComparableValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toFixed(2) : null;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  const normalized = String(value).trim();
  return normalized || null;
}

export function addChange(
  changes: Record<string, HistoryChange>,
  field: string,
  previousValue: unknown,
  nextValue: unknown,
): void {
  const from = formatComparableValue(previousValue);
  const to = formatComparableValue(nextValue);
  if (from === to) {
    return;
  }
  changes[field] = { from, to };
}

export function normalizeHistoryChanges(value: unknown): Record<string, HistoryChange> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, HistoryChange>;
  }
  const result: Record<string, HistoryChange> = {};
  for (const [field, rawChange] of Object.entries(value as Record<string, unknown>)) {
    if (!rawChange || typeof rawChange !== "object" || Array.isArray(rawChange)) {
      continue;
    }
    const from = formatComparableValue((rawChange as { from?: unknown }).from);
    const to = formatComparableValue((rawChange as { to?: unknown }).to);
    result[field] = { from, to };
  }
  return result;
}

export function buildUserDisplayMap(
  users: { id: string; display?: string | null; login_name?: string | null }[],
): Map<string, string> {
  return new Map(
    users.map((user) => [
      user.id,
      String(user.display ?? user.login_name ?? "").trim() || "Nao identificado",
    ]),
  );
}

export function buildUserLoginNameMap(
  users: { id: string; login_name?: string | null }[],
): Map<string, string> {
  return new Map(
    users.map((user) => [user.id, String(user.login_name ?? "").trim() || "Nao identificado"]),
  );
}

export function buildNameMap<T extends { id: string; name: string | null }>(
  items: T[],
): Map<string, string> {
  return new Map(
    items.map((item) => [item.id, String(item.name ?? "").trim() || "Nao identificado"]),
  );
}
