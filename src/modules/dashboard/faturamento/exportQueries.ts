import { EXPORT_PAGE_SIZE } from "./constants";
import type { BillingFilters, BillingListItem, BillingListResponse } from "./types";

export function createApiError(payload: { message?: string; dbError?: unknown }, fallback: string) {
  return Object.assign(new Error(payload.message ?? fallback), {
    payload,
    dbError: payload.dbError ?? null,
  });
}

/**
 * Le TODOS os faturamentos que batem com os filtros, pagina a pagina.
 *
 * Pedir uma pagina gigante nao funciona: `parsePagination` capa em
 * `maxPageSize: 500` e a rota responde 200 com a primeira pagina, entao um
 * `pageSize=10000` devolvia 500 registros apresentados como o total. As duas
 * exportacoes da tela precisam do mesmo laco, e ele mora aqui para nao divergirem.
 *
 * `mode=export` faz a rota cobrar a permissao `export` em vez de `read`.
 */
export async function fetchBillingOrdersForExport(params: {
  filters: BillingFilters;
  authHeaders: Record<string, string>;
  errorMessage: string;
}): Promise<BillingListItem[]> {
  const { filters, authHeaders, errorMessage } = params;
  const orders: BillingListItem[] = [];
  let page = 1;
  let total = 0;

  for (;;) {
    const search = new URLSearchParams({ mode: "export", page: String(page), pageSize: String(EXPORT_PAGE_SIZE) });
    if (filters.projectId) search.set("projectId", filters.projectId);
    if (filters.status !== "TODOS") search.set("status", filters.status);
    if (filters.billingKind !== "TODOS") search.set("billingKind", filters.billingKind);
    if (filters.noProductionReasonId) search.set("noProductionReasonId", filters.noProductionReasonId);

    const response = await fetch(`/api/faturamento?${search.toString()}`, { headers: authHeaders });
    const payload = (await response.json().catch(() => ({}))) as BillingListResponse;
    if (!response.ok) throw createApiError(payload, errorMessage);

    const pageOrders = payload.orders ?? [];
    total = payload.pagination?.total ?? total;
    orders.push(...pageOrders);

    if (!pageOrders.length || orders.length >= total) break;
    page += 1;
  }

  return orders;
}
