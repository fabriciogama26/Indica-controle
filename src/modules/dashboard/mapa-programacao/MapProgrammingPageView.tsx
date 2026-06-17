"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import styles from "./MapProgrammingPageView.module.css";

type DeadlineStatus = "OVERDUE" | "TODAY" | "SOON" | "NORMAL" | "NO_DEADLINE";

type NeverProgrammedProject = {
  id: string;
  sob: string;
  serviceCenter: string;
  priority: string;
  serviceType: string;
  city: string;
  executionDeadline: string;
  daysUntilDeadline: number | null;
  deadlineStatus: DeadlineStatus;
};

type TeamWithoutProgramming = {
  id: string;
  name: string;
  vehiclePlate: string;
  serviceCenter: string;
  teamType: string;
  foremanName: string;
};

type MapProgrammingResponse = {
  filters?: {
    startDate: string;
    endDate: string;
    generatedAt: string;
  };
  summary?: {
    activeProjectCount: number;
    neverProgrammedProjectCount: number;
    overdueNeverProgrammedProjectCount: number;
    dueSoonNeverProgrammedProjectCount: number;
    noDeadlineNeverProgrammedProjectCount: number;
    activeTeamCount: number;
    teamsWithoutProgrammingCount: number;
    programmedTeamCount: number;
  };
  neverProgrammedProjects?: NeverProgrammedProject[];
  teamsWithoutProgramming?: TeamWithoutProgramming[];
  message?: string;
};

type FilterState = {
  startDate: string;
  endDate: string;
  projectSearch: string;
  teamSearch: string;
  serviceCenter: string;
};

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return toIsoDate(value);
}

function formatDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value || "-";
  }
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getDeadlineLabel(item: NeverProgrammedProject) {
  if (item.deadlineStatus === "NO_DEADLINE") return "Sem data limite";
  if (item.daysUntilDeadline === null) return "-";
  if (item.daysUntilDeadline < 0) return `Vencida ha ${Math.abs(item.daysUntilDeadline)} dias`;
  if (item.daysUntilDeadline === 0) return "Vence hoje";
  return `Vence em ${item.daysUntilDeadline} dias`;
}

