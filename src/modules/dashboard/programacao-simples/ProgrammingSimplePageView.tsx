"use client";

import { FormEvent, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import styles from "./ProgrammingSimplePageView.module.css";

type PeriodMode = "integral" | "partial";
type ProgrammingStatus = "PROGRAMADA" | "ADIADA" | "CANCELADA";
type DocumentKey = "sgd" | "pi" | "pep";

type ProjectItem = {
  id: string;
  code: string;
  city: string;
  base: string;
  serviceType: string;
};

type TeamItem = {
  id: string;
  name: string;
  serviceCenterName: string;
};

type SupportOptionItem = {
  id: string;
  description: string;
};

type DocumentEntry = {
  number: string;
  deliveredAt: string;
};

type ActivityCatalogItem = {
  id: string;
  code: string;
  description: string;
  unit: string;
};

type ActivityItem = {
  catalogId: string;
  code: string;
  description: string;
  quantity: number;
  unit: string;
};

type ScheduleItem = {
  id: string;
  projectId: string;
  teamId: string;
  status: ProgrammingStatus;
  date: string;
  period: PeriodMode;
  startTime: string;
  endTime: string;
  updatedAt: string;
};

type ProgrammingResponse = {
  projects?: ProjectItem[];
  teams?: TeamItem[];
  supportOptions?: SupportOptionItem[];
  schedules?: ScheduleItem[];
  message?: string;
};

type ActivityCatalogResponse = {
  items?: ActivityCatalogItem[];
  message?: string;
};

type BatchCreateResponse = {
  success?: boolean;
  insertedCount?: number;
  message?: string;
};

type FormState = {
  projectId: string;
  date: string;
  period: PeriodMode;
  startTime: string;
  endTime: string;
  feeder: string;
  supportItemId: string;
  note: string;
  teamIds: string[];
  teamSearch: string;
  activitySearch: string;
  activityQuantity: string;
  activities: ActivityItem[];
  documents: Record<DocumentKey, DocumentEntry>;
};

type FilterState = {
  startDate: string;
  endDate: string;
  projectId: string;
  teamId: string;
  status: "TODOS" | ProgrammingStatus;
};

const PAGE_SIZE = 20;
const DOCUMENT_KEYS: Array<{ key: DocumentKey; label: string }> = [
  { key: "sgd", label: "SGD" },
  { key: "pi", label: "PI" },
  { key: "pep", label: "PEP" },
];

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: string, amount: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + amount);
  return toIsoDate(date);
}

function formatDate(value: string) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("pt-BR");
}

function formatDateTime(value: string) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("pt-BR");
}

function calculateExpectedMinutes(startTime: string, endTime: string, period: PeriodMode) {
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;

  if (Number.isFinite(startTotal) && Number.isFinite(endTotal) && endTotal > startTotal) {
    return endTotal - startTotal;
  }

  return period === "integral" ? 480 : 240;
}

function createEmptyDocuments(): Record<DocumentKey, DocumentEntry> {
  return {
    sgd: { number: "", deliveredAt: "" },
    pi: { number: "", deliveredAt: "" },
    pep: { number: "", deliveredAt: "" },
  };
}

function createInitialForm(initialDate: string): FormState {
  return {
    projectId: "",
    date: initialDate,
    period: "integral",
    startTime: "08:00",
    endTime: "17:00",
    feeder: "",
    supportItemId: "",
    note: "",
    teamIds: [],
    teamSearch: "",
    activitySearch: "",
    activityQuantity: "1",
    activities: [],
    documents: createEmptyDocuments(),
  };
}

function activityOptionLabel(item: ActivityCatalogItem) {
  return `${item.code} - ${item.description}`;
}

function findActivityOption(value: string, options: ActivityCatalogItem[]) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return (
    options.find((item) => {
      return item.code.toLowerCase() === normalized || activityOptionLabel(item).toLowerCase() === normalized;
    }) ?? null
  );
}

