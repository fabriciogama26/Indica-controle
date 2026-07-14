"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useAuth } from "@/hooks/useAuth";
import { CsvExportButton } from "@/components/ui/CsvExportButton";
import { ExportProgressModal } from "@/components/ui/ExportProgressModal";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { buildCsvContent, downloadCsvFile } from "@/lib/utils/csv";
import styles from "./DashboardMeasurementPageView.module.css";

type Option = {
  id: string;
  label: string;
};

type CycleOption = {
  cycleStart: string;
  cycleEnd: string;
  label: string;
};

type CompletionChartItem = {
  label: string;
  value: number;
  orders: number;
  projectCount: number;
  projects: ProjectProductionDetail[];
  percentage: number;
};

type CycleComparison = {
  label: string;
  value: number;
  meta: number;
  standardMeta: number;
  workedMeta: number;
  workdays: number;
  defaultWorkdays: number;
  workedDays: number;
  orderCount: number;
  projectCount: number;
  averageTicketValue: number;
  averageServiceTicketValue: number;
  executedWorkdays: number;
  averageDailyValue: number;
  workedObjectiveValue: number;
  objectiveDailyValue: number;
  targetDailyValue: number;
  forecastValue: number;
  forecastPercentage: number;
  forecastDifference: number;
  percentage: number;
};

type AnnualCycleComparison = {
  cycleStart: string;
  cycleEnd: string;
  label: string;
  measuredValue: number;
  forecastValue: number;
  metaValue: number;
  measuredPercentage: number;
  forecastPercentage: number;
  measuredDifference: number;
  forecastDifference: number;
  executedWorkdays: number;
  workdays: number;
  orderCount: number;
  projectCount: number;
  teamCount: number;
  hasMeta: boolean;
};

type PeriodSummary = {
  realizedValue: number;
  orderCount: number;
  projectCount: number;
  averageTicketValue: number;
  averageServiceTicketValue: number;
};

type CompletionTableTotals = {
  value: number;
  orders: number;
  projectCount: number;
};

type ProjectProductionDetail = {
  projectId: string;
  projectCode: string;
  serviceCenter: string;
  totalValue: number;
  orderCount: number;
};

type DashboardResponse = {
  message?: string;
  cycles?: CycleOption[];
  periods?: Option[];
  selectedPeriod?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  selectedCycleStart?: string | null;
  filters?: {
    projects: Option[];
  };
  completionChart?: CompletionChartItem[];
  cycleCompletionChart?: CompletionChartItem[];
  periodCompletionChart?: CompletionChartItem[];
  periodSummary?: PeriodSummary | null;
  cycleComparison?: CycleComparison | null;
  annualYear?: number;
  annualCycleComparison?: AnnualCycleComparison[];
};

type ExpandedChart = "completionCycle" | "completionPeriod" | "cycle" | "annual" | null;
type MetaMode = "cycle" | "standard" | "worked";

type ProjectDetailModal = {
  title: string;
  subtitle: string;
  rows: ProjectProductionDetail[];
  filename: string;
} | null;

const metaLabels: Record<MetaMode, string> = {
  cycle: "Meta ciclo",
  standard: "Meta ciclo padrao",
  worked: "Meta ciclo trabalhado",
};

const metaDayLabels: Record<MetaMode, string> = {
  cycle: "Dias uteis",
  standard: "Dias padrao",
  worked: "Dias reais",
};

const metaColors: Record<MetaMode | "value", string> = {
  value: "#4b77c7",
  cycle: "#f07f2f",
  standard: "#17a884",
  worked: "#7b61ff",
};

const completionChartColors: Record<string, string> = {
  Concluidos: "#4b77c7",
  Parciais: "#f07f2f",
  "Parcial planejado beneficio atingido": "#17a884",
  Pendencias: "#e25555",
  "Garantia de faturamento minimo": "#7b61ff",
};

function formatCurrency(value: number, compact = false) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatCompactCurrency(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const sign = safeValue < 0 ? "- " : "";
  const absoluteValue = Math.abs(safeValue);
  const numberFormat = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: absoluteValue >= 1_000_000 ? 2 : 1,
  });

  if (absoluteValue >= 1_000_000) {
    return `${sign}R$ ${numberFormat.format(absoluteValue / 1_000_000)} mi`;
  }

  if (absoluteValue >= 1_000) {
    return `${sign}R$ ${numberFormat.format(absoluteValue / 1_000)} mil`;
  }

  return `${sign}${formatCurrency(absoluteValue)}`;
}

function formatPercent(value: number) {
  return `${(Number.isFinite(value) ? value : 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })}%`;
}