function getDeadlineClassName(status: DeadlineStatus) {
  if (status === "OVERDUE") return styles.statusOverdue;
  if (status === "TODAY") return styles.statusToday;
  if (status === "SOON") return styles.statusSoon;
  if (status === "NO_DEADLINE") return styles.statusMuted;
  return styles.statusNormal;
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
  const [draftFilters, setDraftFilters] = useState<FilterState>(() => ({
    startDate: today,
    endDate: addDays(today, 6),
    projectSearch: "",
    teamSearch: "",
    serviceCenter: "",
  }));
  const [activeFilters, setActiveFilters] = useState<FilterState>(() => ({
    startDate: today,
    endDate: addDays(today, 6),
    projectSearch: "",
    teamSearch: "",
    serviceCenter: "",
  }));
  const [data, setData] = useState<MapProgrammingResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const accessToken = session?.accessToken ?? "";

  const loadData = useCallback(async () => {
    if (!accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para carregar Mapa de Programacao." });
      return;
    }

    setIsLoading(true);
    setFeedback(null);

    try {
      const query = new URLSearchParams({
        startDate: activeFilters.startDate,
        endDate: activeFilters.endDate,
      });
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao carregar Mapa de Programacao.";
      setFeedback({ type: "error", message });
      await logError("Falha ao carregar Mapa de Programacao.", error, {
        operation: "load_map_programming",
        startDate: activeFilters.startDate,
        endDate: activeFilters.endDate,
      });
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, activeFilters.endDate, activeFilters.startDate, logError]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const serviceCenterOptions = useMemo(() => {
    const values = new Set<string>();
    for (const project of data?.neverProgrammedProjects ?? []) {
      if (project.serviceCenter) values.add(project.serviceCenter);
    }
    for (const team of data?.teamsWithoutProgramming ?? []) {
      if (team.serviceCenter) values.add(team.serviceCenter);
    }
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }, [data]);

  const filteredProjects = useMemo(() => {
    const search = normalizeSearch(activeFilters.projectSearch);
    return (data?.neverProgrammedProjects ?? []).filter((project) => {
      if (activeFilters.serviceCenter && project.serviceCenter !== activeFilters.serviceCenter) return false;
      if (!search) return true;
      return normalizeSearch(`${project.sob} ${project.serviceCenter} ${project.priority} ${project.serviceType} ${project.city}`)
        .includes(search);
    });
  }, [activeFilters.projectSearch, activeFilters.serviceCenter, data]);

  const filteredTeams = useMemo(() => {
    const search = normalizeSearch(activeFilters.teamSearch);
    return (data?.teamsWithoutProgramming ?? []).filter((team) => {
      if (activeFilters.serviceCenter && team.serviceCenter !== activeFilters.serviceCenter) return false;
      if (!search) return true;
      return normalizeSearch(`${team.name} ${team.foremanName} ${team.serviceCenter} ${team.teamType} ${team.vehiclePlate}`)
        .includes(search);
    });
  }, [activeFilters.serviceCenter, activeFilters.teamSearch, data]);

  const summary = data?.summary;
  const periodLabel = `${formatDate(activeFilters.startDate)} a ${formatDate(activeFilters.endDate)}`;

  function updateDraftField(field: keyof FilterState, value: string) {
    setDraftFilters((current) => ({ ...current, [field]: value }));
  }

  function applyFilters() {
    if (draftFilters.endDate < draftFilters.startDate) {
      setFeedback({ type: "error", message: "Data final deve ser maior ou igual a data inicial." });
      return;
    }
    setActiveFilters(draftFilters);
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

  function exportNeverProgrammedProjects() {
    if (!filteredProjects.length) {
      setFeedback({ type: "error", message: "Nenhuma obra nunca programada para exportar." });
      return;
    }

    exportCsv(
      `mapa_programacao_obras_nunca_programadas_${today}.csv`,
      ["SOB", "Centro de servico", "Prioridade", "Tipo de obra", "Municipio", "Data limite", "Status do prazo"],
      filteredProjects.map((project) => [
        project.sob,
        project.serviceCenter,
        project.priority,
        project.serviceType,
        project.city,
        formatDate(project.executionDeadline),
        getDeadlineLabel(project),
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
      {feedback ? (
        <div className={feedback.type === "error" ? styles.errorMessage : styles.successMessage}>
          {feedback.message}
        </div>
      ) : null}

      <article className={styles.toolbar}>
        <div>
          <h2>Filtros do Mapa de Programacao</h2>
          <p>Controle de carteira nunca programada e disponibilidade de equipes no periodo.</p>
        </div>
        <div className={styles.quickActions}>
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
            <input value={draftFilters.projectSearch} onChange={(event) => updateDraftField("projectSearch", event.target.value)} placeholder="SOB, municipio, prioridade" />
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

      <div className={styles.summaryGrid}>
        <article className={styles.summaryCard}>
          <span>Obras ativas</span>
          <strong>{summary?.activeProjectCount ?? 0}</strong>
        </article>
        <article className={`${styles.summaryCard} ${styles.summaryAlert}`}>
          <span>Nunca programadas</span>
          <strong>{summary?.neverProgrammedProjectCount ?? 0}</strong>
        </article>
        <article className={`${styles.summaryCard} ${styles.summaryDanger}`}>
          <span>Vencidas sem programacao</span>
          <strong>{summary?.overdueNeverProgrammedProjectCount ?? 0}</strong>
        </article>
        <article className={`${styles.summaryCard} ${styles.summaryWarning}`}>
          <span>Vencem em ate 15 dias</span>
          <strong>{summary?.dueSoonNeverProgrammedProjectCount ?? 0}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span>Equipes sem programacao</span>
          <strong>{summary?.teamsWithoutProgrammingCount ?? 0}</strong>
        </article>
      </div>

      <div className={styles.contentGrid}>
        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h3>Obras nunca programadas</h3>
              <span>Projetos ativos da carteira sem nenhum historico em Programacao.</span>
            </div>
            <button type="button" className={styles.secondaryButton} onClick={exportNeverProgrammedProjects}>
              Exportar CSV
            </button>
          </div>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>SOB</th>
                  <th>Centro</th>
                  <th>Prioridade</th>
                  <th>Tipo</th>
                  <th>Municipio</th>
                  <th>Data limite</th>
                  <th>Status</th>
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {filteredProjects.length ? filteredProjects.map((project) => (
                  <tr key={project.id}>
                    <td>{project.sob}</td>
                    <td>{project.serviceCenter}</td>
                    <td>{project.priority}</td>
                    <td>{project.serviceType}</td>
                    <td>{project.city}</td>
                    <td>{formatDate(project.executionDeadline)}</td>
                    <td><span className={`${styles.statusPill} ${getDeadlineClassName(project.deadlineStatus)}`}>{getDeadlineLabel(project)}</span></td>
                    <td><Link className={styles.tableLink} href="/programacao-simples">Programar</Link></td>
                  </tr>
                )) : (
                  <tr><td colSpan={8} className={styles.emptyRow}>Nenhuma obra nunca programada para os filtros atuais.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h3>Equipes sem programacao</h3>
              <span>Equipes ativas sem programacao PROGRAMADA/REPROGRAMADA no periodo {periodLabel}.</span>
            </div>
            <button type="button" className={styles.secondaryButton} onClick={exportTeamsWithoutProgramming}>
              Exportar CSV
            </button>
          </div>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Equipe</th>
                  <th>Tipo</th>
                  <th>Centro</th>
                  <th>Encarregado</th>
                  <th>Placa</th>
                </tr>
              </thead>
              <tbody>
                {filteredTeams.length ? filteredTeams.map((team) => (
                  <tr key={team.id}>
                    <td>{team.name}</td>
                    <td>{team.teamType}</td>
                    <td>{team.serviceCenter}</td>
                    <td>{team.foremanName}</td>
                    <td>{team.vehiclePlate || "-"}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={5} className={styles.emptyRow}>Nenhuma equipe sem programacao para os filtros atuais.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </div>
    </section>
  );
}
