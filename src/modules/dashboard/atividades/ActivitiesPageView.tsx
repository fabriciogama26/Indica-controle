"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useExportCooldown } from "@/hooks/useExportCooldown";
import { useMassImport } from "@/hooks/useMassImport";
import { usePagination } from "@/hooks/usePagination";
import { CsvExportButton } from "@/components/ui/CsvExportButton";
import { MassImportModal } from "@/components/ui/MassImportModal";
import { Pagination } from "@/components/ui/Pagination";
import styles from "./ActivitiesPageView.module.css";
import { downloadCsvFile } from "@/lib/utils/csv";
import { formatAuditActor, formatDateTime } from "@/lib/utils/formatters";
import { DEFAULT_PAGE_SIZE, DEFAULT_EXPORT_PAGE_SIZE, DEFAULT_HISTORY_PAGE_SIZE } from "@/lib/constants/pagination";
import type { MassImportRowResult } from "@/lib/utils/massImport";
import { CatalogSelectField } from "./CatalogSelectField";
import { buildActivitiesCsv } from "./csv";
import { formatHistoryValue, formatMoney, formatPoints, toInputMoney, toInputPoints } from "./formatters";
import {
  ACTIVITY_MASS_IMPORT_COLUMNS_HINT,
  buildActivityMassImportTemplateCsv,
  parseActivityMassImportCsv,
  type ActivityImportRow,
} from "./massImport";

