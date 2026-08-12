"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ExportProgressModal } from "@/components/ui/ExportProgressModal";
import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { useExportCooldown } from "@/hooks/useExportCooldown";
import { downloadCsvFile } from "@/lib/utils/csv";
import {
  buildDeadlineCsvContent,
  DEADLINE_CAROUSEL_PAGE_SIZE,
  DEADLINE_WINDOW_EXTENDED_DAYS,
  DEADLINE_WINDOW_LONG_DAYS,
  DEADLINE_WINDOW_MAX_DAYS,
  DEADLINE_WINDOW_SHORT_DAYS,
  formatDeadlineStatusLabel,
  resolveDeadlineStatus,
  resolveDeadlineVisualVariant,
  type DeadlineStatus,
  type DeadlineViewMode,
} from "./deadline";
import { ProgrammingDeadlineModal } from "./components/ProgrammingDeadlineModal";
import { ProgrammingDeadlinePanel } from "./components/ProgrammingDeadlinePanel";
import { ProjectMiniCard } from "./components/ProjectMiniCard";
import { ProjectTable } from "./components/ProjectTable";
import { formatDate, formatNameList } from "./formatters";
import type {
  FilterState,
  MapProgrammingResponse,
  MapProject,
  ProjectSituationKey,
  ServiceScope,
  StatusCard,
} from "./types";
import styles from "./MapProgrammingPageView.module.css";

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return toIsoDate(value);
}

