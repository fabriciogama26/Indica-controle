// Leitura das agregacoes do Dashboard Estoque pela RPC `get_stock_dashboard_aggregates`
// (migration 439). Uma chamada substitui a carga de movimentacoes + itens + operacoes de
// equipe + materiais + projetos + equipes + 4 recortes de estorno em chunks.
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";

export type StockDashboardOperationKind = "ENTRY" | "EXIT" | "TRANSFER" | "REQUISITION" | "RETURN" | "FIELD_RETURN";

export type StockDashboardFilters = {
  startDate: string;
  endDate: string;
  stockCenterId: string | null;
  teamId: string | null;
  projectId: string | null;
  materialCode: string;
  materialType: string;
};

export type DashboardMaterialRow = {
  materialId: string;
  materialCode: string;
  description: string;
  unit: string;
  materialType: string;
  unitPrice: number;
  balanceQuantity: number;
  lastMovementAt: string | null;
};

export type EvolutionRow = {
  period: string;
  label: string;
  estimatedValue: number;
  entry: number;
  exit: number;
  transfer: number;
  requisition: number;
  return: number;
  fieldReturn: number;
};

export type ScatterMaterialRow = {
  operationKind: "REQUISITION" | "RETURN";
  materialId: string;
  materialCode: string;
  description: string;
  unit: string;
  quantity: number;
  operationCount: number;
  projectCount: number;
  currentBalance: number;
};

export type ScatterUnitRow = {
  operationKind: "REQUISITION" | "RETURN";
  unit: string;
  quantity: number;
  materialCount: number;
  operationCount: number;
};

export type OptionRow = {
  id: string;
  label: string;
};

export type StockCenterRow = {
  id: string;
  name: string;
  controlsBalance: boolean;
};

export type StockDashboardAggregates = {
  stockCenters: StockCenterRow[];
  materials: DashboardMaterialRow[];
  movementCount: number;
  totalMovementQuantity: number;
  movementEvolution: EvolutionRow[];
  scatterMaterials: ScatterMaterialRow[];
  scatterSummaryByUnit: ScatterUnitRow[];
  teams: OptionRow[];
  projects: OptionRow[];
};

export class StockDashboardAggregatesError extends Error {
  constructor(
    message: string,
    readonly status: 500 | 503 | 504,
  ) {
    super(message);
    this.name = "StockDashboardAggregatesError";
  }
}

// `statement_timeout` do Postgres. O PostgREST devolve HTTP 500 para ele (familia 57*), entao o
// status sozinho nao separa "consulta demorou demais" de "erro da funcao".
const STATEMENT_TIMEOUT_CODE = "57014";

// Falha de conexao/infraestrutura: sem resposta (0), gateway (502/503/504/520-524), conexao do
// Postgres (08*), recurso insuficiente (53*) ou PostgREST sem banco (PGRST000-002).
function isUnavailableRpcFailure(status: number, code: string | undefined) {
  if (status === 0 || status === 502 || status === 503 || status === 504) return true;
  if (status >= 520 && status <= 524) return true;
  const normalizedCode = String(code ?? "");
  return normalizedCode.startsWith("08") || normalizedCode.startsWith("53") || /^PGRST00[0-2]$/.test(normalizedCode);
}

type RawAggregates = Partial<Record<keyof StockDashboardAggregates, unknown>>;

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function arrayValue<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export async function loadStockDashboardAggregates(
  context: AuthenticatedAppUserContext,
  filters: StockDashboardFilters,
): Promise<StockDashboardAggregates> {
  const { data, error, status } = await context.supabase.rpc("get_stock_dashboard_aggregates", {
    p_tenant_id: context.appUser.tenant_id,
    p_start_date: filters.startDate,
    p_end_date: filters.endDate,
    p_stock_center_id: filters.stockCenterId,
    p_team_id: filters.teamId,
    p_project_id: filters.projectId,
    p_material_code: filters.materialCode || null,
    p_material_type: filters.materialType || null,
  });

  if (error) {
    console.error("[dash-estoque] Falha na RPC get_stock_dashboard_aggregates", {
      tenantId: context.appUser.tenant_id,
      userId: context.appUser.id,
      status,
      code: error.code,
      message: error.message,
    });

    if (error.code === STATEMENT_TIMEOUT_CODE) {
      throw new StockDashboardAggregatesError(
        "O Dashboard Estoque excedeu o tempo limite do banco. Reduza o periodo ou filtre por centro de estoque e tente novamente.",
        504,
      );
    }

    if (isUnavailableRpcFailure(status, error.code)) {
      throw new StockDashboardAggregatesError("Banco de dados indisponivel no momento. Tente novamente em instantes.", 503);
    }

    const migrationHint = error.code === "PGRST202"
      ? " Verifique se a migration 439_create_get_stock_dashboard_aggregates_rpc.sql foi aplicada."
      : "";
    throw new StockDashboardAggregatesError(`Falha ao carregar Dashboard Estoque.${migrationHint}`, 500);
  }

  const raw = (data ?? {}) as RawAggregates;

  return {
    stockCenters: arrayValue<StockCenterRow>(raw.stockCenters),
    materials: arrayValue<DashboardMaterialRow>(raw.materials).map((row) => ({
      ...row,
      unitPrice: numberValue(row.unitPrice),
      balanceQuantity: numberValue(row.balanceQuantity),
    })),
    movementCount: numberValue(raw.movementCount),
    totalMovementQuantity: numberValue(raw.totalMovementQuantity),
    movementEvolution: arrayValue<EvolutionRow>(raw.movementEvolution).map((row) => ({
      ...row,
      estimatedValue: numberValue(row.estimatedValue),
    })),
    scatterMaterials: arrayValue<ScatterMaterialRow>(raw.scatterMaterials).map((row) => ({
      ...row,
      quantity: numberValue(row.quantity),
      operationCount: numberValue(row.operationCount),
      projectCount: numberValue(row.projectCount),
      currentBalance: numberValue(row.currentBalance),
    })),
    scatterSummaryByUnit: arrayValue<ScatterUnitRow>(raw.scatterSummaryByUnit).map((row) => ({
      ...row,
      quantity: numberValue(row.quantity),
      materialCount: numberValue(row.materialCount),
      operationCount: numberValue(row.operationCount),
    })),
    teams: arrayValue<OptionRow>(raw.teams),
    projects: arrayValue<OptionRow>(raw.projects),
  };
}
