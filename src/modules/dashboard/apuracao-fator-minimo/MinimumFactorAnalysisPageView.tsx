"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { CsvExportButton } from "@/components/ui/CsvExportButton";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import styles from "./MinimumFactorAnalysisPageView.module.css";

type Option = {
  id: string;
  label?: string;
  name?: string;
  code?: string;
  description?: string;
  serviceCenter?: string;
  serviceType?: string;
  groupName?: string;
  vehiclePlate?: string;
  foremanName?: string;
};

type FilterState = {
  startDate: string;
  endDate: string;
  status: "TODOS" | "ABERTA" | "FECHADA";
  projectIds: string[];
  teamIds: string[];
  serviceTypeId: string;
  activityIds: string[];
};

type AnalysisRow = {
  key: string;
  executionDate: string;
  teamId: string;
  teamName: string;
  foremanName: string;
  teamTypeName: string;
  points: number;
  pointTarget: number;
  pointDifference: number;
  totalValue: number;
  financialTarget: number;
  complementValue: number;
  quantity: number;
  itemCount: number;
  orderCount: number;
  projectCount: number;
  projectCodes: string[];
  serviceCodes: Array<{
    code: string;
    description: string;
    quantity: number;
    points: number;
    value: number;
  }>;
  status: "ATINGIU" | "NAO_ATINGIU" | "SEM_META";
};

type DetailRow = {
  orderId: string;
  orderNumber: string;
  executionDate: string;
  projectCode: string;
  serviceCenter: string;
  activityCode: string;
  activityDescription: string;
  quantity: number;
  points: number;
  totalValue: number;
  status: string;
};

type AnalysisResponse = {
  rows?: AnalysisRow[];
  detailRows?: DetailRow[];
  summary?: {
    rowCount: number;
    reachedCount: number;
    notReachedCount: number;
    withoutTargetCount: number;
    totalPoints: number;
    totalValue: number;
    complementValue: number;
  };
  message?: string;
};

type MetaResponse = {
  projects?: Option[];
  teams?: Option[];
  serviceTypes?: Option[];
  activities?: Option[];
  message?: string;
};

type DetailModal = {
  row: AnalysisRow;
  details: DetailRow[];
  loading: boolean;
};

const RESULT_PAGE_SIZE = 20;

function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentYearRange() {
  const today = toIsoDate(new Date());
  const year = today.slice(0, 4);
  return {
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
  };
}

function formatDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "-";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatDecimal(value: number, digits = 2) {
  return Number(value ?? 0).toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatCurrency(value: number) {
  return Number(value ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function csvEscape(value: string | number) {
  const text = String(value ?? "");
  if (/[;"\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const csv = `\uFEFF${rows.map((row) => row.map(csvEscape).join(";")).join("\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function buildQuery(filters: FilterState) {
  const params = new URLSearchParams();
  params.set("startDate", filters.startDate);
  params.set("endDate", filters.endDate);
  params.set("status", filters.status);
  for (const projectId of filters.projectIds) params.append("projectId", projectId);
  for (const teamId of filters.teamIds) params.append("teamId", teamId);
  if (filters.serviceTypeId) params.set("serviceTypeId", filters.serviceTypeId);
  for (const activityId of filters.activityIds) params.append("activityId", activityId);
  return params;
}

function statusLabel(status: AnalysisRow["status"]) {
  if (status === "ATINGIU") return "Atingiu";
  if (status === "NAO_ATINGIU") return "Nao atingiu";
  return "Sem meta";
}

function statusClassName(status: AnalysisRow["status"]) {
  if (status === "ATINGIU") return styles.statusSuccess;
  if (status === "NAO_ATINGIU") return styles.statusDanger;
  return styles.statusNeutral;
}

export function MinimumFactorAnalysisPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("apuracao_fator_minimo");
  const defaultRange = useMemo(() => currentYearRange(), []);
  const [filters, setFilters] = useState<FilterState>({
    ...defaultRange,
    status: "FECHADA",
    projectIds: [],
    teamIds: [],
    serviceTypeId: "",
    activityIds: [],
  });
  const [activeFilters, setActiveFilters] = useState<FilterState>(filters);
  const [projectDraftId, setProjectDraftId] = useState("");
  const [teamDraftId, setTeamDraftId] = useState("");
  const [activityDraftId, setActivityDraftId] = useState("");
  const [projects, setProjects] = useState<Option[]>([]);
  const [teams, setTeams] = useState<Option[]>([]);
  const [serviceTypes, setServiceTypes] = useState<Option[]>([]);
  const [activities, setActivities] = useState<Option[]>([]);
  const [rows, setRows] = useState<AnalysisRow[]>([]);
  const [summary, setSummary] = useState<AnalysisResponse["summary"] | null>(null);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [detailModal, setDetailModal] = useState<DetailModal | null>(null);
  const [lastExportAt, setLastExportAt] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [resultPage, setResultPage] = useState(1);

  const accessToken = session?.accessToken ?? "";

  const selectedActivityCount = activeFilters.activityIds.length;
  const activeFilterLabel = selectedActivityCount
    ? `${selectedActivityCount} codigo(s) selecionado(s)`
    : "Todos os codigos";
  const resultTotalPages = Math.max(1, Math.ceil(rows.length / RESULT_PAGE_SIZE));
  const safeResultPage = Math.min(resultPage, resultTotalPages);
  const pagedRows = useMemo(
    () => rows.slice((safeResultPage - 1) * RESULT_PAGE_SIZE, safeResultPage * RESULT_PAGE_SIZE),
    [rows, safeResultPage],
  );

  const loadMeta = useCallback(async () => {
    if (!accessToken) return;
    setIsLoadingMeta(true);
    try {
      const response = await fetch("/api/apuracao-fator-minimo?mode=meta", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as MetaResponse | null;
      if (!response.ok) throw new Error(payload?.message ?? "Falha ao carregar filtros da apuracao.");
      setProjects(payload?.projects ?? []);
      setTeams(payload?.teams ?? []);
      setServiceTypes(payload?.serviceTypes ?? []);
      setActivities(payload?.activities ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao carregar filtros da apuracao.";
      setFeedback({ type: "error", message });
      await logError("Falha ao carregar filtros da Apuracao de Fator Minimo", error);
    } finally {
      setIsLoadingMeta(false);
    }
  }, [accessToken, logError]);

  const loadAnalysis = useCallback(async (targetFilters: FilterState) => {
    if (!accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para carregar apuracao." });
      return;
    }
    setIsLoading(true);
    setFeedback(null);
    try {
      const query = buildQuery(targetFilters);
      query.set("_refresh", String(Date.now()));
      const response = await fetch(`/api/apuracao-fator-minimo?${query.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as AnalysisResponse | null;
      if (!response.ok) throw new Error(payload?.message ?? "Falha ao simular fator minimo.");
      setRows(payload?.rows ?? []);
      setSummary(payload?.summary ?? null);
      setActiveFilters(targetFilters);
      setResultPage(1);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao simular fator minimo.";
      setFeedback({ type: "error", message });
      await logError("Falha ao simular Apuracao de Fator Minimo", error, targetFilters);
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, logError]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  function updateFilter<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function findOption(items: Option[], id: string) {
    return items.find((item) => item.id === id);
  }

  function addFilterItem(key: "projectIds" | "teamIds" | "activityIds", id: string, clearDraft: () => void) {
    if (!id) return;
    setFilters((current) => current[key].includes(id)
      ? current
      : { ...current, [key]: [...current[key], id] });
    clearDraft();
  }

  function removeFilterItem(key: "projectIds" | "teamIds" | "activityIds", id: string) {
    setFilters((current) => ({
      ...current,
      [key]: current[key].filter((item) => item !== id),
    }));
  }

  function optionLabel(item: Option | undefined, fallback: string) {
    if (!item) return fallback;
    return item.label || item.name || [item.code, item.description].filter(Boolean).join(" - ") || fallback;
  }

  function applyFilters() {
    loadAnalysis(filters);
  }

  function clearFilters() {
    const cleared: FilterState = {
      ...defaultRange,
      status: "FECHADA",
      projectIds: [],
      teamIds: [],
      serviceTypeId: "",
      activityIds: [],
    };
    setFilters(cleared);
    setActiveFilters(cleared);
    setRows([]);
    setSummary(null);
    setResultPage(1);
    setProjectDraftId("");
    setTeamDraftId("");
    setActivityDraftId("");
    setFeedback(null);
  }

  async function openDetail(row: AnalysisRow) {
    setDetailModal({ row, details: [], loading: true });
    try {
      const query = buildQuery(activeFilters);
      query.set("detailTeamId", row.teamId);
      query.set("detailDate", row.executionDate);
      query.set("_refresh", String(Date.now()));
      const response = await fetch(`/api/apuracao-fator-minimo?${query.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as AnalysisResponse | null;
      if (!response.ok) throw new Error(payload?.message ?? "Falha ao carregar detalhe da apuracao.");
      setDetailModal({ row, details: payload?.detailRows ?? [], loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao carregar detalhe da apuracao.";
      setFeedback({ type: "error", message });
      setDetailModal({ row, details: [], loading: false });
      await logError("Falha ao carregar detalhe da Apuracao de Fator Minimo", error, row);
    }
  }

  async function exportRows() {
    if (!rows.length) {
      setFeedback({ type: "error", message: "Nenhuma apuracao encontrada para exportar." });
      return;
    }
    if (Date.now() - lastExportAt < 10_000) {
      setFeedback({ type: "error", message: "Aguarde 10 segundos entre as exportacoes." });
      return;
    }
    setLastExportAt(Date.now());
    setIsExporting(true);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    try {
      downloadCsv(`apuracao_fator_minimo_${toIsoDate(new Date())}.csv`, [
        ["Data", "Equipe", "Encarregado", "Tipo", "Pontos", "Meta pontos", "Diferenca pontos", "Valor", "Meta financeira", "Complemento estimado", "Status", "Ordens", "Projetos", "Codigos"],
        ...rows.map((row) => [
          formatDate(row.executionDate),
          row.teamName,
          row.foremanName,
          row.teamTypeName,
          formatDecimal(row.points),
          formatDecimal(row.pointTarget),
          formatDecimal(row.pointDifference),
          formatCurrency(row.totalValue),
          formatCurrency(row.financialTarget),
          formatCurrency(row.complementValue),
          statusLabel(row.status),
          row.orderCount,
          row.projectCodes.join(" / "),
          row.serviceCodes.map((item) => item.code).join(" / "),
        ]),
      ]);
      setFeedback({ type: "success", message: "Apuracao exportada com sucesso." });
    } finally {
      setIsExporting(false);
    }
  }

  async function exportDetail() {
    if (!detailModal?.details.length) {
      setFeedback({ type: "error", message: "Nenhum detalhe encontrado para exportar." });
      return;
    }
    setIsExporting(true);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    try {
      downloadCsv(`apuracao_fator_minimo_detalhe_${detailModal.row.teamName}_${detailModal.row.executionDate}.csv`, [
        ["Ordem", "Data", "Projeto", "Centro de servico", "Codigo", "Descricao", "Quantidade", "Pontos", "Valor", "Status ordem"],
        ...detailModal.details.map((row) => [
          row.orderNumber,
          formatDate(row.executionDate),
          row.projectCode,
          row.serviceCenter,
          row.activityCode,
          row.activityDescription,
          formatDecimal(row.quantity, 4),
          formatDecimal(row.points),
          formatCurrency(row.totalValue),
          row.status,
        ]),
      ]);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <section className={styles.wrapper}>
      {feedback ? <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>{feedback.message}</div> : null}

      <article className={styles.toolbar}>
        <div>
          <h2>Apuracao de Fator Minimo</h2>
          <p>Simulacao por filtros usando itens de medicao consolidados por equipe e data.</p>
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h3>Filtros</h3>
            <span>{isLoadingMeta ? "Carregando filtros..." : activeFilterLabel}</span>
          </div>
          <button type="button" className={styles.primaryButton} onClick={applyFilters} disabled={isLoading || isLoadingMeta}>
            {isLoading ? "Simulando..." : "Simular"}
          </button>
        </div>

        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span>Data inicio</span>
            <input type="date" value={filters.startDate} onChange={(event) => updateFilter("startDate", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Data fim</span>
            <input type="date" value={filters.endDate} onChange={(event) => updateFilter("endDate", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Status</span>
            <select value={filters.status} onChange={(event) => updateFilter("status", event.target.value as FilterState["status"])}>
              <option value="FECHADA">Fechada</option>
              <option value="ABERTA">Aberta</option>
              <option value="TODOS">Todos ativos</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Tipo de servico</span>
            <select value={filters.serviceTypeId} onChange={(event) => updateFilter("serviceTypeId", event.target.value)}>
              <option value="">Todos</option>
              {serviceTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <div className={styles.field}>
            <span>Projeto</span>
            <div className={styles.addRow}>
              <select value={projectDraftId} onChange={(event) => setProjectDraftId(event.target.value)}>
                <option value="">Selecionar projeto</option>
                {projects
                  .filter((item) => !filters.projectIds.includes(item.id))
                  .map((item) => <option key={item.id} value={item.id}>{item.label} - {item.serviceCenter}</option>)}
              </select>
              <button
                type="button"
                className={styles.addButton}
                onClick={() => addFilterItem("projectIds", projectDraftId, () => setProjectDraftId(""))}
                disabled={!projectDraftId}
              >
                Adicionar
              </button>
            </div>
            <div className={styles.chipList}>
              {filters.projectIds.length ? filters.projectIds.map((id) => (
                <button key={id} type="button" className={styles.chip} onClick={() => removeFilterItem("projectIds", id)}>
                  {optionLabel(findOption(projects, id), id)} x
                </button>
              )) : <small>Todos os projetos</small>}
            </div>
          </div>
          <div className={styles.field}>
            <span>Equipe</span>
            <div className={styles.addRow}>
              <select value={teamDraftId} onChange={(event) => setTeamDraftId(event.target.value)}>
                <option value="">Selecionar equipe</option>
                {teams
                  .filter((item) => !filters.teamIds.includes(item.id))
                  .map((item) => <option key={item.id} value={item.id}>{item.label}{item.foremanName ? ` - ${item.foremanName}` : ""}</option>)}
            </select>
              <button
                type="button"
                className={styles.addButton}
                onClick={() => addFilterItem("teamIds", teamDraftId, () => setTeamDraftId(""))}
                disabled={!teamDraftId}
              >
                Adicionar
              </button>
            </div>
            <div className={styles.chipList}>
              {filters.teamIds.length ? filters.teamIds.map((id) => (
                <button key={id} type="button" className={styles.chip} onClick={() => removeFilterItem("teamIds", id)}>
                  {optionLabel(findOption(teams, id), id)} x
                </button>
              )) : <small>Todas as equipes</small>}
            </div>
          </div>
          <div className={`${styles.field} ${styles.wideField}`}>
            <span>Codigo de servico</span>
            <div className={styles.addRow}>
              <select value={activityDraftId} onChange={(event) => setActivityDraftId(event.target.value)}>
                <option value="">Selecionar codigo</option>
                {activities
                  .filter((item) => !filters.activityIds.includes(item.id))
                  .map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
              <button
                type="button"
                className={styles.addButton}
                onClick={() => addFilterItem("activityIds", activityDraftId, () => setActivityDraftId(""))}
                disabled={!activityDraftId}
              >
                Adicionar
              </button>
            </div>
            <div className={styles.chipList}>
              {filters.activityIds.length ? filters.activityIds.map((id) => (
                <button key={id} type="button" className={styles.chip} onClick={() => removeFilterItem("activityIds", id)}>
                  {optionLabel(findOption(activities, id), id)} x
                </button>
              )) : <small>Todos os codigos</small>}
            </div>
          </div>
        </div>
      </article>

      <div className={styles.summaryGrid}>
        <article className={styles.summaryCard}>
          <span>Dias/equipes</span>
          <strong>{summary?.rowCount ?? 0}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span>Atingiram</span>
          <strong>{summary?.reachedCount ?? 0}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span>Nao atingiram</span>
          <strong>{summary?.notReachedCount ?? 0}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span>Pontos apurados</span>
          <strong>{formatDecimal(summary?.totalPoints ?? 0)}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span>Complemento estimado</span>
          <strong>{formatCurrency(summary?.complementValue ?? 0)}</strong>
        </article>
      </div>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h3>Resultado da simulacao</h3>
            <span>Calculo por equipe + data. Quando houver codigo filtrado, somente esse codigo entra na pontuacao.</span>
          </div>
          <div className={styles.resultActions}>
            <button type="button" className={styles.ghostButton} onClick={clearFilters} disabled={isLoading || isLoadingMeta}>
              Limpar
            </button>
            <CsvExportButton
              onClick={() => void exportRows()}
              disabled={isLoading || isExporting || !rows.length}
              isLoading={isExporting}
              className={styles.secondaryButton}
              idleLabel="Exportar CSV"
              loadingLabel="Gerando..."
            />
          </div>
        </div>
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Equipe</th>
                <th>Tipo</th>
                <th>Pontos</th>
                <th>Meta</th>
                <th>Diferenca</th>
                <th>Valor</th>
                <th>Complemento</th>
                <th>Status</th>
                <th>Ordens</th>
                <th>Codigos</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={11} className={styles.emptyCell}>Simulando apuracao...</td></tr>
              ) : rows.length ? pagedRows.map((row) => (
                <tr key={row.key} className={styles.clickableRow} onClick={() => openDetail(row)}>
                  <td>{formatDate(row.executionDate)}</td>
                  <td>
                    <strong>{row.teamName}</strong>
                    <small>{row.foremanName}</small>
                  </td>
                  <td>{row.teamTypeName}</td>
                  <td>{formatDecimal(row.points)}</td>
                  <td>{formatDecimal(row.pointTarget)}</td>
                  <td>{formatDecimal(row.pointDifference)}</td>
                  <td>{formatCurrency(row.totalValue)}</td>
                  <td>{formatCurrency(row.complementValue)}</td>
                  <td><span className={`${styles.statusBadge} ${statusClassName(row.status)}`}>{statusLabel(row.status)}</span></td>
                  <td>{row.orderCount}</td>
                  <td className={styles.wrapCell}>{row.serviceCodes.slice(0, 4).map((item) => item.code).join(" / ")}{row.serviceCodes.length > 4 ? " / ..." : ""}</td>
                </tr>
              )) : (
                <tr><td colSpan={11} className={styles.emptyCell}>{summary ? "Nenhum resultado encontrado para os filtros." : "Clique em Simular para calcular a apuracao."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className={styles.paginationBar}>
          <span>
            {rows.length ? `Pagina ${safeResultPage} de ${resultTotalPages} | ${rows.length} resultado(s)` : "Sem resultados paginados"}
          </span>
          <div className={styles.paginationActions}>
            <button type="button" className={styles.ghostButton} onClick={() => setResultPage((page) => Math.max(1, page - 1))} disabled={safeResultPage <= 1}>
              Anterior
            </button>
            <button type="button" className={styles.ghostButton} onClick={() => setResultPage((page) => Math.min(resultTotalPages, page + 1))} disabled={safeResultPage >= resultTotalPages}>
              Proxima
            </button>
          </div>
        </div>
      </article>

      {detailModal ? (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
          <article className={styles.modal}>
            <header className={styles.modalHeader}>
              <div>
                <h3>{detailModal.row.teamName} - {formatDate(detailModal.row.executionDate)}</h3>
                <span>{statusLabel(detailModal.row.status)} | {formatDecimal(detailModal.row.points)} de {formatDecimal(detailModal.row.pointTarget)} pontos</span>
              </div>
              <div className={styles.modalActions}>
                <CsvExportButton
                  onClick={() => void exportDetail()}
                  disabled={isExporting || !detailModal.details.length}
                  isLoading={isExporting}
                  showProgressModal={false}
                  className={styles.secondaryButton}
                  idleLabel="Exportar detalhe"
                  loadingLabel="Gerando..."
                />
                <button type="button" className={styles.ghostButton} onClick={() => setDetailModal(null)}>Fechar</button>
              </div>
            </header>
            <div className={styles.modalBody}>
              <div className={styles.detailMetrics}>
                <div><span>Valor</span><strong>{formatCurrency(detailModal.row.totalValue)}</strong></div>
                <div><span>Meta financeira</span><strong>{formatCurrency(detailModal.row.financialTarget)}</strong></div>
                <div><span>Complemento</span><strong>{formatCurrency(detailModal.row.complementValue)}</strong></div>
                <div><span>Projetos</span><strong>{detailModal.row.projectCodes.join(" / ") || "-"}</strong></div>
              </div>
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Ordem</th>
                      <th>Projeto</th>
                      <th>Centro</th>
                      <th>Codigo</th>
                      <th>Descricao</th>
                      <th>Quantidade</th>
                      <th>Pontos</th>
                      <th>Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailModal.loading ? (
                      <tr><td colSpan={8} className={styles.emptyCell}>Carregando detalhe...</td></tr>
                    ) : detailModal.details.length ? detailModal.details.map((row) => (
                      <tr key={`${row.orderId}:${row.activityCode}:${row.activityDescription}`}>
                        <td>{row.orderNumber}</td>
                        <td>{row.projectCode}</td>
                        <td>{row.serviceCenter}</td>
                        <td>{row.activityCode}</td>
                        <td className={styles.wrapCell}>{row.activityDescription}</td>
                        <td>{formatDecimal(row.quantity, 4)}</td>
                        <td>{formatDecimal(row.points)}</td>
                        <td>{formatCurrency(row.totalValue)}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={8} className={styles.emptyCell}>Nenhum item encontrado para este detalhe.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </article>
        </div>
      ) : null}
    </section>
  );
}
