"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import styles from "./MeasurementViewPageView.module.css";
import { downloadBlobFile } from "@/lib/utils/csv";
import { ExportProgressModal } from "@/components/ui/ExportProgressModal";
import type {
  ActivityCatalogItem,
  ActivityCatalogResponse,
  ExportProgress,
  Filters,
  MeasurementCountResponse,
  MeasurementExportType,
  MeasurementMetaResponse,
  NoProductionReasonItem,
  ProjectItem,
  ProjectServiceTypeItem,
  TeamItem,
  WorkCompletionCatalogItem,
} from "./types";
import {
  activityOptionLabel,
  buildOrdersQuery,
  findActivityOption,
  findProjectOption,
  monthRange,
  normalizeWorkCompletionCodeToken,
  resolveEconomicWorkCompletionStatus,
  toIsoDate,
} from "./utils";

// Tela de consulta/extracao da Medicao: nao cadastra, nao edita e nao muda status.
// A contagem usa a menor pagina possivel da propria listagem porque so serve para
// informar quantas ordens o filtro alcanca e habilitar/desabilitar os botoes de CSV.
const COUNT_PAGE_SIZE = 1;

export function MeasurementViewPageView() {
  const { session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const today = useMemo(() => toIsoDate(new Date()), []);
  const initialFilters = useMemo<Filters>(
    () => ({
      ...monthRange(today),
      projectId: "",
      teamId: "",
      serviceTypeId: "",
      activityId: "",
      status: "TODOS",
      measurementKind: "TODOS",
      noProductionReasonId: "",
      programmingMatch: "TODOS",
      workCompletionStatus: "TODOS",
      completionAlert: "TODOS",
    }),
    [today],
  );

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [noProductionReasons, setNoProductionReasons] = useState<NoProductionReasonItem[]>([]);
  const [projectServiceTypes, setProjectServiceTypes] = useState<ProjectServiceTypeItem[]>([]);
  const [workCompletionCatalog, setWorkCompletionCatalog] = useState<WorkCompletionCatalogItem[]>([]);
  const [filterDraft, setFilterDraft] = useState<Filters>(initialFilters);
  const [activeFilters, setActiveFilters] = useState<Filters>(initialFilters);
  const [filterProjectSearch, setFilterProjectSearch] = useState("");
  const [filterActivitySearch, setFilterActivitySearch] = useState("");
  const [filterActivityOptions, setFilterActivityOptions] = useState<ActivityCatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [isLoadingTotal, setIsLoadingTotal] = useState(false);
  const [isExportingSummary, setIsExportingSummary] = useState(false);
  const [isExportingDetails, setIsExportingDetails] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const deferredFilterActivitySearch = useDeferredValue(filterActivitySearch);
  const isGeneratingExport = Boolean(exportProgress);
  const isBusy = isGeneratingExport || isLoadingMeta || isLoadingTotal;

  const workCompletionFilterOptions = useMemo(() => {
    const map = new Map<string, { code: string; label: string }>();

    for (const item of workCompletionCatalog) {
      const code = resolveEconomicWorkCompletionStatus(item.code) ?? normalizeWorkCompletionCodeToken(item.code);
      if (!code || map.has(code)) {
        continue;
      }

      map.set(code, {
        code,
        label: String(item.label ?? "").trim() || code,
      });
    }

    return Array.from(map.values());
  }, [workCompletionCatalog]);

  useEffect(() => {
    if (!accessToken) {
      setProjects([]);
      setTeams([]);
      setNoProductionReasons([]);
      setProjectServiceTypes([]);
      setWorkCompletionCatalog([]);
      setIsLoadingMeta(false);
      return;
    }

    let ignore = false;
    async function loadMeta() {
      setIsLoadingMeta(true);
      try {
        const response = await fetch("/api/medicao/meta?includeSources=1", {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        const data = (await response.json().catch(() => null)) as MeasurementMetaResponse | null;
        if (!response.ok) throw new Error(data?.message ?? "Falha ao carregar filtros da medicao.");
        if (ignore) return;
        setProjects(data?.projects ?? []);
        setTeams(data?.teams ?? []);
        setNoProductionReasons(data?.noProductionReasons ?? []);
        setProjectServiceTypes(data?.projectServiceTypes ?? []);
        setWorkCompletionCatalog(data?.workCompletionCatalog ?? []);
      } catch (error) {
        if (!ignore) {
          setProjects([]);
          setTeams([]);
          setNoProductionReasons([]);
          setProjectServiceTypes([]);
          setWorkCompletionCatalog([]);
          setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar filtros da medicao." });
        }
      } finally {
        if (!ignore) setIsLoadingMeta(false);
      }
    }

    void loadMeta();
    return () => {
      ignore = true;
    };
  }, [accessToken, refreshTick]);

  useEffect(() => {
    if (!accessToken || deferredFilterActivitySearch.trim().length < 2) {
      setFilterActivityOptions([]);
      return;
    }

    let ignore = false;
    async function loadFilterActivityCatalog() {
      const response = await fetch(`/api/medicao/activities/catalog?q=${encodeURIComponent(deferredFilterActivitySearch)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const data = (await response.json().catch(() => null)) as ActivityCatalogResponse | null;
      if (!ignore) setFilterActivityOptions(data?.items ?? []);
    }

    void loadFilterActivityCatalog();
    return () => {
      ignore = true;
    };
  }, [accessToken, deferredFilterActivitySearch]);

  useEffect(() => {
    if (!accessToken) {
      setTotal(0);
      setIsLoadingTotal(false);
      return;
    }

    let ignore = false;
    async function loadFilteredTotal() {
      setIsLoadingTotal(true);
      try {
        const query = buildOrdersQuery(activeFilters, 1, COUNT_PAGE_SIZE);
        const response = await fetch(`/api/medicao?${query}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        const data = (await response.json().catch(() => null)) as MeasurementCountResponse | null;
        if (!response.ok) throw new Error(data?.message ?? "Falha ao consultar ordens de medicao.");
        if (ignore) return;
        setTotal(data?.pagination?.total ?? 0);
      } catch (error) {
        if (!ignore) {
          setTotal(0);
          setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao consultar ordens de medicao." });
        }
      } finally {
        if (!ignore) setIsLoadingTotal(false);
      }
    }

    void loadFilteredTotal();
    return () => {
      ignore = true;
    };
  }, [accessToken, activeFilters, refreshTick]);

  async function downloadMeasurementExport(type: MeasurementExportType, filename: string) {
    if (!accessToken) {
      throw new Error("Sessao invalida para exportar ordens de medicao.");
    }

    const query = new URLSearchParams(buildOrdersQuery(activeFilters, 1, COUNT_PAGE_SIZE));
    query.set("type", type);
    const response = await fetch(`/api/medicao/export?${query.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });

    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(errorPayload?.message ?? "Falha ao exportar ordens de medicao.");
    }

    const blob = await response.blob();
    downloadBlobFile(blob, filename);
  }

  async function exportSummaryCsv() {
    if (!total) {
      setFeedback({ type: "error", message: "Nenhuma ordem encontrada para exportar com os filtros atuais." });
      return;
    }
    if (isGeneratingExport) return;

    setIsExportingSummary(true);
    setExportProgress({ title: "Gerando...", message: "Gerando arquivo CSV no servidor." });
    try {
      await downloadMeasurementExport("summary", `ordens_medicao_${toIsoDate(new Date())}.csv`);
      setFeedback({ type: "success", message: "Exportacao concluida." });
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao exportar ordens de medicao." });
    } finally {
      setIsExportingSummary(false);
      setExportProgress(null);
    }
  }

  async function exportDetailedCsv() {
    if (!total) {
      setFeedback({ type: "error", message: "Nenhuma ordem encontrada para exportar detalhamento." });
      return;
    }
    if (isGeneratingExport) return;

    setIsExportingDetails(true);
    setExportProgress({ title: "Gerando...", message: "Gerando detalhamento CSV no servidor." });
    try {
      await downloadMeasurementExport("details", `ordens_medicao_detalhamento_${toIsoDate(new Date())}.csv`);
      setFeedback({ type: "success", message: "Exportacao concluida." });
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao exportar detalhamento da medicao." });
    } finally {
      setIsExportingDetails(false);
      setExportProgress(null);
    }
  }

  function applyFilters() {
    const matchedProject = findProjectOption(filterProjectSearch, projects);
    if (filterProjectSearch.trim() && !matchedProject) {
      setFeedback({ type: "error", message: "Projeto invalido no filtro. Selecione um projeto da lista." });
      return;
    }

    const matchedActivity = findActivityOption(filterActivitySearch, filterActivityOptions);
    if (filterActivitySearch.trim() && !matchedActivity) {
      setFeedback({ type: "error", message: "Atividade invalida no filtro. Selecione uma atividade da lista." });
      return;
    }

    const nextFilters = {
      ...filterDraft,
      projectId: matchedProject?.id ?? "",
      activityId: matchedActivity?.id ?? "",
    };
    setFilterDraft(nextFilters);
    setFilterProjectSearch(matchedProject?.code ?? "");
    setFilterActivitySearch(matchedActivity ? activityOptionLabel(matchedActivity) : "");
    setFeedback(null);
    setActiveFilters(nextFilters);
  }

  function clearFilters() {
    setFilterDraft(initialFilters);
    setActiveFilters(initialFilters);
    setFilterProjectSearch("");
    setFilterActivitySearch("");
    setFilterActivityOptions([]);
    setFeedback(null);
  }

  return (
    <section className={styles.wrapper}>
      <ExportProgressModal
        open={Boolean(exportProgress)}
        title={exportProgress?.title ?? "Gerando..."}
        message={exportProgress?.message ?? "Preparando arquivo."}
        percent={exportProgress?.percent}
      />

      {feedback ? <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>{feedback.message}</div> : null}

      <article className={styles.card}>
        <h2 className={styles.cardTitle}>Filtros</h2>
        <div className={styles.filterGrid}>
          <label className={styles.field}><span>Data inicial</span><input type="date" value={filterDraft.startDate} onChange={(event) => setFilterDraft((current) => ({ ...current, startDate: event.target.value }))} /></label>
          <label className={styles.field}><span>Data final</span><input type="date" value={filterDraft.endDate} onChange={(event) => setFilterDraft((current) => ({ ...current, endDate: event.target.value }))} /></label>
          <label className={styles.field}>
            <span>Projeto</span>
            <input
              value={filterProjectSearch}
              onChange={(event) => {
                setFilterProjectSearch(event.target.value);
                if (!event.target.value.trim()) {
                  setFilterDraft((current) => ({ ...current, projectId: "" }));
                }
              }}
              list="medicao-visualizacao-project-filter-list"
              placeholder="Digite o codigo do projeto"
            />
          </label>
          <label className={styles.field}>
            <span>Equipe</span>
            <select value={filterDraft.teamId} onChange={(event) => setFilterDraft((current) => ({ ...current, teamId: event.target.value }))}>
              <option value="">Todas</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>Tipo de Servico</span>
            <select value={filterDraft.serviceTypeId} onChange={(event) => setFilterDraft((current) => ({ ...current, serviceTypeId: event.target.value }))}>
              <option value="">Todos</option>
              {projectServiceTypes.map((serviceType) => <option key={serviceType.id} value={serviceType.id}>{serviceType.name}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>Atividade</span>
            <input
              value={filterActivitySearch}
              onChange={(event) => {
                setFilterActivitySearch(event.target.value);
                setFilterDraft((current) => ({ ...current, activityId: "" }));
              }}
              list="medicao-visualizacao-activity-filter-list"
              placeholder="Digite codigo ou descricao"
            />
          </label>
          <label className={styles.field}>
            <span>Status</span>
            <select value={filterDraft.status} onChange={(event) => setFilterDraft((current) => ({ ...current, status: event.target.value as Filters["status"] }))}>
              <option value="TODOS">Todos</option>
              <option value="ABERTA">Aberta</option>
              <option value="FECHADA">Fechada</option>
              <option value="CANCELADA">Cancelada</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Tipo</span>
            <select value={filterDraft.measurementKind} onChange={(event) => setFilterDraft((current) => ({ ...current, measurementKind: event.target.value as Filters["measurementKind"] }))}>
              <option value="TODOS">Todos</option>
              <option value="COM_PRODUCAO">Com producao</option>
              <option value="SEM_PRODUCAO">Sem producao</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Motivo sem producao</span>
            <select value={filterDraft.noProductionReasonId} onChange={(event) => setFilterDraft((current) => ({ ...current, noProductionReasonId: event.target.value }))}>
              <option value="">Todos</option>
              {noProductionReasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>Programacao</span>
            <select value={filterDraft.programmingMatch} onChange={(event) => setFilterDraft((current) => ({ ...current, programmingMatch: event.target.value as Filters["programmingMatch"] }))}>
              <option value="TODOS">Todos</option>
              <option value="PROGRAMADA">Programada</option>
              <option value="NAO_PROGRAMADA">Nao programada</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Estado Trabalho</span>
            <select value={filterDraft.workCompletionStatus} onChange={(event) => setFilterDraft((current) => ({ ...current, workCompletionStatus: event.target.value as Filters["workCompletionStatus"] }))}>
              <option value="TODOS">Todos</option>
              {workCompletionFilterOptions.map((item) => (
                <option key={item.code} value={item.code}>{item.label}</option>
              ))}
              <option value="NAO_INFORMADO">Nao informado</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Alerta Status execucao</span>
            <select value={filterDraft.completionAlert} onChange={(event) => setFilterDraft((current) => ({ ...current, completionAlert: event.target.value as Filters["completionAlert"] }))}>
              <option value="TODOS">Todos</option>
              <option value="SIM">Com alerta</option>
              <option value="NAO">Sem alerta</option>
            </select>
          </label>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.primaryButton} onClick={applyFilters} disabled={isGeneratingExport}>Aplicar</button>
          <button type="button" className={styles.ghostButton} onClick={clearFilters} disabled={isGeneratingExport}>Limpar</button>
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.tableHeader}>
          <h2 className={styles.cardTitle}>Extracao</h2>
          <div className={styles.tableHeaderActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void exportSummaryCsv()}
              disabled={isBusy || isExportingSummary || isExportingDetails || total <= 0}
            >
              {isExportingSummary ? "Exportando..." : "Exportar Excel (CSV)"}
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => void exportDetailedCsv()}
              disabled={isBusy || isExportingDetails || isExportingSummary || total <= 0}
            >
              {isExportingDetails ? "Gerando..." : "Detalhamento (CSV)"}
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setRefreshTick((current) => current + 1)}
              disabled={isBusy || isExportingSummary || isExportingDetails}
            >
              {isLoadingTotal ? "Atualizando..." : "Atualizar"}
            </button>
          </div>
        </div>
        <div className={styles.summaryBar}>
          <div>
            <span>Ordens no filtro</span>
            <strong>{isLoadingTotal ? "..." : total}</strong>
          </div>
          <div>
            <span>Periodo</span>
            <strong>{`${activeFilters.startDate} a ${activeFilters.endDate}`}</strong>
          </div>
        </div>
        <p className={styles.tableHint}>
          Exportar Excel (CSV) gera uma linha por ordem. Detalhamento (CSV) gera uma linha por
          atividade da ordem, com codigo da atividade, codigo IDD, quantidade, taxa e valores.
        </p>
      </article>

      <datalist id="medicao-visualizacao-activity-filter-list">
        {filterActivityOptions.map((item) => <option key={item.id} value={activityOptionLabel(item)} />)}
      </datalist>
      <datalist id="medicao-visualizacao-project-filter-list">
        {projects.map((item) => (
          <option key={item.id} value={item.code}>
            {item.serviceName}
          </option>
        ))}
      </datalist>
    </section>
  );
}
