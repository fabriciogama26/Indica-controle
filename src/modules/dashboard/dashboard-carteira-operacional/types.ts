export type DashboardPortfolioOption = {
  id: string;
  label: string;
};

export type DashboardPortfolioCycle = {
  cycleStart: string;
  cycleEnd: string;
  label: string;
};

export type DashboardPortfolioFilters = {
  cycleStart: string;
  project: string;
  serviceCenterId: string;
  portfolioScope: "ACTIVE" | "WITHDRAWN" | "ALL";
};

export type DashboardPortfolioDiagnostic = {
  status: "SAUDAVEL" | "ATENCAO" | "RISCO";
  message: string;
  signals: string[];
};

export type DashboardPortfolioQuantitySummary = {
  operationalProjects: number;
  workedProjects: number;
  newProjects: number;
  inheritedProjects: number;
  concludedProjects: number;
  pendingProjects: number;
  withdrawnProjects: number;
  averageAge: number;
  renewalRate: number;
};

export type DashboardPortfolioFinancialSummary = {
  totalPortfolioValue: number;
  producedInCycle: number;
  accumulatedValue: number;
  remainingPotential: number;
  explorationRate: number;
  averageNewProjectValue: number;
  averageInheritedProjectValue: number;
  completedAverageTicket: number;
};

export type DashboardPortfolioGoalCoverage = {
  status: "SAUDAVEL" | "ATENCAO" | "RISCO" | "SEM_META";
  cycleStart: string | null;
  cycleEnd: string | null;
  cycleEndLabel: string;
  cycleGoal: number;
  dailyGoal: number;
  producedValue: number;
  remainingCycleGoal: number;
  remainingPotential: number;
  coveragePercentage: number;
  autonomyBusinessDays: number;
  depletionDate: string | null;
  depletionDateLabel: string;
  message: string;
};

export type DashboardPortfolioFlowRow = {
  stage: string;
  projects: number;
  value: number;
};

export type DashboardPortfolioRenewalRow = {
  origin: string;
  projects: number;
  valueInCycle: number;
  averageTicket: number;
  participation: number;
};

export type DashboardPortfolioAgeBucket = {
  label: string;
  count: number;
  value: number;
};

export type DashboardPortfolioProject = {
  projectId: string;
  projectCode: string;
  serviceCenterId: string | null;
  serviceCenter: string;
  status: "CONCLUIDO" | "PENDENTE";
  origin: "NOVO" | "HERDADO" | "SEM_PRODUCAO";
  portfolioStatus: "ATIVA" | "RETIRADA";
  isWithdrawn: boolean;
  firstActivityDate: string | null;
  lastActivityDate: string | null;
  firstActivityLabel: string;
  lastActivityLabel: string;
  lastProductionWeek: number | null;
  daysWithoutProduction: number | null;
  workedCycleCount: number;
  cyclesWithoutProduction: number;
  totalForecastValue: number;
  valueBeforeCycle: number;
  valueInCycle: number;
  accumulatedValue: number;
  remainingPotential: number;
  exploredPercentage: number;
};

export type DashboardPortfolioActivityForecastItem = {
  id: string;
  activityId: string;
  code: string;
  description: string;
  type: string | null;
  unit: string;
  unitValue: number;
  voicePoint: number;
  totalValue: number;
  qtyPlanned: number;
  observation: string | null;
  source: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type DashboardPortfolioActivityForecastResponse = {
  message?: string;
  project?: {
    id: string;
    sob: string;
  };
  items?: DashboardPortfolioActivityForecastItem[];
};

export type DashboardPortfolioResponse = {
  message?: string;
  cycles?: DashboardPortfolioCycle[];
  selectedCycleStart?: string | null;
  selectedCycleEnd?: string | null;
  portfolioScope?: DashboardPortfolioFilters["portfolioScope"];
  filters?: {
    projects: DashboardPortfolioOption[];
    serviceCenters: DashboardPortfolioOption[];
  };
  diagnostic?: DashboardPortfolioDiagnostic;
  quantitySummary?: DashboardPortfolioQuantitySummary;
  financialSummary?: DashboardPortfolioFinancialSummary;
  goalCoverage?: DashboardPortfolioGoalCoverage;
  flow?: DashboardPortfolioFlowRow[];
  renewalChart?: DashboardPortfolioRenewalRow[];
  ageBuckets?: DashboardPortfolioAgeBucket[];
  projects?: DashboardPortfolioProject[];
};
