export type TeamPerformanceOrder = {
  id: string;
  projectId: string;
  teamId: string;
  executionDate: string;
  projectCodeSnapshot: string | null;
  teamNameSnapshot: string | null;
  foremanNameSnapshot: string | null;
};

export type TeamPerformanceTeam = {
  id: string;
  name: string;
  foremanPersonId: string | null;
  supervisorPersonId: string | null;
  isActive: boolean;
};

export type TeamPerformanceProjectDetail = {
  projectId: string;
  projectCode: string;
  serviceCenter: string;
  totalValue: number;
  orderCount: number;
};

export type TeamForemanContributionRow = {
  teamId: string;
  teamName: string;
  foremanName: string;
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

export type TeamPerformanceWindowInput = {
  orders: TeamPerformanceOrder[];
  potentialSupervisorTeams: TeamPerformanceTeam[];
  teamsById: ReadonlyMap<string, TeamPerformanceTeam>;
  metaWorkdays: number;
  standardMetaWorkdays: number;
  startDate: string;
  endDate: string;
  getOrderValue: (orderId: string) => number;
  getProjectServiceCenter: (projectId: string) => string;
  getPersonName: (personId: string) => string;
  getDailyMetaByTeamType: (teamTypeId: string) => number;
  resolveTeamTypeId: (teamId: string, isoDate: string) => string | null;
  resolveTeamTypeName: (teamId: string, isoDate: string) => string;
  resolveTeamForemanName: (teamId: string, isoDate: string) => string;
};

export type TeamPerformanceWindowResult = {
  teams: TeamPerformanceRow[];
  teamForemen: TeamForemanContributionRow[];
  supervisors: SupervisorPerformanceRow[];
  realizedValue: number;
};
