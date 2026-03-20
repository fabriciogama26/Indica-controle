"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import styles from "./TeamsPageView.module.css";

type TeamItem = {
  id: string;
  name: string;
  vehiclePlate: string;
  serviceCenterId: string | null;
  serviceCenterName: string;
  teamTypeId: string;
  teamTypeName: string;
  foremanId: string;
  foremanName: string;
  isActive: boolean;
  cancellationReason: string | null;
  canceledAt: string | null;
  canceledByName: string | null;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

type TeamHistoryEntry = {
  id: string;
  changeType: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason: string | null;
  createdAt: string;
  createdByName: string;
  changes: Record<string, { from: string | null; to: string | null }>;
};

type ForemanOption = {
  id: string;
  name: string;
};

type TeamTypeOption = {
  id: string;
  name: string;
};

type ServiceCenterOption = {
  id: string;
  name: string;
};

type TeamFormState = {
  id: string | null;
  name: string;
  vehiclePlate: string;
  serviceCenterId: string;
  teamTypeId: string;
  foremanId: string;
  updatedAt: string;
};

type TeamFilterState = {
  name: string;
  vehiclePlate: string;
  serviceCenterId: string;
  teamTypeId: string;
  foremanId: string;
};

type TeamsListResponse = {
  teams?: TeamItem[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

type TeamsMetaResponse = {
  foremen?: ForemanOption[];
  teamTypes?: TeamTypeOption[];
  serviceCenters?: ServiceCenterOption[];
  message?: string;
};

type TeamHistoryResponse = {
  history?: TeamHistoryEntry[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

const PAGE_SIZE = 20;
const HISTORY_PAGE_SIZE = 5;
const EXPORT_PAGE_SIZE = 100;

const HISTORY_FIELD_LABELS: Record<string, string> = {
  name: "Nome da equipe",
  vehiclePlate: "Placa do veiculo",
  serviceCenterName: "Base",
  teamTypeName: "Tipo",
  foremanName: "Encarregado",
  isActive: "Status",
  cancellationReason: "Motivo do cancelamento",
  canceledAt: "Data do cancelamento",
  activationReason: "Motivo da ativacao",
};

const INITIAL_FORM: TeamFormState = {
  id: null,
  name: "",
  vehiclePlate: "",
  serviceCenterId: "",
  teamTypeId: "",
  foremanId: "",
  updatedAt: "",
};

const INITIAL_FILTERS: TeamFilterState = {
  name: "",
  vehiclePlate: "",
  serviceCenterId: "",
  teamTypeId: "",
  foremanId: "",
};

function normalizeText(value: string) {
  return String(value ?? "").trim();
}

function normalizePlate(value: string) {
  return normalizeText(value).toUpperCase();
}

function buildQuery(filters: TeamFilterState, page: number, pageSize = PAGE_SIZE) {
  const params = new URLSearchParams();
  if (filters.name.trim()) {
    params.set("name", filters.name.trim());
  }
  if (filters.vehiclePlate.trim()) {
    params.set("vehiclePlate", filters.vehiclePlate.trim());
  }
  if (filters.serviceCenterId.trim()) {
    params.set("serviceCenterId", filters.serviceCenterId.trim());
  }
  if (filters.teamTypeId.trim()) {
    params.set("teamTypeId", filters.teamTypeId.trim());
  }
  if (filters.foremanId.trim()) {
    params.set("foremanId", filters.foremanId.trim());
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

function buildTeamsCsv(teamItems: TeamItem[]) {
  const header = ["Nome da equipe", "Placa do veiculo", "Base", "Tipo", "Encarregado", "Registrado em", "Status"];
  const rows = teamItems.map((team) => [
    team.name,
    team.vehiclePlate,
    team.serviceCenterName,
    team.teamTypeName,
    team.foremanName,
    formatDateTime(team.createdAt),
    team.isActive ? "Ativo" : "Inativo",
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

export function TeamsPageView() {
  const { session } = useAuth();
  const [form, setForm] = useState<TeamFormState>(INITIAL_FORM);
  const [filterDraft, setFilterDraft] = useState<TeamFilterState>(INITIAL_FILTERS);
  const [activeFilters, setActiveFilters] = useState<TeamFilterState>(INITIAL_FILTERS);
  const [foremen, setForemen] = useState<ForemanOption[]>([]);
  const [teamTypes, setTeamTypes] = useState<TeamTypeOption[]>([]);
  const [serviceCenters, setServiceCenters] = useState<ServiceCenterOption[]>([]);
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [detailTeam, setDetailTeam] = useState<TeamItem | null>(null);
  const [historyTeam, setHistoryTeam] = useState<TeamItem | null>(null);
  const [historyEntries, setHistoryEntries] = useState<TeamHistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [statusTeam, setStatusTeam] = useState<TeamItem | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));
  const isEditing = Boolean(form.id);
  const statusAction = statusTeam?.isActive ? "cancel" : "activate";
  const canSubmitStatusChange = Boolean(statusReason.trim()) && !isChangingStatus;
  const missingTeamMetaReasons = useMemo(() => {
    if (isLoadingMeta) {
      return [] as string[];
    }

    const reasons: string[] = [];
    if (serviceCenters.length === 0) {
      reasons.push("Base (Centro de Servico)");
    }
    if (teamTypes.length === 0) {
      reasons.push("Tipo de Equipe");
    }
    if (foremen.length === 0) {
      reasons.push("Encarregado");
    }
    return reasons;
  }, [foremen.length, isLoadingMeta, serviceCenters.length, teamTypes.length]);
  const canSubmitTeamForm = missingTeamMetaReasons.length === 0 && !isSaving;

  const loadMeta = useCallback(async () => {
    if (!session?.accessToken) {
      return;
    }

    setIsLoadingMeta(true);
    try {
      const response = await fetch("/api/teams/meta", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      const data = (await response.json().catch(() => ({}))) as TeamsMetaResponse;
      if (!response.ok) {
        setForemen([]);
        setTeamTypes([]);
        setServiceCenters([]);
        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao carregar metadados de equipes.",
        });
        return;
      }

      setForemen(data.foremen ?? []);
      setTeamTypes(data.teamTypes ?? []);
      setServiceCenters(data.serviceCenters ?? []);
    } catch {
      setForemen([]);
      setTeamTypes([]);
      setServiceCenters([]);
      setFeedback({
        type: "error",
        message: "Falha ao carregar metadados de equipes.",
      });
    } finally {
      setIsLoadingMeta(false);
    }
  }, [session?.accessToken]);

  const loadTeams = useCallback(
    async (targetPage: number, filters: TeamFilterState) => {
      if (!session?.accessToken) {
        return;
      }

      setIsLoadingList(true);

      try {
        const query = buildQuery(filters, targetPage);
        const response = await fetch(`/api/teams?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as TeamsListResponse;

        if (!response.ok) {
          setTeams([]);
          setTotal(0);
          setFeedback({
            type: "error",
            message: data.message ?? "Falha ao carregar equipes.",
          });
          return [] as TeamItem[];
        }

        const nextTeams = data.teams ?? [];
        setTeams(nextTeams);
        setTotal(data.pagination?.total ?? 0);
        return nextTeams;
      } catch {
        setTeams([]);
        setTotal(0);
        setFeedback({
          type: "error",
          message: "Falha ao carregar equipes.",
        });
        return [] as TeamItem[];
      } finally {
        setIsLoadingList(false);
      }
    },
    [session?.accessToken],
  );

  const loadTeamHistory = useCallback(
    async (team: TeamItem, targetPage: number) => {
      if (!session?.accessToken) {
        setFeedback({ type: "error", message: "Sessao invalida para carregar historico." });
        return;
      }

      setIsLoadingHistory(true);
      try {
        const params = new URLSearchParams();
        params.set("historyTeamId", team.id);
        params.set("historyPage", String(targetPage));
        params.set("historyPageSize", String(HISTORY_PAGE_SIZE));

        const response = await fetch(`/api/teams?${params.toString()}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as TeamHistoryResponse;
        if (!response.ok) {
          setFeedback({ type: "error", message: data.message ?? "Falha ao carregar historico da equipe." });
          setHistoryEntries([]);
          setHistoryTotal(0);
          return;
        }

        setHistoryEntries(data.history ?? []);
        setHistoryPage(data.pagination?.page ?? targetPage);
        setHistoryTotal(data.pagination?.total ?? 0);
      } catch {
        setFeedback({ type: "error", message: "Falha ao carregar historico da equipe." });
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
    void loadTeams(page, activeFilters);
  }, [activeFilters, loadTeams, page]);

  const formTitle = useMemo(() => (isEditing ? "Editar Equipe" : "Cadastro de Equipes"), [isEditing]);

  function resetForm() {
    setForm(INITIAL_FORM);
  }

  function updateFilterField(field: keyof TeamFilterState, value: string) {
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

  function startEdit(team: TeamItem) {
    setForm({
      id: team.id,
      name: team.name,
      vehiclePlate: team.vehiclePlate,
      serviceCenterId: team.serviceCenterId ?? "",
      teamTypeId: team.teamTypeId,
      foremanId: team.foremanId,
      updatedAt: team.updatedAt,
    });
    setFeedback(null);
    scrollDashboardContentToTop();
  }

  function closeHistoryModal() {
    setHistoryTeam(null);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    setIsLoadingHistory(false);
  }

  function openStatusModal(team: TeamItem) {
    setStatusTeam(team);
    setStatusReason("");
  }

  function closeStatusModal() {
    setStatusTeam(null);
    setStatusReason("");
    setIsChangingStatus(false);
  }

  async function openHistoryModal(team: TeamItem) {
    setHistoryTeam(team);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    await loadTeamHistory(team, 1);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.accessToken) {
      setFeedback({
        type: "error",
        message: "Sessao invalida para salvar equipe.",
      });
      return;
    }

    if (missingTeamMetaReasons.length > 0) {
      setFeedback({
        type: "error",
        message: `Cadastre os prerequisitos antes de salvar equipe: ${missingTeamMetaReasons.join(", ")}.`,
      });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      const payload = {
        id: form.id,
        name: normalizeText(form.name),
        vehiclePlate: normalizePlate(form.vehiclePlate),
        serviceCenterId: normalizeText(form.serviceCenterId),
        teamTypeId: normalizeText(form.teamTypeId),
        foremanId: normalizeText(form.foremanId),
        ...(form.id ? { expectedUpdatedAt: form.updatedAt } : {}),
      };

      const response = await fetch("/api/teams", {
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
          resetForm();
          await loadTeams(page, activeFilters);
        }

        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao salvar equipe.",
        });
        return;
      }

      setFeedback({
        type: "success",
        message: data.message ?? "Equipe salva com sucesso.",
      });
      resetForm();
      await loadTeams(1, activeFilters);
      setPage(1);
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao salvar equipe.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmStatusChange() {
    if (!session?.accessToken || !statusTeam || !statusAction || !statusReason.trim()) {
      return;
    }

    setIsChangingStatus(true);

    try {
      const response = await fetch("/api/teams", {
        method: "PATCH",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          id: statusTeam.id,
          reason: statusReason.trim(),
          action: statusAction,
          expectedUpdatedAt: statusTeam.updatedAt,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { success?: boolean; message?: string; code?: string };

      if (!response.ok || !data.success) {
        if (
          data.code === "CONCURRENT_MODIFICATION"
          || data.code === "RECORD_INACTIVE"
          || data.code === "STATUS_ALREADY_CHANGED"
        ) {
          if (form.id === statusTeam.id) {
            resetForm();
          }
          closeStatusModal();
          await loadTeams(page, activeFilters);
        }

        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao atualizar status da equipe.",
        });
        return;
      }

      setFeedback({
        type: "success",
        message: data.message ?? "Status da equipe atualizado com sucesso.",
      });

      if (form.id === statusTeam.id) {
        resetForm();
      }

      closeStatusModal();
      await loadTeams(page, activeFilters);
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao atualizar status da equipe.",
      });
    } finally {
      setIsChangingStatus(false);
    }
  }

  async function handleExportTeams() {
    if (!session?.accessToken) {
      setFeedback({
        type: "error",
        message: "Sessao invalida para exportar equipes.",
      });
      return;
    }

    setIsExporting(true);

    try {
      const allTeams: TeamItem[] = [];
      let exportPage = 1;
      let totalItems = 0;

      while (true) {
        const query = buildQuery(activeFilters, exportPage, EXPORT_PAGE_SIZE);
        const response = await fetch(`/api/teams?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as TeamsListResponse;

        if (!response.ok) {
          setFeedback({
            type: "error",
            message: data.message ?? "Falha ao exportar equipes.",
          });
          return;
        }

        const pageItems = data.teams ?? [];
        totalItems = data.pagination?.total ?? totalItems;
        allTeams.push(...pageItems);

        if (pageItems.length === 0 || allTeams.length >= totalItems) {
          break;
        }

        exportPage += 1;
      }

      if (allTeams.length === 0) {
        setFeedback({
          type: "error",
          message: "Nenhuma equipe encontrada para exportar com os filtros atuais.",
        });
        return;
      }

      const csv = buildTeamsCsv(allTeams);
      const exportDate = new Date().toISOString().slice(0, 10);
      downloadCsvFile(csv, `equipes_${exportDate}.csv`);

      setFeedback({
        type: "success",
        message: `${allTeams.length} equipe(s) exportada(s) com sucesso.`,
      });
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao exportar equipes.",
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
        {missingTeamMetaReasons.length > 0 ? (
          <div className={styles.feedbackError}>
            Cadastre os prerequisitos antes de salvar equipe: {missingTeamMetaReasons.join(", ")}.
          </div>
        ) : null}

        <form className={styles.formGrid} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>
              Nome da equipe <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Ex.: Equipe Norte 01"
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Placa do veiculo <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.vehiclePlate}
              onChange={(event) => setForm((current) => ({ ...current, vehiclePlate: event.target.value }))}
              placeholder="Ex.: ABC1D23"
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Base <span className="requiredMark">*</span>
            </span>
            <select
              value={form.serviceCenterId}
              onChange={(event) => setForm((current) => ({ ...current, serviceCenterId: event.target.value }))}
              required
              disabled={isLoadingMeta}
            >
              <option value="" disabled>
                {isLoadingMeta ? "Carregando..." : "Selecione a base"}
              </option>
              {serviceCenters.map((serviceCenter) => (
                <option key={serviceCenter.id} value={serviceCenter.id}>
                  {serviceCenter.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>
              Tipo <span className="requiredMark">*</span>
            </span>
            <select
              value={form.teamTypeId}
              onChange={(event) => setForm((current) => ({ ...current, teamTypeId: event.target.value }))}
              required
              disabled={isLoadingMeta}
            >
              <option value="" disabled>
                {isLoadingMeta ? "Carregando..." : "Selecione"}
              </option>
              {teamTypes.map((teamType) => (
                <option key={teamType.id} value={teamType.id}>
                  {teamType.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>
              Encarregado <span className="requiredMark">*</span>
            </span>
            <select
              value={form.foremanId}
              onChange={(event) => setForm((current) => ({ ...current, foremanId: event.target.value }))}
              required
              disabled={isLoadingMeta}
            >
              <option value="" disabled>
                {isLoadingMeta ? "Carregando..." : "Selecione"}
              </option>
              {foremen.map((foreman) => (
                <option key={foreman.id} value={foreman.id}>
                  {foreman.name}
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
            <button type="submit" className={styles.primaryButton} disabled={!canSubmitTeamForm}>
              {isSaving ? "Salvando..." : isEditing ? "Atualizar" : "Cadastrar"}
            </button>
          </div>
        </form>
      </article>

      <article className={styles.card}>
        <h3 className={styles.cardTitle}>Filtros</h3>

        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span>Nome da equipe</span>
            <input
              type="text"
              value={filterDraft.name}
              onChange={(event) => updateFilterField("name", event.target.value)}
              placeholder="Filtrar por equipe"
            />
          </label>

          <label className={styles.field}>
            <span>Placa do veiculo</span>
            <input
              type="text"
              value={filterDraft.vehiclePlate}
              onChange={(event) => updateFilterField("vehiclePlate", event.target.value)}
              placeholder="Filtrar por placa"
            />
          </label>

          <label className={styles.field}>
            <span>Encarregado</span>
            <select
              value={filterDraft.foremanId}
              onChange={(event) => updateFilterField("foremanId", event.target.value)}
              disabled={isLoadingMeta}
            >
              <option value="">Todos</option>
              {foremen.map((foreman) => (
                <option key={foreman.id} value={foreman.id}>
                  {foreman.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Base</span>
            <select
              value={filterDraft.serviceCenterId}
              onChange={(event) => updateFilterField("serviceCenterId", event.target.value)}
              disabled={isLoadingMeta}
            >
              <option value="">Todas</option>
              {serviceCenters.map((serviceCenter) => (
                <option key={serviceCenter.id} value={serviceCenter.id}>
                  {serviceCenter.name}
                </option>
              ))}
            </select>
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
          <h3 className={styles.cardTitle}>Lista de Equipes</h3>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => void handleExportTeams()}
            disabled={isExporting || isLoadingList}
          >
            {isExporting ? "Exportando..." : "Exportar Excel (CSV)"}
          </button>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Nome da equipe</th>
                <th>Placa do veiculo</th>
                <th>Base</th>
                <th>Tipo</th>
                <th>Encarregado</th>
                <th>Registrado em</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {teams.length > 0 ? (
                teams.map((team) => (
                  <tr key={team.id} className={!team.isActive ? styles.inactiveRow : undefined}>
                    <td>
                      <div className={styles.sobCell}>
                        <span>{team.name}</span>
                        {!team.isActive ? <span className={styles.statusTag}>Inativo</span> : null}
                      </div>
                    </td>
                    <td>{team.vehiclePlate}</td>
                    <td>{team.serviceCenterName}</td>
                    <td>{team.teamTypeName}</td>
                    <td>{team.foremanName}</td>
                    <td>{formatDateTime(team.createdAt)}</td>
                    <td className={styles.actionsCell}>
                      <div className={styles.tableActions}>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionView}`}
                          onClick={() => setDetailTeam(team)}
                          title="Detalhes"
                          aria-label="Detalhes da equipe"
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
                          onClick={() => startEdit(team)}
                          title="Editar"
                          aria-label="Editar equipe"
                          disabled={!team.isActive}
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
                          onClick={() => void openHistoryModal(team)}
                          title="Historico"
                          aria-label="Historico da equipe"
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
                          className={`${styles.actionButton} ${team.isActive ? styles.actionCancel : styles.actionActivate}`}
                          onClick={() => openStatusModal(team)}
                          title={team.isActive ? "Cancelar" : "Ativar"}
                          aria-label={team.isActive ? "Cancelar equipe" : "Ativar equipe"}
                        >
                          {team.isActive ? (
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
                    {isLoadingList ? "Carregando equipes..." : "Nenhuma equipe encontrada para os filtros informados."}
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

      {detailTeam ? (
        <div className={styles.modalOverlay} onClick={() => setDetailTeam(null)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Detalhes da Equipe {detailTeam.name}</h4>
                <p className={styles.modalSubtitle}>ID da equipe: {detailTeam.id}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setDetailTeam(null)}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <div className={styles.detailGrid}>
                <div>
                  <strong>Status:</strong> {detailTeam.isActive ? "Ativo" : "Inativo"}
                </div>
                <div>
                  <strong>Nome da equipe:</strong> {detailTeam.name}
                </div>
                <div>
                  <strong>Placa do veiculo:</strong> {detailTeam.vehiclePlate}
                </div>
                <div>
                  <strong>Base:</strong> {detailTeam.serviceCenterName}
                </div>
                <div>
                  <strong>Tipo:</strong> {detailTeam.teamTypeName}
                </div>
                <div>
                  <strong>Encarregado:</strong> {detailTeam.foremanName}
                </div>
                <div>
                  <strong>Registrado por:</strong> {detailTeam.createdByName}
                </div>
                <div>
                  <strong>Criado em:</strong> {formatDateTime(detailTeam.createdAt)}
                </div>
                <div>
                  <strong>Atualizado por:</strong> {detailTeam.updatedByName}
                </div>
                <div>
                  <strong>Atualizado em:</strong> {formatDateTime(detailTeam.updatedAt)}
                </div>
                {!detailTeam.isActive ? (
                  <>
                    <div>
                      <strong>Cancelado em:</strong> {formatDateTime(detailTeam.canceledAt)}
                    </div>
                    <div>
                      <strong>Cancelado por:</strong> {detailTeam.canceledByName ?? "-"}
                    </div>
                    <div className={styles.detailWide}>
                      <strong>Motivo do cancelamento:</strong> {detailTeam.cancellationReason ?? "-"}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {historyTeam ? (
        <div className={styles.modalOverlay} onClick={closeHistoryModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Historico da Equipe {historyTeam.name}</h4>
                <p className={styles.modalSubtitle}>ID da equipe: {historyTeam.id}</p>
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
                        void loadTeamHistory(historyTeam, target);
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
                        void loadTeamHistory(historyTeam, target);
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

      {statusTeam ? (
        <div className={styles.modalOverlay} onClick={closeStatusModal}>
          <article className={styles.statusModalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>{statusAction === "cancel" ? "Cancelar Equipe" : "Ativar Equipe"}</h4>
                <p className={styles.modalSubtitle}>
                  {statusAction === "cancel"
                    ? `Equipe ${statusTeam.name} sera cancelada.`
                    : `Equipe ${statusTeam.name} sera ativada.`}
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