function diffInDays(targetDate: string, baseDate: string) {
  const target = Date.parse(`${targetDate}T00:00:00.000Z`);
  const base = Date.parse(`${baseDate}T00:00:00.000Z`);
  if (!Number.isFinite(target) || !Number.isFinite(base)) {
    return null;
  }
  return Math.round((target - base) / 86_400_000);
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function resolveDeadlineWindowDays(viewMode: DeadlineViewMode) {
  if (viewMode === "90") return DEADLINE_WINDOW_MAX_DAYS;
  if (viewMode === "60") return DEADLINE_WINDOW_EXTENDED_DAYS;
  if (viewMode === "30") return DEADLINE_WINDOW_LONG_DAYS;
  return DEADLINE_WINDOW_SHORT_DAYS;
}

function formatDeadlineRangeLabel(daysDiff: number) {
  if (daysDiff < 0) return "Vencida";
  if (daysDiff <= DEADLINE_WINDOW_SHORT_DAYS) return "Ate 15 dias";
  if (daysDiff <= DEADLINE_WINDOW_LONG_DAYS) return "16 a 30 dias";
  if (daysDiff <= DEADLINE_WINDOW_EXTENDED_DAYS) return "31 a 60 dias";
  return "61 a 90 dias";
}

function getCardClassName(key: ProjectSituationKey) {
  if (key === "WITHDRAWN") return styles.summaryWarning;
  if (key === "TO_REPROGRAM" || key === "INTERRUPTED" || key === "WITHOUT_STATUS") return styles.summaryDanger;
  if (key === "PENDING" || key === "PARTIAL" || key === "PARTIAL_PLANNED" || key === "BENEFIT_REACHED") return styles.summaryWarning;
  if (key === "CONCLUDED") return styles.summarySuccess;
  return styles.summaryNeutral;
}

function exportCsv(filename: string, header: string[], rows: Array<Array<string | number | null>>) {
  const escapeValue = (value: string | number | null) => {
    const text = String(value ?? "");
    if (/[;"\n\r]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };
  const content = `\uFEFF${[header, ...rows].map((row) => row.map(escapeValue).join(";")).join("\n")}`;
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function MapProgrammingPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("mapa_programacao");
  const today = useMemo(() => toIsoDate(new Date()), []);
  const [draftFilters, setDraftFilters] = useState<FilterState>({
    startDate: "",
    endDate: "",
    projectSearch: "",
    teamSearch: "",
    serviceCenter: "",
    serviceScope: "OBRAS",
  });
  const [activeFilters, setActiveFilters] = useState<FilterState>({
    startDate: "",
    endDate: "",
    projectSearch: "",
    teamSearch: "",
    serviceCenter: "",
    serviceScope: "OBRAS",
  });
  const [data, setData] = useState<MapProgrammingResponse | null>(null);
  const [selectedCardKey, setSelectedCardKey] = useState<ProjectSituationKey | null>(null);
  const [selectedProject, setSelectedProject] = useState<MapProject | null>(null);
  const [selectedCardPage, setSelectedCardPage] = useState(1);
  const [priorityPage, setPriorityPage] = useState(1);
  const [neverProgrammedPage, setNeverProgrammedPage] = useState(1);
  const [deadlineViewMode, setDeadlineViewMode] = useState<DeadlineViewMode>("15");
  const [deadlineCarouselPage, setDeadlineCarouselPage] = useState(0);
  const [isDeadlineModalOpen, setIsDeadlineModalOpen] = useState(false);
  const [isExportingDeadlineModal, setIsExportingDeadlineModal] = useState(false);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const deadlineModalExportCooldown = useExportCooldown();

  const accessToken = session?.accessToken ?? "";

  const loadData = useCallback(async () => {
    if (!accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para carregar Mapa de Programacao." });
      return;
    }

    setIsLoading(true);
    setFeedback(null);

    try {
      const query = new URLSearchParams();
      if (activeFilters.startDate && activeFilters.endDate) {
        query.set("startDate", activeFilters.startDate);
        query.set("endDate", activeFilters.endDate);
      }
      // O escopo por Tipo de Servico e resolvido no servidor: a carteira, os
      // cards, os prazos e o resumo do topo precisam sair todos do mesmo
      // conjunto de obras.
      query.set("serviceScope", activeFilters.serviceScope);

      const response = await fetch(`/api/mapa-programacao?${query.toString()}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const responseData = (await response.json().catch(() => ({}))) as MapProgrammingResponse;

      if (!response.ok) {
        throw new Error(responseData.message ?? "Falha ao carregar Mapa de Programacao.");
      }

      setData(responseData);
      setSelectedCardKey(null);
      setSelectedProject(null);
      setSelectedCardPage(1);
      setPriorityPage(1);
      setNeverProgrammedPage(1);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao carregar Mapa de Programacao.";
      setFeedback({ type: "error", message });
      await logError("Falha ao carregar Mapa de Programacao.", error, {
        operation: "load_map_programming",
        startDate: activeFilters.startDate,
        endDate: activeFilters.endDate,
        serviceScope: activeFilters.serviceScope,
      });
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, activeFilters.endDate, activeFilters.serviceScope, activeFilters.startDate, logError]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const statusCards = useMemo(() => data?.statusCards ?? [], [data]);

  const serviceCenterOptions = useMemo(() => {
    const values = new Set<string>();
    for (const card of statusCards) {
      for (const project of card.projects) {
        if (project.serviceCenter) values.add(project.serviceCenter);
      }
    }
    for (const team of data?.teamsWithoutProgramming ?? []) {
      if (team.serviceCenter) values.add(team.serviceCenter);
    }
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }, [data, statusCards]);

  const selectedCard = statusCards.find((card) => card.key === selectedCardKey) ?? null;

  const filterProjects = useCallback((projects: MapProject[]) => {
    const search = normalizeSearch(activeFilters.projectSearch);
    return projects.filter((project) => {
      if (activeFilters.serviceCenter && project.serviceCenter !== activeFilters.serviceCenter) return false;
      if (!search) return true;
      return normalizeSearch([
        project.sob,
        project.projectName,
        project.contract,
        project.serviceCenter,
        project.serviceType,
        project.city,
        ...project.latestTeamNames,
        ...project.latestForemanNames,
        project.latestWorkCompletionLabel,
        project.latestProgrammingStatus,
      ].join(" ")).includes(search);
    });
  }, [activeFilters.projectSearch, activeFilters.serviceCenter]);

  const filteredSelectedProjects = selectedCard ? filterProjects(selectedCard.projects) : [];
  const filteredPriorityProjects = useMemo(
    () => filterProjects(data?.priorityProjects ?? []),
    [data, filterProjects],
  );
  const filteredNeverProgrammedProjects = useMemo(
    () => filterProjects(data?.neverProgrammedProjects ?? []),
    [data, filterProjects],
  );
  const portfolioProjects = useMemo(
    () => statusCards.find((card) => card.key === "PORTFOLIO")?.projects ?? [],
    [statusCards],
  );
  const deadlineWindowDays = useMemo(
    () => resolveDeadlineWindowDays(deadlineViewMode),
    [deadlineViewMode],
  );
  const deadlineProjects = useMemo(() => {
    return filterProjects(portfolioProjects)
      .map((project) => {
        const executionDeadline = project.executionDeadline.trim();
        if (project.completed || !executionDeadline || !/^\d{4}-\d{2}-\d{2}$/.test(executionDeadline)) {
          return null;
        }

        const daysDiff = diffInDays(executionDeadline, today);
        if (daysDiff === null) {
          return null;
        }

        return {
          id: project.id,
          sob: project.sob,
          serviceCenter: project.serviceCenter || "Sem base",
          priority: project.priority || "Sem prioridade",
          workType: project.serviceType || "Sem tipo",
          executionDeadline,
          latestProgrammingDate: project.latestDate,
          reason: project.reason,
          // Prazos das Obras mostra a coluna em branco quando nao ha Estado
          // Trabalho. Decide pelo codigo, nao pelo texto do rotulo: o servidor
          // passou a distinguir "Nao informado" de "Nao se aplica (cancelada)".
          workCompletionStatus: project.latestWorkCompletionStatus
            ? project.latestWorkCompletionLabel
            : "",
          daysDiff,
        };
      })
      .filter((item): item is {
        id: string;
        sob: string;
        serviceCenter: string;
        priority: string;
        workType: string;
        executionDeadline: string;
        latestProgrammingDate: string;
        reason: string;
        workCompletionStatus: string;
        daysDiff: number;
      } => Boolean(item));
  }, [filterProjects, portfolioProjects, today]);
  const deadlineSummary = useMemo(() => {
    const overdue = deadlineProjects.filter((item) => resolveDeadlineStatus(item.daysDiff, deadlineWindowDays) === "OVERDUE").length;
    const dueToday = deadlineProjects.filter((item) => resolveDeadlineStatus(item.daysDiff, deadlineWindowDays) === "TODAY").length;
    const dueSoon = deadlineProjects.filter((item) => resolveDeadlineStatus(item.daysDiff, deadlineWindowDays) === "SOON").length;
    const normal = deadlineProjects.filter((item) => resolveDeadlineStatus(item.daysDiff, deadlineWindowDays) === "NORMAL").length;

    return { overdue, dueToday, dueSoon, normal };
  }, [deadlineProjects, deadlineWindowDays]);
  const deadlineSobCards = useMemo(() => {
    const priorityByStatus: Record<DeadlineStatus, number> = {
      TODAY: 0,
      SOON: 1,
      OVERDUE: 2,
      NORMAL: 3,
    };

    return deadlineProjects
      .filter((item) => item.daysDiff <= deadlineWindowDays)
      .map((item) => {
        const deadlineStatus = resolveDeadlineStatus(item.daysDiff, deadlineWindowDays);
        return {
          ...item,
          deadlineStatus,
          visualVariant: resolveDeadlineVisualVariant(item.daysDiff, deadlineWindowDays),
          statusLabel: formatDeadlineStatusLabel(item.daysDiff, deadlineWindowDays),
          rangeLabel: formatDeadlineRangeLabel(item.daysDiff),
        };
      })
      .sort((left, right) => {
        const priorityDiff = priorityByStatus[left.deadlineStatus] - priorityByStatus[right.deadlineStatus];
        if (priorityDiff !== 0) return priorityDiff;
        if (left.daysDiff === right.daysDiff) return left.sob.localeCompare(right.sob);
        if (left.deadlineStatus === "OVERDUE") return right.daysDiff - left.daysDiff;
        return left.daysDiff - right.daysDiff;
      });
  }, [deadlineProjects, deadlineWindowDays]);
  const deadlineSobPages = useMemo(() => {
    const pages: Array<typeof deadlineSobCards> = [];
    for (let start = 0; start < deadlineSobCards.length; start += DEADLINE_CAROUSEL_PAGE_SIZE) {
      pages.push(deadlineSobCards.slice(start, start + DEADLINE_CAROUSEL_PAGE_SIZE));
    }
    return pages;
  }, [deadlineSobCards]);
  const totalDeadlineCarouselPages = Math.max(1, deadlineSobPages.length);
  const deadlineWindowHeading = `SOB com vencimento ate ${deadlineWindowDays} dias`;

  useEffect(() => {
    setPriorityPage(1);
    setNeverProgrammedPage(1);
    setSelectedCardPage(1);
  }, [activeFilters.projectSearch, activeFilters.serviceCenter, activeFilters.teamSearch]);

  useEffect(() => {
    setDeadlineCarouselPage(0);
  }, [activeFilters.projectSearch, activeFilters.serviceCenter, deadlineViewMode]);

  useEffect(() => {
    setDeadlineCarouselPage((current) => {
      if (!deadlineSobPages.length) return 0;
      const lastPage = deadlineSobPages.length - 1;
      if (current > lastPage) return lastPage;
      if (current < 0) return 0;
      return current;
    });
  }, [deadlineSobPages]);

  const filteredTeams = useMemo(() => {
    const search = normalizeSearch(activeFilters.teamSearch);
    return (data?.teamsWithoutProgramming ?? []).filter((team) => {
      if (activeFilters.serviceCenter && team.serviceCenter !== activeFilters.serviceCenter) return false;
      if (!search) return true;
      return normalizeSearch(`${team.name} ${team.foremanName} ${team.serviceCenter} ${team.teamType} ${team.vehiclePlate}`)
        .includes(search);
    });
  }, [activeFilters.serviceCenter, activeFilters.teamSearch, data]);

  const periodLabel = activeFilters.startDate && activeFilters.endDate
    ? `${formatDate(activeFilters.startDate)} a ${formatDate(activeFilters.endDate)}`
    : "Sem periodo";

  function updateDraftField<Field extends keyof FilterState>(field: Field, value: FilterState[Field]) {
    setDraftFilters((current) => ({ ...current, [field]: value }));
  }

  // Tipo aplica na hora, sem passar por `Aplicar`: ele redefine o universo da
  // tela inteira, entao deixar o rascunho apontando para um escopo e a tela
  // mostrando outro so gera leitura errada dos numeros.
  function changeServiceScope(value: ServiceScope) {
    setDraftFilters((current) => ({ ...current, serviceScope: value }));
    setActiveFilters((current) => ({ ...current, serviceScope: value }));
  }

  function applyFilters() {
    if ((draftFilters.startDate && !draftFilters.endDate) || (!draftFilters.startDate && draftFilters.endDate)) {
      setFeedback({ type: "error", message: "Informe data inicial e data final, ou deixe as duas em branco." });
      return;
    }
    if (draftFilters.startDate && draftFilters.endDate && draftFilters.endDate < draftFilters.startDate) {
      setFeedback({ type: "error", message: "Data final deve ser maior ou igual a data inicial." });
      return;
    }
    setActiveFilters(draftFilters);
  }

  function clearPeriod() {
    const nextFilters = {
      ...draftFilters,
      startDate: "",
      endDate: "",
    };
    setDraftFilters(nextFilters);
    setActiveFilters(nextFilters);
  }

  function setPeriod(days: number) {
    const nextFilters = {
      ...draftFilters,
      startDate: today,
      endDate: addDays(today, days - 1),
    };
    setDraftFilters(nextFilters);
    setActiveFilters(nextFilters);
  }

  async function handleExportDeadlineModalCsv() {
    if (!deadlineSobCards.length) {
      setFeedback({ type: "error", message: "Nenhum prazo encontrado para exportar na janela selecionada." });
      return;
    }

    if (!deadlineModalExportCooldown.tryStart()) {
      setFeedback({
        type: "error",
        message: `Aguarde ${deadlineModalExportCooldown.getRemainingSeconds()}s antes de exportar novamente.`,
      });
      return;
    }

    setIsExportingDeadlineModal(true);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    try {
      const csv = buildDeadlineCsvContent({
        items: deadlineSobCards,
        deadlineWindowDays,
      });
      downloadCsvFile(csv, `prazos_obras_${deadlineWindowDays}dias_${today}.csv`);
    } catch (error) {
      setFeedback({ type: "error", message: "Falha ao exportar prazos das obras." });
      await logError("Falha ao exportar prazos das obras.", error, {
        operation: "export_deadline_csv",
        deadlineWindowDays,
        itemCount: deadlineSobCards.length,
      });
    } finally {
      setIsExportingDeadlineModal(false);
    }
  }

  async function runCsvExport(exporter: () => void) {
    if (isExportingCsv) return;

    setIsExportingCsv(true);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    try {
      exporter();
    } finally {
      setIsExportingCsv(false);
    }
  }

  function exportProjects(card: StatusCard, projects: MapProject[]) {
    if (!projects.length) {
      setFeedback({ type: "error", message: "Nenhuma obra para exportar." });
      return;
    }

    exportCsv(
      `mapa_programacao_${card.key.toLowerCase()}_${today}.csv`,
      [
        "SOB",
        "Projeto",
        "Centro",
        "Contrato",
        "Tipo",
        "Municipio",
        "Ultima data",
        "Equipe",
        "Encarregado",
        "Estado Trabalho",
        "Status Programacao",
        "Etapas",
        "Equipes",
        "Dias desde ultima",
        "Motivo",
      ],
      projects.map((project) => [
        project.sob,
        project.projectName,
        project.serviceCenter,
        project.contract,
        project.serviceType,
        project.city,
        formatDate(project.latestDate),
        formatNameList(project.latestTeamNames),
        formatNameList(project.latestForemanNames),
        project.latestWorkCompletionLabel,
        project.latestProgrammingStatus,
        project.stageCount,
        project.teamCount,
        project.daysSinceLatest,
        project.reason,
      ]),
    );
  }

  function exportTeamsWithoutProgramming() {
    if (!filteredTeams.length) {
      setFeedback({ type: "error", message: "Nenhuma equipe sem programacao para exportar." });
      return;
    }

    exportCsv(
      `mapa_programacao_equipes_sem_programacao_${today}.csv`,
      ["Equipe", "Tipo", "Centro de servico", "Encarregado", "Placa", "Periodo"],
      filteredTeams.map((team) => [
        team.name,
        team.teamType,
        team.serviceCenter,
        team.foremanName,
        team.vehiclePlate,
        periodLabel,
      ]),
    );
  }

  return (
    <section className={styles.wrapper}>
      <ExportProgressModal
        open={isExportingCsv}
        title="Gerando..."
        message="Gerando arquivo CSV."
      />
      {feedback ? (
        <div className={feedback.type === "error" ? styles.errorMessage : styles.successMessage}>
          {feedback.message}
        </div>
      ) : null}

      <article className={styles.toolbar}>
        <div>
          <h2>Mapa de Programacao</h2>
          <p>
            Carteira consolidada por obra e ultima programacao.
            {activeFilters.serviceScope === "MANUTENCAO"
              ? " Tipo: Manutencao (inclui Emergencial)."
              : " Tipo: Obras (tudo que nao e Manutencao nem Emergencial)."}
          </p>
        </div>
        <div className={styles.quickActions}>
          <button type="button" className={styles.ghostButton} onClick={clearPeriod} disabled={isLoading}>
            Sem periodo
          </button>
          <button type="button" className={styles.ghostButton} onClick={() => setPeriod(1)} disabled={isLoading}>
            Hoje
          </button>
          <button type="button" className={styles.ghostButton} onClick={() => setPeriod(7)} disabled={isLoading}>
            Semana
          </button>
          <button type="button" className={styles.ghostButton} onClick={() => setPeriod(15)} disabled={isLoading}>
            15 dias
          </button>
          <button type="button" className={styles.ghostButton} onClick={() => setPeriod(30)} disabled={isLoading}>
            30 dias
          </button>
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span>Data inicial</span>
            <input type="date" value={draftFilters.startDate} onChange={(event) => updateDraftField("startDate", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Data final</span>
            <input type="date" value={draftFilters.endDate} onChange={(event) => updateDraftField("endDate", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Tipo</span>
            <select
              value={draftFilters.serviceScope}
              onChange={(event) => changeServiceScope(event.target.value === "MANUTENCAO" ? "MANUTENCAO" : "OBRAS")}
              disabled={isLoading}
            >
              <option value="OBRAS">Obras</option>
              <option value="MANUTENCAO">Manutencao</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Centro de servico</span>
            <select value={draftFilters.serviceCenter} onChange={(event) => updateDraftField("serviceCenter", event.target.value)}>
              <option value="">Todos</option>
              {serviceCenterOptions.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Obra</span>
            <input value={draftFilters.projectSearch} onChange={(event) => updateDraftField("projectSearch", event.target.value)} placeholder="SOB, projeto, status" />
          </label>
          <label className={styles.field}>
            <span>Equipe</span>
            <input value={draftFilters.teamSearch} onChange={(event) => updateDraftField("teamSearch", event.target.value)} placeholder="Equipe, encarregado, placa" />
          </label>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.primaryButton} onClick={applyFilters} disabled={isLoading}>
            {isLoading ? "Carregando..." : "Aplicar"}
          </button>
          <button type="button" className={styles.secondaryButton} onClick={() => void loadData()} disabled={isLoading}>
            Atualizar
          </button>
        </div>
      </article>

      <ProgrammingDeadlinePanel
        summary={deadlineSummary}
        windowHeading={deadlineWindowHeading}
        viewMode={deadlineViewMode}
        windowDays={deadlineWindowDays}
        pages={deadlineSobPages}
        carouselPage={deadlineCarouselPage}
        totalPages={totalDeadlineCarouselPages}
        onViewModeChange={setDeadlineViewMode}
        onOpenModal={() => setIsDeadlineModalOpen(true)}
        onPreviousPage={() => setDeadlineCarouselPage((current) => Math.max(0, current - 1))}
        onNextPage={() =>
          setDeadlineCarouselPage((current) => Math.min(totalDeadlineCarouselPages - 1, current + 1))
        }
      />

      <div className={styles.summaryGrid}>
        {statusCards.map((card) => {
          const visibleCount = filterProjects(card.projects).length;
          return (
            <button
              type="button"
              key={card.key}
              className={`${styles.summaryCard} ${getCardClassName(card.key)}`}
              onClick={() => setSelectedCardKey(card.key)}
            >
              <span>{card.title}</span>
              <strong>{visibleCount}</strong>
              <small>{card.description}</small>
            </button>
          );
        })}
      </div>

      <div className={styles.contentGrid}>
        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h3>Obras prioritarias</h3>
              <span>Indicadores de carteira nao mudam com o periodo; a data afeta apenas equipes.</span>
            </div>
          </div>
          <ProjectTable
            projects={filteredPriorityProjects}
            page={priorityPage}
            onPageChange={setPriorityPage}
            emptyMessage="Nenhuma obra prioritaria para os filtros atuais."
            onProjectClick={setSelectedProject}
          />
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h3>Equipes sem programacao</h3>
              <span>{data?.filters?.teamPeriodEnabled ? periodLabel : "Informe periodo para analisar equipes."}</span>
            </div>
            <button type="button" className={styles.secondaryButton} onClick={() => void runCsvExport(exportTeamsWithoutProgramming)} disabled={isExportingCsv || !data?.filters?.teamPeriodEnabled}>
              {isExportingCsv ? "Exportando..." : "Exportar CSV"}
            </button>
          </div>
          <div className={styles.teamList}>
            {data?.filters?.teamPeriodEnabled ? (
              filteredTeams.length ? filteredTeams.map((team) => (
                <article key={team.id} className={styles.teamItem}>
                  <strong>{team.name}</strong>
                  <span>{team.teamType} | {team.serviceCenter}</span>
                  <span>{team.foremanName}</span>
                  <small>{team.vehiclePlate || "-"}</small>
                </article>
              )) : (
                <div className={styles.emptyState}>Nenhuma equipe sem programacao para os filtros atuais.</div>
              )
            ) : (
              <div className={styles.emptyState}>Periodo nao informado.</div>
            )}
          </div>
        </article>
      </div>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h3>Obras nunca programadas</h3>
            <span>Carteira valida sem historico em Programacao.</span>
          </div>
        </div>
        <ProjectTable
          projects={filteredNeverProgrammedProjects}
          page={neverProgrammedPage}
          onPageChange={setNeverProgrammedPage}
          emptyMessage="Nenhuma obra nunca programada para os filtros atuais."
          onProjectClick={setSelectedProject}
        />
      </article>

      <ProgrammingDeadlineModal
        isOpen={isDeadlineModalOpen}
        items={deadlineSobCards}
        windowDays={deadlineWindowDays}
        isExporting={isExportingDeadlineModal}
        onClose={() => setIsDeadlineModalOpen(false)}
        onExport={() => void handleExportDeadlineModalCsv()}
      />

      {selectedCard ? (
        <div className={styles.modalBackdrop} role="presentation" onClick={() => setSelectedCardKey(null)}>
          <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="map-programming-modal-title" onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h3 id="map-programming-modal-title">{selectedCard.title}</h3>
                <span>{filteredSelectedProjects.length} obras</span>
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.secondaryButton} onClick={() => void runCsvExport(() => exportProjects(selectedCard, filteredSelectedProjects))} disabled={isExportingCsv}>
                  {isExportingCsv ? "Exportando..." : "Exportar CSV"}
                </button>
                <button type="button" className={styles.ghostButton} onClick={() => setSelectedCardKey(null)}>
                  Fechar
                </button>
              </div>
            </div>
            <ProjectTable
              projects={filteredSelectedProjects}
              page={selectedCardPage}
              onPageChange={setSelectedCardPage}
              emptyMessage="Nenhuma obra encontrada para os filtros atuais."
              onProjectClick={setSelectedProject}
            />
          </section>
        </div>
      ) : null}

      {selectedProject ? (
        <div className={styles.modalBackdrop} role="presentation" onClick={() => setSelectedProject(null)}>
          <section className={styles.detailModal} role="dialog" aria-modal="true" aria-labelledby="map-programming-project-title" onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h3 id="map-programming-project-title">ID: {selectedProject.id}</h3>
              </div>
              <button type="button" className={styles.ghostButton} onClick={() => setSelectedProject(null)}>
                Fechar
              </button>
            </div>
            <ProjectMiniCard project={selectedProject} expanded />
          </section>
        </div>
      ) : null}
    </section>
  );
}