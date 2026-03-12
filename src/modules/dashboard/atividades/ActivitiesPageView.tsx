"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import styles from "./ActivitiesPageView.module.css";

type ActivityItem = {
  id: string;
  code: string;
  description: string;
  group: string;
  value: number;
  unit: string;
  scope: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type ActivityFormState = {
  id: string | null;
  code: string;
  description: string;
  group: string;
  value: string;
  unit: string;
  scope: string;
};

type ActivityFilterState = {
  code: string;
  description: string;
};

type ActivitiesListResponse = {
  activities?: ActivityItem[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

const PAGE_SIZE = 20;

const INITIAL_FORM: ActivityFormState = {
  id: null,
  code: "",
  description: "",
  group: "",
  value: "",
  unit: "",
  scope: "",
};

const INITIAL_FILTERS: ActivityFilterState = {
  code: "",
  description: "",
};

function formatMoney(value: number) {
  return Number(value ?? 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function toInputMoney(value: number) {
  return String(Number(value ?? 0).toFixed(2));
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
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadActivities = useCallback(
    async (targetPage: number, filters: ActivityFilterState) => {
      if (!session?.accessToken) {
        return;
      }

      setIsLoadingList(true);

      try {
        const params = new URLSearchParams();
        if (filters.code.trim()) {
          params.set("code", filters.code.trim());
        }
        if (filters.description.trim()) {
          params.set("description", filters.description.trim());
        }
        params.set("page", String(targetPage));
        params.set("pageSize", String(PAGE_SIZE));

        const response = await fetch(`/api/activities?${params.toString()}`, {
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
          return;
        }

        setActivities(data.activities ?? []);
        setTotal(data.pagination?.total ?? 0);
      } catch {
        setActivities([]);
        setTotal(0);
        setFeedback({
          type: "error",
          message: "Falha ao carregar atividades.",
        });
      } finally {
        setIsLoadingList(false);
      }
    },
    [session?.accessToken],
  );

  useEffect(() => {
    void loadActivities(page, activeFilters);
  }, [activeFilters, loadActivities, page]);

  const formTitle = useMemo(
    () => (form.id ? "Editar Atividade" : "Cadastro de Atividades"),
    [form.id],
  );

  const isEditing = Boolean(form.id);

  function resetForm() {
    setForm(INITIAL_FORM);
  }

  function updateFilterField(field: keyof ActivityFilterState, value: string) {
    setFilterDraft((current) => ({ ...current, [field]: value }));
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
      description: activity.description,
      group: activity.group,
      value: toInputMoney(activity.value),
      unit: activity.unit,
      scope: activity.scope,
    });
    setFeedback(null);
    scrollDashboardContentToTop();
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
        code: form.code,
        description: form.description,
        group: form.group,
        value: form.value,
        unit: form.unit,
        scope: form.scope,
      };

      const response = await fetch("/api/activities", {
        method: form.id ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json().catch(() => ({}))) as { success?: boolean; message?: string };

      if (!response.ok || !data.success) {
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

  return (
    <section className={styles.wrapper}>
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

          <label className={styles.field}>
            <span>
              Valor <span className="requiredMark">*</span>
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.value}
              onChange={(event) => setForm((current) => ({ ...current, value: event.target.value }))}
              placeholder="0,00"
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
          <div className={styles.tableHint}>Listagem paginada no servidor ({PAGE_SIZE} por pagina).</div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Descricao</th>
                <th>Valor</th>
                <th>Unidade</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {!isLoadingList && activities.length === 0 ? (
                <tr>
                  <td colSpan={5} className={styles.emptyRow}>
                    Nenhuma atividade encontrada para os filtros informados.
                  </td>
                </tr>
              ) : null}

              {activities.map((activity) => (
                <tr key={activity.id}>
                  <td>{activity.code}</td>
                  <td>{activity.description}</td>
                  <td>{formatMoney(activity.value)}</td>
                  <td>{activity.unit}</td>
                  <td className={styles.actionsCell}>
                    <button
                      type="button"
                      className={`${styles.actionButton} ${styles.actionEdit}`}
                      onClick={() => startEdit(activity)}
                      title="Editar atividade"
                      aria-label="Editar atividade"
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
                  </td>
                </tr>
              ))}
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

      {feedback ? (
        <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>{feedback.message}</div>
      ) : null}
    </section>
  );
}
