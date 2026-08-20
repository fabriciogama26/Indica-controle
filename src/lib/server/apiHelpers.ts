import type { PostgrestError } from "@supabase/supabase-js";

type HistoryChange = { from: string | null; to: string | null };

/**
 * Teto de linhas que o PostgREST deste projeto entrega por resposta (`db-max-rows`).
 *
 * O corte NAO e sinalizado: a resposta volta 200 com menos linhas do que o SQL produziu. Por isso
 * `.limit(n)` com n acima deste valor e sempre uma armadilha — promete n, entrega 1000, e o codigo
 * que le o resultado nao tem como saber. Ler uma tabela inteira exige `.range()` em laco.
 */
export const SUPABASE_RESPONSE_ROW_CAP = 1000;

export function parsePositiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export interface ParsePaginationOptions {
  defaultPageSize?: number;
  maxPageSize?: number;
  maxPage?: number;
}

export function parsePagination(params: URLSearchParams, options: ParsePaginationOptions = {}) {
  const { defaultPageSize = 20, maxPageSize = 100, maxPage } = options;
  const rawPage = parsePositiveInteger(params.get("page"), 1);
  const page = maxPage ? Math.min(rawPage, maxPage) : rawPage;
  const pageSize = Math.min(parsePositiveInteger(params.get("pageSize"), defaultPageSize), maxPageSize);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  return { page, pageSize, from, to };
}

/**
 * Le TODAS as linhas de uma consulta, paginando por `.range()` em blocos de
 * `SUPABASE_RESPONSE_ROW_CAP`.
 *
 * Duas regras que parecem detalhe e nao sao:
 *
 * 1. A parada e pagina VAZIA, nunca "pagina menor que a pedida". Se o teto do servidor for menor
 *    que o bloco pedido, a primeira pagina ja volta curta e a segunda condicao daria o resultado
 *    como terminado — truncando em silencio, que e exatamente o bug que este helper existe para
 *    impedir. Custa uma chamada extra no fim.
 * 2. O avanco e pelo numero de linhas REALMENTE recebidas, nao pelo tamanho do bloco. Avancar pelo
 *    bloco pularia linhas sempre que o servidor devolvesse menos do que o pedido.
 *
 * `loadPage` deve aplicar um `.order()` estavel; sem ordem definida o Postgres nao garante a mesma
 * sequencia entre chamadas e a paginacao por offset pode repetir ou perder linhas.
 *
 * `maxRows` define um teto INTENCIONAL de leitura, para rotas que cruzam tudo em memoria e nao
 * podem crescer sem limite. Diferente de um `.limit()` alto, este teto e real: a leitura para
 * exatamente nele, e o chamador consegue detectar que bateu no teto comparando o total lido com o
 * valor pedido — que e o aviso de resultado parcial que o `.limit()` acima do teto do servidor
 * tornava impossivel de disparar. Sem `maxRows`, le ate o fim.
 */
export async function loadAllRows<T>(
  loadPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  options: { maxRows?: number } = {},
): Promise<{ data: T[] | null; error: PostgrestError | null }> {
  const { maxRows } = options;
  const rows: T[] = [];
  let from = 0;

  for (;;) {
    const blockSize =
      maxRows === undefined
        ? SUPABASE_RESPONSE_ROW_CAP
        : Math.min(SUPABASE_RESPONSE_ROW_CAP, maxRows - rows.length);

    if (blockSize <= 0) {
      return { data: rows, error: null };
    }

    const { data, error } = await loadPage(from, from + blockSize - 1);
    if (error) {
      return { data: null, error };
    }

    const page = data ?? [];
    if (!page.length) {
      return { data: rows, error: null };
    }

    rows.push(...page);
    from += page.length;
  }
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
