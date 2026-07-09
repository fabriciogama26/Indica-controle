export type DashboardTeamsOption = {
  id: string;
  label: string;
};

export type DashboardTeamsCycle = {
  cycleStart: string;
  cycleEnd: string;
  label: string;
};

export type DashboardTeamsWeek = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  workdays: number;
};

export type DashboardTeamsProject = {
  projectId: string;
  projectCode: string;
  serviceCenter: string;
  totalValue: number;
  orderCount: number;
};

export type DashboardTeamRow = {
  teamId: string;
  teamName: string;
  teamTypeNames: string[];
  foremanNames: string[];
  totalValue: number;
  metaValue: number;
  standardMetaValue: number;
  workedMetaValue: number;
  projectCount: number;
  projects: DashboardTeamsProject[];
  metaDays?: number;
  standardMetaDays?: number;
  workedDays: number;
  percentage: number;
  foremanContributions: DashboardTeamForemanRow[];
};

export type DashboardTeamForemanRow = {
  teamId: string;
  teamName: string;
  foremanName: string;
  totalValue: number;
  orderCount: number;
  projectCount: number;
  projects: DashboardTeamsProject[];
  workedDays: number;
  participationPercentage: number;
};

export type DashboardSupervisorRow = {
  supervisorId: string | null;
  supervisorName: string;
  totalValue: number;
  orderCount: number;
  projectCount: number;
  projects: DashboardTeamsProject[];
  productiveTeamCount: number;
  potentialTeamCount: number;
  productiveMetaValue: number;
  potentialMetaValue: number;
  productivePercentage: number;
  potentialPercentage: number;
  percentageOfTotal?: number;
};

export type DashboardTeamsResponse = {
  message?: string;
  cycles?: DashboardTeamsCycle[];
  selectedCycleStart?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  filters?: {
    projects: DashboardTeamsOption[];
    teams: DashboardTeamsOption[];
    foremen: DashboardTeamsOption[];
    supervisors?: DashboardTeamsOption[];
  };
  cycleWeeks?: DashboardTeamsWeek[];
  teamsProduction?: DashboardTeamRow[];
  teamsProductionByWeek?: Record<string, DashboardTeamRow[]>;
  teamForemen?: DashboardTeamForemanRow[];
  teamForemenByWeek?: Record<string, DashboardTeamForemanRow[]>;
  supervisorsProduction?: DashboardSupervisorRow[];
  supervisorsProductionByWeek?: Record<string, DashboardSupervisorRow[]>;
};

export type DashboardTeamsFilters = {
  cycleStart: string;
  startDate: string;
  endDate: string;
  project: string;
  teamId: string;
  foreman: string;
  supervisorId: string;
};
