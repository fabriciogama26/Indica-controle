// Tipos, constantes e helpers puros do Dashboard Medicao.
//
// Extraidos de `DashboardMeasurementPageView.tsx` quando a tela ganhou o seletor
// de tipo operacional (TECNICA/COMERCIAL), para o arquivo continuar encolhendo em
// vez de crescer sobre o teto. Nao ha React aqui: `ExpandIcon` ficou no PageView
// de proposito, porque e JSX.

export type Option = {
  id: string;
  label: string;
};

export type CycleOption = {
  cycleStart: string;
  cycleEnd: string;
  label: string;
};

export type CompletionChartItem = {
  label: string;
  value: number;
  orders: number;
  projectCount: number;
  projects: ProjectProductionDetail[];
  percentage: number;
};

export type CycleComparison = {
  label: string;
  value: number;
  meta: number;
  standardMeta: number;
  workedMeta: number;
  workdays: number;
  defaultWorkdays: number;
  workedDays: number;
  orderCount: number;
  projectCount: number;
  averageTicketValue: number;
  averageServiceTicketValue: number;
  completedProjectCount: number;
  completedAverageTicketValue: number;
  projectDetails: CycleProjectDetail[];
  executedWorkdays: number;
  averageDailyValue: number;
  workedObjectiveValue: number;
  objectiveDailyValue: number;
  targetDailyValue: number;
  forecastValue: number;
  forecastPercentage: number;
  forecastDifference: number;
  percentage: number;
};

export type AnnualCycleComparison = {
  cycleStart: string;
  cycleEnd: string;
  label: string;
  measuredValue: number;
  forecastValue: number;
  metaValue: number;
  measuredPercentage: number;
  forecastPercentage: number;
  measuredDifference: number;
  forecastDifference: number;
  executedWorkdays: number;
  workdays: number;
  orderCount: number;
  projectCount: number;
  teamCount: number;
  hasMeta: boolean;
};

export type PeriodSummary = {
  realizedValue: number;
  orderCount: number;
  projectCount: number;
  averageTicketValue: number;
  averageServiceTicketValue: number;
  completedProjectCount: number;
  completedAverageTicketValue: number;
};

export type CompletionTableTotals = {
  value: number;
  orders: number;
  projectCount: number;
};

export type ProjectProductionDetail = {
  projectId: string;
  projectCode: string;
  serviceCenter: string;
  totalValue: number;
  orderCount: number;
};

export type CycleProjectDetail = {
  projectId: string;
  projectCode: string;
  firstActivity: string;
  valueBeforeCycle: number;
  valueInCycle: number;
  accumulatedValue: number;
  workedCycleCount: number;
  week: number | null;
};

export type TeamCategoryOption = {
  code: string;
  label: string;
};

export type DashboardResponse = {
  message?: string;
  teamCategoryCode?: string;
  teamCategories?: TeamCategoryOption[];
  cycles?: CycleOption[];
  periods?: Option[];
  selectedPeriod?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  selectedCycleStart?: string | null;
  filters?: {
    projects: Option[];
  };
  completionChart?: CompletionChartItem[];
  cycleCompletionChart?: CompletionChartItem[];
  periodCompletionChart?: CompletionChartItem[];
  periodSummary?: PeriodSummary | null;
  cycleComparison?: CycleComparison | null;
  annualYear?: number;
  annualCycleComparison?: AnnualCycleComparison[];
};

export type ExpandedChart = "completionCycle" | "completionPeriod" | "cycle" | "annual" | null;
// Padrao TECNICA: e a operacao que o dashboard sempre mostrou, entao abrir a tela
// sem escolher nada continua entregando exatamente o mesmo recorte de antes.
export const DEFAULT_TEAM_CATEGORY_CODE = "TECNICA";

export type MetaMode = "cycle" | "standard" | "worked";
export type ServiceScope = "ALL" | "OBRAS" | "MANUTENCAO";

export type ProjectDetailModal = {
  kind: "production";
  title: string;
  subtitle: string;
  rows: ProjectProductionDetail[];
  filename: string;
} | {
  kind: "cycle";
  title: string;
  subtitle: string;
  rows: CycleProjectDetail[];
  filename: string;
} | null;

export const metaLabels: Record<MetaMode, string> = {
  cycle: "Meta ciclo",
  standard: "Meta ciclo padrao",
  worked: "Meta ciclo trabalhado",
};

export const metaDayLabels: Record<MetaMode, string> = {
  cycle: "Dias uteis",
  standard: "Dias padrao",
  worked: "Dias reais",
};