function formatPercentOneDecimal(value: number) {
  return `${(Number.isFinite(value) ? value : 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function maxValue(values: number[]) {
  return Math.max(1, ...values.map((value) => Number(value) || 0));
}

function filenameToken(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "detalhe";
}

function todayToken() {
  return new Date().toISOString().slice(0, 10);
}

function formatDatePtBr(value: string | null | undefined) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function formatCycleAxisLabel(value: string) {
  const [year, month] = value.split("-");
  const monthIndex = Number(month) - 1;
  const monthLabels = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  if (!year || monthIndex < 0 || monthIndex > 11) return value;
  return `${monthLabels[monthIndex]}/${year.slice(2)}`;
}

function getCurrentYearPeriod() {
  const year = new Date().getFullYear();
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  };
}

function getCurrentYear() {
  return new Date().getFullYear();
}

function resolveCycleMetaValue(cycle: CycleComparison, mode: MetaMode) {
  if (mode === "standard") return cycle.standardMeta;
  if (mode === "worked") return cycle.workedMeta;
  return cycle.meta;
}

function resolveCycleDays(cycle: CycleComparison, mode: MetaMode) {
  if (mode === "standard") return cycle.defaultWorkdays;
  if (mode === "worked") return cycle.workedDays;
  return cycle.workdays;
}

function resolveCycleForecastValue(cycle: CycleComparison, mode: MetaMode) {
  return cycle.averageDailyValue * resolveCycleDays(cycle, mode);
}

function resolveCycleForecastDifference(cycle: CycleComparison, mode: MetaMode) {
  return resolveCycleForecastValue(cycle, mode) - resolveCycleMetaValue(cycle, mode);
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4H4v4M4 4l6 6M16 4h4v4M20 4l-6 6M8 20H4v-4M4 20l6-6M16 20h4v-4M20 20l-6-6" />
    </svg>
  );
}

export function DashboardMeasurementPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("dashboard_medicao");
  const [cycles, setCycles] = useState<CycleOption[]>([]);
  const [projects, setProjects] = useState<Option[]>([]);
  const [startDate, setStartDate] = useState(() => getCurrentYearPeriod().start);
  const [endDate, setEndDate] = useState(() => getCurrentYearPeriod().end);
  const [periodStartDraft, setPeriodStartDraft] = useState(() => getCurrentYearPeriod().start);
  const [periodEndDraft, setPeriodEndDraft] = useState(() => getCurrentYearPeriod().end);
  const [selectedCycleStart, setSelectedCycleStart] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [completionStatus, setCompletionStatus] = useState("TODOS");
  const [annualYear, setAnnualYear] = useState(() => getCurrentYear());
  const [cycleDraft, setCycleDraft] = useState("");
  const [projectSearchDraft, setProjectSearchDraft] = useState("");
  const [completionStatusDraft, setCompletionStatusDraft] = useState("TODOS");
  const [annualYearDraft, setAnnualYearDraft] = useState(() => getCurrentYear());
  const [cycleMetaMode, setCycleMetaMode] = useState<MetaMode>("cycle");
  const [expandedChart, setExpandedChart] = useState<ExpandedChart>(null);
  const [cycleCompletionChart, setCycleCompletionChart] = useState<CompletionChartItem[]>([]);
  const [periodCompletionChart, setPeriodCompletionChart] = useState<CompletionChartItem[]>([]);
  const [periodSummary, setPeriodSummary] = useState<PeriodSummary | null>(null);
  const [cycleComparison, setCycleComparison] = useState<CycleComparison | null>(null);
  const [annualCycleComparison, setAnnualCycleComparison] = useState<AnnualCycleComparison[]>([]);
  const [annualTooltipIndex, setAnnualTooltipIndex] = useState<number | null>(null);
  const [projectDetailModal, setProjectDetailModal] = useState<ProjectDetailModal>(null);
  const [isExportingProjectDetails, setIsExportingProjectDetails] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const suppressNextAutoLoadRef = useRef(false);

  const loadDashboard = useCallback(async () => {
    if (!session?.accessToken) return;

    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (selectedCycleStart) params.set("cycleStart", selectedCycleStart);
    params.set("year", String(annualYear));
    if (projectSearch.trim()) params.set("project", projectSearch.trim());
    if (completionStatus !== "TODOS") params.set("completionStatus", completionStatus);

    setIsLoading(true);
    try {
      const response = await fetch(`/api/dashboard-medicao?${params.toString()}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });
      const data = (await response.json().catch(() => ({}))) as DashboardResponse;

      if (!response.ok) {
        await logError("Falha ao carregar Dashboard Medicao", new Error(data.message ?? `HTTP ${response.status}`), {
          status: response.status,
          cycleStart: selectedCycleStart || null,
        });
        setFeedback({ type: "error", message: data.message ?? "Falha ao carregar Dashboard Medicao." });
        return;
      }

      setCycles(data.cycles ?? []);
      setProjects(data.filters?.projects ?? []);
      setCycleCompletionChart(data.cycleCompletionChart ?? []);
      setPeriodCompletionChart(data.periodCompletionChart ?? data.completionChart ?? []);
      setPeriodSummary(data.periodSummary ?? null);
      setCycleComparison(data.cycleComparison ?? null);
      setAnnualCycleComparison(data.annualCycleComparison ?? []);
      if (data.annualYear) {
        setAnnualYear(data.annualYear);
        setAnnualYearDraft(data.annualYear);
      }
      const nextStartDate = data.startDate || "";
      const nextEndDate = data.endDate || "";
      const nextSelectedCycleStart = data.selectedCycleStart || "";
      if ((!startDate && nextStartDate) || (!endDate && nextEndDate) || (!selectedCycleStart && nextSelectedCycleStart)) {
        suppressNextAutoLoadRef.current = true;
      }
      setStartDate((current) => current || nextStartDate);
      setEndDate((current) => current || nextEndDate);
      setPeriodStartDraft((current) => current || nextStartDate);
      setPeriodEndDraft((current) => current || nextEndDate);
      setSelectedCycleStart((current) => current || nextSelectedCycleStart);
      setFeedback(null);
    } catch (error) {
      await logError("Falha ao carregar Dashboard Medicao", error, {
        cycleStart: selectedCycleStart || null,
      });
      setFeedback({ type: "error", message: "Falha ao carregar Dashboard Medicao." });
    } finally {
      setIsLoading(false);
    }
  }, [annualYear, completionStatus, endDate, logError, projectSearch, selectedCycleStart, session?.accessToken, startDate]);

  useEffect(() => {
    if (suppressNextAutoLoadRef.current) {
      suppressNextAutoLoadRef.current = false;
      return;
    }
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    setCycleDraft(selectedCycleStart);
  }, [selectedCycleStart]);

  useEffect(() => {
    setAnnualYearDraft(annualYear);
  }, [annualYear]);

  const cycleMax = useMemo(
    () => maxValue([
      cycleComparison?.value ?? 0,
      cycleComparison && cycleMetaMode !== "worked" ? resolveCycleForecastValue(cycleComparison, cycleMetaMode) : 0,
      cycleComparison ? resolveCycleMetaValue(cycleComparison, cycleMetaMode) : 0,
    ]),
    [cycleComparison, cycleMetaMode],
  );
  const visibleAnnualCycleComparison = useMemo(
    () => annualCycleComparison.filter((item) => (
      item.metaValue > 0
      || item.forecastValue > 0
      || item.measuredValue > 0
      || item.orderCount > 0
      || item.projectCount > 0
    )),
    [annualCycleComparison],
  );
  const annualTotals = useMemo(() => {
    const metaValue = visibleAnnualCycleComparison.reduce((sum, item) => sum + item.metaValue, 0);
    const forecastValue = visibleAnnualCycleComparison.reduce((sum, item) => sum + item.forecastValue, 0);
    const measuredValue = visibleAnnualCycleComparison.reduce((sum, item) => sum + item.measuredValue, 0);
    return {
      metaValue,
      forecastValue,
      measuredValue,
      attainment: metaValue > 0 ? (measuredValue / metaValue) * 100 : 0,
    };
  }, [visibleAnnualCycleComparison]);
  const selectedCycleLabel = cycleComparison?.label ?? "Ciclo selecionado";

  function openChart(chart: Exclude<ExpandedChart, null>) {
    setExpandedChart(chart);
  }

  function applyDashboardFilters() {
    const nextProjectSearch = projectSearchDraft.trim();
    const filtersAreApplied =
      selectedCycleStart === cycleDraft &&
      projectSearch === nextProjectSearch &&
      completionStatus === completionStatusDraft;

    if (filtersAreApplied) {
      void loadDashboard();
      return;
    }

    setSelectedCycleStart(cycleDraft);
    setProjectSearch(nextProjectSearch);
    setProjectSearchDraft(nextProjectSearch);
    setCompletionStatus(completionStatusDraft);
  }

  function applyAnnualYearFilter() {
    if (annualYear === annualYearDraft) {
      void loadDashboard();
      return;
    }

    setAnnualYear(annualYearDraft);
  }

  function applyPeriodFilter() {
    if (periodStartDraft === startDate && periodEndDraft === endDate) {
      void loadDashboard();
      return;
    }
    setStartDate(periodStartDraft);
    setEndDate(periodEndDraft);
  }

  function openCompletionProjectDetails(row: CompletionChartItem, subtitle: string, filenamePrefix: string) {
    setProjectDetailModal({
      title: `Projetos - ${row.label}`,
      subtitle,
      rows: row.projects,
      filename: `${filenamePrefix}_${filenameToken(row.label)}_${todayToken()}.csv`,
    });
  }

  function handleProjectDetailRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, callback: () => void) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      callback();
    }
  }

  async function exportProjectDetailsCsv() {
    if (!projectDetailModal?.rows.length) {
      setFeedback({ type: "error", message: "Nenhum projeto encontrado para exportar." });
      return;
    }

    setIsExportingProjectDetails(true);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    try {
      const header = ["Projeto", "Centro", "Valor cobrado", "Ordens"];
      const rows = projectDetailModal.rows.map((item) => [
        item.projectCode,
        item.serviceCenter,
        item.totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        item.orderCount,
      ]);
      const csv = buildCsvContent(header, rows);
      downloadCsvFile(csv, projectDetailModal.filename);
    } finally {
      setIsExportingProjectDetails(false);
    }
  }

  function renderExpandButton(chart: Exclude<ExpandedChart, null>, title: string) {
    return (
      <button type="button" className={styles.expandButton} onClick={() => openChart(chart)} aria-label={`Ampliar ${title}`} title={`Ampliar ${title}`}>
        <ExpandIcon />
      </button>
    );
  }

  function renderCompletionTable(
    items: CompletionChartItem[],
    subtitle: string,
    filenamePrefix: string,
    totals?: CompletionTableTotals | null,
  ) {
    return (
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Status</th>
              <th>Valor</th>
              <th>Ordens</th>
              <th>Projetos</th>
              <th>%Valor</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.label}
                className={styles.clickableRow}
                role="button"
                tabIndex={0}
                title={`Ver projetos de ${item.label}`}
                onClick={() => openCompletionProjectDetails(item, subtitle, filenamePrefix)}
                onKeyDown={(event) => handleProjectDetailRowKeyDown(event, () => openCompletionProjectDetails(item, subtitle, filenamePrefix))}
              >
                <td>{item.label}</td>
                <td>{formatCurrency(item.value)}</td>
                <td>{item.orders}</td>
                <td>{item.projectCount}</td>
                <td>{formatPercent(item.percentage)}</td>
              </tr>
            ))}
          </tbody>
          {totals ? (
            <tfoot>
              <tr>
                <td>Total</td>
                <td>{formatCurrency(totals.value)}</td>
                <td>{totals.orders}</td>
                <td>{totals.projectCount}</td>
                <td>{formatPercent(totals.value > 0 ? 100 : 0)}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    );
  }

  function renderCompletionChart(items: CompletionChartItem[], isExpanded = false) {
    const completionMax = maxValue(items.map((item) => item.value));
    return (
      <div className={`${styles.dualChart} ${isExpanded ? styles.chartExpanded : ""}`}>
        {items.map((item) => (
          <div key={item.label} className={styles.verticalBarGroup}>
            <div className={styles.valueLabel}>{formatCurrency(item.value)}</div>
            <div className={isExpanded ? styles.verticalBarTrackExpanded : styles.verticalBarTrack}>
              <div
                className={styles.dynamicBar}
                style={{
                  background: completionChartColors[item.label] ?? metaColors.value,
                  height: `${Math.max(4, (item.value / completionMax) * 100)}%`,
                }}
              />
            </div>
            <strong>{item.label}</strong>
          </div>
        ))}
      </div>
    );
  }

  function renderCycleChart(isExpanded = false) {
    if (!cycleComparison) return null;
    const metaValue = resolveCycleMetaValue(cycleComparison, cycleMetaMode);
    const forecastValue = resolveCycleForecastValue(cycleComparison, cycleMetaMode);
    const showForecast = cycleMetaMode !== "worked";
    return (
      <div className={`${styles.dualChart} ${isExpanded ? styles.chartExpanded : ""}`}>
        <div className={styles.verticalBarGroup}>
          <div className={styles.valueLabel}>{formatCurrency(cycleComparison.value)}</div>
          <div className={isExpanded ? styles.verticalBarTrackExpanded : styles.verticalBarTrack}>
            <div className={styles.barBlue} style={{ height: `${Math.max(4, (cycleComparison.value / cycleMax) * 100)}%` }} />
          </div>
          <strong>Valor</strong>
        </div>
        {showForecast ? (
          <div className={styles.verticalBarGroup}>
            <div className={styles.valueLabel}>{formatCurrency(forecastValue)}</div>
            <div className={isExpanded ? styles.verticalBarTrackExpanded : styles.verticalBarTrack}>
              <div className={styles.barGreen} style={{ height: `${Math.max(4, (forecastValue / cycleMax) * 100)}%` }} />
            </div>
            <strong>Projecao de fechamento</strong>
          </div>
        ) : null}
        <div className={styles.verticalBarGroup}>
          <div className={styles.valueLabel}>{formatCurrency(metaValue)}</div>
          <div className={isExpanded ? styles.verticalBarTrackExpanded : styles.verticalBarTrack}>
            <div className={styles.barOrange} style={{ height: `${Math.max(4, (metaValue / cycleMax) * 100)}%` }} />
          </div>
          <strong>{metaLabels[cycleMetaMode]}</strong>
        </div>
      </div>
    );
  }

  function renderAnnualCycleChart(isExpanded = false) {
    const chartData = visibleAnnualCycleComparison;
    if (!chartData.length) {
      return <div className={styles.emptyChart}>Nenhum ciclo encontrado para o ano selecionado.</div>;
    }

    const annualMax = maxValue(chartData.flatMap((item) => [
      item.measuredValue,
      item.forecastValue,
      item.metaValue,
    ]));
    const chartWidth = Math.max(760, chartData.length * 102);
    const chartHeight = isExpanded ? 500 : 330;
    const margin = { top: 34, right: 34, bottom: 54, left: 48 };
    const plotWidth = chartWidth - margin.left - margin.right;
    const plotHeight = chartHeight - margin.top - margin.bottom;
    const step = chartData.length > 1 ? plotWidth / (chartData.length - 1) : plotWidth;
    const barWidth = 30;
    const hoveredItem = annualTooltipIndex !== null ? chartData[annualTooltipIndex] : null;
    const xAt = (index: number) => (chartData.length > 1 ? margin.left + (step * index) : margin.left + (plotWidth / 2));
    const yAt = (value: number) => margin.top + plotHeight - ((Number(value) || 0) / annualMax) * plotHeight;
    const linePath = (key: "metaValue" | "forecastValue") => chartData
      .map((item, index) => `${index === 0 ? "M" : "L"} ${xAt(index)} ${yAt(item[key])}`)
      .join(" ");
    const tooltipLeft = hoveredItem && annualTooltipIndex !== null
      ? Math.min(Math.max(xAt(annualTooltipIndex), 120), chartWidth - 120)
      : 0;

    return (
      <div className={styles.annualChartScroller}>
        <div
          className={`${styles.annualChart} ${isExpanded ? styles.annualChartExpanded : ""}`}
          style={{ width: chartWidth }}
          onMouseLeave={() => setAnnualTooltipIndex(null)}
        >
          {hoveredItem ? (
            <div
              className={styles.annualTooltip}
              style={{ left: tooltipLeft, top: 8 }}
            >
              <strong>Ciclo {formatDatePtBr(hoveredItem.cycleStart)} a {formatDatePtBr(hoveredItem.cycleEnd)}</strong>
              <span>Meta: {formatCompactCurrency(hoveredItem.metaValue)}</span>
              <span>Previsao: {formatCompactCurrency(hoveredItem.forecastValue)}</span>
              <span>Medicao: {formatCompactCurrency(hoveredItem.measuredValue)}</span>
              <span>Atingimento: {formatPercentOneDecimal(hoveredItem.measuredPercentage)}</span>
            </div>
          ) : null}
          <svg
            className={styles.annualSvg}
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            role="img"
            aria-label="Grafico anual combinado de Meta ciclo, Previsao e Medicao"
          >
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = margin.top + plotHeight - (plotHeight * ratio);
              return (
                <line
                  key={ratio}
                  x1={margin.left}
                  x2={chartWidth - margin.right}
                  y1={y}
                  y2={y}
                  className={styles.annualGridLine}
                />
              );
            })}
            {chartData.map((item, index) => {
              const barHeight = item.measuredValue > 0 ? Math.max(4, margin.top + plotHeight - yAt(item.measuredValue)) : 0;
              const showMeasurementLabel = item.measuredValue > 0;
              return (
                <g key={item.cycleStart}>
                  <rect
                    x={xAt(index) - (barWidth / 2)}
                    y={margin.top + plotHeight - barHeight}
                    width={barWidth}
                    height={barHeight}
                    rx="4"
                    className={styles.annualMeasurementBar}
                  />
                  {showMeasurementLabel ? (
                    <text
                      x={xAt(index)}
                      y={Math.max(14, margin.top + plotHeight - barHeight - 8)}
                      className={styles.annualMeasurementLabel}
                      textAnchor="middle"
                    >
                      {formatCompactCurrency(item.measuredValue)}
                    </text>
                  ) : null}
                  <text
                    x={xAt(index)}
                    y={chartHeight - 18}
                    className={styles.annualAxisLabel}
                    textAnchor="middle"
                  >
                    {formatCycleAxisLabel(item.cycleEnd)}
                  </text>
                </g>
              );
            })}
            <path d={linePath("metaValue")} className={styles.annualMetaLine} />
            <path d={linePath("forecastValue")} className={styles.annualForecastLine} />
            {chartData.map((item, index) => (
              <g key={`${item.cycleStart}-points`}>
                {item.metaValue > 0 ? <circle cx={xAt(index)} cy={yAt(item.metaValue)} r="4" className={styles.annualMetaPoint} /> : null}
                {item.forecastValue > 0 ? <circle cx={xAt(index)} cy={yAt(item.forecastValue)} r="4" className={styles.annualForecastPoint} /> : null}
              </g>
            ))}
            <line
              x1={margin.left}
              x2={chartWidth - margin.right}
              y1={margin.top + plotHeight}
              y2={margin.top + plotHeight}
              className={styles.annualAxisLine}
            />
            {chartData.map((item, index) => {
              const overlayWidth = chartData.length > 1 ? step : plotWidth;
              return (
                <rect
                  key={`${item.cycleStart}-hover`}
                  x={xAt(index) - (overlayWidth / 2)}
                  y={margin.top}
                  width={overlayWidth}
                  height={plotHeight + 34}
                  className={styles.annualHoverArea}
                  onMouseEnter={() => setAnnualTooltipIndex(index)}
                  onFocus={() => setAnnualTooltipIndex(index)}
                />
              );
            })}
          </svg>
        </div>
      </div>
    );
  }

  function renderAnnualCycleTable() {
    return (
      <div className={`${styles.tableWrapper} ${styles.annualTableWrapper}`}>
        <table className={`${styles.table} ${styles.annualTable}`}>
          <thead>
            <tr>
              <th>Ciclo</th>
              <th>Meta</th>
              <th>Previsao</th>
              <th>Medicao</th>
              <th>% Medicao</th>
              <th>Diferenca da meta</th>
              <th>Equipes/Ciclo</th>
              <th>Projetos</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visibleAnnualCycleComparison.length ? (
              visibleAnnualCycleComparison.map((item) => {
                const measuredDifferenceClass = item.measuredDifference < 0
                  ? styles.differenceNegative
                  : item.measuredDifference > 0
                    ? styles.differencePositive
                    : undefined;

                return (
                  <tr key={item.cycleStart}>
                    <td>{item.label}</td>
                    <td className={styles.numericCell}>{formatCompactCurrency(item.metaValue)}</td>
                    <td className={styles.numericCell}>{formatCompactCurrency(item.forecastValue)}</td>
                    <td className={styles.numericCell}>{formatCompactCurrency(item.measuredValue)}</td>
                    <td className={styles.numericCell}>{formatPercentOneDecimal(item.measuredPercentage)}</td>
                    <td className={`${styles.numericCell} ${measuredDifferenceClass ?? ""}`}>{formatCompactCurrency(item.measuredDifference)}</td>
                    <td className={styles.numericCell}>{item.teamCount}</td>
                    <td className={styles.numericCell}>{item.projectCount}</td>
                    <td>
                      <span className={item.hasMeta ? styles.statusBadgeSuccess : styles.statusBadgeWarning}>
                        {item.hasMeta ? "Cadastrada" : "Sem meta"}
                      </span>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={9} className={styles.emptyRow}>Nenhum ciclo encontrado para o ano selecionado.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  function renderAnnualMetricCards() {
    return (
      <div className={styles.annualMetricGrid}>
        <div className={styles.annualMetricWithLegend}>
          <div className={`${styles.metric} ${styles.annualMetric}`}>
            <span>Meta acumulada</span>
            <strong>{formatCompactCurrency(annualTotals.metaValue)}</strong>
          </div>
          <div className={styles.annualMetricLegend}>
            <span className={styles.legendItem}><span className={`${styles.legendLine} ${styles.legendLineOrangeDashed}`} />Meta ciclo</span>
            <span className={styles.legendItem}><span className={`${styles.legendLine} ${styles.legendLineGreen}`} />Previsao</span>
            <span className={styles.legendItem}><span className={`${styles.legendDot} ${styles.legendBlue}`} />Medicao</span>
          </div>
        </div>
        <div className={`${styles.metric} ${styles.annualMetric}`}>
          <span>Previsao acumulada</span>
          <strong>{formatCompactCurrency(annualTotals.forecastValue)}</strong>
        </div>
        <div className={`${styles.metric} ${styles.annualMetric}`}>
          <span>Medicao acumulada</span>
          <strong>{formatCompactCurrency(annualTotals.measuredValue)}</strong>
        </div>
        <div className={`${styles.metric} ${styles.annualMetric}`}>
          <span>Atingimento</span>
          <strong>{formatPercentOneDecimal(annualTotals.attainment)}</strong>
        </div>
      </div>
    );
  }

  const expandedTitle = expandedChart === "completionCycle"
    ? "Concluidos X parciais no ciclo"
    : expandedChart === "completionPeriod"
      ? "Visao geral por periodo"
    : expandedChart === "cycle"
      ? "Ciclo da medicao"
    : expandedChart === "annual"
      ? "Evolucao anual por ciclo"
      : "";

  return (
    <section className={styles.wrapper}>
      <ExportProgressModal
        open={isExportingProjectDetails}
        title="Gerando..."
        message="Preparando arquivo para download."
      />
      {feedback ? (
        <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>{feedback.message}</div>
      ) : null}

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Filtros</h2>
            <p className={styles.cardSubtitle}>Consolidacao por ciclo operacional da Medicao.</p>
          </div>
          <button type="button" className={styles.primaryButton} onClick={applyDashboardFilters} disabled={isLoading}>
            {isLoading ? "Filtrando..." : "Filtrar"}
          </button>
        </div>

        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span>Ciclo</span>
            <select value={cycleDraft} onChange={(event) => setCycleDraft(event.target.value)} disabled={isLoading}>
              {cycles.length ? (
                cycles.map((cycle) => (
                  <option key={cycle.cycleStart} value={cycle.cycleStart}>
                    {cycle.label}
                  </option>
                ))
              ) : (
                <option value="">Nenhum ciclo com medicao</option>
              )}
            </select>
          </label>

          <label className={styles.field}>
            <span>Projeto (SOB)</span>
            <input
              type="text"
              value={projectSearchDraft}
              onChange={(event) => setProjectSearchDraft(event.target.value)}
              placeholder="Filtrar por SOB"
              list="dashboard-medicao-projects"
              disabled={isLoading}
            />
          </label>
          <datalist id="dashboard-medicao-projects">
            {projects.map((project) => (
              <option key={project.id} value={project.label} />
            ))}
          </datalist>

          <label className={styles.field}>
            <span>Status execucao</span>
            <select value={completionStatusDraft} onChange={(event) => setCompletionStatusDraft(event.target.value)} disabled={isLoading}>
                <option value="TODOS">Todos</option>
                <option value="CONCLUIDO">Concluidos</option>
                <option value="PARCIAL">Parciais</option>
                <option value="PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO">Parcial planejado beneficio atingido</option>
                <option value="PENDENCIA">Pendencias</option>
              </select>
            </label>

        </div>
      </article>

      <div className={styles.completionGrid}>
        <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Concluidos X parciais no ciclo</h2>
            <p className={styles.cardSubtitle}>Valores realizados agrupados pelo status economico no ciclo selecionado.</p>
          </div>
          {renderExpandButton("completionCycle", "Concluidos X parciais no ciclo")}
        </div>
        {renderCompletionTable(cycleCompletionChart, selectedCycleLabel, "dashboard_medicao_status_ciclo", cycleComparison ? {
          value: cycleComparison.value,
          orders: cycleComparison.orderCount,
          projectCount: cycleComparison.projectCount,
        } : null)}
        {renderCompletionChart(cycleCompletionChart)}
      </article>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Visao geral por periodo</h2>
            <p className={styles.cardSubtitle}>Valores faturados por categoria conforme o De/Para.</p>
          </div>
          <div className={styles.chartActions}>
            <div className={styles.periodFields}>
              <label className={styles.inlineDate}>
                <span>De</span>
                <input type="date" value={periodStartDraft} onChange={(event) => setPeriodStartDraft(event.target.value)} disabled={isLoading} />
              </label>
              <label className={styles.inlineDate}>
                <span>Para</span>
                <input type="date" value={periodEndDraft} onChange={(event) => setPeriodEndDraft(event.target.value)} disabled={isLoading} />
              </label>
            </div>
            <button type="button" className={styles.secondaryButton} onClick={applyPeriodFilter} disabled={isLoading}>
              Filtrar periodo
            </button>
            {renderExpandButton("completionPeriod", "Visao geral por periodo")}
          </div>
        </div>
        <div className={`${styles.cycleMetricGrid} ${styles.periodMetricGrid}`}>
          <div className={styles.metric}>
            <span>Ticket medio / Projetos</span>
            <strong>{formatCurrency(periodSummary?.averageTicketValue ?? 0)}</strong>
          </div>
          <div className={styles.metric}>
            <span>Ticket medio / Servicos</span>
            <strong>{formatCurrency(periodSummary?.averageServiceTicketValue ?? 0)}</strong>
          </div>
          <div className={styles.metric}>
            <span>Projetos no ciclo</span>
            <strong>{periodSummary?.projectCount ?? 0}</strong>
          </div>
          <div className={styles.metric}>
            <span>Ordens de Servicos no ciclo</span>
            <strong>{periodSummary?.orderCount ?? 0}</strong>
          </div>
        </div>
        {renderCompletionTable(
          periodCompletionChart,
          `Periodo ${formatDatePtBr(startDate) || "inicio"} a ${formatDatePtBr(endDate) || "fim"}`,
          "dashboard_medicao_status_periodo",
          periodSummary ? {
            value: periodSummary.realizedValue,
            orders: periodSummary.orderCount,
            projectCount: periodSummary.projectCount,
          } : null,
        )}
        {renderCompletionChart(periodCompletionChart)}
      </article>
      </div>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Ciclo da medicao</h2>
            <p className={styles.cardSubtitle}>Valor realizado contra a meta cadastrada para o ciclo.</p>
          </div>
          <div className={styles.chartActions}>
            <label className={styles.inlineSelect}>
              <span>Meta</span>
              <select value={cycleMetaMode} onChange={(event) => setCycleMetaMode(event.target.value as MetaMode)}>
                <option value="cycle">Meta ciclo</option>
                <option value="standard">Meta ciclo padrao</option>
                <option value="worked">Meta ciclo trabalhado</option>
              </select>
            </label>
            {renderExpandButton("cycle", "Ciclo da medicao")}
          </div>
        </div>

        <div className={styles.cycleMetricGrid}>
          <div className={styles.metric}>
            <span>Ticket medio / Projetos</span>
            <strong>{formatCurrency(cycleComparison?.averageTicketValue ?? 0)}</strong>
          </div>
          <div className={styles.metric}>
            <span>Ticket medio / Servicos</span>
            <strong>{formatCurrency(cycleComparison?.averageServiceTicketValue ?? 0)}</strong>
          </div>
          <div className={styles.metric}>
            <span>Projetos no ciclo</span>
            <strong>{cycleComparison?.projectCount ?? 0}</strong>
          </div>
          <div className={styles.metric}>
            <span>Ordens de Servicos no ciclo</span>
            <strong>{cycleComparison?.orderCount ?? 0}</strong>
          </div>
          <div className={styles.metric}>
            <span>Ritmo atual</span>
            <strong>{formatCurrency(cycleComparison?.averageDailyValue ?? 0)}/dia</strong>
          </div>
          <div className={styles.metric}>
            <span>Ritmo produtivo</span>
            <strong>{formatCurrency(cycleComparison?.objectiveDailyValue ?? 0)}/dia</strong>
          </div>
          <div className={styles.metric}>
            <span>Ritmo meta</span>
            <strong>{formatCurrency(cycleComparison?.targetDailyValue ?? 0)}/dia</strong>
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Ciclo</th>
                <th>Valor</th>
                <th>Projetos</th>
                {cycleMetaMode !== "worked" ? <th>Projecao de fechamento</th> : null}
                <th>{metaLabels[cycleMetaMode]}</th>
                <th>{metaDayLabels[cycleMetaMode]}</th>
                {cycleMetaMode !== "worked" ? <th>Dias trabalhados</th> : null}
                <th>Dif. ritmo produtivo</th>
                <th>Dif. ritmo meta</th>
                {cycleMetaMode !== "worked" ? <th>Dif. prevista</th> : null}
                <th>%Porcentagem</th>
                {cycleMetaMode !== "worked" ? <th>%Previsto</th> : null}
              </tr>
            </thead>
            <tbody>
              {cycleComparison ? (() => {
                const forecastDifference = resolveCycleForecastDifference(cycleComparison, cycleMetaMode);
                const productiveRhythmDifference = cycleComparison.averageDailyValue - cycleComparison.objectiveDailyValue;
                const targetRhythmDifference = cycleComparison.averageDailyValue - cycleComparison.targetDailyValue;
                const forecastDifferenceClass = forecastDifference < 0
                  ? styles.forecastDifferenceNegative
                  : forecastDifference > 0
                    ? styles.forecastDifferencePositive
                    : undefined;
                const productiveRhythmDifferenceClass = productiveRhythmDifference < 0
                  ? styles.forecastDifferenceNegative
                  : productiveRhythmDifference > 0
                    ? styles.forecastDifferencePositive
                    : undefined;
                const targetRhythmDifferenceClass = targetRhythmDifference < 0
                  ? styles.forecastDifferenceNegative
                  : targetRhythmDifference > 0
                    ? styles.forecastDifferencePositive
                    : undefined;

                return (
                  <tr>
                    <td>{cycleComparison.label}</td>
                    <td>{formatCurrency(cycleComparison.value)}</td>
                    <td>{cycleComparison.projectCount}</td>
                    {cycleMetaMode !== "worked" ? <td>{formatCurrency(resolveCycleForecastValue(cycleComparison, cycleMetaMode))}</td> : null}
                    <td>{formatCurrency(resolveCycleMetaValue(cycleComparison, cycleMetaMode))}</td>
                    <td>{resolveCycleDays(cycleComparison, cycleMetaMode)}</td>
                    {cycleMetaMode !== "worked" ? <td>{cycleComparison.executedWorkdays}</td> : null}
                    <td className={productiveRhythmDifferenceClass}>{formatCurrency(productiveRhythmDifference)}/dia</td>
                    <td className={targetRhythmDifferenceClass}>{formatCurrency(targetRhythmDifference)}/dia</td>
                    {cycleMetaMode !== "worked" ? <td className={forecastDifferenceClass}>{formatCurrency(forecastDifference)}</td> : null}
                    <td>{formatPercent(resolveCycleMetaValue(cycleComparison, cycleMetaMode) > 0 ? (cycleComparison.value / resolveCycleMetaValue(cycleComparison, cycleMetaMode)) * 100 : 0)}</td>
                    {cycleMetaMode !== "worked" ? <td>{formatPercent(resolveCycleMetaValue(cycleComparison, cycleMetaMode) > 0 ? (resolveCycleForecastValue(cycleComparison, cycleMetaMode) / resolveCycleMetaValue(cycleComparison, cycleMetaMode)) * 100 : 0)}</td> : null}
                  </tr>
                );
              })() : (
                <tr>
                  <td colSpan={cycleMetaMode === "worked" ? 8 : 12} className={styles.emptyRow}>Nenhum ciclo encontrado.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {renderCycleChart()}
      </article>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Evolucao anual por ciclo</h2>
            <p className={styles.cardSubtitle}>Comparativo de Meta ciclo, Previsao e Medicao em todos os ciclos do ano selecionado.</p>
          </div>
          <div className={styles.chartActions}>
            <label className={styles.inlineDate}>
              <span>Ano</span>
              <input
                type="number"
                min="2000"
                max="2100"
                step="1"
                value={annualYearDraft}
                onChange={(event) => setAnnualYearDraft(Number(event.target.value) || getCurrentYear())}
                disabled={isLoading}
              />
            </label>
            <button type="button" className={styles.secondaryButton} onClick={applyAnnualYearFilter} disabled={isLoading}>
              Filtrar ano
            </button>
            {renderExpandButton("annual", "Evolucao anual por ciclo")}
          </div>
        </div>

        {renderAnnualMetricCards()}

        {renderAnnualCycleChart()}
        <div className={styles.sectionHeader}>
          <h3>Detalhamento dos ciclos</h3>
        </div>
        {renderAnnualCycleTable()}
      </article>

      {/*
      Os blocos operacionais foram movidos para /dashboard-equipes na Etapa 4.
      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Equipes no ciclo</h2>
            <p className={styles.cardSubtitle}>Visao oficial de valor realizado e meta por equipe no ciclo selecionado.</p>
          </div>
          <div className={styles.chartActions}>
            <label className={styles.inlineSelect}>
              <span>Semana</span>
              <select value={teamWeekFilter} onChange={(event) => setTeamWeekFilter(event.target.value)}>
                <option value="">Ciclo completo</option>
                {cycleWeeks.map((week) => (
                  <option key={week.id} value={week.id}>
                    {week.label}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.checkboxGroup} aria-label="Metas da tabela de equipes">
              <span>Meta</span>
              <div className={styles.checkboxRow}>
                {(Object.keys(foremanMetaLabels) as ForemanMetaMode[]).map((mode) => (
                  <label key={mode} className={styles.checkboxOption}>
                    <input
                      type="checkbox"
                      checked={teamMetaModes.includes(mode)}
                      onChange={() => toggleTeamMetaMode(mode)}
                    />
                    {foremanMetaLabels[mode]}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Equipe</th>
                <th>Tipo(s)</th>
                <th>Encarregado(s)</th>
                <th>Valor realizado</th>
                <th>Projetos</th>
                {teamMetaModes.map((mode) => (
                  <th key={`${mode}-team-meta`}>{foremanMetaLabels[mode]}</th>
                ))}
                {teamMetaModes.map((mode) => (
                  <th key={`${mode}-team-days`}>{metaDayLabels[mode]}</th>
                ))}
                {teamMetaModes.map((mode) => (
                  <th key={`${mode}-team-percent`}>%{foremanMetaLabels[mode]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {selectedTeamsProduction.length ? (
                selectedTeamsProduction.map((item) => (
                  <tr
                    key={item.teamId}
                    className={styles.clickableRow}
                    role="button"
                    tabIndex={0}
                    title={`Ver projetos da equipe ${item.teamName}`}
                    onClick={() => openTeamProjectDetails(item)}
                    onKeyDown={(event) => handleProjectDetailRowKeyDown(event, () => openTeamProjectDetails(item))}
                  >
                    <td>{item.teamName}</td>
                    <td>{item.teamTypeNames.join(" / ") || "Nao identificado"}</td>
                    <td>{item.foremanNames.join(" / ") || "Nao identificado"}</td>
                    <td>{formatCurrency(item.totalValue)}</td>
                    <td>{item.projectCount}</td>
                    {teamMetaModes.map((mode) => (
                      <td key={`${item.teamId}-${mode}-team-meta`}>{formatCurrency(resolveForemanMetaValue(item, mode))}</td>
                    ))}
                    {teamMetaModes.map((mode) => (
                      <td key={`${item.teamId}-${mode}-team-days`}>{resolveForemanDays(item, summary, mode)}</td>
                    ))}
                    {teamMetaModes.map((mode) => {
                      const metaValue = resolveForemanMetaValue(item, mode);
                      return (
                        <td key={`${item.teamId}-${mode}-team-percent`}>
                          {formatPercent(metaValue > 0 ? (item.totalValue / metaValue) * 100 : 0)}
                        </td>
                      );
                    })}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5 + (teamMetaModes.length * 3)} className={styles.emptyRow}>Nenhuma equipe encontrada no ciclo.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Encarregados no ciclo</h2>
            <p className={styles.cardSubtitle}>Visao gerencial por encarregado, com meta rateada pelos dias de responsabilidade em cada equipe.</p>
          </div>
          <div className={styles.chartActions}>
            <label className={styles.inlineSelect}>
              <span>Semana</span>
              <select value={foremanWeekFilter} onChange={(event) => setForemanWeekFilter(event.target.value)}>
                <option value="">Ciclo completo</option>
                {cycleWeeks.map((week) => (
                  <option key={week.id} value={week.id}>
                    {week.label}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.checkboxGroup} aria-label="Metas do grafico de encarregados">
              <span>Meta</span>
              <div className={styles.checkboxRow}>
                {(Object.keys(foremanMetaLabels) as ForemanMetaMode[]).map((mode) => (
                  <label key={mode} className={styles.checkboxOption}>
                    <input
                      type="checkbox"
                      checked={foremanMetaModes.includes(mode)}
                      onChange={() => toggleForemanMetaMode(mode)}
                    />
                    {foremanMetaLabels[mode]}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Nomes</th>
                <th>Valor realizado</th>
                <th>Projetos</th>
                <th>Equipes</th>
                {foremanMetaModes.map((mode) => (
                  <th key={`${mode}-meta`}>{foremanMetaLabels[mode]}</th>
                ))}
                {foremanMetaModes.map((mode) => (
                  <th key={`${mode}-days`}>{metaDayLabels[mode]}</th>
                ))}
                {foremanMetaModes.map((mode) => (
                  <th key={`${mode}-percent`}>%{foremanMetaLabels[mode]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {selectedForemen.length ? (
                selectedForemen.map((item) => {
                  return (
                    <tr
                      key={item.foremanName}
                      className={styles.clickableRow}
                      role="button"
                      tabIndex={0}
                      title={`Ver projetos de ${item.foremanName}`}
                      onClick={() => openForemanProjectDetails(item)}
                      onKeyDown={(event) => handleProjectDetailRowKeyDown(event, () => openForemanProjectDetails(item))}
                    >
                      <td>{item.foremanName}</td>
                      <td>{formatCurrency(item.totalValue)}</td>
                      <td>{item.projectCount}</td>
                      <td>{item.teamCount}</td>
                      {foremanMetaModes.map((mode) => (
                        <td key={`${item.foremanName}-${mode}-meta`}>{formatCurrency(resolveForemanMetaValue(item, mode))}</td>
                      ))}
                      {foremanMetaModes.map((mode) => (
                        <td key={`${item.foremanName}-${mode}-days`}>{resolveForemanDays(item, summary, mode)}</td>
                      ))}
                      {foremanMetaModes.map((mode) => {
                        const metaValue = resolveForemanMetaValue(item, mode);
                        return (
                          <td key={`${item.foremanName}-${mode}-percent`}>
                            {formatPercent(metaValue > 0 ? (item.totalValue / metaValue) * 100 : 0)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={4 + (foremanMetaModes.length * 3)} className={styles.emptyRow}>Nenhum encarregado encontrado no ciclo.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {renderForemanVisualizations()}
      </article>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Supervisor no ciclo</h2>
            <p className={styles.cardSubtitle}>Somatoria da producao das equipes vinculadas ao supervisor no ciclo selecionado.</p>
          </div>
          <div className={styles.chartActions}>
            <label className={styles.inlineSelect}>
              <span>Semana</span>
              <select value={supervisorWeekFilter} onChange={(event) => setSupervisorWeekFilter(event.target.value)}>
                <option value="">Ciclo completo</option>
                {cycleWeeks.map((week) => (
                  <option key={week.id} value={week.id}>
                    {week.label}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.checkboxGroup} aria-label="Base da meta do supervisor">
              <span>Base da meta</span>
              <div className={styles.checkboxRow}>
                <label className={styles.checkboxOption}>
                  <input
                    type="radio"
                    name="supervisorMetaBase"
                    value="productive"
                    checked={supervisorMetaBase === "productive"}
                    onChange={() => setSupervisorMetaBase("productive")}
                  />
                  Equipes com producao
                </label>
                <label className={styles.checkboxOption}>
                  <input
                    type="radio"
                    name="supervisorMetaBase"
                    value="potential"
                    checked={supervisorMetaBase === "potential"}
                    onChange={() => setSupervisorMetaBase("potential")}
                  />
                  Todas vinculadas
                </label>
              </div>
            </div>
            {renderExpandButton("supervisorProduction", "Supervisor no ciclo")}
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Supervisor</th>
                <th>Valor produzido</th>
                <th>Projetos</th>
                <th>Equipes com producao</th>
                <th>Equipes vinculadas</th>
                <th>Ordens</th>
                <th>Meta equipes com producao</th>
                <th>% producao</th>
                <th>Meta total vinculada</th>
                <th>% total</th>
              </tr>
            </thead>
            <tbody>
              {selectedSupervisorsProduction.length ? (
                selectedSupervisorsProduction.map((item) => (
                  <tr
                    key={item.supervisorId ?? item.supervisorName}
                    className={styles.clickableRow}
                    role="button"
                    tabIndex={0}
                    title={`Ver projetos de ${item.supervisorName}`}
                    onClick={() => openSupervisorProjectDetails(item)}
                    onKeyDown={(event) => handleProjectDetailRowKeyDown(event, () => openSupervisorProjectDetails(item))}
                  >
                    <td>{item.supervisorName}</td>
                    <td>{formatCurrency(item.totalValue)}</td>
                    <td>{item.projectCount}</td>
                    <td>{item.productiveTeamCount}</td>
                    <td>{item.potentialTeamCount}</td>
                    <td>{item.orderCount}</td>
                    <td>{formatCurrency(item.productiveMetaValue)}</td>
                    <td>{formatPercent(item.productivePercentage)}</td>
                    <td>{formatCurrency(item.potentialMetaValue)}</td>
                    <td>{formatPercent(item.potentialPercentage)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} className={styles.emptyRow}>Nenhum supervisor encontrado no recorte selecionado.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {renderSupervisorProductionChart()}
      </article>
      */}

      {expandedChart ? (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-label={expandedTitle}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>{expandedTitle}</h2>
              <button type="button" className={styles.closeButton} onClick={() => setExpandedChart(null)} aria-label="Fechar grafico ampliado">
                x
              </button>
            </div>
            <div className={styles.modalBody}>
              {expandedChart === "completionCycle" ? (
                <>
                  {renderCompletionTable(cycleCompletionChart, selectedCycleLabel, "dashboard_medicao_status_ciclo", cycleComparison ? {
                    value: cycleComparison.value,
                    orders: cycleComparison.orderCount,
                    projectCount: cycleComparison.projectCount,
                  } : null)}
                  {renderCompletionChart(cycleCompletionChart, true)}
                </>
              ) : null}
              {expandedChart === "completionPeriod" ? (
                <>
                  {renderCompletionTable(
                    periodCompletionChart,
                    `Periodo ${formatDatePtBr(startDate) || "inicio"} a ${formatDatePtBr(endDate) || "fim"}`,
                    "dashboard_medicao_status_periodo",
                    periodSummary ? {
                      value: periodSummary.realizedValue,
                      orders: periodSummary.orderCount,
                      projectCount: periodSummary.projectCount,
                    } : null,
                  )}
                  {renderCompletionChart(periodCompletionChart, true)}
                </>
              ) : null}
              {expandedChart === "cycle" ? renderCycleChart(true) : null}
              {expandedChart === "annual" ? (
                <>
                  {renderAnnualMetricCards()}
                  {renderAnnualCycleChart(true)}
                  <div className={styles.sectionHeader}>
                    <h3>Detalhamento dos ciclos</h3>
                  </div>
                  {renderAnnualCycleTable()}
                </>
              ) : null}
              {/*
              As expansoes de encarregado e supervisor pertencem ao Dashboard Equipes.
              {expandedChart === "foremanRanking" ? renderForemanRanking(true) : null}
              {expandedChart === "foremanBullet" ? (
                renderForemanBulletChart(true)
              ) : null}
              {expandedChart === "foremanGap" ? renderForemanGapChart(true) : null}
              {expandedChart === "supervisorProduction" ? (
                <>
                  <div className={styles.tableWrapper}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Supervisor</th>
                          <th>Valor produzido</th>
                          <th>Projetos</th>
                          <th>Equipes com producao</th>
                          <th>Equipes vinculadas</th>
                          <th>Ordens</th>
                          <th>Meta equipes com producao</th>
                          <th>% producao</th>
                          <th>Meta total vinculada</th>
                          <th>% total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSupervisorsProduction.map((item) => (
                          <tr
                            key={item.supervisorId ?? item.supervisorName}
                            className={styles.clickableRow}
                            role="button"
                            tabIndex={0}
                            title={`Ver projetos de ${item.supervisorName}`}
                            onClick={() => openSupervisorProjectDetails(item)}
                            onKeyDown={(event) => handleProjectDetailRowKeyDown(event, () => openSupervisorProjectDetails(item))}
                          >
                            <td>{item.supervisorName}</td>
                            <td>{formatCurrency(item.totalValue)}</td>
                            <td>{item.projectCount}</td>
                            <td>{item.productiveTeamCount}</td>
                            <td>{item.potentialTeamCount}</td>
                            <td>{item.orderCount}</td>
                            <td>{formatCurrency(item.productiveMetaValue)}</td>
                            <td>{formatPercent(item.productivePercentage)}</td>
                            <td>{formatCurrency(item.potentialMetaValue)}</td>
                            <td>{formatPercent(item.potentialPercentage)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {renderSupervisorProductionChart(true)}
                </>
              ) : null}
              */}
            </div>
          </div>
        </div>
      ) : null}

      {projectDetailModal ? (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-label={projectDetailModal.title}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div>
                <h2>{projectDetailModal.title}</h2>
                <p className={styles.modalSubtitle}>{projectDetailModal.subtitle}</p>
              </div>
              <div className={styles.modalActions}>
                <CsvExportButton
                  onClick={() => void exportProjectDetailsCsv()}
                  isLoading={isExportingProjectDetails}
                  className={styles.secondaryButton}
                  idleLabel="Exportar Excel (CSV)"
                  showProgressModal={false}
                />
                <button type="button" className={styles.closeButton} onClick={() => setProjectDetailModal(null)} aria-label="Fechar detalhe de projetos">
                  x
                </button>
              </div>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Projeto</th>
                      <th>Centro</th>
                      <th>Valor cobrado</th>
                      <th>Ordens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectDetailModal.rows.length ? (
                      projectDetailModal.rows.map((item) => (
                        <tr key={item.projectId}>
                          <td>{item.projectCode}</td>
                          <td>{item.serviceCenter}</td>
                          <td>{formatCurrency(item.totalValue)}</td>
                          <td>{item.orderCount}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className={styles.emptyRow}>Nenhum projeto encontrado no recorte selecionado.</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td>{projectDetailModal.rows.length} projetos</td>
                      <td>{formatCurrency(projectDetailModal.rows.reduce((sum, item) => sum + item.totalValue, 0))}</td>
                      <td>{projectDetailModal.rows.reduce((sum, item) => sum + item.orderCount, 0)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
