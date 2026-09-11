import { buildCsvContent, downloadCsvFile } from "@/lib/utils/csv";

// Linha ja expandida pela tela: na visao Comercial e uma Incidencia, na tecnica e o
// projeto. O CSV do modal exporta exatamente estas linhas.
type DashboardProjectCsvRow = {
  projectCode: string;
  serviceCenter: string;
  totalValue: number;
  orderCount: number;
  incidence: string;
};

type DashboardProjectSummaryRow = {
  projectCode: string;
  commercialOrders?: Array<{ orderRef: string }>;
};

type DashboardContributionCsvRow = {
  teamName?: string;
  foremanName: string;
  memberNames: string[];
  totalValue: number;
  participationPercentage: number;
  workedDays: number;
  orderCount: number;
  projectCount: number;
  projects?: DashboardProjectSummaryRow[];
};

export function formatDashboardCurrency(value: number, compact = false) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 2,
  }).format(Number(value ?? 0));
}

export function formatDashboardPercent(value: number) {
  return `${Number(value ?? 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

export function maxDashboardValue(values: number[]) {
  return Math.max(1, ...values.map((value) => Number(value) || 0));
}

export function dashboardFilenameToken(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "detalhe";
}

export function exportDashboardProjectsCsv(filename: string, params: {
  commercial: boolean;
  rows: DashboardProjectCsvRow[];
}) {
  const header = [
    "Projeto",
    "Centro",
    "Valor cobrado",
    "Ordens",
    ...(params.commercial ? ["Incidencia"] : []),
  ];
  const dataRows = params.rows.map((item) => [
    item.projectCode,
    item.serviceCenter,
    item.totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    item.orderCount,
    ...(params.commercial ? [item.incidence] : []),
  ]);
  downloadCsvFile(buildCsvContent(header, dataRows), filename);
}

function formatProjectCodes(projects: DashboardProjectSummaryRow[] | undefined) {
  return (projects ?? []).map((project) => project.projectCode).join(", ") || "Nenhum";
}

function listIncidences(projects: DashboardProjectSummaryRow[] | undefined) {
  const refs = new Set<string>();
  for (const project of projects ?? []) {
    for (const order of project.commercialOrders ?? []) {
      if (order.orderRef) refs.add(order.orderRef);
    }
  }
  return Array.from(refs).sort((left, right) => left.localeCompare(right));
}

function formatIncidences(projects: DashboardProjectSummaryRow[] | undefined) {
  return listIncidences(projects).join(", ");
}

export function exportDashboardTeamContributionsCsv(filename: string, params: {
  teamName: string;
  metaLabel: string;
  metaValue: number;
  totalValue: number;
  projectCount: number;
  commercial: boolean;
  rows: Array<{
    foremanName: string;
    memberNames: string[];
    totalValue: number;
    participationPercentage: number;
    workedDays: number;
    orderCount: number;
    projectCount: number;
    projects?: DashboardProjectSummaryRow[];
  }>;
}) {
  const teamFilterLabel = params.commercial ? "EQUIPE" : "MK / Equipe";
  const teamParticipationLabel = params.commercial ? "Participacao na EQUIPE (%)" : "Participacao no MK (%)";
  const teamTotalLabel = params.commercial ? "TOTAL EQUIPE" : "TOTAL MK";
  const header = [
    teamFilterLabel,
    ...(params.commercial ? ["Eletricista 1", "Eletricista 2"] : ["Encarregado"]),
    "Valor produzido",
    teamParticipationLabel,
    `Contribuicao sobre ${params.metaLabel} (%)`,
    "Dias com producao",
    "Ordens",
    "Projetos",
    "Lista de projetos",
    ...(params.commercial ? ["Incidencias"] : []),
  ];
  const dataRows = params.rows.map((item) => [
    params.teamName,
    ...(params.commercial ? [item.memberNames[0] ?? "", item.memberNames[1] ?? ""] : [item.foremanName]),
    item.totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    item.participationPercentage.toLocaleString("pt-BR", { maximumFractionDigits: 2 }),
    (params.metaValue > 0 ? (item.totalValue / params.metaValue) * 100 : 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 }),
    item.workedDays,
    item.orderCount,
    item.projectCount,
    formatProjectCodes(item.projects),
    ...(params.commercial ? [formatIncidences(item.projects)] : []),
  ]);
  dataRows.push([
    params.teamName,
    ...(params.commercial ? [teamTotalLabel, ""] : [teamTotalLabel]),
    params.totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    "100",
    (params.metaValue > 0 ? (params.totalValue / params.metaValue) * 100 : 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 }),
    "",
    params.rows.reduce((sum, item) => sum + item.orderCount, 0),
    params.projectCount,
    "",
    // Total: quantidade de Incidencias distintas, nao a lista concatenada.
    ...(params.commercial ? [listIncidences(params.rows.flatMap((item) => item.projects ?? [])).length] : []),
  ]);

  downloadCsvFile(buildCsvContent(header, dataRows), filename);
}

export function exportDashboardTeamForemenCsv(filename: string, params: {
  commercial: boolean;
  rows: DashboardContributionCsvRow[];
}) {
  const teamFilterLabel = params.commercial ? "EQUIPE" : "MK / Equipe";
  const teamParticipationLabel = params.commercial ? "Participacao na EQUIPE (%)" : "Participacao no MK (%)";
  const header = [
    teamFilterLabel,
    ...(params.commercial ? ["Eletricista 1", "Eletricista 2"] : ["Encarregado"]),
    "Valor produzido",
    teamParticipationLabel,
    "Dias com producao",
    "Ordens",
    "Projetos",
    "Lista de projetos",
    ...(params.commercial ? ["Incidencias"] : []),
  ];
  const dataRows = params.rows.map((item) => [
    item.teamName ?? "",
    ...(params.commercial ? [item.memberNames[0] ?? "", item.memberNames[1] ?? ""] : [item.foremanName]),
    item.totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    item.participationPercentage.toLocaleString("pt-BR", { maximumFractionDigits: 2 }),
    item.workedDays,
    item.orderCount,
    item.projectCount,
    formatProjectCodes(item.projects),
    ...(params.commercial ? [formatIncidences(item.projects)] : []),
  ]);

  downloadCsvFile(buildCsvContent(header, dataRows), filename);
}
