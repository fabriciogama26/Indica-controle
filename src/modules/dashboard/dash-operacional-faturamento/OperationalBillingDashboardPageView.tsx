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

export function OperationalBillingDashboardPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("dash-operacional-faturamento");
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [serviceCenters, setServiceCenters] = useState<Option[]>([]);
  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [billingCategories, setBillingCategories] = useState<BillingCategoryRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [projectId, setProjectId] = useState("");
  const [serviceCenterId, setServiceCenterId] = useState("");
  const [activityCode, setActivityCode] = useState("");
  const [activityStatus, setActivityStatus] = useState("TODAS");
  const [onlyDivergences, setOnlyDivergences] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const visibleProjects = useMemo(
    () => projects.filter((project) => !serviceCenterId || project.serviceCenterId === serviceCenterId),
    [projects, serviceCenterId],
  );

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projectId, projects],
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
      setBillingCategories([]);
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
      setBillingCategories(payload.billingCategories ?? []);
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
  }, [activityCode, activityStatus, logError, onlyDivergences, onlyMissing, projectId, serviceCenterId, session?.accessToken]);

  useEffect(() => {
    void loadMetadata();
  }, [loadMetadata]);

  function handleServiceCenterChange(value: string) {
    setServiceCenterId(value);
    const currentProject = projects.find((project) => project.id === projectId);
    if (currentProject && value && currentProject.serviceCenterId !== value) {
      setProjectId("");
      setRows([]);
      setBillingCategories([]);
      setSummary(null);
    }
  }

  function handleProjectChange(value: string) {
    setProjectId(value);
    const nextProject = projects.find((project) => project.id === value);
    if (nextProject?.serviceCenterId) {
      setServiceCenterId(nextProject.serviceCenterId);
    }
  }

  function exportRows() {
    if (!rows.length) {
      setFeedback({ type: "error", message: "Nenhum registro para exportar." });
      return;
    }

    downloadCsv("dash_operacional_faturamento.csv", [
      [
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
        row.code,
        row.description,
        row.unit,
        row.activityStatus,
        row.measurement.quantity,
        row.measurement.value,
        row.asbuilt.quantity,
        row.asbuilt.value,
        row.billing.quantity,
        row.billing.value,
        row.quantityDiffAsbuiltMeasurement,
        row.quantityDiffBillingMeasurement,
        row.valueDiffAsbuiltMeasurement,
        row.valueDiffBillingMeasurement,
        row.situation,
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
            <select value={projectId} onChange={(event) => handleProjectChange(event.target.value)} disabled={isLoading || !serviceCenterId}>
              <option value="">Selecione</option>
              {visibleProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.label}
                </option>
              ))}
            </select>
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
            <h2 className={styles.cardTitle}>Codigos por origem</h2>
            <p className={styles.cardSubtitle}>
              {selectedProject ? `${selectedProject.label} | ${selectedProject.serviceCenter}` : "Selecione Centro de servico e Projeto."}
            </p>
          </div>
          <div className={styles.tableActions}>
            <button type="button" className={styles.secondaryButton} onClick={exportRows} disabled={isLoading}>
              Exportar CSV
            </button>
            <div className={styles.valueSummary}>
              <span>Medicao: {formatCurrency(summary?.measurementValue ?? 0)}</span>
              <span>Asbuilt: {formatCurrency(summary?.asbuiltValue ?? 0)}</span>
              <span>Faturamento: {formatCurrency(summary?.billingValue ?? 0)}</span>
            </div>
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
            <h2 className={styles.cardTitle}>Categorias cobradas no faturamento</h2>
            <p className={styles.cardSubtitle}>
              Quantidade e valor cobrados por categoria dos codigos faturados no projeto selecionado.
            </p>
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.categoryTable}>
            <thead>
              <tr>
                <th>Categoria</th>
                <th>Quantidade cobrada</th>
                <th>Valor cobrado</th>
                <th>Codigos cobrados</th>
                <th>Itens</th>
              </tr>
            </thead>
            <tbody>
              {billingCategories.length ? (
                billingCategories.map((category) => (
                  <tr key={category.categoryId}>
                    <td><strong>{category.categoryName}</strong></td>
                    <td>{formatNumber(category.quantity)}</td>
                    <td>{formatCurrency(category.value)}</td>
                    <td>{category.codes.join(", ") || "Nao informado"}</td>
                    <td>{category.itemCount}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className={styles.emptyRow}>
                    {isLoading ? "Carregando categorias..." : "Nenhuma categoria cobrada no faturamento para os filtros selecionados."}
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
