// Filtros da listagem de Medicao Asbuilt, compartilhados entre a listagem paginada
// (`GET /api/medicao-asbuilt`) e a exportacao (`GET /api/medicao-asbuilt/export`).
//
// Existem num lugar so para que o CSV exportado nunca divirja da lista que o usuario
// esta vendo: o mesmo parse e a mesma aplicacao no banco para as duas rotas.

export type AsbuiltMeasurementKindFilter = "COM_PRODUCAO" | "SEM_PRODUCAO";

export type AsbuiltMeasurementListFilters = {
  projectId: string | null;
  status: string | null;
  asbuiltMeasurementKind: AsbuiltMeasurementKindFilter | null;
  noProductionReasonId: string | null;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeUuid(value: unknown) {
  const normalized = normalizeText(value);
  return /^[0-9a-f-]{36}$/i.test(normalized) ? normalized : null;
}

export function parseAsbuiltMeasurementListFilters(searchParams: URLSearchParams): AsbuiltMeasurementListFilters {
  const status = normalizeText(searchParams.get("status")).toUpperCase();
  const asbuiltMeasurementKind = normalizeText(searchParams.get("asbuiltMeasurementKind")).toUpperCase();

  return {
    projectId: normalizeUuid(searchParams.get("projectId")),
    status: status && status !== "TODOS" ? status : null,
    asbuiltMeasurementKind:
      asbuiltMeasurementKind === "COM_PRODUCAO" || asbuiltMeasurementKind === "SEM_PRODUCAO"
        ? asbuiltMeasurementKind
        : null,
    noProductionReasonId: normalizeUuid(searchParams.get("noProductionReasonId")),
  };
}

/**
 * Condicoes de igualdade (`coluna = valor`) que os filtros ativos aplicam em
 * `project_asbuilt_measurement_orders`. Cada rota aplica com `.eq(coluna, valor)` no proprio
 * builder.
 *
 * Devolve pares em vez de receber o builder de proposito: uma funcao generica sobre o builder
 * do PostgREST estoura a profundidade de tipos do TypeScript (TS2589) no `next build`.
 */
export function asbuiltMeasurementListFilterConditions(
  filters: AsbuiltMeasurementListFilters,
): Array<[column: string, value: string]> {
  const conditions: Array<[column: string, value: string]> = [];
  if (filters.projectId) conditions.push(["project_id", filters.projectId]);
  if (filters.status) conditions.push(["status", filters.status]);
  if (filters.asbuiltMeasurementKind) conditions.push(["asbuilt_kind", filters.asbuiltMeasurementKind]);
  if (filters.noProductionReasonId) conditions.push(["no_production_reason_id", filters.noProductionReasonId]);
  return conditions;
}
