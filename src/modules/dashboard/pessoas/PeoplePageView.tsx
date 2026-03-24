"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useExportCooldown } from "@/hooks/useExportCooldown";
import styles from "./PeoplePageView.module.css";

type PersonItem = {
  id: string;
  name: string;
  matriculation: string | null;
  jobTitleId: string;
  jobTitleName: string;
  jobTitleTypeId: string | null;
  jobTitleTypeName: string | null;
  jobLevel: string | null;
  isActive: boolean;
  cancellationReason: string | null;
  canceledAt: string | null;
  canceledByName: string | null;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

type PersonHistoryEntry = {
  id: string;
  changeType: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason: string | null;
  createdAt: string;
  createdByName: string;
  changes: Record<string, { from: string | null; to: string | null }>;
};

type JobTitleTypeOption = {
  id: string;
  jobTitleId: string;
  name: string;
};

type JobTitleOption = {
  id: string;
  code: string;
  name: string;
};

type JobLevelOption = {
  level: string;
};

type PersonFormState = {
  id: string | null;
  updatedAt: string | null;
  name: string;
  matriculation: string;
  jobTitleId: string;
  jobTitleTypeId: string;
  jobLevel: string;
};

type PersonFilterState = {
  name: string;
  matriculation: string;
  jobTitleId: string;
  jobTitleTypeId: string;
  jobLevel: string;
  status: "" | "ativo" | "inativo";
};

type PeopleListResponse = {
  people?: PersonItem[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

type PeopleMetaResponse = {
  jobTitleTypes?: JobTitleTypeOption[];
  jobTitles?: JobTitleOption[];
  jobLevels?: JobLevelOption[];
  message?: string;
};

type PersonHistoryResponse = {
  history?: PersonHistoryEntry[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

const PAGE_SIZE = 20;
const HISTORY_PAGE_SIZE = 5;
const EXPORT_PAGE_SIZE = 100;

const HISTORY_FIELD_LABELS: Record<string, string> = {
  name: "Nome",
  matriculation: "Matricula",
  jobTitleName: "Cargo",
  jobTitleTypeName: "Tipo",
  jobLevel: "Nivel",
  isActive: "Status",
  cancellationReason: "Motivo do cancelamento",
  canceledAt: "Data do cancelamento",
  activationReason: "Motivo da ativacao",
};

const INITIAL_FORM: PersonFormState = {
  id: null,
  updatedAt: null,
  name: "",
  matriculation: "",
  jobTitleId: "",
  jobTitleTypeId: "",
  jobLevel: "",
};

const INITIAL_FILTERS: PersonFilterState = {
  name: "",
  matriculation: "",
  jobTitleId: "",
  jobTitleTypeId: "",
  jobLevel: "",
  status: "",
};

function normalizeText(value: string) {
  return String(value ?? "").trim();
}

function normalizeMatriculation(value: string) {
  return normalizeText(value).toUpperCase();
}

function buildQuery(filters: PersonFilterState, page: number, pageSize = PAGE_SIZE) {
  const params = new URLSearchParams();
  if (filters.name.trim()) {
    params.set("name", filters.name.trim());
  }
  if (filters.matriculation.trim()) {
    params.set("matriculation", filters.matriculation.trim());
  }
  if (filters.jobTitleId.trim()) {
    params.set("jobTitleId", filters.jobTitleId.trim());
  }
  if (filters.jobTitleTypeId.trim()) {
    params.set("jobTitleTypeId", filters.jobTitleTypeId.trim());
  }
  if (filters.jobLevel.trim()) {
    params.set("jobLevel", filters.jobLevel.trim());
  }
  if (filters.status.trim()) {
    params.set("status", filters.status.trim());
  }
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return params.toString();
}

function escapeCsvValue(value: string | number | null | undefined) {
  const raw = String(value ?? "").replace(/\r?\n|\r/g, " ").trim();
  if (raw.includes(";") || raw.includes('"')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function buildPeopleCsv(personItems: PersonItem[]) {
  const header = [
    "Nome",
    "Matricula",
    "Cargo",
    "Tipo",
    "Nivel",
    "Status",
    "Registrado por",
    "Registrado em",
    "Atualizado por",
    "Atualizado em",
  ];
  const rows = personItems.map((person) => [
    person.name,
    person.matriculation ?? "-",
    person.jobTitleName,
    person.jobTitleTypeName ?? "-",
    person.jobLevel ?? "-",
    person.isActive ? "Ativo" : "Inativo",
    formatAuditActor(person.createdByName),
    formatDateTime(person.createdAt),
    formatAuditActor(person.updatedByName),
    formatDateTime(person.updatedAt),
  ]);

  const csvLines = [header, ...rows].map((line) => line.map((item) => escapeCsvValue(item)).join(";"));
  return `\uFEFF${csvLines.join("\n")}`;
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

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("pt-BR");
}

function formatAuditActor(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized || "Nao identificado";
}

function formatHistoryValue(field: string, value: string | null) {
  if (!value) {
    return "-";
  }

  if (field === "isActive") {
    return value === "true" ? "Ativo" : "Inativo";
  }

  if (field === "canceledAt") {
    return formatDateTime(value);
  }

  return value;
}

function scrollDashboardContentToTop() {
  if (typeof window === "undefined") {
    return;
  }

  const content = document.querySelector<HTMLElement>('[data-main-content-scroll="true"]');
  if (content) {
    content.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

export function PeoplePageView() {
  const { session } = useAuth();
  const [form, setForm] = useState<PersonFormState>(INITIAL_FORM);
  const [filterDraft, setFilterDraft] = useState<PersonFilterState>(INITIAL_FILTERS);
  const [activeFilters, setActiveFilters] = useState<PersonFilterState>(INITIAL_FILTERS);
  const [jobTitleTypes, setJobTitleTypes] = useState<JobTitleTypeOption[]>([]);
  const [jobTitles, setJobTitles] = useState<JobTitleOption[]>([]);
  const [jobLevels, setJobLevels] = useState<JobLevelOption[]>([]);
  const [people, setPeople] = useState<PersonItem[]>([]);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const exportCooldown = useExportCooldown();
  const [detailPerson, setDetailPerson] = useState<PersonItem | null>(null);
  const [historyPerson, setHistoryPerson] = useState<PersonItem | null>(null);
  const [historyEntries, setHistoryEntries] = useState<PersonHistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [statusPerson, setStatusPerson] = useState<PersonItem | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));
  const isEditing = Boolean(form.id);
  const statusAction = statusPerson?.isActive ? "cancel" : "activate";
  const canSubmitStatusChange = Boolean(statusReason.trim()) && !isChangingStatus;
  const hasJobTitles = jobTitles.length > 0;

  const getJobTitleTypesForJob = useCallback(
    (jobTitleId: string) =>
      jobTitleId ? jobTitleTypes.filter((item) => item.jobTitleId === jobTitleId) : [],
    [jobTitleTypes],
  );

  const formTypeOptions = useMemo(
    () => getJobTitleTypesForJob(form.jobTitleId),
    [form.jobTitleId, getJobTitleTypesForJob],
  );

  const filterTypeOptions = useMemo(
    () => getJobTitleTypesForJob(filterDraft.jobTitleId),
    [filterDraft.jobTitleId, getJobTitleTypesForJob],
  );
  const hasTypeOptionsForSelectedJob = !form.jobTitleId || formTypeOptions.length > 0;
  const canSubmitPersonForm = hasJobTitles && hasTypeOptionsForSelectedJob && !isSaving;

  const loadMeta = useCallback(async () => {
    if (!session?.accessToken) {
      return;
    }

    setIsLoadingMeta(true);
    try {
      const response = await fetch("/api/people/meta", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      const data = (await response.json().catch(() => ({}))) as PeopleMetaResponse;
      if (!response.ok) {
        setJobTitleTypes([]);
        setJobTitles([]);
        setJobLevels([]);
        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao carregar metadados de pessoas.",
        });
        return;
      }

      setJobTitleTypes(data.jobTitleTypes ?? []);
      setJobTitles(data.jobTitles ?? []);
      setJobLevels(data.jobLevels ?? []);
    } catch {
      setJobTitleTypes([]);
      setJobTitles([]);
      setJobLevels([]);
      setFeedback({
        type: "error",
        message: "Falha ao carregar metadados de pessoas.",
      });
    } finally {
      setIsLoadingMeta(false);
    }
  }, [session?.accessToken]);

  const loadPeople = useCallback(
    async (targetPage: number, filters: PersonFilterState) => {
      if (!session?.accessToken) {
        return;
      }

      setIsLoadingList(true);

      try {
        const query = buildQuery(filters, targetPage);
        const response = await fetch(`/api/people?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as PeopleListResponse;

        if (!response.ok) {
          setPeople([]);
          setTotal(0);
          setFeedback({
            type: "error",
            message: data.message ?? "Falha ao carregar pessoas.",
          });
          return;
        }

        setPeople(data.people ?? []);
        setTotal(data.pagination?.total ?? 0);
      } catch {
        setPeople([]);
        setTotal(0);
        setFeedback({
          type: "error",
          message: "Falha ao carregar pessoas.",
        });
      } finally {
        setIsLoadingList(false);
      }
    },
    [session?.accessToken],
  );

  const loadPersonHistory = useCallback(
    async (person: PersonItem, targetPage: number) => {
      if (!session?.accessToken) {
        setFeedback({ type: "error", message: "Sessao invalida para carregar historico." });
        return;
      }

      setIsLoadingHistory(true);
      try {
        const params = new URLSearchParams();
        params.set("historyPersonId", person.id);
        params.set("historyPage", String(targetPage));
        params.set("historyPageSize", String(HISTORY_PAGE_SIZE));

        const response = await fetch(`/api/people?${params.toString()}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as PersonHistoryResponse;
        if (!response.ok) {
          setFeedback({ type: "error", message: data.message ?? "Falha ao carregar historico da pessoa." });
          setHistoryEntries([]);
          setHistoryTotal(0);
          return;
        }

        setHistoryEntries(data.history ?? []);
        setHistoryPage(data.pagination?.page ?? targetPage);
        setHistoryTotal(data.pagination?.total ?? 0);
      } catch {
        setFeedback({ type: "error", message: "Falha ao carregar historico da pessoa." });
        setHistoryEntries([]);
        setHistoryTotal(0);
      } finally {
        setIsLoadingHistory(false);
      }
    },
    [session?.accessToken],
  );

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    void loadPeople(page, activeFilters);
  }, [activeFilters, loadPeople, page]);

  const formTitle = useMemo(() => (isEditing ? "Editar Pessoa" : "Cadastro de Pessoas"), [isEditing]);

  function resetForm() {
    setForm(INITIAL_FORM);
  }

  function updateFilterField(field: keyof PersonFilterState, value: string) {
    setFilterDraft((current) => {
      if (field === "jobTitleId") {
        return { ...current, jobTitleId: value, jobTitleTypeId: "" };
      }
      return { ...current, [field]: value };
    });
  }

  function applyFilters() {
    setPage(1);
    setActiveFilters(filterDraft);
    setFeedback(null);
  }

  function clearFilters() {
    setFilterDraft(INITIAL_FILTERS);
    setActiveFilters(INITIAL_FILTERS);
    setPage(1);
    setFeedback(null);
  }

  function startEdit(person: PersonItem) {
    setForm({
      id: person.id,
      updatedAt: person.updatedAt,
      name: person.name,
      matriculation: person.matriculation ?? "",
      jobTitleId: person.jobTitleId,
      jobTitleTypeId: person.jobTitleTypeId ?? "",
      jobLevel: person.jobLevel ?? "",
    });
    setFeedback(null);
    scrollDashboardContentToTop();
  }

  function closeHistoryModal() {
    setHistoryPerson(null);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    setIsLoadingHistory(false);
  }

  function openStatusModal(person: PersonItem) {
    setStatusPerson(person);
    setStatusReason("");
  }

  function closeStatusModal() {
    setStatusPerson(null);
    setStatusReason("");
    setIsChangingStatus(false);
  }

  async function openHistoryModal(person: PersonItem) {
    setHistoryPerson(person);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    await loadPersonHistory(person, 1);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.accessToken) {
      setFeedback({
        type: "error",
        message: "Sessao invalida para salvar pessoa.",
      });
      return;
    }

    if (!hasJobTitles) {
      setFeedback({
        type: "error",
        message: "Nao ha cargos ativos para cadastro. Cadastre ao menos um cargo em Cadastro Base > Cargo.",
      });
      return;
    }

    if (!hasTypeOptionsForSelectedJob) {
      setFeedback({
        type: "error",
        message: "Nao ha tipos ativos para o cargo selecionado. Cadastre ao menos um tipo para este cargo.",
      });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      const payload = {
        id: form.id,
        name: normalizeText(form.name),
        matriculation: normalizeMatriculation(form.matriculation) || null,
        jobTitleId: normalizeText(form.jobTitleId),
        jobTitleTypeId: normalizeText(form.jobTitleTypeId) || null,
        jobLevel: normalizeText(form.jobLevel) || null,
        ...(form.id ? { expectedUpdatedAt: form.updatedAt } : {}),
      };

      const response = await fetch("/api/people", {
        method: form.id ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
        code?: string;
      };

      if (!response.ok || !data.success) {
        if (data.code === "CONCURRENT_MODIFICATION" || data.code === "RECORD_INACTIVE") {
          resetForm();
          await loadPeople(page, activeFilters);
        }

        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao salvar pessoa.",
        });
        return;
      }

      setFeedback({
        type: "success",
        message: data.message ?? "Pessoa salva com sucesso.",
      });
      resetForm();
      await loadPeople(1, activeFilters);
      setPage(1);
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao salvar pessoa.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmStatusChange() {
    if (!session?.accessToken || !statusPerson || !statusAction || !statusReason.trim()) {
      return;
    }

    setIsChangingStatus(true);

    try {
      const response = await fetch("/api/people", {
        method: "PATCH",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          id: statusPerson.id,
          reason: statusReason.trim(),
          action: statusAction,
          expectedUpdatedAt: statusPerson.updatedAt,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
        code?: string;
      };

      if (!response.ok || !data.success) {
        if (
          data.code === "CONCURRENT_MODIFICATION"
          || data.code === "RECORD_INACTIVE"
          || data.code === "STATUS_ALREADY_CHANGED"
        ) {
          if (form.id === statusPerson.id) {
            resetForm();
          }
          closeStatusModal();
          await loadPeople(page, activeFilters);
        }

        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao atualizar status da pessoa.",
        });
        return;
      }

      setFeedback({
        type: "success",
        message: data.message ?? "Status da pessoa atualizado com sucesso.",
      });

      if (form.id === statusPerson.id) {
        resetForm();
      }

      closeStatusModal();
      await loadPeople(page, activeFilters);
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao atualizar status da pessoa.",
      });
    } finally {
      setIsChangingStatus(false);
    }
  }

  async function handleExportPeople() {
    if (!session?.accessToken) {
      setFeedback({
        type: "error",
        message: "Sessao invalida para exportar pessoas.",
      });
      return;
    }

    if (!exportCooldown.tryStart()) {
      setFeedback({
        type: "error",
        message: `Aguarde ${exportCooldown.getRemainingSeconds()}s antes de exportar novamente.`,
      });
      return;
    }

    setIsExporting(true);

    try {
      const allPeople: PersonItem[] = [];
      let exportPage = 1;
      let totalItems = 0;

      while (true) {
        const query = buildQuery(activeFilters, exportPage, EXPORT_PAGE_SIZE);
        const response = await fetch(`/api/people?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as PeopleListResponse;

        if (!response.ok) {
          setFeedback({
            type: "error",
            message: data.message ?? "Falha ao exportar pessoas.",
          });
          return;
        }

        const pageItems = data.people ?? [];
        totalItems = data.pagination?.total ?? totalItems;
        allPeople.push(...pageItems);

        if (pageItems.length === 0 || allPeople.length >= totalItems) {
          break;
        }

        exportPage += 1;
      }

      if (allPeople.length === 0) {
        setFeedback({
          type: "error",
          message: "Nenhuma pessoa encontrada para exportar com os filtros atuais.",
        });
        return;
      }

      const csv = buildPeopleCsv(allPeople);
      const exportDate = new Date().toISOString().slice(0, 10);
      downloadCsvFile(csv, `pessoas_${exportDate}.csv`);

      setFeedback({
        type: "success",
        message: `${allPeople.length} pessoa(s) exportada(s) com sucesso.`,
      });
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao exportar pessoas.",
      });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <section className={styles.wrapper}>
      {feedback ? (
        <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>{feedback.message}</div>
      ) : null}

      <article className={`${styles.card} ${isEditing ? styles.editingCard : ""}`}>
        <h3 className={styles.cardTitle}>{formTitle}</h3>
        {!isLoadingMeta && !hasJobTitles ? (
          <div className={styles.feedbackError}>
            Nao ha cargos ativos para cadastro. Cadastre ao menos um cargo em Cadastro Base &gt; Cargo.
          </div>
        ) : null}
        {!isLoadingMeta && form.jobTitleId && !hasTypeOptionsForSelectedJob ? (
          <div className={styles.feedbackError}>
            Nao ha tipos ativos para o cargo selecionado. Cadastre ao menos um tipo para este cargo.
          </div>
        ) : null}

        <form className={styles.formGrid} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>
              Nome <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Nome completo"
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Matricula <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.matriculation}
              onChange={(event) => setForm((current) => ({ ...current, matriculation: event.target.value }))}
              placeholder="Ex.: 000123"
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Cargo <span className="requiredMark">*</span>
            </span>
            <select
              value={form.jobTitleId}
              onChange={(event) =>
                setForm((current) => ({ ...current, jobTitleId: event.target.value, jobTitleTypeId: "" }))
              }
              required
              disabled={isLoadingMeta}
            >
              <option value="" disabled>
                {isLoadingMeta ? "Carregando..." : "Selecione"}
              </option>
              {jobTitles.map((jobTitle) => (
                <option key={jobTitle.id} value={jobTitle.id}>
                  {jobTitle.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>
              Tipo <span className="requiredMark">*</span>
            </span>
            <select
              value={form.jobTitleTypeId}
              onChange={(event) => setForm((current) => ({ ...current, jobTitleTypeId: event.target.value }))}
              disabled={isLoadingMeta || !form.jobTitleId}
              required
            >
              <option value="" disabled>
                {form.jobTitleId ? "Selecione" : "Selecione o cargo primeiro"}
              </option>
              {formTypeOptions.map((jobTitleType) => (
                <option key={jobTitleType.id} value={jobTitleType.id}>
                  {jobTitleType.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Nivel</span>
            <select
              value={form.jobLevel}
              onChange={(event) => setForm((current) => ({ ...current, jobLevel: event.target.value }))}
              disabled={isLoadingMeta}
            >
              <option value="">Selecione</option>
              {jobLevels.map((level) => (
                <option key={level.level} value={level.level}>
                  {level.level}
                </option>
              ))}
            </select>
          </label>

          <div className={`${styles.actions} ${styles.formActions}`}>
            {isEditing ? (
              <button type="button" className={styles.ghostButton} onClick={resetForm} disabled={isSaving}>
                Cancelar
              </button>
            ) : null}
            <button type="submit" className={styles.primaryButton} disabled={!canSubmitPersonForm}>
              {isSaving ? "Salvando..." : isEditing ? "Atualizar" : "Cadastrar"}
            </button>
          </div>
        </form>
      </article>

      <article className={styles.card}>
        <h3 className={styles.cardTitle}>Filtros</h3>

        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span>Nome</span>
            <input
              type="text"
              value={filterDraft.name}
              onChange={(event) => updateFilterField("name", event.target.value)}
              placeholder="Filtrar por nome"
            />
          </label>

          <label className={styles.field}>
            <span>Matricula</span>
            <input
              type="text"
              value={filterDraft.matriculation}
              onChange={(event) => updateFilterField("matriculation", event.target.value)}
              placeholder="Filtrar por matricula"
            />
          </label>

          <label className={styles.field}>
            <span>Cargo</span>
            <select
              value={filterDraft.jobTitleId}
              onChange={(event) => updateFilterField("jobTitleId", event.target.value)}
              disabled={isLoadingMeta}
            >
              <option value="">Todos</option>
              {jobTitles.map((jobTitle) => (
                <option key={jobTitle.id} value={jobTitle.id}>
                  {jobTitle.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Tipo</span>
            <select
              value={filterDraft.jobTitleTypeId}
              onChange={(event) => updateFilterField("jobTitleTypeId", event.target.value)}
              disabled={isLoadingMeta || !filterDraft.jobTitleId}
            >
              <option value="">{filterDraft.jobTitleId ? "Todos" : "Selecione o cargo primeiro"}</option>
              {filterTypeOptions.map((jobTitleType) => (
                <option key={jobTitleType.id} value={jobTitleType.id}>
                  {jobTitleType.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Nivel</span>
            <select
              value={filterDraft.jobLevel}
              onChange={(event) => updateFilterField("jobLevel", event.target.value)}
              disabled={isLoadingMeta}
            >
              <option value="">Todos</option>
              {jobLevels.map((level) => (
                <option key={level.level} value={level.level}>
                  {level.level}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Status</span>
            <select value={filterDraft.status} onChange={(event) => updateFilterField("status", event.target.value)}>
              <option value="">Todos</option>
              <option value="ativo">Ativo</option>
              <option value="inativo">Inativo</option>
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
          <h3 className={styles.cardTitle}>Lista de Pessoas</h3>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => void handleExportPeople()}
            disabled={isExporting || isLoadingList || exportCooldown.isCoolingDown}
          >
            {isExporting ? "Exportando..." : "Exportar Excel (CSV)"}
          </button>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Matricula</th>
                <th>Cargo</th>
                <th>Tipo</th>
                <th>Nivel</th>
                <th>Registrado em</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {people.length > 0 ? (
                people.map((person) => (
                  <tr key={person.id} className={!person.isActive ? styles.inactiveRow : undefined}>
                    <td>
                      <div className={styles.sobCell}>
                        <span>{person.name}</span>
                        {!person.isActive ? <span className={styles.statusTag}>Inativo</span> : null}
                      </div>
                    </td>
                    <td>{person.matriculation ?? "-"}</td>
                    <td>{person.jobTitleName}</td>
                    <td>{person.jobTitleTypeName ?? "-"}</td>
                    <td>{person.jobLevel ?? "-"}</td>
                    <td>{formatDateTime(person.createdAt)}</td>
                    <td className={styles.actionsCell}>
                      <div className={styles.tableActions}>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionView}`}
                          onClick={() => setDetailPerson(person)}
                          title="Detalhes"
                          aria-label="Detalhes da pessoa"
                        >
                          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path
                              d="M2.5 12s3.8-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.8 6.5-9.5 6.5S2.5 12 2.5 12Z"
                              stroke="currentColor"
                              strokeWidth="1.7"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <circle cx="12" cy="12" r="2.8" stroke="currentColor" strokeWidth="1.7" />
                          </svg>
                        </button>

                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionEdit}`}
                          onClick={() => startEdit(person)}
                          title="Editar"
                          aria-label="Editar pessoa"
                          disabled={!person.isActive}
                        >
                          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path
                              d="m4 20 4.5-1 9-9a1.75 1.75 0 0 0-2.5-2.5l-9 9L4 20Z"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <path d="m13.5 6.5 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                          </svg>
                        </button>

                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionHistory}`}
                          onClick={() => void openHistoryModal(person)}
                          title="Historico"
                          aria-label="Historico da pessoa"
                        >
                          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path
                              d="M3.75 12a8.25 8.25 0 1 0 2.25-5.69M3.75 4.75v4h4"
                              stroke="currentColor"
                              strokeWidth="1.7"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <path d="M12 8.5v3.75l2.5 1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                          </svg>
                        </button>

                        <button
                          type="button"
                          className={`${styles.actionButton} ${person.isActive ? styles.actionCancel : styles.actionActivate}`}
                          onClick={() => openStatusModal(person)}
                          title={person.isActive ? "Cancelar" : "Ativar"}
                          aria-label={person.isActive ? "Cancelar pessoa" : "Ativar pessoa"}
                        >
                          {person.isActive ? (
                            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
                              <path d="m9.5 9.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
                              <path
                                d="m8.5 12 2.2 2.2 4.8-4.8"
                                stroke="currentColor"
                                strokeWidth="1.7"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className={styles.emptyRow}>
                    {isLoadingList ? "Carregando pessoas..." : "Nenhuma pessoa encontrada para os filtros informados."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className={styles.pagination}>
          <span>
            Pagina {Math.min(page, totalPages)} de {totalPages} | Total: {total}
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

      {detailPerson ? (
        <div className={styles.modalOverlay} onClick={() => setDetailPerson(null)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Detalhes da Pessoa {detailPerson.name}</h4>
                <p className={styles.modalSubtitle}>ID da pessoa: {detailPerson.id}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setDetailPerson(null)}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <div className={styles.detailGrid}>
                <div>
                  <strong>Status:</strong> {detailPerson.isActive ? "Ativo" : "Inativo"}
                </div>
                <div>
                  <strong>Nome:</strong> {detailPerson.name}
                </div>
                <div>
                  <strong>Matricula:</strong> {detailPerson.matriculation ?? "-"}
                </div>
                <div>
                  <strong>Cargo:</strong> {detailPerson.jobTitleName}
                </div>
                <div>
                  <strong>Tipo:</strong> {detailPerson.jobTitleTypeName ?? "-"}
                </div>
                <div>
                  <strong>Nivel:</strong> {detailPerson.jobLevel ?? "-"}
                </div>
                <div>
                  <strong>Registrado por:</strong> {formatAuditActor(detailPerson.createdByName)}
                </div>
                <div>
                  <strong>Criado em:</strong> {formatDateTime(detailPerson.createdAt)}
                </div>
                <div>
                  <strong>Atualizado por:</strong> {formatAuditActor(detailPerson.updatedByName)}
                </div>
                <div>
                  <strong>Atualizado em:</strong> {formatDateTime(detailPerson.updatedAt)}
                </div>
                {!detailPerson.isActive ? (
                  <>
                    <div>
                      <strong>Cancelado em:</strong> {formatDateTime(detailPerson.canceledAt)}
                    </div>
                    <div>
                      <strong>Cancelado por:</strong> {detailPerson.canceledByName ?? "-"}
                    </div>
                    <div className={styles.detailWide}>
                      <strong>Motivo do cancelamento:</strong> {detailPerson.cancellationReason ?? "-"}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {historyPerson ? (
        <div className={styles.modalOverlay} onClick={closeHistoryModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Historico da Pessoa {historyPerson.name}</h4>
                <p className={styles.modalSubtitle}>ID da pessoa: {historyPerson.id}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={closeHistoryModal}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              {isLoadingHistory ? <p>Carregando historico...</p> : null}

              {!isLoadingHistory && historyEntries.length === 0 ? <p>Nenhuma alteracao registrada.</p> : null}

              {!isLoadingHistory && historyEntries.length > 0
                ? historyEntries.map((entry) => (
                    <article key={entry.id} className={styles.historyCard}>
                      <header className={styles.historyCardHeader}>
                        <strong>
                          {entry.changeType === "CANCEL"
                            ? "Cancelamento"
                            : entry.changeType === "ACTIVATE"
                              ? "Ativacao"
                              : "Atualizacao"}
                        </strong>
                        <span>
                          {formatDateTime(entry.createdAt)} | {entry.createdByName}
                        </span>
                      </header>

                      {entry.reason ? <p className={styles.historyReason}>Motivo: {entry.reason}</p> : null}

                      <div className={styles.historyChanges}>
                        {Object.entries(entry.changes).map(([field, change]) => (
                          <div key={field} className={styles.historyChangeItem}>
                            <strong>{HISTORY_FIELD_LABELS[field] ?? field}</strong>
                            <span>De: {formatHistoryValue(field, change.from)}</span>
                            <span>Para: {formatHistoryValue(field, change.to)}</span>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))
                : null}

              {historyTotal > 0 ? (
                <div className={styles.pagination}>
                  <span>
                    Pagina {Math.min(historyPage, historyTotalPages)} de {historyTotalPages} | Total: {historyTotal}
                  </span>

                  <div className={styles.paginationActions}>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      onClick={() => {
                        const target = Math.max(1, historyPage - 1);
                        void loadPersonHistory(historyPerson, target);
                      }}
                      disabled={historyPage <= 1 || isLoadingHistory}
                    >
                      Anterior
                    </button>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      onClick={() => {
                        const target = Math.min(historyTotalPages, historyPage + 1);
                        void loadPersonHistory(historyPerson, target);
                      }}
                      disabled={historyPage >= historyTotalPages || isLoadingHistory}
                    >
                      Proxima
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </article>
        </div>
      ) : null}

      {statusPerson ? (
        <div className={styles.modalOverlay} onClick={closeStatusModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>{statusAction === "cancel" ? "Cancelar Pessoa" : "Ativar Pessoa"}</h4>
                <p className={styles.modalSubtitle}>
                  {statusAction === "cancel"
                    ? `Pessoa ${statusPerson.name} sera cancelada.`
                    : `Pessoa ${statusPerson.name} sera ativada.`}
                </p>
              </div>
            </header>

            <div className={styles.modalBody}>
              <label className={styles.field}>
                <span>
                  {statusAction === "cancel" ? "Motivo do cancelamento" : "Motivo da ativacao"}{" "}
                  <span className="requiredMark">*</span>
                </span>
                <textarea
                  value={statusReason}
                  onChange={(event) => setStatusReason(event.target.value)}
                  placeholder={statusAction === "cancel" ? "Descreva o motivo do cancelamento" : "Descreva o motivo da ativacao"}
                  rows={4}
                  required
                />
              </label>

              <div className={styles.actions}>
                <button type="button" className={styles.ghostButton} onClick={closeStatusModal} disabled={isChangingStatus}>
                  Voltar
                </button>
                <button
                  type="button"
                  className={statusAction === "cancel" ? styles.dangerButton : styles.primaryButton}
                  onClick={() => void confirmStatusChange()}
                  disabled={!canSubmitStatusChange}
                >
                  {isChangingStatus
                    ? statusAction === "cancel"
                      ? "Cancelando..."
                      : "Ativando..."
                    : statusAction === "cancel"
                      ? "Confirmar cancelamento"
                      : "Confirmar ativacao"}
                </button>
              </div>
            </div>
          </article>
        </div>
      ) : null}
    </section>
  );
}



