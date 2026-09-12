import { buildCsvContent, downloadCsvFile } from "@/lib/utils/csv";

type ProjectOption = {
  id: string;
  label: string;
  serviceCenterId: string | null;
  serviceCenter: string;
};

type Option = {
  id: string;
  label: string;
};

type CategoryColumn = {
  categoryId: string;
  categoryName: string;
};

type CategorySummaryRow = {
  label: string;
  totalValue: number;
  categories: Record<string, { quantity: number; value: number } | undefined>;
};

type DashboardResponse = {
  message?: string;
  categoryColumns?: CategoryColumn[];
  categorySummaryRows?: CategorySummaryRow[];
};

type ProjectValueRow = {
  projectCode: string;
  serviceCenter: string;
  workCompletionStatusLabel: string;
  serviceTypeName: string;
  measurementValue: number;
  asbuiltValue: number;
  billingValue: number;
  asbuiltMeasurementDiff: number;
  billingAsbuiltDiff: number;
};

type ProjectValueTotals = {
  measurementValue: number;
  asbuiltValue: number;
  billingValue: number;
  asbuiltMeasurementDiff: number;
  billingAsbuiltDiff: number;
};

type ExportFilters = {
  serviceCenterId: string;
  activityCode: string;
  activityStatus: string;
  onlyDivergences: boolean;
  onlyMissing: boolean;
};

const EXPORT_BATCH_SIZE = 4;

function formatCsvCurrencyValue(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return safeValue.toFixed(2).replace(".", ",");
}

function filenameToken(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "todos";
}

async function fetchProjectCategorySummary(accessToken: string, project: ProjectOption, filters: ExportFilters) {
  const params = new URLSearchParams({ projectId: project.id });
  if (filters.serviceCenterId) params.set("serviceCenterId", filters.serviceCenterId);
  if (filters.activityCode.trim()) params.set("activityCode", filters.activityCode.trim());
  if (filters.activityStatus !== "TODAS") params.set("activityStatus", filters.activityStatus);
  if (filters.onlyDivergences) params.set("onlyDivergences", "true");
  if (filters.onlyMissing) params.set("onlyMissing", "true");

  const response = await fetch(`/api/dash-operacional-faturamento?${params.toString()}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = (await response.json().catch(() => ({}))) as DashboardResponse;
  if (!response.ok) {
    throw new Error(payload.message ?? `Falha ao carregar categorias do projeto ${project.label}.`);
  }

  return {
    project,
    categoryColumns: payload.categoryColumns ?? [],
    categorySummaryRows: payload.categorySummaryRows ?? [],
  };
}

export async function exportAllProjectCategorySummaryCsv(params: {
  accessToken: string;
  projects: ProjectOption[];
  serviceCenters: Option[];
  filters: ExportFilters;
}) {
  const targetProjects = params.projects.filter((project) => (
    !params.filters.serviceCenterId || project.serviceCenterId === params.filters.serviceCenterId
  ));
  if (!targetProjects.length) return { exported: false, message: "Nenhum projeto encontrado para exportar." };

  const columnMap = new Map<string, CategoryColumn>();
  const exportRows: Array<{ project: ProjectOption; row: CategorySummaryRow }> = [];
  for (let index = 0; index < targetProjects.length; index += EXPORT_BATCH_SIZE) {
    const batch = targetProjects.slice(index, index + EXPORT_BATCH_SIZE);
    const summaries = await Promise.all(batch.map((project) => fetchProjectCategorySummary(params.accessToken, project, params.filters)));
    for (const summary of summaries) {
      for (const column of summary.categoryColumns) columnMap.set(column.categoryId, column);
      for (const row of summary.categorySummaryRows) exportRows.push({ project: summary.project, row });
    }
  }

  const exportColumns = Array.from(columnMap.values()).sort((left, right) => left.categoryName.localeCompare(right.categoryName, "pt-BR"));
  if (!exportColumns.length || !exportRows.length) {
    return { exported: false, message: "Nenhuma categoria para exportar nos projetos filtrados." };
  }

  const serviceCenterName = params.serviceCenters.find((serviceCenter) => serviceCenter.id === params.filters.serviceCenterId)?.label ?? "todos";
  const headers = [
    "projeto",
    "centro_servico",
    "origem",
    ...exportColumns.map((category) => `${category.categoryName}_quantidade`),
    ...exportColumns.map((category) => `${category.categoryName}_valor`),
    "total_valor",
  ];
  const rows = exportRows.map(({ project, row }) => [
    project.label,
    project.serviceCenter,
    row.label,
    ...exportColumns.map((category) => row.categories[category.categoryId]?.quantity ?? 0),
    ...exportColumns.map((category) => formatCsvCurrencyValue(row.categories[category.categoryId]?.value ?? 0)),
    formatCsvCurrencyValue(row.totalValue),
  ]);

  downloadCsvFile(
    buildCsvContent(headers, rows),
    `dash_operacional_faturamento_todos_projetos_categorias_${filenameToken(serviceCenterName)}.csv`,
  );
  return { exported: true, message: "CSV de todos os projetos gerado." };
}

export function exportProjectValuesCsv(rows: ProjectValueRow[], totals: ProjectValueTotals) {
  if (!rows.length) return { exported: false, message: "Nenhum projeto para exportar." };

  downloadCsvFile(
    buildCsvContent(
      [
        "projeto",
        "centro_servico",
        "estado_trabalho",
        "tipo_servico",
        "medicao_valor",
        "asbuilt_valor",
        "faturamento_valor",
        "dif_valor_asbuilt_medicao",
        "dif_valor_faturamento_asbuilt",
      ],
      [
        ...rows.map((row) => [
          row.projectCode,
          row.serviceCenter,
          row.workCompletionStatusLabel,
          row.serviceTypeName || "Nao informado",
          formatCsvCurrencyValue(row.measurementValue),
          formatCsvCurrencyValue(row.asbuiltValue),
          formatCsvCurrencyValue(row.billingValue),
          formatCsvCurrencyValue(row.asbuiltMeasurementDiff),
          formatCsvCurrencyValue(row.billingAsbuiltDiff),
        ]),
        [
          "TOTAL",
          "",
          "",
          "",
          formatCsvCurrencyValue(totals.measurementValue),
          formatCsvCurrencyValue(totals.asbuiltValue),
          formatCsvCurrencyValue(totals.billingValue),
          formatCsvCurrencyValue(totals.asbuiltMeasurementDiff),
          formatCsvCurrencyValue(totals.billingAsbuiltDiff),
        ],
      ],
    ),
    "dash_operacional_faturamento_projetos_por_valor.csv",
  );
  return { exported: true, message: "CSV de projetos por valor gerado." };
}
