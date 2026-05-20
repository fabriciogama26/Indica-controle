"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import styles from "./ProjectConsumptionPageView.module.css";

type ProjectOption = {
  id: string;
  label: string;
};

type ConsumptionRow = {
  materialId: string;
  materialCode: string;
  description: string;
  unit: string;
  materialType: string;
  plannedQuantity: number;
  requisitionQuantity: number;
  returnQuantity: number;
  netQuantity: number;
  deviationQuantity: number;
};

type Summary = {
  materialCount: number;
  plannedQuantity: number;
  requisitionQuantity: number;
  returnQuantity: number;
  netQuantity: number;
  deviationQuantity: number;
  overPlannedCount: number;
  unplannedConsumedCount: number;
};

type ConsumptionResponse = {
  message?: string;
  filters?: {
    projects: ProjectOption[];
  };
  selectedProject?: ProjectOption | null;
  rows?: ConsumptionRow[];
  chartRows?: ConsumptionRow[];
  summary?: Summary | null;
};

function formatDecimal(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(Number.isFinite(value) ? value : 0);
}

function normalizeCompare(value: string) {
  return value.trim().toUpperCase();
}

function maxValue(values: number[]) {
  return Math.max(1, ...values.map((value) => Math.abs(Number(value) || 0)));
}

function deviationLabel(row: ConsumptionRow) {
  if (row.plannedQuantity <= 0 && row.netQuantity > 0) return "Nao previsto";
  if (row.deviationQuantity > 0) return "Acima";
  if (row.deviationQuantity < 0) return "Abaixo";
  return "Conferido";
}

function deviationClass(row: ConsumptionRow) {
  if (row.plannedQuantity <= 0 && row.netQuantity > 0) return styles.statusUnplanned;
  if (row.deviationQuantity > 0) return styles.statusOver;
  if (row.deviationQuantity < 0) return styles.statusUnder;
  return styles.statusOk;
}

function ConsumptionChart({ rows }: { rows: ConsumptionRow[] }) {
  const max = maxValue(rows.flatMap((row) => [row.plannedQuantity, row.netQuantity]));

  return (
    <div className={styles.chartList}>
      {rows.length ? (
        rows.map((row) => {
          const plannedWidth = Math.max(4, (Math.abs(row.plannedQuantity) / max) * 100);
          const netWidth = Math.max(4, (Math.abs(row.netQuantity) / max) * 100);

          return (
            <div key={row.materialId} className={styles.chartRow}>
              <div className={styles.chartLabel}>
                <strong>{row.materialCode}</strong>
                <span>{row.description}</span>
              </div>
              <div className={styles.chartBars}>
                <div className={styles.chartBarLine}>
                  <span>Previsto</span>
                  <div className={styles.chartTrack}>
                    <div className={styles.chartPlannedFill} style={{ width: `${plannedWidth}%` }} />
                  </div>
                  <strong>{formatDecimal(row.plannedQuantity)}</strong>
                </div>
                <div className={styles.chartBarLine}>
                  <span>Liquido</span>
                  <div className={styles.chartTrack}>
                    <div className={row.deviationQuantity > 0 ? styles.chartOverFill : styles.chartNetFill} style={{ width: `${netWidth}%` }} />
                  </div>
                  <strong>{formatDecimal(row.netQuantity)}</strong>
                </div>
              </div>
            </div>
          );
        })
      ) : (
        <div className={styles.emptyState}>Selecione um projeto para visualizar o grafico.</div>
      )}
    </div>
  );
}

