"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { CsvExportButton } from "@/components/ui/CsvExportButton";
import styles from "./ProjectConsumptionPageView.module.css";

type ProjectOption = {
  id: string;
  label: string;
};

type MaterialOption = {
  id: string;
  code: string;
  description: string;
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
  stockQuantity: number;
  situationCode:
    | "CONFERIDO"
    | "ABAIXO_COM_ESTOQUE"
    | "ABAIXO_SEM_ESTOQUE"
    | "ACIMA_PREVISTO"
    | "FORA_PREVISTO"
    | "PREVISTO_SEM_REQUISICAO";
  situationLabel: string;
};

type Summary = {
  materialCount: number;
  requisitionMaterialCount: number;
  returnMaterialCount: number;
  stockMaterialCount: number;
  stockShortageMaterialCount: number;
};

type TableFilters = {
  requisitionNonZero: boolean;
  returnNonZero: boolean;
  stockNonZero: boolean;
  netNonZero: boolean;
  situationCode: "" | ConsumptionRow["situationCode"];
};

type ConsumptionResponse = {
  message?: string;
  filters?: {
    projects: ProjectOption[];
  };
  selectedProject?: ProjectOption | null;
  materialOptions?: MaterialOption[];
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

function csvEscape(value: unknown) {
  const normalized = String(value ?? "").replace(/"/g, '""');
  return `"${normalized}"`;
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function findProjectOption(value: string, options: ProjectOption[]) {
  const normalized = normalizeCompare(value);
  if (!normalized) return null;
  return options.find((project) => normalizeCompare(project.label) === normalized) ?? null;
}

function findMaterialOption(value: string, options: MaterialOption[]) {
  const normalized = normalizeCompare(value);
  if (!normalized) return null;

  const codeCandidate = normalizeCompare(value.split("-")[0] ?? value);
  return (
    options.find((material) => normalizeCompare(material.code) === normalized)
    ?? options.find((material) => normalizeCompare(material.code) === codeCandidate)
    ?? null
  );
}

function maxValue(values: number[]) {
  return Math.max(1, ...values.map((value) => Math.abs(Number(value) || 0)));
}

function situationClass(code: ConsumptionRow["situationCode"]) {
  if (code === "CONFERIDO") return styles.situationOk;
  if (code === "ABAIXO_COM_ESTOQUE") return styles.situationWithStock;
  if (code === "ABAIXO_SEM_ESTOQUE") return styles.situationWithoutStock;
  if (code === "ACIMA_PREVISTO") return styles.situationOver;
  if (code === "FORA_PREVISTO") return styles.situationUnplanned;
  return styles.situationPending;
}

function rowSituationClass(code: ConsumptionRow["situationCode"]) {
  if (code === "CONFERIDO") return styles.rowOk;
  if (code === "ABAIXO_COM_ESTOQUE") return styles.rowWithStock;
  if (code === "ABAIXO_SEM_ESTOQUE") return styles.rowWithoutStock;
  if (code === "ACIMA_PREVISTO") return styles.rowOver;
  if (code === "FORA_PREVISTO") return styles.rowUnplanned;
  return styles.rowPending;
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
  const [materialOptions, setMaterialOptions] = useState<MaterialOption[]>([]);
  const [projectQuery, setProjectQuery] = useState("");
  const [materialCode, setMaterialCode] = useState("");
  const [selectedProject, setSelectedProject] = useState<ProjectOption | null>(null);
  const [rows, setRows] = useState<ConsumptionRow[]>([]);
  const [chartRows, setChartRows] = useState<ConsumptionRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tableFilters, setTableFilters] = useState<TableFilters>({
    requisitionNonZero: false,
    returnNonZero: false,
    stockNonZero: false,
    netNonZero: false,
    situationCode: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const projectByQuery = useMemo(() => findProjectOption(projectQuery, projects), [projectQuery, projects]);

  const materialByQuery = useMemo(() => findMaterialOption(materialCode, materialOptions), [materialCode, materialOptions]);

  const situationOptions = useMemo(() => {
    const options = new Map<ConsumptionRow["situationCode"], string>();
    rows.forEach((row) => {
      options.set(row.situationCode, row.situationLabel);
    });
    return Array.from(options, ([code, label]) => ({ code, label })).sort((left, right) =>
      left.label.localeCompare(right.label, "pt-BR"),
    );
  }, [rows]);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        if (tableFilters.requisitionNonZero && row.requisitionQuantity === 0) return false;
        if (tableFilters.returnNonZero && row.returnQuantity === 0) return false;
        if (tableFilters.stockNonZero && row.stockQuantity === 0) return false;
        if (tableFilters.netNonZero && row.netQuantity === 0) return false;
        if (tableFilters.situationCode && row.situationCode !== tableFilters.situationCode) return false;
        return true;
      }),
    [rows, tableFilters],
  );

  function updateTableFilter<K extends keyof TableFilters>(key: K, value: TableFilters[K]) {
    setTableFilters((current) => ({ ...current, [key]: value }));
  }

  const loadConsumption = useCallback(
    async (projectId?: string | null) => {
      if (!session?.accessToken) return;

      const params = new URLSearchParams();
      if (projectId) params.set("projectId", projectId);
      if (materialCode.trim()) params.set("materialCode", materialByQuery?.code ?? materialCode.trim());

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
        setMaterialOptions(payload.materialOptions ?? []);
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
    [logError, materialByQuery?.code, materialCode, projectQuery, session?.accessToken],
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

  async function exportRows() {
    if (!filteredRows.length) {
      setFeedback({ type: "error", message: "Nao ha materiais para exportar." });
      return;
    }

    setIsExporting(true);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    try {
      const header = [
        "Projeto",
        "Codigo do Material",
        "Descricao",
        "UMB",
        "Em estoque",
        "Quantidade prevista",
        "Quantidade Requisicao",
        "Quantidade Devolucao",
        "Qtd Liquida",
        "Desvio",
        "Situacao",
      ];
      const projectLabel = selectedProject?.label ?? projectByQuery?.label ?? "projeto";
      const lines = filteredRows.map((row) => [
        projectLabel,
        row.materialCode,
        row.description,
        row.unit,
        formatDecimal(row.stockQuantity),
        formatDecimal(row.plannedQuantity),
        formatDecimal(row.requisitionQuantity),
        formatDecimal(row.returnQuantity),
        formatDecimal(row.netQuantity),
        formatDecimal(row.deviationQuantity),
        row.situationLabel,
      ]);
      const csv = `\uFEFF${[header, ...lines].map((line) => line.map(csvEscape).join(";")).join("\n")}`;
      const filenameProject = projectLabel.replace(/[^a-zA-Z0-9_-]+/g, "_") || "projeto";
      downloadCsv(csv, `consumo_projeto_${filenameProject}_${toIsoDate(new Date())}.csv`);
      setFeedback({ type: "success", message: "Materiais do projeto exportados com sucesso." });
    } finally {
      setIsExporting(false);
    }
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
              onChange={(event) => {
                setMaterialCode(event.target.value);
                setFeedback(null);
              }}
              list="consumo-material-list"
              placeholder="Digite ou selecione o codigo"
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
          <span>Requisicao</span>
          <strong>{summary?.requisitionMaterialCount ?? 0}</strong>
        </div>
        <div className={styles.metric}>
          <span>Devolucao</span>
          <strong>{summary?.returnMaterialCount ?? 0}</strong>
        </div>
        <div className={styles.metric}>
          <span>Em estoque</span>
          <strong>{summary?.stockMaterialCount ?? 0}</strong>
        </div>
        <div className={styles.metric}>
          <span>Falta em estoque</span>
          <strong>{summary?.stockShortageMaterialCount ?? 0}</strong>
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
            <CsvExportButton
              onClick={() => void exportRows()}
              disabled={!filteredRows.length || isLoading || isExporting}
              isLoading={isExporting}
              className={styles.secondaryButton}
              idleLabel="Extrair Excel"
            />
          </div>

          <div className={styles.tableFilters}>
            <div className={styles.checkboxGroup} aria-label="Filtros de quantidade">
              <label className={styles.checkboxField}>
                <input
                  type="checkbox"
                  checked={tableFilters.requisitionNonZero}
                  onChange={(event) => updateTableFilter("requisitionNonZero", event.target.checked)}
                />
                <span>Requisicao &lt;&gt; 0</span>
              </label>
              <label className={styles.checkboxField}>
                <input
                  type="checkbox"
                  checked={tableFilters.returnNonZero}
                  onChange={(event) => updateTableFilter("returnNonZero", event.target.checked)}
                />
                <span>Devolucao &lt;&gt; 0</span>
              </label>
              <label className={styles.checkboxField}>
                <input
                  type="checkbox"
                  checked={tableFilters.stockNonZero}
                  onChange={(event) => updateTableFilter("stockNonZero", event.target.checked)}
                />
                <span>Em estoque &lt;&gt; 0</span>
              </label>
              <label className={styles.checkboxField}>
                <input
                  type="checkbox"
                  checked={tableFilters.netNonZero}
                  onChange={(event) => updateTableFilter("netNonZero", event.target.checked)}
                />
                <span>Liquida &lt;&gt; 0</span>
              </label>
            </div>

            <label className={`${styles.field} ${styles.compactField}`}>
              <span>Situacao</span>
              <select
                value={tableFilters.situationCode}
                onChange={(event) =>
                  updateTableFilter("situationCode", event.target.value as TableFilters["situationCode"])
                }
              >
                <option value="">Todas</option>
                {situationOptions.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Codigo do Material</th>
                  <th>Descricao</th>
                  <th>UMB</th>
                  <th>Em estoque</th>
                  <th>Quantidade prevista</th>
                  <th>Quantidade Requisicao</th>
                  <th>Quantidade Devolucao</th>
                  <th>Qtd Liquida</th>
                  <th>Desvio</th>
                  <th>Situacao</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.materialId} className={rowSituationClass(row.situationCode)}>
                    <td><strong>{row.materialCode}</strong></td>
                    <td>{row.description}</td>
                    <td>{row.unit}</td>
                    <td>{formatDecimal(row.stockQuantity)}</td>
                    <td>{formatDecimal(row.plannedQuantity)}</td>
                    <td>{formatDecimal(row.requisitionQuantity)}</td>
                    <td>{formatDecimal(row.returnQuantity)}</td>
                    <td>{formatDecimal(row.netQuantity)}</td>
                    <td>{formatDecimal(row.deviationQuantity)}</td>
                    <td>
                      <span className={situationClass(row.situationCode)}>{row.situationLabel}</span>
                    </td>
                  </tr>
                ))}
                {!filteredRows.length ? (
                  <tr>
                    <td colSpan={10} className={styles.emptyRow}>
                      {selectedProject
                        ? "Nenhum material encontrado para os filtros selecionados."
                        : "Selecione um projeto e clique em Filtrar."}
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
      <datalist id="consumo-material-list">
        {materialOptions.map((material) => (
          <option key={material.id} value={material.code}>
            {material.description}
          </option>
        ))}
      </datalist>
    </section>
  );
}
