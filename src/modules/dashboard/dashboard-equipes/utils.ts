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

export function exportDashboardProjectsCsv(filename: string, rows: Array<{
  projectCode: string;
  serviceCenter: string;
  totalValue: number;
  orderCount: number;
}>) {
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const header = ["Projeto", "Centro", "Valor cobrado", "Ordens"];
  const dataRows = rows.map((item) => [
    item.projectCode,
    item.serviceCenter,
    item.totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    item.orderCount,
  ]);
  const csv = `\uFEFF${[header, ...dataRows].map((line) => line.map(escape).join(";")).join("\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportDashboardTeamContributionsCsv(filename: string, params: {
  teamName: string;
  metaLabel: string;
  metaValue: number;
  totalValue: number;
  projectCount: number;
  rows: Array<{
    foremanName: string;
    totalValue: number;
    participationPercentage: number;
    workedDays: number;
    orderCount: number;
    projectCount: number;
  }>;
}) {
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const header = [
    "MK / Equipe",
    "Encarregado",
    "Valor produzido",
    "Participacao no MK (%)",
    `Contribuicao sobre ${params.metaLabel} (%)`,
    "Dias com producao",
    "Ordens",
    "Projetos",
  ];
  const dataRows = params.rows.map((item) => [
    params.teamName,
    item.foremanName,
    item.totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    item.participationPercentage.toLocaleString("pt-BR", { maximumFractionDigits: 2 }),
    (params.metaValue > 0 ? (item.totalValue / params.metaValue) * 100 : 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 }),
    item.workedDays,
    item.orderCount,
    item.projectCount,
  ]);
  dataRows.push([
    params.teamName,
    "TOTAL MK",
    params.totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    "100",
    (params.metaValue > 0 ? (params.totalValue / params.metaValue) * 100 : 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 }),
    "",
    params.rows.reduce((sum, item) => sum + item.orderCount, 0),
    params.projectCount,
  ]);

  const csv = `\uFEFF${[header, ...dataRows].map((line) => line.map(escape).join(";")).join("\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
