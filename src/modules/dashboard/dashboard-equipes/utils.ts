import { buildCsvContent, downloadCsvFile } from "@/lib/utils/csv";

type DashboardProjectCsvRow = {
  projectCode: string;
  serviceCenter: string;
  totalValue: number;
  orderCount: number;
  commercialOrderRefs?: string[];
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
  projects?: DashboardProjectCsvRow[];
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
    ...(params.commercial ? ["Incidencias"] : []),
  ];
  const dataRows = params.rows.map((item) => [
    item.projectCode,
    item.serviceCenter,
    item.totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    item.orderCount,
    ...(params.commercial ? [formatIncidences([item])] : []),
  ]);
  downloadCsvFile(buildCsvContent(header, dataRows), filename);
}

function formatProjectCodes(projects: DashboardProjectCsvRow[] | undefined) {
  return (projects ?? []).map((project) => project.projectCode).join(", ") || "Nenhum";
}

function formatIncidences(projects: DashboardProjectCsvRow[] | undefined) {
  const refs = Array.from(new Set((projects ?? []).flatMap((project) => project.commercialOrderRefs ?? [])));
  return refs.sort((left, right) => left.localeCompare(right)).join(", ");
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
    projects?: DashboardProjectCsvRow[];
  }>;
}) {
  const header = [
    "MK / Equipe",
    ...(params.commercial ? ["Eletricista 1", "Eletricista 2"] : ["Encarregado"]),
    "Valor produzido",
    "Participacao no MK (%)",
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
    ...(params.commercial ? ["TOTAL MK", ""] : ["TOTAL MK"]),
    params.totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    "100",
    (params.metaValue > 0 ? (params.totalValue / params.metaValue) * 100 : 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 }),
    "",
    params.rows.reduce((sum, item) => sum + item.orderCount, 0),
    params.projectCount,
    "",
    ...(params.commercial ? [""] : []),
  ]);

  downloadCsvFile(buildCsvContent(header, dataRows), filename);
}

export function exportDashboardTeamForemenCsv(filename: string, params: {
  commercial: boolean;
  rows: DashboardContributionCsvRow[];
}) {
  const header = [
    "MK / Equipe",
    ...(params.commercial ? ["Eletricista 1", "Eletricista 2"] : ["Encarregado"]),
    "Valor produzido",
    "Participacao no MK (%)",
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