export function ProjectConsumptionPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("consumo_projeto");
  const hasLoadedInitialData = useRef(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectQuery, setProjectQuery] = useState("");
  const [materialCode, setMaterialCode] = useState("");
  const [selectedProject, setSelectedProject] = useState<ProjectOption | null>(null);
  const [rows, setRows] = useState<ConsumptionRow[]>([]);
  const [chartRows, setChartRows] = useState<ConsumptionRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const projectByQuery = useMemo(() => {
    const normalized = normalizeCompare(projectQuery);
    if (!normalized) return null;
    return projects.find((project) => normalizeCompare(project.label) === normalized) ?? null;
  }, [projectQuery, projects]);

  const loadConsumption = useCallback(
    async (projectId?: string | null) => {
      if (!session?.accessToken) return;

      const params = new URLSearchParams();
      if (projectId) params.set("projectId", projectId);
      if (materialCode.trim()) params.set("materialCode", materialCode.trim());

      setIsLoading(true);
      try {
        const response = await fetch(`/api/consumo-projeto?${params.toString()}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });
        const payload = (await response.json().catch(() => ({}))) as ConsumptionResponse;

        if (!response.ok) {
          throw new Error(payload.message ?? "Falha ao carregar Consumo por Projeto.");
        }

        setProjects(payload.filters?.projects ?? []);
        setSelectedProject(payload.selectedProject ?? null);
        setRows(payload.rows ?? []);
        setChartRows(payload.chartRows ?? []);
        setSummary(payload.summary ?? null);
        setFeedback(projectId ? { type: "success", message: "Consumo por Projeto atualizado." } : null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao carregar Consumo por Projeto.";
        setFeedback({ type: "error", message });
        await logError("Falha ao carregar Consumo por Projeto", error, {
          projectQuery,
          projectId,
          materialCode,
        });
      } finally {
        setIsLoading(false);
      }
    },
    [logError, materialCode, projectQuery, session?.accessToken],
  );

  useEffect(() => {
    if (!session?.accessToken) {
      hasLoadedInitialData.current = false;
      return;
    }

    if (hasLoadedInitialData.current) return;
    hasLoadedInitialData.current = true;
    void loadConsumption(null);
  }, [loadConsumption, session?.accessToken]);

  function handleFilter() {
    if (!projectByQuery) {
      setFeedback({ type: "error", message: "Selecione um projeto valido pela lista." });
      setSelectedProject(null);
      setRows([]);
      setChartRows([]);
      setSummary(null);
      return;
    }

    void loadConsumption(projectByQuery.id);
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
            <p className={styles.cardSubtitle}>Selecione o projeto para comparar materiais previstos, requisitados e devolvidos.</p>
          </div>
          <button type="button" className={styles.primaryButton} onClick={handleFilter} disabled={isLoading}>
            {isLoading ? "Filtrando..." : "Filtrar"}
          </button>
        </div>

        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span>Projeto</span>
            <input
              value={projectQuery}
              onChange={(event) => {
                setProjectQuery(event.target.value);
                setFeedback(null);
              }}
              list="consumo-projeto-list"
              placeholder="Digite ou selecione o SOB"
              disabled={isLoading}
            />
          </label>
          <label className={styles.field}>
            <span>Codigo do material</span>
            <input
              value={materialCode}
              onChange={(event) => setMaterialCode(event.target.value)}
              placeholder="Todos"
              disabled={isLoading}
            />
          </label>
        </div>
      </article>

      <div className={styles.summaryGrid}>
        <div className={styles.metric}>
          <span>Materiais</span>
          <strong>{summary?.materialCount ?? 0}</strong>
        </div>
        <div className={styles.metric}>
          <span>Previsto</span>
          <strong>{formatDecimal(summary?.plannedQuantity ?? 0)}</strong>
        </div>
        <div className={styles.metric}>
          <span>Requisicao</span>
          <strong>{formatDecimal(summary?.requisitionQuantity ?? 0)}</strong>
        </div>
        <div className={styles.metric}>
          <span>Devolucao</span>
          <strong>{formatDecimal(summary?.returnQuantity ?? 0)}</strong>
        </div>
        <div className={styles.metric}>
          <span>Qtd liquida</span>
          <strong>{formatDecimal(summary?.netQuantity ?? 0)}</strong>
        </div>
        <div className={styles.metric}>
          <span>Desvio</span>
          <strong>{formatDecimal(summary?.deviationQuantity ?? 0)}</strong>
        </div>
        <div className={styles.metric}>
          <span>Acima previsto</span>
          <strong>{summary?.overPlannedCount ?? 0}</strong>
        </div>
        <div className={styles.metric}>
          <span>Nao previstos</span>
          <strong>{summary?.unplannedConsumedCount ?? 0}</strong>
        </div>
      </div>

      <div className={styles.contentGrid}>
        <article className={styles.tableCard}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>Materiais do projeto</h2>
              <p className={styles.cardSubtitle}>
                {selectedProject ? `Projeto selecionado: ${selectedProject.label}` : "Nenhum projeto selecionado."}
              </p>
            </div>
          </div>

          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Codigo do Material</th>
                  <th>Descricao</th>
                  <th>UMB</th>
                  <th>Quantidade prevista</th>
                  <th>Quantidade Requisicao</th>
                  <th>Quantidade Devolucao</th>
                  <th>Qtd Liquida</th>
                  <th>Desvio</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.materialId}>
                    <td><strong>{row.materialCode}</strong></td>
                    <td>{row.description}</td>
                    <td>{row.unit}</td>
                    <td>{formatDecimal(row.plannedQuantity)}</td>
                    <td>{formatDecimal(row.requisitionQuantity)}</td>
                    <td>{formatDecimal(row.returnQuantity)}</td>
                    <td>{formatDecimal(row.netQuantity)}</td>
                    <td>{formatDecimal(row.deviationQuantity)}</td>
                    <td>
                      <span className={deviationClass(row)}>{deviationLabel(row)}</span>
                    </td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={9} className={styles.emptyRow}>
                      {selectedProject ? "Nenhum material encontrado para o filtro." : "Selecione um projeto e clique em Filtrar."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>Consumo x Previsto</h2>
              <p className={styles.cardSubtitle}>Maiores desvios entre quantidade liquida e quantidade prevista.</p>
            </div>
          </div>
          <ConsumptionChart rows={chartRows} />
        </article>
      </div>

      <datalist id="consumo-projeto-list">
        {projects.map((project) => (
          <option key={project.id} value={project.label} />
        ))}
      </datalist>
    </section>
  );
}
