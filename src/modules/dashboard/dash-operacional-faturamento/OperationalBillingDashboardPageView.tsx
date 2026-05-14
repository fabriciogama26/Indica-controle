"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import styles from "./OperationalBillingDashboardPageView.module.css";

type Option = {
  id: string;
  label: string;
};

type ProjectOption = Option & {
  serviceCenterId: string | null;
  serviceCenter: string;
};

type OriginTotals = {
  quantity: number;
  value: number;
  itemCount: number;
};

type DashboardRow = {
  code: string;
  description: string;
  unit: string;
  activityStatus: "ATIVA" | "INATIVA" | "NAO_IDENTIFICADA";
  measurement: OriginTotals;
  asbuilt: OriginTotals;
  billing: OriginTotals;
  quantityDiffAsbuiltMeasurement: number;
  quantityDiffBillingMeasurement: number;
  valueDiffAsbuiltMeasurement: number;
  valueDiffBillingMeasurement: number;
  isMissingInAnyBase: boolean;
  isDivergent: boolean;
  situation: string;
};

type BillingCategoryRow = {
  categoryId: string;
  categoryName: string;
  quantity: number;
  value: number;
  itemCount: number;
  codes: string[];
};

type CategoryTotals = OriginTotals & {
  codes: string[];
};

type CategoryColumn = {
  categoryId: string;
  categoryName: string;
};

type CategorySummaryRow = {
  origin: "measurement" | "asbuilt" | "billing";
  label: string;
  totalQuantity: number;
  totalValue: number;
  categories: Record<string, CategoryTotals>;
};

type ChartItem = {
  key: string;
  label: string;
  value: number;
};

type Summary = {
  totalRows: number;
  divergentRows: number;
  missingRows: number;
  conferredRows: number;
  measurementValue: number;
  asbuiltValue: number;
  billingValue: number;
};

type DashboardResponse = {
  message?: string;
  filters?: {
    projects: ProjectOption[];
    serviceCenters: Option[];
  };
  selectedProject?: ProjectOption | null;
  rows?: DashboardRow[];
  billingCategories?: BillingCategoryRow[];
  categoryColumns?: CategoryColumn[];
  categorySummaryRows?: CategorySummaryRow[];
  chartItems?: ChartItem[];
  summary?: Summary | null;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(value) ? value : 0);
}