// Textos do icone de informe dos cards de indicador. O card de periodo e o card de
// ciclo somam bases diferentes: o periodo inclui a Garantia de faturamento minimo,
// o ciclo nao. Ver docs/Tela_Dashboard_Medicao_SaaS.txt.
export const periodMetricHelp = {
  averageTicket:
    "Valor total do recorte De/Para dividido pelos projetos distintos do recorte. Valor e projetos incluem a Garantia de faturamento minimo.",
  completedAverageTicket:
    "Valor das ordens com Estado Trabalho Concluido no recorte De/Para dividido pelos projetos distintos concluidos. Nao inclui a Garantia de faturamento minimo.",
  averageServiceTicket:
    "Valor total do recorte De/Para dividido pela quantidade de ordens do recorte. Valor e contagem incluem a Garantia de faturamento minimo.",
} as const;

export const cycleMetricHelp = {
  averageTicket:
    "Valor realizado no ciclo dividido pelos projetos distintos do ciclo e dos filtros aplicados.",
  completedAverageTicket:
    "Valor das ordens com Estado Trabalho Concluido dividido pelos projetos distintos concluidos, no ciclo e nos filtros aplicados.",
  averageServiceTicket:
    "Valor realizado no ciclo dividido pela quantidade de ordens com producao do ciclo e dos filtros aplicados.",
  currentPace:
    "Valor realizado no ciclo dividido pelos Dias trabalhados, ou seja, as datas distintas de execucao das medicoes com producao. Dia sem execucao nao entra na conta.",
  productivePace:
    "Soma da meta diaria do tipo de equipe vigente para cada par unico de equipe + data com producao, dividida pelos Dias trabalhados. Ordens sem producao, canceladas e a Garantia de faturamento minimo ficam de fora.",
  targetPace:
    "Soma de Valor diario x Equipes medida cadastrada na Meta do ciclo, por tipo de equipe. Nao depende do que foi executado.",
} as const;

export const metaColors: Record<MetaMode | "value", string> = {
  value: "#4b77c7",
  cycle: "#f07f2f",
  standard: "#17a884",
  worked: "#7b61ff",
};

export const completionChartColors: Record<string, string> = {
  Concluido: "#4b77c7",
  Parcial: "#f07f2f",
  "Beneficio atingido": "#17a884",
  Pendente: "#e25555",
  "Garantia de faturamento minimo": "#7b61ff",
};

export function formatCurrency(value: number, compact = false) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatCompactCurrency(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const sign = safeValue < 0 ? "- " : "";
  const absoluteValue = Math.abs(safeValue);
  const numberFormat = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: absoluteValue >= 1_000_000 ? 2 : 1,
  });

  if (absoluteValue >= 1_000_000) {
    return `${sign}R$ ${numberFormat.format(absoluteValue / 1_000_000)} mi`;
  }

  if (absoluteValue >= 1_000) {
    return `${sign}R$ ${numberFormat.format(absoluteValue / 1_000)} mil`;
  }

  return `${sign}${formatCurrency(absoluteValue)}`;
}

export function formatPercent(value: number) {
  return `${(Number.isFinite(value) ? value : 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })}%`;
}

export function formatPercentOneDecimal(value: number) {
  return `${(Number.isFinite(value) ? value : 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

export function maxValue(values: number[]) {
  return Math.max(1, ...values.map((value) => Number(value) || 0));
}

export function filenameToken(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "detalhe";
}

export function todayToken() {
  return new Date().toISOString().slice(0, 10);
}

export function formatDatePtBr(value: string | null | undefined) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

export function formatCycleAxisLabel(value: string) {
  const [year, month] = value.split("-");
  const monthIndex = Number(month) - 1;
  const monthLabels = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  if (!year || monthIndex < 0 || monthIndex > 11) return value;
  return `${monthLabels[monthIndex]}/${year.slice(2)}`;
}

export function getCurrentYearPeriod() {
  const year = new Date().getFullYear();
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  };
}

export function getCurrentYear() {
  return new Date().getFullYear();
}

export function resolveCycleMetaValue(cycle: CycleComparison, mode: MetaMode) {
  if (mode === "standard") return cycle.standardMeta;
  if (mode === "worked") return cycle.workedMeta;
  return cycle.meta;
}

export function resolveCycleDays(cycle: CycleComparison, mode: MetaMode) {
  if (mode === "standard") return cycle.defaultWorkdays;
  if (mode === "worked") return cycle.workedDays;
  return cycle.workdays;
}

export function resolveCycleForecastValue(cycle: CycleComparison, mode: MetaMode) {
  return cycle.averageDailyValue * resolveCycleDays(cycle, mode);
}

export function resolveCycleForecastDifference(cycle: CycleComparison, mode: MetaMode) {
  return resolveCycleForecastValue(cycle, mode) - resolveCycleMetaValue(cycle, mode);
}
