export type ProjectSituationKey =
  | "PORTFOLIO"
  | "CONCLUDED"
  | "TO_REPROGRAM"
  | "PENDING"
  | "PARTIAL_PLANNED"
  | "PARTIAL"
  | "BENEFIT_REACHED"
  | "INTERRUPTED"
  | "WITHOUT_STATUS"
  | "NEVER_PROGRAMMED"
  | "WITHDRAWN";

// Escopo por Tipo de Servico, resolvido no servidor. `MANUTENCAO` agrupa
// emergencial + manutencao e `OBRAS` e o complemento exato: nenhuma obra fica
// de fora e nenhuma aparece nos dois.
export type ServiceScope = "OBRAS" | "MANUTENCAO";

export type PriorityLevel = "NORMAL" | "ATTENTION" | "PRIORITY" | "INCONSISTENCY";

export type MapProject = {
  id: string;
  sob: string;
  projectName: string;
  contract: string;
  serviceCenter: string;
  priority: string;
  serviceType: string;
  city: string;
  executionDeadline: string;
  isWithdrawn: boolean;
  latestProgrammingId: string | null;
  latestDate: string;
  latestProgrammingStatus: string;
  latestWorkCompletionStatus: string | null;
  latestWorkCompletionLabel: string;
  latestTeamNames: string[];
  latestForemanNames: string[];
  latestStageLabel: string;
  stageCount: number;
  teamCount: number;
  hasOpenPendencia: boolean;
  reason: string;
  daysSinceLatest: number | null;
  priorityLevel: PriorityLevel;
  hasFutureActiveProgramming: boolean;
  completed: boolean;
  interrupted: boolean;
  withoutStatus: boolean;
  actionRequired: boolean;
  neverProgrammed: boolean;
};

export type StatusCard = {
  key: ProjectSituationKey;
  title: string;
  description: string;
  count: number;
  projects: MapProject[];
};

export type TeamWithoutProgramming = {
  id: string;
  name: string;
  vehiclePlate: string;
  serviceCenter: string;
  teamType: string;
  foremanName: string;
  active: boolean;
};

export type MapProgrammingResponse = {
  filters?: {
    startDate: string | null;
    endDate: string | null;
    serviceScope: ServiceScope;
    generatedAt: string;
    teamPeriodEnabled: boolean;
  };
  statusCards?: StatusCard[];
  priorityProjects?: MapProject[];
  neverProgrammedProjects?: MapProject[];
  teamsWithoutProgramming?: TeamWithoutProgramming[];
  message?: string;
};

export type FilterState = {
  startDate: string;
  endDate: string;
  projectSearch: string;
  teamSearch: string;
  serviceCenter: string;
  serviceScope: ServiceScope;
};