type ActivityItem = {
  id: string;
  code: string;
  codeIdd: string;
  description: string;
  teamTypeId: string;
  teamTypeName: string;
  categoryId: string;
  categoryName: string;
  groupId: string;
  groupName: string;
  value: number;
  voicePoint: number | null;
  unit: string;
  scope: string;
  isActive: boolean;
  cancellationReason: string | null;
  canceledAt: string | null;
  canceledByName: string | null;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

type ActivityHistoryEntry = {
  id: string;
  changeType: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason: string | null;
  createdAt: string;
  createdByName: string;
  changes: Record<string, { from: string | null; to: string | null }>;
};

type ActivityFormState = {
  id: string | null; code: string; codeIdd: string; description: string; teamTypeId: string; categoryId: string;
  groupId: string; value: string; voicePoint: string; unit: string; scope: string; updatedAt: string;
};

type ActivityFilterState = {
  code: string;
  description: string;
  teamTypeId: string;
  categoryId: string;
  status: "" | "ATIVO" | "INATIVO";
};

type TeamTypeOption = {
  id: string;
  name: string;
};

type CategoryOption = TeamTypeOption;

type ActivityGroupOption = TeamTypeOption & { unitValue: number };

type ActivitiesListResponse = {
  activities?: ActivityItem[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

type ActivityHistoryResponse = {
  history?: ActivityHistoryEntry[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

type ActivitiesMetaResponse = {
  teamTypes?: TeamTypeOption[];
  categories?: CategoryOption[];
  groups?: ActivityGroupOption[];
  message?: string;
};

const PAGE_SIZE = DEFAULT_PAGE_SIZE, HISTORY_PAGE_SIZE = DEFAULT_HISTORY_PAGE_SIZE, EXPORT_PAGE_SIZE = DEFAULT_EXPORT_PAGE_SIZE;

const HISTORY_FIELD_LABELS: Record<string, string> = {
  code: "Codigo",
  codeIdd: "Cod. SAP",
  description: "Descricao",
  teamTypeName: "Tipo",
  categoryName: "Categoria",
  group: "Grupo",
  value: "Valor",
  voicePoint: "Pontos",
  unit: "Unidade",
  scope: "Alcance",
  isActive: "Status",
  cancellationReason: "Motivo do cancelamento",
  canceledAt: "Data do cancelamento",
  activationReason: "Motivo da ativacao",
};

const INITIAL_FORM: ActivityFormState = {
  id: null, code: "", codeIdd: "", description: "", teamTypeId: "", categoryId: "",
  groupId: "", value: "", voicePoint: "", unit: "", scope: "", updatedAt: "",
};

const INITIAL_FILTERS: ActivityFilterState = {
  code: "",
  description: "",
  teamTypeId: "",
  categoryId: "",
  status: "",
};

function normalizeText(value: string) {
  return String(value ?? "").trim();
}

function normalizeCode(value: string) { return normalizeText(value).toUpperCase(); }

function buildQuery(filters: ActivityFilterState, page: number, pageSize = PAGE_SIZE) {
  const params = new URLSearchParams();
  if (filters.code.trim()) {
    params.set("code", filters.code.trim());
  }
  if (filters.description.trim()) {
    params.set("description", filters.description.trim());
  }
  if (filters.teamTypeId.trim()) {
    params.set("teamTypeId", filters.teamTypeId.trim());
  }
  if (filters.categoryId.trim()) {
    params.set("categoryId", filters.categoryId.trim());
  }
  if (filters.status) {
    params.set("status", filters.status);
  }
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return params.toString();
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

export function ActivitiesPageView() {
  const { session } = useAuth();
  const [form, setForm] = useState<ActivityFormState>(INITIAL_FORM);
  const [filterDraft, setFilterDraft] = useState<ActivityFilterState>(INITIAL_FILTERS);
  const [activeFilters, setActiveFilters] = useState<ActivityFilterState>(INITIAL_FILTERS);
  const [teamTypes, setTeamTypes] = useState<TeamTypeOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [groups, setGroups] = useState<ActivityGroupOption[]>([]);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const exportCooldown = useExportCooldown();
  const [detailActivity, setDetailActivity] = useState<ActivityItem | null>(null);
  const [historyActivity, setHistoryActivity] = useState<ActivityItem | null>(null);
  const [historyEntries, setHistoryEntries] = useState<ActivityHistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [statusActivity, setStatusActivity] = useState<ActivityItem | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const { page, total, totalPages, setPage, setTotal } = usePagination({ pageSize: PAGE_SIZE });
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));
  const isEditing = Boolean(form.id);
  const statusAction = statusActivity?.isActive ? "cancel" : "activate";
  const canSubmitStatusChange = Boolean(statusReason.trim()) && !isChangingStatus;

  const loadMeta = useCallback(async () => {
    if (!session?.accessToken) {
      return;
    }

    setIsLoadingMeta(true);
    try {
      const response = await fetch("/api/activities/meta", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      const data = (await response.json().catch(() => ({}))) as ActivitiesMetaResponse;
      if (!response.ok) {
        setTeamTypes([]);
        setCategories([]);
        setGroups([]);
        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao carregar metadados de atividades.",
        });
        return;
      }

      setTeamTypes(data.teamTypes ?? []);
      setCategories(data.categories ?? []);
      setGroups(data.groups ?? []);
    } catch {
      setTeamTypes([]);
      setCategories([]);
      setGroups([]);
      setFeedback({
        type: "error",
        message: "Falha ao carregar metadados de atividades.",
      });
    } finally {
      setIsLoadingMeta(false);
    }
  }, [session?.accessToken]);

  const loadActivities = useCallback(
    async (targetPage: number, filters: ActivityFilterState) => {
      if (!session?.accessToken) {
        return;
      }

      setIsLoadingList(true);

      try {
        const query = buildQuery(filters, targetPage);
        const response = await fetch(`/api/activities?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as ActivitiesListResponse;

        if (!response.ok) {
          setActivities([]);
          setTotal(0);
          setFeedback({
            type: "error",
            message: data.message ?? "Falha ao carregar atividades.",
          });
          return [] as ActivityItem[];
        }

        const nextActivities = data.activities ?? [];
        setActivities(nextActivities);
        setTotal(data.pagination?.total ?? 0);
        return nextActivities;
      } catch {
        setActivities([]);
        setTotal(0);
        setFeedback({
          type: "error",
          message: "Falha ao carregar atividades.",
        });
        return [] as ActivityItem[];
      } finally {
        setIsLoadingList(false);
      }
    },
    [session?.accessToken, setTotal],
  );

  const loadActivityHistory = useCallback(
    async (activity: ActivityItem, targetPage: number) => {
      if (!session?.accessToken) {
        setFeedback({ type: "error", message: "Sessao invalida para carregar historico." });
        return;
      }

      setIsLoadingHistory(true);
      try {
        const params = new URLSearchParams();
        params.set("historyActivityId", activity.id);
        params.set("historyPage", String(targetPage));
        params.set("historyPageSize", String(HISTORY_PAGE_SIZE));

        const response = await fetch(`/api/activities?${params.toString()}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as ActivityHistoryResponse;
        if (!response.ok) {
          setFeedback({ type: "error", message: data.message ?? "Falha ao carregar historico da atividade." });
          setHistoryEntries([]);
          setHistoryTotal(0);
          return;
        }

        setHistoryEntries(data.history ?? []);
        setHistoryPage(data.pagination?.page ?? targetPage);
        setHistoryTotal(data.pagination?.total ?? 0);
      } catch {
        setFeedback({ type: "error", message: "Falha ao carregar historico da atividade." });
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
    void loadActivities(page, activeFilters);
  }, [activeFilters, loadActivities, page]);

  const parseMassImportCsv = useCallback(
    (content: string, fileName: string) => parseActivityMassImportCsv({ content, fileName, teamTypes, categories, groups }),
    [categories, groups, teamTypes],
  );

  const submitMassImport = useCallback(
    async (rows: ActivityImportRow[]) => {
      if (!session?.accessToken) {
        return { ok: false, message: "Sessao invalida para importar atividades em massa.", savedCount: 0, results: [] };
      }

      const response = await fetch("/api/activities", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({ action: "BATCH_IMPORT", rows }),
      });

      const data = (await response.json().catch(() => null)) as
        | { savedCount?: number; results?: MassImportRowResult[]; message?: string }
        | null;

      return {
        ok: response.ok,
        message: data?.message,
        savedCount: Number(data?.savedCount ?? 0),
        results: data?.results ?? [],
      };
    },
    [session?.accessToken],
  );

  const massImport = useMassImport<ActivityImportRow>({
    entityLabel: "atividades",
    errorFilePrefix: "atividades",
    templateFileName: "modelo_atividades_cadastro_em_massa.csv",
    buildTemplateCsv: buildActivityMassImportTemplateCsv,
    parse: parseMassImportCsv,
    submit: submitMassImport,
    resolveErrorColumn: (code) => {
      if (code === "DUPLICATE_ACTIVITY_CODE") return "codigo";
      if (code === "INVALID_TEAM_TYPE") return "tipo_equipe";
      if (code === "INVALID_CATEGORY") return "categoria";
      if (code === "INVALID_GROUP") return "grupo";
      return code === "INVALID_ACTIVITY" ? "dados" : code === "ACTIVITY_CODE_IDD_TYPE_MISMATCH" ? "cod_sap" : "salvamento";
    },
    onImported: async () => {
      await loadActivities(1, activeFilters);
      setPage(1);
    },
    onFeedback: setFeedback,
  });

  const formTitle = useMemo(() => (isEditing ? "Editar Atividade" : "Cadastro de Atividades"), [isEditing]);

  function resetForm() {
    setForm(INITIAL_FORM);
  }

  function updateFilterField(field: keyof ActivityFilterState, value: string) {
    setFilterDraft((current) => ({ ...current, [field]: value }));
  }

  function updateGroupField(groupId: string) {
    const selectedGroup = groups.find((group) => group.id === groupId);
    setForm((current) => ({ ...current, groupId, value: selectedGroup ? toInputMoney(selectedGroup.unitValue) : "" }));
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

  function startEdit(activity: ActivityItem) {
    setForm({
      id: activity.id,
      code: activity.code,
      codeIdd: activity.codeIdd,
      description: activity.description,
      teamTypeId: activity.teamTypeId,
      categoryId: activity.categoryId,
      groupId: activity.groupId,
      value: toInputMoney(activity.value),
      voicePoint: toInputPoints(activity.voicePoint),
      unit: activity.unit,
      scope: activity.scope,
      updatedAt: activity.updatedAt,
    });
    setFeedback(null);
    scrollDashboardContentToTop();
  }

  function closeHistoryModal() {
    setHistoryActivity(null);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    setIsLoadingHistory(false);
  }

  function openStatusModal(activity: ActivityItem) {
    setStatusActivity(activity);
    setStatusReason("");
  }

  function closeStatusModal() {
    setStatusActivity(null);
    setStatusReason("");
    setIsChangingStatus(false);
  }

  async function openHistoryModal(activity: ActivityItem) {
    setHistoryActivity(activity);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    await loadActivityHistory(activity, 1);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.accessToken) {
      setFeedback({
        type: "error",
        message: "Sessao invalida para salvar atividade.",
      });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      const payload = {
        id: form.id,
        code: normalizeCode(form.code),
        codeIdd: normalizeText(form.codeIdd) || null,
        description: normalizeText(form.description),
        teamTypeId: normalizeText(form.teamTypeId),
        categoryId: normalizeText(form.categoryId),
        groupId: normalizeText(form.groupId),
        voicePoint: form.voicePoint,
        unit: normalizeText(form.unit),
        scope: normalizeText(form.scope) || null,
        ...(form.id ? { expectedUpdatedAt: form.updatedAt } : {}),
      };

      const response = await fetch("/api/activities", {
        method: form.id ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json().catch(() => ({}))) as { success?: boolean; message?: string; code?: string };

      if (!response.ok || !data.success) {
        if (data.code === "CONCURRENT_MODIFICATION" || data.code === "RECORD_INACTIVE") {
          await loadActivities(page, activeFilters);
        }

        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao salvar atividade.",
        });
        return;
      }

      setFeedback({
        type: "success",
        message: data.message ?? "Atividade salva com sucesso.",
      });
      resetForm();
      await loadActivities(1, activeFilters);
      setPage(1);
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao salvar atividade.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmStatusChange() {
    if (!session?.accessToken || !statusActivity || !statusAction || !statusReason.trim()) {
      return;
    }

    setIsChangingStatus(true);

    try {
      const response = await fetch("/api/activities", {
        method: "PATCH",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          id: statusActivity.id,
          reason: statusReason.trim(),
          action: statusAction,
          expectedUpdatedAt: statusActivity.updatedAt,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { success?: boolean; message?: string; code?: string };

      if (!response.ok || !data.success) {
        if (
          data.code === "CONCURRENT_MODIFICATION"
          || data.code === "RECORD_INACTIVE"
          || data.code === "STATUS_ALREADY_CHANGED"
        ) {
          closeStatusModal();
          await loadActivities(page, activeFilters);
        }

        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao atualizar status da atividade.",
        });
        return;
      }

      setFeedback({
        type: "success",
        message: data.message ?? "Status da atividade atualizado com sucesso.",
      });

      if (form.id === statusActivity.id) {
        resetForm();
      }

      closeStatusModal();
      await loadActivities(page, activeFilters);
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao atualizar status da atividade.",
      });
    } finally {
      setIsChangingStatus(false);
    }
  }

  async function handleExportActivities() {
    if (!session?.accessToken) {
      setFeedback({
        type: "error",
        message: "Sessao invalida para exportar atividades.",
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
      const allActivities: ActivityItem[] = [];
      let exportPage = 1;
      let totalItems = 0;

      while (true) {
        const query = buildQuery(activeFilters, exportPage, EXPORT_PAGE_SIZE);
        const response = await fetch(`/api/activities?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as ActivitiesListResponse;

        if (!response.ok) {
          setFeedback({
            type: "error",
            message: data.message ?? "Falha ao exportar atividades.",
          });
          return;
        }

        const pageItems = data.activities ?? [];
        totalItems = data.pagination?.total ?? totalItems;
        allActivities.push(...pageItems);

        if (pageItems.length === 0 || allActivities.length >= totalItems) {
          break;
        }

        exportPage += 1;
      }

      if (allActivities.length === 0) {
        setFeedback({
          type: "error",
          message: "Nenhuma atividade encontrada para exportar com os filtros atuais.",
        });
        return;
      }

      const csv = buildActivitiesCsv(allActivities);
      const exportDate = new Date().toISOString().slice(0, 10);
      downloadCsvFile(csv, `atividades_${exportDate}.csv`);

      setFeedback({
        type: "success",
        message: `${allActivities.length} atividade(s) exportada(s) com sucesso.`,
      });
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao exportar atividades.",
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

        <form className={styles.formGrid} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>
              Codigo <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.code}
              onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
              placeholder="Ex.: ATV-001"
              required
            />
          </label>

          <label className={styles.field}>
            <span>Cod. SAP</span>
            <input
              type="text"
              value={form.codeIdd}
              onChange={(event) => setForm((current) => ({ ...current, codeIdd: event.target.value }))}
              placeholder="Codigo SAP"
            />
          </label>

          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>
              Descricao <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Descricao da atividade"
              required
            />
          </label>

          <CatalogSelectField
            label="Tipo"
            value={form.teamTypeId}
            options={teamTypes}
            isLoading={isLoadingMeta}
            onChange={(teamTypeId) => setForm((current) => ({ ...current, teamTypeId }))}
          />

          <CatalogSelectField
            label="Categoria"
            value={form.categoryId}
            options={categories}
            isLoading={isLoadingMeta}
            onChange={(categoryId) => setForm((current) => ({ ...current, categoryId }))}
          />

          <CatalogSelectField
            label="Grupo"
            value={form.groupId}
            options={groups}
            isLoading={isLoadingMeta}
            onChange={updateGroupField}
          />

          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Alcance</span>
            <textarea
              value={form.scope}
              onChange={(event) => setForm((current) => ({ ...current, scope: event.target.value }))}
              placeholder="Descreva o alcance da atividade"
              rows={3}
            />
          </label>

          <label className={styles.field}>
            <span>
              Valor <span className="requiredMark">*</span>
            </span>
            <input type="number" value={form.value} placeholder="Selecione o grupo" readOnly />
          </label>

          <label className={styles.field}>
            <span>
              Pontos <span className="requiredMark">*</span>
            </span>
            <input
              type="number"
              min="0.000001"
              step="0.000001"
              value={form.voicePoint}
              onChange={(event) => setForm((current) => ({ ...current, voicePoint: event.target.value }))}
              placeholder="Ex.: 1"
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Unidade <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.unit}
              onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))}
              placeholder="Ex.: h, km, un"
              required
            />
          </label>

          <div className={`${styles.actions} ${styles.formActions}`}>
            {isEditing ? (
              <button type="button" className={styles.ghostButton} onClick={resetForm} disabled={isSaving}>
                Cancelar
              </button>
            ) : null}
            <button type="submit" className={styles.primaryButton} disabled={isSaving}>
              {isSaving ? "Salvando..." : isEditing ? "Atualizar" : "Cadastrar"}
            </button>
            {!isEditing ? (
              <button type="button" className={styles.secondaryButton} onClick={massImport.open} disabled={isLoadingMeta}>
                Cadastro em massa
              </button>
            ) : null}
          </div>
        </form>
      </article>

      <article className={styles.card}>
        <h3 className={styles.cardTitle}>Filtros</h3>

        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span>Codigo</span>
            <input
              type="text"
              value={filterDraft.code}
              onChange={(event) => updateFilterField("code", event.target.value)}
              placeholder="Filtrar por codigo"
            />
          </label>

          <label className={styles.field}>
            <span>Descricao</span>
            <input
              type="text"
              value={filterDraft.description}
              onChange={(event) => updateFilterField("description", event.target.value)}
              placeholder="Filtrar por descricao"
            />
          </label>

          <label className={styles.field}>
            <span>Tipo</span>
            <select
              value={filterDraft.teamTypeId}
              onChange={(event) => updateFilterField("teamTypeId", event.target.value)}
              disabled={isLoadingMeta}
            >
              <option value="">Todos</option>
              {teamTypes.map((teamType) => (
                <option key={teamType.id} value={teamType.id}>
                  {teamType.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Categoria</span>
            <select
              value={filterDraft.categoryId}
              onChange={(event) => updateFilterField("categoryId", event.target.value)}
              disabled={isLoadingMeta}
            >
              <option value="">Todas</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Status</span>
            <select
              value={filterDraft.status}
              onChange={(event) => updateFilterField("status", event.target.value as ActivityFilterState["status"])}
            >
              <option value="">Todos</option>
              <option value="ATIVO">Ativo</option>
              <option value="INATIVO">Inativo</option>
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
          <h3 className={styles.cardTitle}>Lista de Atividades</h3>
          <CsvExportButton
            onClick={() => void handleExportActivities()}
            disabled={isExporting || isLoadingList || exportCooldown.isCoolingDown}
            isLoading={isExporting}
            className={styles.ghostButton}
          />
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Cod. SAP</th>
                <th>Descricao</th>
                <th>Tipo</th>
                <th>Categoria</th>
                <th>Valor</th>
                <th>Pontos</th>
                <th>Unidade</th>
                <th>Registrado em</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {activities.length > 0 ? (
                activities.map((activity) => (
                  <tr key={activity.id} className={!activity.isActive ? styles.inactiveRow : undefined}>
                    <td>
                      <div className={styles.sobCell}>
                        <span>{activity.code}</span>
                        {!activity.isActive ? <span className={styles.statusTag}>Inativo</span> : null}
                      </div>
                    </td>
                    <td>{activity.codeIdd || "-"}</td>
                    <td>{activity.description}</td>
                    <td>{activity.teamTypeName}</td>
                    <td>{activity.categoryName}</td>
                    <td>{formatMoney(activity.value)}</td>
                    <td>{formatPoints(activity.voicePoint)}</td>
                    <td>{activity.unit}</td>
                    <td>{formatDateTime(activity.createdAt)}</td>
                    <td className={styles.actionsCell}>
                      <div className={styles.tableActions}>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionView}`}
                          onClick={() => setDetailActivity(activity)}
                          title="Detalhes"
                          aria-label="Detalhes da atividade"
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
                          onClick={() => startEdit(activity)}
                          title="Editar"
                          aria-label="Editar atividade"
                          disabled={!activity.isActive}
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
                          onClick={() => void openHistoryModal(activity)}
                          title="Historico"
                          aria-label="Historico da atividade"
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
                          className={`${styles.actionButton} ${activity.isActive ? styles.actionCancel : styles.actionActivate}`}
                          onClick={() => openStatusModal(activity)}
                          title={activity.isActive ? "Cancelar" : "Ativar"}
                          aria-label={activity.isActive ? "Cancelar atividade" : "Ativar atividade"}
                        >
                          {activity.isActive ? (
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
                  <td colSpan={10} className={styles.emptyRow}>
                    {isLoadingList ? "Carregando atividades..." : "Nenhuma atividade encontrada para os filtros informados."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          onPrev={() => setPage((current) => Math.max(1, current - 1))}
          onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
          disabled={isLoadingList}
          className={styles.pagination}
          actionsClassName={styles.paginationActions}
          buttonClassName={styles.ghostButton}
        />
      </article>

      {detailActivity ? (
        <div className={styles.modalOverlay} onClick={() => setDetailActivity(null)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Detalhes da Atividade {detailActivity.code}</h4>
                <p className={styles.modalSubtitle}>ID da atividade: {detailActivity.id}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setDetailActivity(null)}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <div className={styles.detailGrid}>
                <div><strong>Status:</strong> {detailActivity.isActive ? "Ativo" : "Inativo"}</div>
                <div><strong>Codigo:</strong> {detailActivity.code}</div>
                <div><strong>Cod. SAP:</strong> {detailActivity.codeIdd || "-"}</div>
                <div><strong>Descricao:</strong> {detailActivity.description}</div>
                <div><strong>Tipo:</strong> {detailActivity.teamTypeName}</div>
                <div><strong>Categoria:</strong> {detailActivity.categoryName}</div>
                <div><strong>Grupo:</strong> {detailActivity.groupName || "-"}</div>
                <div><strong>Valor:</strong> {formatMoney(detailActivity.value)}</div>
                <div><strong>Pontos:</strong> {formatPoints(detailActivity.voicePoint)}</div>
                <div><strong>Unidade:</strong> {detailActivity.unit}</div>
                <div><strong>Alcance:</strong> {detailActivity.scope || "-"}</div>
                <div><strong>Registrado por:</strong> {formatAuditActor(detailActivity.createdByName)}</div>
                <div><strong>Criado em:</strong> {formatDateTime(detailActivity.createdAt)}</div>
                <div><strong>Atualizado por:</strong> {formatAuditActor(detailActivity.updatedByName)}</div>
                <div><strong>Atualizado em:</strong> {formatDateTime(detailActivity.updatedAt)}</div>
                {!detailActivity.isActive ? (
                  <>
                    <div><strong>Cancelado em:</strong> {formatDateTime(detailActivity.canceledAt)}</div>
                    <div><strong>Cancelado por:</strong> {detailActivity.canceledByName ?? "-"}</div>
                    <div className={styles.detailWide}><strong>Motivo do cancelamento:</strong> {detailActivity.cancellationReason ?? "-"}</div>
                  </>
                ) : null}
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {historyActivity ? (
        <div className={styles.modalOverlay} onClick={closeHistoryModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Historico da Atividade {historyActivity.code}</h4>
                <p className={styles.modalSubtitle}>ID da atividade: {historyActivity.id}</p>
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
                        void loadActivityHistory(historyActivity, target);
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
                        void loadActivityHistory(historyActivity, target);
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

      {statusActivity ? (
        <div className={styles.modalOverlay} onClick={closeStatusModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>{statusActivity.isActive ? "Cancelar Atividade" : "Ativar Atividade"}</h4>
                <p className={styles.modalSubtitle}>Atividade: {statusActivity.code}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={closeStatusModal}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <label className={styles.field}>
                <span>
                  Motivo <span className="requiredMark">*</span>
                </span>
                <textarea
                  value={statusReason}
                  onChange={(event) => setStatusReason(event.target.value)}
                  placeholder={statusActivity.isActive ? "Informe o motivo do cancelamento" : "Informe o motivo da ativacao"}
                  rows={4}
                />
              </label>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={statusActivity.isActive ? styles.dangerButton : styles.primaryButton}
                  onClick={() => void confirmStatusChange()}
                  disabled={!canSubmitStatusChange}
                >
                  {isChangingStatus
                    ? statusActivity.isActive
                      ? "Cancelando..."
                      : "Ativando..."
                    : statusActivity.isActive
                      ? "Confirmar cancelamento"
                      : "Confirmar ativacao"}
                </button>
                <button type="button" className={styles.ghostButton} onClick={closeStatusModal} disabled={isChangingStatus}>
                  Fechar
                </button>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      <MassImportModal controller={massImport} entityLabel="atividades" columnsHint={ACTIVITY_MASS_IMPORT_COLUMNS_HINT} />
    </section>
  );
}