function escapeCsvValue(value: string | number) {
  const raw = String(value ?? "").replace(/\r?\n|\r/g, " ").trim();
  if (raw.includes(";") || raw.includes('"')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function downloadCsvFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ProgrammingSimplePageView() {
  const { session } = useAuth();
  const accessToken = session?.accessToken ?? null;

  const today = useMemo(() => toIsoDate(new Date()), []);
  const [form, setForm] = useState<FormState>(() => createInitialForm(today));
  const [filterDraft, setFilterDraft] = useState<FilterState>({
    startDate: today,
    endDate: addDays(today, 6),
    projectId: "",
    teamId: "",
    status: "TODOS",
  });
  const [activeFilters, setActiveFilters] = useState<FilterState>({
    startDate: today,
    endDate: addDays(today, 6),
    projectId: "",
    teamId: "",
    status: "TODOS",
  });

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [supportOptions, setSupportOptions] = useState<SupportOptionItem[]>([]);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [activityOptions, setActivityOptions] = useState<ActivityCatalogItem[]>([]);
  const [page, setPage] = useState(1);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingActivities, setIsLoadingActivities] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const deferredActivitySearch = useDeferredValue(form.activitySearch);
  const selectedProject = projects.find((item) => item.id === form.projectId) ?? null;
  const availableTeams = useMemo(() => {
    if (!selectedProject) {
      return teams;
    }

    return teams.filter((team) => team.serviceCenterName === selectedProject.base);
  }, [selectedProject, teams]);

  const visibleTeamOptions = useMemo(() => {
    const search = form.teamSearch.trim().toLowerCase();
    if (!search) {
      return availableTeams;
    }

    return availableTeams.filter((team) => team.name.toLowerCase().includes(search));
  }, [availableTeams, form.teamSearch]);

  const projectMap = useMemo(() => new Map(projects.map((item) => [item.id, item])), [projects]);
  const teamMap = useMemo(() => new Map(teams.map((item) => [item.id, item])), [teams]);

  const filteredSchedules = useMemo(() => {
    return schedules.filter((item) => {
      if (activeFilters.projectId && item.projectId !== activeFilters.projectId) {
        return false;
      }

      if (activeFilters.teamId && item.teamId !== activeFilters.teamId) {
        return false;
      }

      if (activeFilters.status !== "TODOS" && item.status !== activeFilters.status) {
        return false;
      }

      return true;
    });
  }, [activeFilters.projectId, activeFilters.status, activeFilters.teamId, schedules]);

  const totalPages = Math.max(1, Math.ceil(filteredSchedules.length / PAGE_SIZE));
  const pagedSchedules = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredSchedules.slice(start, start + PAGE_SIZE);
  }, [filteredSchedules, page]);

  const loadBoardData = useCallback(async () => {
    if (!accessToken) {
      return;
    }

    setIsLoadingList(true);
    try {
      const response = await fetch(
        `/api/programacao?startDate=${activeFilters.startDate}&endDate=${activeFilters.endDate}`,
        {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      const data = (await response.json().catch(() => ({}))) as ProgrammingResponse;
      if (!response.ok) {
        setProjects([]);
        setTeams([]);
        setSchedules([]);
        setSupportOptions([]);
        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao carregar programacao.",
        });
        return;
      }

      const nextProjects = data.projects ?? [];
      const nextTeams = data.teams ?? [];
      const nextSchedules = (data.schedules ?? []).sort((left, right) => {
        if (left.date === right.date) {
          return left.startTime.localeCompare(right.startTime);
        }

        return left.date.localeCompare(right.date);
      });

      setProjects(nextProjects);
      setTeams(nextTeams);
      setSupportOptions(data.supportOptions ?? []);
      setSchedules(nextSchedules);
    } catch {
      setProjects([]);
      setTeams([]);
      setSchedules([]);
      setSupportOptions([]);
      setFeedback({
        type: "error",
        message: "Falha ao carregar programacao.",
      });
    } finally {
      setIsLoadingList(false);
    }
  }, [accessToken, activeFilters.endDate, activeFilters.startDate]);

  useEffect(() => {
    void loadBoardData();
  }, [loadBoardData]);

  useEffect(() => {
    if (!accessToken || deferredActivitySearch.trim().length < 2) {
      setActivityOptions([]);
      setIsLoadingActivities(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsLoadingActivities(true);
      try {
        const response = await fetch(
          `/api/projects/activity-forecast/catalog?q=${encodeURIComponent(deferredActivitySearch.trim())}`,
          {
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            signal: controller.signal,
          },
        );

        const data = (await response.json().catch(() => ({}))) as ActivityCatalogResponse;
        if (!response.ok) {
          setActivityOptions([]);
          return;
        }

        setActivityOptions(data.items ?? []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setActivityOptions([]);
        }
      } finally {
        setIsLoadingActivities(false);
      }
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [accessToken, deferredActivitySearch]);

  useEffect(() => {
    setPage(1);
  }, [activeFilters.projectId, activeFilters.status, activeFilters.teamId, schedules]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    setForm((current) => {
      const validTeamIds = current.teamIds.filter((teamId) =>
        availableTeams.some((team) => team.id === teamId),
      );

      if (validTeamIds.length === current.teamIds.length) {
        return current;
      }

      return { ...current, teamIds: validTeamIds };
    });
  }, [availableTeams, selectedProject]);

  function updateFormField<Key extends keyof FormState>(field: Key, value: FormState[Key]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateFilterField<Key extends keyof FilterState>(field: Key, value: FilterState[Key]) {
    setFilterDraft((current) => ({ ...current, [field]: value }));
  }

  function toggleTeam(teamId: string) {
    setForm((current) => ({
      ...current,
      teamIds: current.teamIds.includes(teamId)
        ? current.teamIds.filter((item) => item !== teamId)
        : [...current.teamIds, teamId],
    }));
  }

  function selectAllVisibleTeams() {
    setForm((current) => ({
      ...current,
      teamIds: Array.from(new Set([...current.teamIds, ...visibleTeamOptions.map((team) => team.id)])),
    }));
  }

  function clearSelectedTeams() {
    setForm((current) => ({ ...current, teamIds: [] }));
  }

  function updateDocument(documentKey: DocumentKey, field: keyof DocumentEntry, value: string) {
    setForm((current) => ({
      ...current,
      documents: {
        ...current.documents,
        [documentKey]: {
          ...current.documents[documentKey],
          [field]: value,
        },
      },
    }));
  }

  function addActivity() {
    const selectedActivity = findActivityOption(form.activitySearch, activityOptions);
    const quantity = Number(form.activityQuantity);

    if (!selectedActivity || !Number.isFinite(quantity) || quantity <= 0) {
      setFeedback({
        type: "error",
        message: "Selecione uma atividade valida e informe uma quantidade maior que zero.",
      });
      return;
    }

    setForm((current) => {
      const existingIndex = current.activities.findIndex((item) => item.catalogId === selectedActivity.id);
      const nextActivities = [...current.activities];

      if (existingIndex >= 0) {
        nextActivities[existingIndex] = { ...nextActivities[existingIndex], quantity };
      } else {
        nextActivities.push({
          catalogId: selectedActivity.id,
          code: selectedActivity.code,
          description: selectedActivity.description,
          quantity,
          unit: selectedActivity.unit,
        });
      }

      return {
        ...current,
        activities: nextActivities,
        activitySearch: "",
        activityQuantity: "1",
      };
    });

    setFeedback(null);
  }

  function updateActivityQuantity(index: number, value: string) {
    const quantity = Number(value);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return;
    }

    setForm((current) => {
      const next = [...current.activities];
      if (!next[index]) {
        return current;
      }

      next[index] = { ...next[index], quantity };
      return { ...current, activities: next };
    });
  }

  function removeActivity(index: number) {
    setForm((current) => ({
      ...current,
      activities: current.activities.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para salvar programacao." });
      return;
    }

    if (!form.teamIds.length) {
      setFeedback({
        type: "error",
        message: "Selecione ao menos uma equipe para cadastrar a programacao.",
      });
      return;
    }

    const expectedMinutes = calculateExpectedMinutes(form.startTime, form.endTime, form.period);
    if (expectedMinutes <= 0) {
      setFeedback({ type: "error", message: "Informe um horario valido para a programacao." });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/programacao", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          action: "BATCH_CREATE",
          projectId: form.projectId,
          teamIds: form.teamIds,
          date: form.date,
          period: form.period,
          startTime: form.startTime,
          endTime: form.endTime,
          expectedMinutes,
          feeder: form.feeder.trim(),
          supportItemId: form.supportItemId || undefined,
          note: form.note.trim(),
          documents: DOCUMENT_KEYS.reduce(
            (accumulator, item) => {
              accumulator[item.key] = {
                number: form.documents[item.key].number.trim(),
                deliveredAt: form.documents[item.key].deliveredAt,
              };
              return accumulator;
            },
            {} as Record<DocumentKey, { number: string; deliveredAt: string }>,
          ),
          activities: form.activities
            .filter((item) => item.quantity > 0)
            .map((item) => ({ catalogId: item.catalogId, quantity: item.quantity })),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as BatchCreateResponse;
      if (!response.ok || !data.success) {
        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao cadastrar programacao em lote.",
        });
        return;
      }

      setFeedback({
        type: "success",
        message: data.message ?? "Programacao cadastrada com sucesso.",
      });
      setForm((current) => ({ ...current, teamIds: [] }));
      await loadBoardData();
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao cadastrar programacao em lote.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  function applyFilters() {
    if (filterDraft.startDate > filterDraft.endDate) {
      setFeedback({
        type: "error",
        message: "A data inicial nao pode ser maior que a data final.",
      });
      return;
    }

    setFeedback(null);
    setActiveFilters(filterDraft);
  }

  function clearFilters() {
    const reset: FilterState = {
      startDate: today,
      endDate: addDays(today, 6),
      projectId: "",
      teamId: "",
      status: "TODOS",
    };
    setFilterDraft(reset);
    setActiveFilters(reset);
    setFeedback(null);
  }

  async function handleExportCsv() {
    if (!filteredSchedules.length) {
      setFeedback({
        type: "error",
        message: "Nenhuma programacao encontrada para exportar com os filtros atuais.",
      });
      return;
    }

    setIsExporting(true);
    try {
      const header = ["Data", "Projeto", "Equipe", "Base", "Horario", "Periodo", "Status", "Atualizado em"];
      const rows = filteredSchedules.map((schedule) => {
        const project = projectMap.get(schedule.projectId);
        const team = teamMap.get(schedule.teamId);
        return [
          formatDate(schedule.date),
          project?.code ?? schedule.projectId,
          team?.name ?? schedule.teamId,
          team?.serviceCenterName ?? "-",
          `${schedule.startTime} - ${schedule.endTime}`,
          schedule.period === "integral" ? "Integral" : "Parcial",
          schedule.status,
          formatDateTime(schedule.updatedAt),
        ];
      });

      const csvLines = [header, ...rows].map((line) => line.map((item) => escapeCsvValue(item)).join(";"));
      const csv = `\uFEFF${csvLines.join("\n")}`;
      const exportDate = new Date().toISOString().slice(0, 10);
      downloadCsvFile(csv, `programacao_simples_${exportDate}.csv`);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <section className={styles.wrapper}>
      {feedback ? (
        <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>{feedback.message}</div>
      ) : null}

      <article className={styles.card}>
        <h3 className={styles.cardTitle}>Cadastro de Programacao</h3>

        <form className={styles.formGrid} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>
              Projeto <span className="requiredMark">*</span>
            </span>
            <select
              value={form.projectId}
              onChange={(event) => updateFormField("projectId", event.target.value)}
              required
            >
              <option value="">Selecione</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} | {project.city} | {project.base}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>
              Data <span className="requiredMark">*</span>
            </span>
            <input type="date" value={form.date} onChange={(event) => updateFormField("date", event.target.value)} required />
          </label>

          <label className={styles.field}>
            <span>
              Periodo <span className="requiredMark">*</span>
            </span>
            <select
              value={form.period}
              onChange={(event) => updateFormField("period", event.target.value as PeriodMode)}
            >
              <option value="integral">Integral</option>
              <option value="partial">Parcial</option>
            </select>
          </label>

          <label className={styles.field}>
            <span>
              Hora inicio <span className="requiredMark">*</span>
            </span>
            <input
              type="time"
              value={form.startTime}
              onChange={(event) => updateFormField("startTime", event.target.value)}
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Hora termino <span className="requiredMark">*</span>
            </span>
            <input
              type="time"
              value={form.endTime}
              onChange={(event) => updateFormField("endTime", event.target.value)}
              required
            />
          </label>

          <label className={styles.field}>
            <span>Apoio</span>
            <select
              value={form.supportItemId}
              onChange={(event) => updateFormField("supportItemId", event.target.value)}
            >
              <option value="">Selecione</option>
              {supportOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.description}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Alimentador</span>
            <input
              type="text"
              value={form.feeder}
              onChange={(event) => updateFormField("feeder", event.target.value)}
              placeholder="Ex.: AL-09"
            />
          </label>

          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Anotacao</span>
            <textarea
              value={form.note}
              onChange={(event) => updateFormField("note", event.target.value)}
              rows={4}
              placeholder="Observacoes operacionais para todas as equipes selecionadas."
            />
          </label>

          <div className={`${styles.field} ${styles.fieldWide}`}>
            <span>
              Equipes <span className="requiredMark">*</span>
            </span>
            <div className={styles.teamSelectionCard}>
              <div className={styles.teamSelectionHeader}>
                <input
                  type="text"
                  value={form.teamSearch}
                  onChange={(event) => updateFormField("teamSearch", event.target.value)}
                  placeholder="Buscar equipe..."
                />
                <div className={styles.actions}>
                  <button type="button" className={styles.ghostButton} onClick={selectAllVisibleTeams}>
                    Marcar visiveis
                  </button>
                  <button type="button" className={styles.ghostButton} onClick={clearSelectedTeams}>
                    Limpar
                  </button>
                </div>
              </div>

              {selectedProject ? (
                <p className={styles.helperText}>
                  Base do projeto selecionado: <strong>{selectedProject.base}</strong>. Somente equipes dessa base sao exibidas.
                </p>
              ) : (
                <p className={styles.helperText}>Selecione um projeto para limitar as equipes pela base.</p>
              )}

              <div className={styles.teamList}>
                {visibleTeamOptions.length ? (
                  visibleTeamOptions.map((team) => (
                    <label key={team.id} className={styles.teamOption}>
                      <input
                        type="checkbox"
                        checked={form.teamIds.includes(team.id)}
                        onChange={() => toggleTeam(team.id)}
                      />
                      <div>
                        <strong>{team.name}</strong>
                        <small>{team.serviceCenterName}</small>
                      </div>
                    </label>
                  ))
                ) : (
                  <p className={styles.emptyHint}>Nenhuma equipe disponivel para o filtro atual.</p>
                )}
              </div>
            </div>
          </div>

          <div className={`${styles.field} ${styles.fieldWide}`}>
            <span>Atividades</span>
            <div className={styles.activityComposer}>
              <label className={styles.field}>
                <span>Codigo da atividade</span>
                <input
                  list="programming-simple-activity-list"
                  value={form.activitySearch}
                  onChange={(event) => updateFormField("activitySearch", event.target.value)}
                  placeholder={isLoadingActivities ? "Buscando atividades..." : "Digite codigo e selecione"}
                />
              </label>
              <label className={styles.field}>
                <span>Quantidade</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.activityQuantity}
                  onChange={(event) => updateFormField("activityQuantity", event.target.value)}
                />
              </label>
              <button type="button" className={styles.secondaryButton} onClick={addActivity}>
                Incluir atividade
              </button>
            </div>

            <div className={styles.activitiesList}>
              {form.activities.length ? (
                form.activities.map((item, index) => (
                  <div key={item.catalogId} className={styles.activityRow}>
                    <div>
                      <strong>{item.code}</strong>
                      <small>{item.description}</small>
                    </div>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={item.quantity}
                      onChange={(event) => updateActivityQuantity(index, event.target.value)}
                    />
                    <span>{item.unit}</span>
                    <button type="button" className={styles.ghostButton} onClick={() => removeActivity(index)}>
                      Remover
                    </button>
                  </div>
                ))
              ) : (
                <p className={styles.emptyHint}>Nenhuma atividade incluida.</p>
              )}
            </div>
          </div>

          <div className={`${styles.field} ${styles.fieldWide}`}>
            <span>Documentos</span>
            <div className={styles.documentsGrid}>
              {DOCUMENT_KEYS.map((item) => (
                <div key={item.key} className={styles.documentCard}>
                  <label className={styles.field}>
                    <span>{item.label}</span>
                    <input
                      value={form.documents[item.key].number}
                      onChange={(event) => updateDocument(item.key, "number", event.target.value)}
                      placeholder={`Numero ${item.label}`}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Data entrega</span>
                    <input
                      type="date"
                      value={form.documents[item.key].deliveredAt}
                      onChange={(event) => updateDocument(item.key, "deliveredAt", event.target.value)}
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div className={`${styles.actions} ${styles.formActions}`}>
            <button type="submit" className={styles.primaryButton} disabled={isSaving || !form.projectId || !form.teamIds.length}>
              {isSaving ? "Salvando..." : "Cadastrar para equipes selecionadas"}
            </button>
          </div>
        </form>
      </article>

      <article className={styles.card}>
        <h3 className={styles.cardTitle}>Filtros</h3>
        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span>Data inicial</span>
            <input
              type="date"
              value={filterDraft.startDate}
              onChange={(event) => updateFilterField("startDate", event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Data final</span>
            <input type="date" value={filterDraft.endDate} onChange={(event) => updateFilterField("endDate", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Projeto</span>
            <select value={filterDraft.projectId} onChange={(event) => updateFilterField("projectId", event.target.value)}>
              <option value="">Todos</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Equipe</span>
            <select value={filterDraft.teamId} onChange={(event) => updateFilterField("teamId", event.target.value)}>
              <option value="">Todas</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Status</span>
            <select
              value={filterDraft.status}
              onChange={(event) => updateFilterField("status", event.target.value as FilterState["status"])}
            >
              <option value="TODOS">Todos</option>
              <option value="PROGRAMADA">Programada</option>
              <option value="ADIADA">Adiada</option>
              <option value="CANCELADA">Cancelada</option>
            </select>
          </label>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.secondaryButton} onClick={applyFilters} disabled={isLoadingList}>
            Aplicar
          </button>
          <button type="button" className={styles.ghostButton} onClick={clearFilters} disabled={isLoadingList}>
            Limpar
          </button>
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.tableHeader}>
          <h3 className={styles.cardTitle}>Lista de Programacoes</h3>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => void handleExportCsv()}
            disabled={isExporting || isLoadingList || !filteredSchedules.length}
          >
            {isExporting ? "Exportando..." : "Exportar Excel (CSV)"}
          </button>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Projeto</th>
                <th>Equipe</th>
                <th>Base</th>
                <th>Horario</th>
                <th>Periodo</th>
                <th>Status</th>
                <th>Atualizado em</th>
              </tr>
            </thead>
            <tbody>
              {pagedSchedules.length ? (
                pagedSchedules.map((schedule) => {
                  const project = projectMap.get(schedule.projectId);
                  const team = teamMap.get(schedule.teamId);
                  return (
                    <tr key={schedule.id}>
                      <td>{formatDate(schedule.date)}</td>
                      <td>{project?.code ?? schedule.projectId}</td>
                      <td>{team?.name ?? schedule.teamId}</td>
                      <td>{team?.serviceCenterName ?? "-"}</td>
                      <td>{schedule.startTime} - {schedule.endTime}</td>
                      <td>{schedule.period === "integral" ? "Integral" : "Parcial"}</td>
                      <td>{schedule.status}</td>
                      <td>{formatDateTime(schedule.updatedAt)}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className={styles.emptyRow}>
                    {isLoadingList
                      ? "Carregando programacoes..."
                      : "Nenhuma programacao encontrada para os filtros informados."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className={styles.pagination}>
          <span>
            Pagina {Math.min(page, totalPages)} de {totalPages} | Total: {filteredSchedules.length}
          </span>
          <div className={styles.paginationActions}>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1 || isLoadingList}
            >
              Anterior
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages || isLoadingList}
            >
              Proxima
            </button>
          </div>
        </div>
      </article>

      <datalist id="programming-simple-activity-list">
        {activityOptions.map((item) => (
          <option key={item.id} value={activityOptionLabel(item)} />
        ))}
      </datalist>
    </section>
  );
}
