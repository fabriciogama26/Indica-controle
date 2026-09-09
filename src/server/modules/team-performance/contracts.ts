export type TeamPerformanceOrder = {
  id: string;
  projectId: string | null;
  teamId: string;
  executionDate: string;
  projectCodeSnapshot: string | null;
  teamNameSnapshot: string | null;
  foremanNameSnapshot: string | null;
  commercialOrderRef?: string | null;
  // Ordem COMERCIAL nao tem encarregado: quem executou sao os dois eletricistas
  // gravados por ordem, na ordem dos slots 1 e 2. Vazio/ausente na ordem tecnica.
  memberNames?: string[];
};

export type TeamPerformanceTeam = {
  id: string;
  name: string;
  foremanPersonId: string | null;
  supervisorPersonId: string | null;
  isActive: boolean;
};

// Uma linha por Incidencia (`commercial_order_ref`) dentro do projeto. A ordem
// comercial pode nao ter Incidencia, e nesse caso ela cai na entrada de `orderRef`
// vazio -- sem isso a soma das linhas nao fecharia com o total do projeto.
export type TeamPerformanceCommercialOrderDetail = {
  orderRef: string;
  totalValue: number;
  orderCount: number;
};

export type TeamPerformanceProjectDetail = {
  projectId: string | null;
  projectCode: string;
  serviceCenter: string;
  totalValue: number;
  orderCount: number;
  commercialOrders: TeamPerformanceCommercialOrderDetail[];
};

export type TeamForemanContributionRow = {
  teamId: string;
  teamName: string;
  // Na tecnica e o encarregado da ordem. Na comercial e a dupla `A / B`, para a
  // linha continuar tendo uma chave de exibicao unica.
  foremanName: string;
  // Vazio na tecnica; na comercial traz Eletricista 1 e Eletricista 2 separados.
  memberNames: string[];
  totalValue: number;
  orderCount: number;
  projectCount: number;
  projects: TeamPerformanceProjectDetail[];
  workedDays: number;
  participationPercentage: number;
};

export type TeamPerformanceRow = {
  teamId: string;
  teamName: string;
  foremanNames: string[];
  teamTypeNames: string[];
  totalValue: number;
  metaValue: number;
  standardMetaValue: number;
  workedMetaValue: number;
  projectCount: number;
  projects: TeamPerformanceProjectDetail[];
  teamCount: number;
  metaDays: number;
  standardMetaDays: number;
  workedDays: number;
  percentage: number;
  foremanContributions: TeamForemanContributionRow[];
};

export type SupervisorPerformanceRow = {
  supervisorId: string | null;
  supervisorName: string;
  totalValue: number;
  orderCount: number;
  projectCount: number;
  projects: TeamPerformanceProjectDetail[];
  productiveTeamCount: number;
  potentialTeamCount: number;
  productiveMetaValue: number;
  potentialMetaValue: number;
  productivePercentage: number;
  potentialPercentage: number;
  percentageOfTotal: number;
};

export type TeamSupervisorAssignment = {
  supervisorId: string | null;
  supervisorName: string;
};

export type TeamPerformanceWindowInput = {
  orders: TeamPerformanceOrder[];
  potentialSupervisorTeams: TeamPerformanceTeam[];
  teamsById: ReadonlyMap<string, TeamPerformanceTeam>;
  metaWorkdays: number;
  standardMetaWorkdays: number;
  startDate: string;
  endDate: string;
  supervisorIdFilter?: string | null;
  getOrderValue: (orderId: string) => number;
  getProjectServiceCenter: (projectId: string) => string;
  getPersonName: (personId: string) => string;
  getDailyMetaByTeamType: (teamTypeId: string) => number;
  resolveTeamTypeId: (teamId: string, isoDate: string) => string | null;
  resolveTeamTypeName: (teamId: string, isoDate: string) => string;
  resolveTeamForemanName: (teamId: string, isoDate: string) => string;
  resolveTeamSupervisor: (teamId: string, isoDate: string) => TeamSupervisorAssignment;
};

export type TeamPerformanceWindowResult = {
  teams: TeamPerformanceRow[];
  teamForemen: TeamForemanContributionRow[];
  supervisors: SupervisorPerformanceRow[];
  realizedValue: number;
};