function csvValue(value: unknown) {
  const text = String(value ?? "");
  if (/[;\n"]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const content = rows.map((row) => row.map(csvValue).join(";")).join("\n");
  const blob = new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function filenameToken(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "sem_projeto";
}

export function OperationalBillingDashboardPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("dash-operacional-faturamento");
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [serviceCenters, setServiceCenters] = useState<Option[]>([]);
  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [categoryColumns, setCategoryColumns] = useState<CategoryColumn[]>([]);
  const [categorySummaryRows, setCategorySummaryRows] = useState<CategorySummaryRow[]>([]);
  const [chartItems, setChartItems] = useState<ChartItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [projectId, setProjectId] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [serviceCenterId, setServiceCenterId] = useState("");
  const [chartProjectId, setChartProjectId] = useState("");
  const [chartProjectSearch, setChartProjectSearch] = useState("");
  const [chartServiceCenterId, setChartServiceCenterId] = useState("");
  const [activityCode, setActivityCode] = useState("");
  const [activityStatus, setActivityStatus] = useState("TODAS");
  const [onlyDivergences, setOnlyDivergences] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isChartLoading, setIsChartLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const visibleProjects = useMemo(
    () => projects.filter((project) => !serviceCenterId || project.serviceCenterId === serviceCenterId),
    [projects, serviceCenterId],
  );

  const projectInputOptions = useMemo(
    () => (serviceCenterId ? visibleProjects : projects),
    [projects, serviceCenterId, visibleProjects],
  );

  const chartVisibleProjects = useMemo(
    () => projects.filter((project) => !chartServiceCenterId || project.serviceCenterId === chartServiceCenterId),
    [chartServiceCenterId, projects],
  );

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projectId, projects],
  );

  const chartMaxValue = useMemo(
    () => Math.max(1, ...chartItems.map((item) => Number(item.value) || 0)),
    [chartItems],
  );

  const loadMetadata = useCallback(async () => {
    if (!session?.accessToken) return;

    setIsLoading(true);
    try {
      const response = await fetch("/api/dash-operacional-faturamento", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const payload = (await response.json().catch(() => ({}))) as DashboardResponse;

      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao carregar filtros do Dash operacional e faturamento.");
      }

      setProjects(payload.filters?.projects ?? []);
      setServiceCenters(payload.filters?.serviceCenters ?? []);
      setRows([]);
      setCategoryColumns([]);
      setCategorySummaryRows([]);
      setChartItems([]);
      setSummary(null);
      setFeedback(null);
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar filtros do Dash operacional e faturamento." });
      await logError("Falha ao carregar filtros do Dash operacional e faturamento", error);
    } finally {
      setIsLoading(false);
    }
  }, [logError, session?.accessToken]);

  const loadDashboard = useCallback(async () => {
    if (!session?.accessToken) return;

    if (projectSearch.trim() && !projectId) {
      setFeedback({ type: "error", message: "Selecione um Projeto valido da lista para consultar." });
      return;
    }

    if (!projectId || !serviceCenterId) {
      setFeedback({ type: "error", message: "Selecione Centro de servico e Projeto para consultar." });
      return;
    }

    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    if (serviceCenterId) params.set("serviceCenterId", serviceCenterId);
    if (activityCode.trim()) params.set("activityCode", activityCode.trim());
    if (activityStatus !== "TODAS") params.set("activityStatus", activityStatus);
    if (onlyDivergences) params.set("onlyDivergences", "true");
    if (onlyMissing) params.set("onlyMissing", "true");

    setIsLoading(true);
    try {
      const response = await fetch(`/api/dash-operacional-faturamento?${params.toString()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const payload = (await response.json().catch(() => ({}))) as DashboardResponse;

      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao carregar Dash operacional e faturamento.");
      }

      setProjects(payload.filters?.projects ?? []);
      setServiceCenters(payload.filters?.serviceCenters ?? []);
      setRows(payload.rows ?? []);
      setCategoryColumns(payload.categoryColumns ?? []);
      setCategorySummaryRows(payload.categorySummaryRows ?? []);
      setSummary(payload.summary ?? null);
      setFeedback({ type: "success", message: "Comparativo atualizado." });
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar Dash operacional e faturamento." });
      await logError("Falha ao carregar Dash operacional e faturamento", error, {
        projectId,
        serviceCenterId,
        activityCode,
        activityStatus,
        onlyDivergences,
        onlyMissing,
      });
    } finally {
      setIsLoading(false);
    }
  }, [activityCode, activityStatus, logError, onlyDivergences, onlyMissing, projectId, projectSearch, serviceCenterId, session?.accessToken]);

  const loadChart = useCallback(async () => {
    if (!session?.accessToken) return;

    if (chartProjectSearch.trim() && !chartProjectId) {
      setFeedback({ type: "error", message: "Selecione um Projeto valido da lista para filtrar o grafico." });
      return;
    }

    const params = new URLSearchParams();
    params.set("includeChart", "true");
    if (chartServiceCenterId) params.set("chartServiceCenterId", chartServiceCenterId);
    if (chartProjectId) params.set("chartProjectId", chartProjectId);

    setIsChartLoading(true);
    try {
      const response = await fetch(`/api/dash-operacional-faturamento?${params.toString()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const payload = (await response.json().catch(() => ({}))) as DashboardResponse;

      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao carregar grafico operacional.");
      }

      setProjects(payload.filters?.projects ?? []);
      setServiceCenters(payload.filters?.serviceCenters ?? []);
      setChartItems(payload.chartItems ?? []);
      setFeedback({ type: "success", message: "Grafico atualizado." });
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar grafico operacional." });
      await logError("Falha ao carregar grafico operacional", error, {
        chartProjectId,
        chartServiceCenterId,
      });
    } finally {
      setIsChartLoading(false);
    }
  }, [chartProjectId, chartProjectSearch, chartServiceCenterId, logError, session?.accessToken]);

  useEffect(() => {
    void loadMetadata();
  }, [loadMetadata]);

  function handleServiceCenterChange(value: string) {
    setServiceCenterId(value);
    const currentProject = projects.find((project) => project.id === projectId);
    if (currentProject && value && currentProject.serviceCenterId !== value) {
      setProjectId("");
      setProjectSearch("");
      setRows([]);
      setCategoryColumns([]);
      setCategorySummaryRows([]);
      setSummary(null);
    }
  }

  function handleProjectSearchChange(value: string) {
    const searchValue = value;
    const matchedProject = projects.find((project) => project.label.toLowerCase() === searchValue.trim().toLowerCase()) ?? null;

    setProjectSearch(searchValue);
    setProjectId(matchedProject?.id ?? "");
    if (matchedProject?.serviceCenterId) {
      setServiceCenterId(matchedProject.serviceCenterId);
    }
  }

  function handleChartServiceCenterChange(value: string) {
    setChartServiceCenterId(value);
    const currentProject = projects.find((project) => project.id === chartProjectId);
    if (currentProject && value && currentProject.serviceCenterId !== value) {
      setChartProjectId("");
      setChartProjectSearch("");
    }
  }

  function handleChartProjectSearchChange(value: string) {
    const matchedProject = projects.find((project) => project.label.toLowerCase() === value.trim().toLowerCase()) ?? null;
    setChartProjectSearch(value);
    setChartProjectId(matchedProject?.id ?? "");
    if (matchedProject?.serviceCenterId) {
      setChartServiceCenterId(matchedProject.serviceCenterId);
    }
  }

  function exportRows() {
    if (!rows.length) {
      setFeedback({ type: "error", message: "Nenhum registro para exportar." });
      return;
    }

    const projectCode = selectedProject?.label ?? "";
    const serviceCenterName = selectedProject?.serviceCenter ?? "";

    downloadCsv(`dash_operacional_faturamento_${filenameToken(projectCode)}.csv`, [
      [
        "projeto",
        "centro_servico",
        "codigo",
        "descricao",
        "unidade",
        "status_atividade",
        "medicao_quantidade",
        "medicao_valor",
        "asbuilt_quantidade",
        "asbuilt_valor",
        "faturamento_quantidade",
        "faturamento_valor",
        "dif_qtd_asbuilt_medicao",
        "dif_qtd_faturamento_medicao",
        "dif_valor_asbuilt_medicao",
        "dif_valor_faturamento_medicao",
        "situacao",
      ],
      ...rows.map((row) => [
        projectCode,
        serviceCenterName,
        row.code,
        row.description,
        row.unit,
        row.activityStatus,
        row.measurement.quantity,
        formatCurrency(row.measurement.value),
        row.asbuilt.quantity,
        formatCurrency(row.asbuilt.value),
        row.billing.quantity,
        formatCurrency(row.billing.value),
        row.quantityDiffAsbuiltMeasurement,
        row.quantityDiffBillingMeasurement,
        formatCurrency(row.valueDiffAsbuiltMeasurement),
        formatCurrency(row.valueDiffBillingMeasurement),
        row.situation,
      ]),
    ]);
  }

  function exportCategorySummary() {
    if (!categoryColumns.length || !categorySummaryRows.length) {
      setFeedback({ type: "error", message: "Nenhuma categoria para exportar." });
      return;
    }

    const projectCode = selectedProject?.label ?? "";
    const serviceCenterName = selectedProject?.serviceCenter ?? "";

    downloadCsv(`dash_operacional_faturamento_categorias_${filenameToken(projectCode)}.csv`, [
      [
        "projeto",
        "centro_servico",
        "origem",
        ...categoryColumns.map((category) => `${category.categoryName}_quantidade`),
        ...categoryColumns.map((category) => `${category.categoryName}_valor`),
        "total_valor",
      ],
      ...categorySummaryRows.map((row) => [
        projectCode,
        serviceCenterName,
        row.label,
        ...categoryColumns.map((category) => row.categories[category.categoryId]?.quantity ?? 0),
        ...categoryColumns.map((category) => formatCurrency(row.categories[category.categoryId]?.value ?? 0)),
        formatCurrency(row.totalValue),
      ]),
    ]);
  }

  return (
    <section className={styles.wrapper}>
      {feedback ? (
        <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>
          {feedback.message}
        </div>
      ) : null}

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Filtros</h2>
            <p className={styles.cardSubtitle}>Comparativo por projeto entre Medicao, Medicao Asbuilt e Faturamento.</p>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.primaryButton} onClick={() => void loadDashboard()} disabled={isLoading}>
              {isLoading ? "Filtrando..." : "Filtrar"}
            </button>
          </div>
        </div>

        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span>Centro de servico *</span>
            <select value={serviceCenterId} onChange={(event) => handleServiceCenterChange(event.target.value)} disabled={isLoading}>
              <option value="">Selecione</option>
              {serviceCenters.map((serviceCenter) => (
                <option key={serviceCenter.id} value={serviceCenter.id}>
                  {serviceCenter.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Projeto *</span>
            <input
              list="operational-billing-projects"
              value={projectSearch}
              onChange={(event) => handleProjectSearchChange(event.target.value)}
              placeholder="Digite o SOB do projeto"
              disabled={isLoading}
            />
            <datalist id="operational-billing-projects">
              {projectInputOptions.map((project) => (
                <option key={project.id} value={project.label}>
                  {project.serviceCenter}
                </option>
              ))}
            </datalist>
          </label>

          <label className={styles.field}>
            <span>Codigo de atividade</span>
            <input
              type="text"
              value={activityCode}
              onChange={(event) => setActivityCode(event.target.value)}
              placeholder="Ex.: A001"
              disabled={isLoading}
            />
          </label>

          <label className={styles.field}>
            <span>Atividade ativa/inativa</span>
            <select value={activityStatus} onChange={(event) => setActivityStatus(event.target.value)} disabled={isLoading}>
              <option value="TODAS">Todas</option>
              <option value="ATIVA">Ativas</option>
              <option value="INATIVA">Inativas</option>
            </select>
          </label>

          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={onlyDivergences}
              onChange={(event) => setOnlyDivergences(event.target.checked)}
              disabled={isLoading}
            />
            <span>Mostrar somente divergencias</span>
          </label>

          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={onlyMissing}
              onChange={(event) => setOnlyMissing(event.target.checked)}
              disabled={isLoading}
            />
            <span>Mostrar somente codigos ausentes em alguma base</span>
          </label>
        </div>
      </article>

      <div className={styles.summaryGrid}>
        <div className={styles.metric}>
          <span>Codigos</span>
          <strong>{summary?.totalRows ?? 0}</strong>
        </div>
        <div className={styles.metric}>
          <span>Divergentes</span>
          <strong>{summary?.divergentRows ?? 0}</strong>
        </div>
        <div className={styles.metric}>
          <span>Ausentes</span>
          <strong>{summary?.missingRows ?? 0}</strong>
        </div>
        <div className={styles.metric}>
          <span>Conferidos</span>
          <strong>{summary?.conferredRows ?? 0}</strong>
        </div>
      </div>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Grafico operacional</h2>
            <p className={styles.cardSubtitle}>Comparativo independente entre total medido, medido em projetos com As Built, As Built e faturado.</p>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.primaryButton} onClick={() => void loadChart()} disabled={isChartLoading}>
              {isChartLoading ? "Filtrando..." : "Filtrar grafico"}
            </button>
          </div>
        </div>

        <div className={styles.chartFilterGrid}>
          <label className={styles.field}>
            <span>Centro de servico</span>
            <select value={chartServiceCenterId} onChange={(event) => handleChartServiceCenterChange(event.target.value)} disabled={isChartLoading}>
              <option value="">Todos</option>
              {serviceCenters.map((serviceCenter) => (
                <option key={serviceCenter.id} value={serviceCenter.id}>
                  {serviceCenter.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Projeto</span>
            <input
              list="operational-billing-chart-projects"
              value={chartProjectSearch}
              onChange={(event) => handleChartProjectSearchChange(event.target.value)}
              placeholder="Todos ou digite o SOB"
              disabled={isChartLoading}
            />
            <datalist id="operational-billing-chart-projects">
              {chartVisibleProjects.map((project) => (
                <option key={project.id} value={project.label}>
                  {project.serviceCenter}
                </option>
              ))}
            </datalist>
          </label>
        </div>

        <div className={styles.barChart}>
          {chartItems.length ? (
            chartItems.map((item) => {
              const height = Math.max(4, (item.value / chartMaxValue) * 100);
              return (
                <div key={item.key} className={styles.barGroup}>
                  <div className={styles.barValue}>{formatCurrency(item.value)}</div>
                  <div className={styles.barTrack}>
                    <div className={styles.barFill} style={{ height: `${height}%` }} />
                  </div>
                  <strong>{item.label}</strong>
                </div>
              );
            })
          ) : (
            <div className={styles.emptyChart}>
              {isChartLoading ? "Carregando grafico..." : "Use o filtro proprio do grafico e clique em Filtrar grafico."}
            </div>
          )}
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Codigos por origem</h2>
            <p className={styles.cardSubtitle}>
              {selectedProject ? `${selectedProject.label} | ${selectedProject.serviceCenter}` : "Selecione Centro de servico e Projeto."}
            </p>
          </div>
          <div className={styles.tableActions}>
            <button type="button" className={styles.secondaryButton} onClick={exportRows} disabled={isLoading}>
              Exportar CSV
            </button>
          </div>
        </div>

        <div className={styles.valueCardGrid}>
          <div className={styles.valueCard}>
            <span>Medicao</span>
            <strong>{formatCurrency(summary?.measurementValue ?? 0)}</strong>
          </div>
          <div className={styles.valueCard}>
            <span>Asbuilt</span>
            <strong>{formatCurrency(summary?.asbuiltValue ?? 0)}</strong>
          </div>
          <div className={styles.valueCard}>
            <span>Faturamento</span>
            <strong>{formatCurrency(summary?.billingValue ?? 0)}</strong>
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Descricao</th>
                <th>Status atividade</th>
                <th>Medicao qtd.</th>
                <th>Medicao valor</th>
                <th>Asbuilt qtd.</th>
                <th>Asbuilt valor</th>
                <th>Faturamento qtd.</th>
                <th>Faturamento valor</th>
                <th>Dif. qtd. Asbuilt x Medicao</th>
                <th>Dif. qtd. Fat. x Medicao</th>
                <th>Dif. valor Asbuilt x Medicao</th>
                <th>Dif. valor Fat. x Medicao</th>
                <th>Situacao</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row) => (
                  <tr key={row.code}>
                    <td><strong>{row.code}</strong></td>
                    <td>{row.description || "Nao informado"}</td>
                    <td>
                      <span className={row.activityStatus === "INATIVA" ? styles.statusInactive : styles.statusActive}>
                        {row.activityStatus === "NAO_IDENTIFICADA" ? "Nao identificada" : row.activityStatus === "ATIVA" ? "Ativa" : "Inativa"}
                      </span>
                    </td>
                    <td>{formatNumber(row.measurement.quantity)}</td>
                    <td>{formatCurrency(row.measurement.value)}</td>
                    <td>{formatNumber(row.asbuilt.quantity)}</td>
                    <td>{formatCurrency(row.asbuilt.value)}</td>
                    <td>{formatNumber(row.billing.quantity)}</td>
                    <td>{formatCurrency(row.billing.value)}</td>
                    <td>{formatNumber(row.quantityDiffAsbuiltMeasurement)}</td>
                    <td>{formatNumber(row.quantityDiffBillingMeasurement)}</td>
                    <td>{formatCurrency(row.valueDiffAsbuiltMeasurement)}</td>
                    <td>{formatCurrency(row.valueDiffBillingMeasurement)}</td>
                    <td>
                      <span className={row.isMissingInAnyBase ? styles.statusMissing : row.isDivergent ? styles.statusDivergent : styles.statusOk}>
                        {row.situation}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={14} className={styles.emptyRow}>
                    {isLoading ? "Carregando comparativo..." : "Nenhum codigo encontrado para os filtros selecionados."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Resumo por categoria</h2>
            <p className={styles.cardSubtitle}>
              Quantidade e valor por categoria dos codigos do projeto selecionado.
            </p>
          </div>
          <div className={styles.tableActions}>
            <button type="button" className={styles.secondaryButton} onClick={exportCategorySummary} disabled={isLoading}>
              Exportar CSV
            </button>
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.categoryTable}>
            <thead>
              <tr>
                <th>Origem</th>
                {categoryColumns.map((category) => (
                  <th key={category.categoryId}>{category.categoryName}</th>
                ))}
                <th>Total valor</th>
              </tr>
            </thead>
            <tbody>
              {categoryColumns.length ? (
                categorySummaryRows.map((row) => (
                  <tr key={row.origin}>
                    <td><strong>{row.label}</strong></td>
                    {categoryColumns.map((category) => {
                      const totals = row.categories[category.categoryId];
                      return (
                        <td key={`${row.origin}-${category.categoryId}`}>
                          {totals && totals.itemCount > 0 ? (
                            <div className={styles.categoryCell}>
                              <strong>{formatNumber(totals.quantity)}</strong>
                              <span>{formatCurrency(totals.value)}</span>
                            </div>
                          ) : "-"}
                        </td>
                      );
                    })}
                    <td>{formatCurrency(row.totalValue)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className={styles.emptyRow}>
                    {isLoading ? "Carregando categorias..." : "Nenhuma categoria encontrada para os filtros selecionados."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
