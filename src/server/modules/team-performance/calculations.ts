import type {
  SupervisorPerformanceRow,
  TeamPerformanceOrder,
  TeamPerformanceProjectDetail,
  TeamPerformanceRow,
  TeamForemanContributionRow,
  TeamPerformanceWindowInput,
  TeamPerformanceWindowResult,
} from "./contracts";

type TeamAggregate = {
  teamId: string;
  teamName: string;
  foremanNames: Set<string>;
  totalValue: number;
  projectIds: Set<string>;
  projects: Map<string, TeamPerformanceProjectDetail>;
  workedDates: Set<string>;
  foremanContributions: Map<string, {
    foremanName: string;
    totalValue: number;
    orderCount: number;
    projectIds: Set<string>;
    projects: Map<string, TeamPerformanceProjectDetail>;
    workedDates: Set<string>;
  }>;
};

type SupervisorAggregate = {
  supervisorId: string | null;
  supervisorName: string;
  totalValue: number;
  orderCount: number;
  projectIds: Set<string>;
  projects: Map<string, TeamPerformanceProjectDetail>;
  productiveTeamIds: Set<string>;
  potentialTeamIds: Set<string>;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toIsoDate(value: Date) {
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function addDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function listBusinessDayIsoDates(startDate: string, endDate: string) {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  const dates: string[] = [];

  for (let current = start; current <= end; current = addDays(current, 1)) {
    const day = current.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(toIsoDate(current));
    }
  }

  return dates;
}

function addProjectProduction(
  target: Map<string, TeamPerformanceProjectDetail>,
  order: TeamPerformanceOrder,
  totalValue: number,
  getProjectServiceCenter: TeamPerformanceWindowInput["getProjectServiceCenter"],
) {
  const current = target.get(order.projectId) ?? {
    projectId: order.projectId,
    projectCode: normalizeText(order.projectCodeSnapshot) || "Projeto sem codigo",
    serviceCenter: getProjectServiceCenter(order.projectId) || "Centro nao informado",
    totalValue: 0,
    orderCount: 0,
  };

  current.totalValue += totalValue;
  current.orderCount += 1;
  target.set(order.projectId, current);
}

function buildProjectRows(target: Map<string, TeamPerformanceProjectDetail>) {
  return Array.from(target.values()).sort((left, right) => right.totalValue - left.totalValue);
}

export function calculateTeamPerformanceWindow(input: TeamPerformanceWindowInput): TeamPerformanceWindowResult {
  const teams = new Map<string, TeamAggregate>();
  const supervisors = createSupervisorMap(input);

  function calculateTeamMeta(teamId: string, metaWorkdays: number) {
    if (metaWorkdays <= 0) return 0;

    const businessDays = listBusinessDayIsoDates(input.startDate, input.endDate);
    if (!businessDays.length) return 0;

    const dayWeight = metaWorkdays / businessDays.length;
    return businessDays.reduce((total, isoDate) => {
      const teamTypeId = input.resolveTeamTypeId(teamId, isoDate);
      return total + (teamTypeId ? input.getDailyMetaByTeamType(teamTypeId) * dayWeight : 0);
    }, 0);
  }

  function calculateWorkedTeamMeta(teamId: string, dates: Set<string>) {
    let total = 0;
    for (const isoDate of dates) {
      const teamTypeId = input.resolveTeamTypeId(teamId, isoDate);
      if (teamTypeId) {
        total += input.getDailyMetaByTeamType(teamTypeId);
      }
    }
    return total;
  }

  function addOrder(order: TeamPerformanceOrder) {
    const totalValue = input.getOrderValue(order.id);
    const team = input.teamsById.get(order.teamId);
    const measuredForemanName = normalizeText(order.foremanNameSnapshot) || "Nao identificado";
    const foremanName = normalizeText(order.foremanNameSnapshot)
      || (team?.foremanPersonId ? input.getPersonName(team.foremanPersonId) : "")
      || "Nao identificado";
    const teamAggregate = teams.get(order.teamId) ?? {
      teamId: order.teamId,
      teamName: normalizeText(order.teamNameSnapshot) || normalizeText(team?.name) || "Equipe sem nome",
      foremanNames: new Set<string>(),
      totalValue: 0,
      projectIds: new Set<string>(),
      projects: new Map<string, TeamPerformanceProjectDetail>(),
      workedDates: new Set<string>(),
      foremanContributions: new Map(),
    };

    teamAggregate.foremanNames.add(foremanName);
    teamAggregate.totalValue += totalValue;
    teamAggregate.projectIds.add(order.projectId);
    teamAggregate.workedDates.add(order.executionDate);
    addProjectProduction(teamAggregate.projects, order, totalValue, input.getProjectServiceCenter);
    const contribution = teamAggregate.foremanContributions.get(measuredForemanName) ?? {
      foremanName: measuredForemanName,
      totalValue: 0,
      orderCount: 0,
      projectIds: new Set<string>(),
      projects: new Map<string, TeamPerformanceProjectDetail>(),
      workedDates: new Set<string>(),
    };
    contribution.totalValue += totalValue;
    contribution.orderCount += 1;
    contribution.projectIds.add(order.projectId);
    contribution.workedDates.add(order.executionDate);
    addProjectProduction(contribution.projects, order, totalValue, input.getProjectServiceCenter);
    teamAggregate.foremanContributions.set(measuredForemanName, contribution);
    teams.set(order.teamId, teamAggregate);

    addSupervisorOrder(supervisors, order, totalValue, input);
  }

  for (const order of input.orders) {
    addOrder(order);
  }

  const realizedValue = input.orders.reduce((sum, order) => sum + input.getOrderValue(order.id), 0);
  const teamRows = buildTeamRows(input, teams, calculateTeamMeta, calculateWorkedTeamMeta);
  return {
    teams: teamRows,
    teamForemen: teamRows.flatMap((team) => team.foremanContributions),
    supervisors: buildSupervisorRows(input, supervisors, realizedValue, calculateTeamMeta),
    realizedValue,
  };
}

function createSupervisorMap(input: TeamPerformanceWindowInput) {
  const map = new Map<string, SupervisorAggregate>();

  for (const team of input.potentialSupervisorTeams) {
    const supervisorId = team.supervisorPersonId;
    const supervisorName = supervisorId
      ? input.getPersonName(supervisorId) || "Supervisor nao identificado"
      : "Sem supervisor";
    const supervisorKey = supervisorId ?? "__NO_SUPERVISOR__";
    const current = map.get(supervisorKey) ?? {
      supervisorId,
      supervisorName,
      totalValue: 0,
      orderCount: 0,
      projectIds: new Set<string>(),
      projects: new Map<string, TeamPerformanceProjectDetail>(),
      productiveTeamIds: new Set<string>(),
      potentialTeamIds: new Set<string>(),
    };
    current.potentialTeamIds.add(team.id);
    map.set(supervisorKey, current);
  }

  return map;
}

function addSupervisorOrder(
  target: Map<string, SupervisorAggregate>,
  order: TeamPerformanceOrder,
  totalValue: number,
  input: TeamPerformanceWindowInput,
) {
  const team = input.teamsById.get(order.teamId);
  const supervisorId = team?.supervisorPersonId ?? null;
  const supervisorName = supervisorId
    ? input.getPersonName(supervisorId) || "Supervisor nao identificado"
    : "Sem supervisor";
  const supervisorKey = supervisorId ?? "__NO_SUPERVISOR__";
  const current = target.get(supervisorKey) ?? {
    supervisorId,
    supervisorName,
    totalValue: 0,
    orderCount: 0,
    projectIds: new Set<string>(),
    projects: new Map<string, TeamPerformanceProjectDetail>(),
    productiveTeamIds: new Set<string>(),
    potentialTeamIds: new Set<string>(),
  };

  current.totalValue += totalValue;
  current.orderCount += 1;
  current.projectIds.add(order.projectId);
  current.productiveTeamIds.add(order.teamId);
  if (team?.isActive) {
    current.potentialTeamIds.add(order.teamId);
  }
  addProjectProduction(current.projects, order, totalValue, input.getProjectServiceCenter);
  target.set(supervisorKey, current);
}

function buildTeamRows(
  input: TeamPerformanceWindowInput,
  target: Map<string, TeamAggregate>,
  calculateTeamMeta: (teamId: string, metaWorkdays: number) => number,
  calculateWorkedTeamMeta: (teamId: string, dates: Set<string>) => number,
): TeamPerformanceRow[] {
  const periodDates = Array.from(new Set([
    ...listBusinessDayIsoDates(input.startDate, input.endDate),
    ...Array.from(target.values()).flatMap((team) => Array.from(team.workedDates)),
  ]));

  return Array.from(target.values())
    .map((team) => {
      const metaValue = calculateTeamMeta(team.teamId, input.metaWorkdays);
      const standardMetaValue = calculateTeamMeta(team.teamId, input.standardMetaWorkdays);
      const foremanNames = new Set(team.foremanNames);
      const teamTypeNames = new Set<string>();

      for (const isoDate of periodDates) {
        foremanNames.add(input.resolveTeamForemanName(team.teamId, isoDate));
        teamTypeNames.add(input.resolveTeamTypeName(team.teamId, isoDate));
      }

      return {
        teamId: team.teamId,
        teamName: team.teamName,
        foremanNames: Array.from(foremanNames).filter(Boolean).sort((left, right) => left.localeCompare(right)),
        teamTypeNames: Array.from(teamTypeNames).filter(Boolean).sort((left, right) => left.localeCompare(right)),
        totalValue: team.totalValue,
        metaValue,
        standardMetaValue,
        workedMetaValue: calculateWorkedTeamMeta(team.teamId, team.workedDates),
        projectCount: team.projectIds.size,
        projects: buildProjectRows(team.projects),
        teamCount: 1,
        metaDays: input.metaWorkdays,
        standardMetaDays: input.standardMetaWorkdays,
        workedDays: team.workedDates.size,
        percentage: metaValue > 0 ? (team.totalValue / metaValue) * 100 : 0,
        foremanContributions: buildTeamForemanContributions(team),
      };
    })
    .sort((left, right) => right.totalValue - left.totalValue);
}

function buildTeamForemanContributions(team: TeamAggregate): TeamForemanContributionRow[] {
  return Array.from(team.foremanContributions.values())
    .map((contribution) => ({
      teamId: team.teamId,
      teamName: team.teamName,
      foremanName: contribution.foremanName,
      totalValue: contribution.totalValue,
      orderCount: contribution.orderCount,
      projectCount: contribution.projectIds.size,
      projects: buildProjectRows(contribution.projects),
      workedDays: contribution.workedDates.size,
      participationPercentage: team.totalValue > 0 ? (contribution.totalValue / team.totalValue) * 100 : 0,
    }))
    .sort((left, right) => right.totalValue - left.totalValue);
}

function buildSupervisorRows(
  input: TeamPerformanceWindowInput,
  target: Map<string, SupervisorAggregate>,
  totalRealized: number,
  calculateTeamMeta: (teamId: string, metaWorkdays: number) => number,
): SupervisorPerformanceRow[] {
  return Array.from(target.values())
    .map((supervisor) => {
      const productiveMetaValue = Array.from(supervisor.productiveTeamIds).reduce(
        (total, teamId) => total + calculateTeamMeta(teamId, input.metaWorkdays),
        0,
      );
      const potentialMetaValue = Array.from(supervisor.potentialTeamIds).reduce(
        (total, teamId) => total + calculateTeamMeta(teamId, input.metaWorkdays),
        0,
      );

      return {
        supervisorId: supervisor.supervisorId,
        supervisorName: supervisor.supervisorName,
        totalValue: supervisor.totalValue,
        orderCount: supervisor.orderCount,
        projectCount: supervisor.projectIds.size,
        projects: buildProjectRows(supervisor.projects),
        productiveTeamCount: supervisor.productiveTeamIds.size,
        potentialTeamCount: supervisor.potentialTeamIds.size,
        productiveMetaValue,
        potentialMetaValue,
        productivePercentage: productiveMetaValue > 0 ? (supervisor.totalValue / productiveMetaValue) * 100 : 0,
        potentialPercentage: potentialMetaValue > 0 ? (supervisor.totalValue / potentialMetaValue) * 100 : 0,
        percentageOfTotal: totalRealized > 0 ? (supervisor.totalValue / totalRealized) * 100 : 0,
      };
    })
    .sort((left, right) => right.totalValue - left.totalValue);
}
