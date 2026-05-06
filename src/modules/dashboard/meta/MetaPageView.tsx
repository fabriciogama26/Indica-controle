"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { CsvExportButton } from "@/components/ui/CsvExportButton";
import { useAuth } from "@/hooks/useAuth";
import { useExportCooldown } from "@/hooks/useExportCooldown";
import styles from "./MetaPageView.module.css";

type TeamTypeTarget = {
  id: string;
  name: string;
  dailyValue: number;
  activeTeamCount: number;
  targetId: string | null;
  updatedAt: string | null;
};

type CycleOption = {
  id: string | null;
  cycleStart: string;
  cycleEnd: string;
  label: string;
  defaultWorkdays: number;
  workedDays: number;
  workdays: number;
  notes: string;
  updatedAt: string | null;
  isEdited: boolean;
  targets?: Array<{
    teamTypeId: string;
    dailyValue: number;
    measuredTeamCount: number;
  }>;
};

type MetaRegistration = {
  id: string;
  cycleStart: string;
  cycleEnd: string;
  label: string;
  workdays: number;
  defaultWorkdays: number;
  workedDays: number;
  notes: string;
  updatedAt: string | null;
  targetCount: number;
  totalActiveTeams: number;
  totalMeasuredTeams: number;
  totalDailyGoal: number;
  totalCycleGoal: number;
  totalStandardCycleGoal: number;
  totalWorkedCycleGoal: number;
};

type MetaDetailItem = {
  id: string;
  teamTypeId: string;
  teamTypeName: string;
  dailyValue: number;
  activeTeamCount: number;
  measuredTeamCount: number;
  dailyGoal: number;
  cycleGoal: number;
  standardCycleGoal: number;
  workedCycleGoal: number;
  updatedAt: string;
};

type MetaDetail = MetaRegistration & {
  items: MetaDetailItem[];
};

type MetaHistoryEntry = {
  id: string;
  actionType: "CREATE" | "UPDATE";
  reason: string;
  changes: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  createdByName: string;
};

type MetaResponse = {
  teamTypes?: TeamTypeTarget[];
  cycles?: CycleOption[];
  registrations?: MetaRegistration[];
  message?: string;
};

type MetaDetailResponse = {
  detail?: MetaDetail;
  message?: string;
};

type MetaHistoryResponse = {
  history?: MetaHistoryEntry[];
  message?: string;
};

type SaveResponse = {
  success?: boolean;
  message?: string;
};

const HISTORY_PAGE_SIZE = 5;
const META_HISTORY_FIELD_LABELS: Record<string, string> = {
  cycleStart: "Inicio do ciclo",
  cycleEnd: "Fim do ciclo",
  workdays: "Dias uteis",
  defaultWorkdays: "Dias padrao segunda a sexta",
  workedDays: "Média Dias trabalhados",
  notes: "Observacao",
  totalMeasuredTeams: "Equipes medida",
  totalDailyGoal: "Meta diaria",
  totalCycleGoal: "Meta ciclo",
  totalStandardCycleGoal: "Meta ciclo padrao",
  totalWorkedCycleGoal: "Meta ciclo trabalhado",
};

function scrollDashboardContentToTop() {
  if (typeof window === "undefined") return;
  const content = document.querySelector<HTMLElement>('[data-main-content-scroll="true"]');
  if (content) {
    content.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatDate(value: string) {
  if (!value) return "-";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("pt-BR");
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("pt-BR");
}

function escapeCsvValue(value: string | number | null | undefined) {
  const normalized = String(value ?? "").replace(/\r?\n/g, " ").trim();
  if (/[;"\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

function downloadCsvFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildRegistrationsCsv(registrations: MetaRegistration[]) {
  const header = [
    "Ciclo",
    "Dias uteis",
    "Dias padrao",
    "Média Dias trabalhados",
    "Equipes ativas",
    "Equipes medida",
    "Meta diaria",
    "Meta ciclo",
    "Meta ciclo padrao",
    "Meta ciclo trabalhado",
    "Atualizado em",
  ];
  const rows = registrations.map((registration) => [
    registration.label,
    registration.workdays,
    registration.defaultWorkdays,
    registration.workedDays,
    registration.totalActiveTeams,
    registration.totalMeasuredTeams,
    formatCurrency(registration.totalDailyGoal),
    formatCurrency(registration.totalCycleGoal),
    formatCurrency(registration.totalStandardCycleGoal),
    formatCurrency(registration.totalWorkedCycleGoal),
    formatDateTime(registration.updatedAt),
  ]);
  const csvLines = [header, ...rows].map((line) => line.map((item) => escapeCsvValue(item)).join(";"));
  return `\uFEFF${csvLines.join("\n")}\n`;
}

function formatInputMoney(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function normalizeMoneyInput(value: string) {
  return value.replace(/[^\d,.]/g, "");
}

function parseInputMoney(value: string) {
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Number(parsed.toFixed(2));
}

function formatHistoryActionLabel(action: string) {
  const normalized = String(action ?? "").toUpperCase();
  if (normalized === "CREATE") return "Cadastro";
  if (normalized === "UPDATE") return "Edicao";
  return normalized || "Atualizacao";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatMetaHistoryValue(field: string, value: unknown) {
  if (value === null || value === undefined) return "-";

  if (field === "cycleStart" || field === "cycleEnd") {
    return formatDate(String(value));
  }

  if (
    field === "totalDailyGoal"
    || field === "totalCycleGoal"
    || field === "totalStandardCycleGoal"
    || field === "totalWorkedCycleGoal"
  ) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? formatCurrency(parsed) : "-";
  }

  const normalized = String(value).trim();
  return normalized || "-";
}

function resolveMetaHistoryChanges(entry: MetaHistoryEntry) {
  const from = isRecord(entry.changes.from) ? entry.changes.from : {};
  const to = isRecord(entry.changes.to) ? entry.changes.to : {};
  const fields = Array.from(new Set([...Object.keys(from), ...Object.keys(to)]))
    .filter((field) => META_HISTORY_FIELD_LABELS[field]);

  return fields.map((field) => ({
    field,
    label: META_HISTORY_FIELD_LABELS[field],
    from: from[field],
    to: to[field],
  }));
}

function isCycleCurrent(cycle: CycleOption) {
  const today = new Date();
  const start = new Date(`${cycle.cycleStart}T00:00:00`);
  const end = new Date(`${cycle.cycleEnd}T23:59:59`);
  return today >= start && today <= end;
}

export function MetaPageView() {
  const { session } = useAuth();
  const exportCooldown = useExportCooldown();
  const [teamTypes, setTeamTypes] = useState<TeamTypeTarget[]>([]);
  const [cycles, setCycles] = useState<CycleOption[]>([]);
  const [registrations, setRegistrations] = useState<MetaRegistration[]>([]);
  const [targetDraft, setTargetDraft] = useState<Record<string, string>>({});
  const [measuredTeamDraft, setMeasuredTeamDraft] = useState<Record<string, string>>({});
  const [selectedCycleStart, setSelectedCycleStart] = useState("");
  const [cycleWorkdays, setCycleWorkdays] = useState("");
  const [cycleNotes, setCycleNotes] = useState("");
  const [editingCycleId, setEditingCycleId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MetaDetail | null>(null);
  const [historyCycle, setHistoryCycle] = useState<MetaRegistration | null>(null);
  const [historyEntries, setHistoryEntries] = useState<MetaHistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const selectedCycle = useMemo(
    () => cycles.find((cycle) => cycle.cycleStart === selectedCycleStart) ?? null,
    [cycles, selectedCycleStart],
  );

  const targetRows = useMemo(() => {
    return teamTypes.map((teamType) => {
      const dailyValue = parseInputMoney(targetDraft[teamType.id] ?? "") ?? 0;
      const activeTeamCount = Number(teamType.activeTeamCount ?? 0);
      const measuredTeamCount = Number(measuredTeamDraft[teamType.id] ?? activeTeamCount);
      return {
        teamTypeId: teamType.id,
        name: teamType.name,
        dailyValue,
        activeTeamCount,
        measuredTeamCount,
        dailyGoal: dailyValue * measuredTeamCount,
      };
    });
  }, [measuredTeamDraft, targetDraft, teamTypes]);

  const targetSummary = useMemo(() => {
    const totalDailyGoal = targetRows.reduce((sum, item) => sum + item.dailyGoal, 0);
    const parsedWorkdays = Number(cycleWorkdays);
    const safeWorkdays = Number.isInteger(parsedWorkdays) && parsedWorkdays >= 0 ? parsedWorkdays : 0;
    const defaultWorkdays = selectedCycle?.defaultWorkdays ?? 0;
    const workedDays = selectedCycle?.workedDays ?? 0;
    return {
      configured: targetRows.filter((item) => item.dailyValue > 0).length,
      activeTeams: targetRows.reduce((sum, item) => sum + item.activeTeamCount, 0),
      measuredTeams: targetRows.reduce((sum, item) => sum + item.measuredTeamCount, 0),
      totalDailyGoal,
      cycleGoal: totalDailyGoal * safeWorkdays,
      standardCycleGoal: totalDailyGoal * defaultWorkdays,
      workedCycleGoal: totalDailyGoal * workedDays,
    };
  }, [cycleWorkdays, selectedCycle?.defaultWorkdays, selectedCycle?.workedDays, targetRows]);
  const isEditing = Boolean(editingCycleId);

  const historyTotalPages = Math.max(1, Math.ceil(historyEntries.length / HISTORY_PAGE_SIZE));
  const pagedHistoryEntries = useMemo(
    () => historyEntries.slice((historyPage - 1) * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE),
    [historyEntries, historyPage],
  );

  useEffect(() => {
    if (historyPage > historyTotalPages) {
      setHistoryPage(historyTotalPages);
    }
  }, [historyPage, historyTotalPages]);

  const loadMeta = useCallback(async () => {
    if (!session?.accessToken) return;

    setIsLoading(true);
    try {
      const response = await fetch("/api/meta", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });
      const data = (await response.json().catch(() => ({}))) as MetaResponse;

      if (!response.ok) {
        setTeamTypes([]);
        setCycles([]);
        setRegistrations([]);
        setFeedback({ type: "error", message: data.message ?? "Falha ao carregar metas." });
        return;
      }

      const nextTeamTypes = data.teamTypes ?? [];
      const nextCycles = data.cycles ?? [];
      setTeamTypes(nextTeamTypes);
      setCycles(nextCycles);
      setRegistrations(data.registrations ?? []);
      setTargetDraft(
        Object.fromEntries(nextTeamTypes.map((item) => [item.id, formatInputMoney(Number(item.dailyValue ?? 0))])),
      );
      setMeasuredTeamDraft(
        Object.fromEntries(nextTeamTypes.map((item) => [item.id, String(Number(item.activeTeamCount ?? 0))])),
      );

      setSelectedCycleStart((current) => {
        if (current && nextCycles.some((cycle) => cycle.cycleStart === current)) return current;
        const currentCycle = nextCycles.find(isCycleCurrent);
        return currentCycle?.cycleStart ?? nextCycles[0]?.cycleStart ?? "";
      });
    } catch {
      setTeamTypes([]);
      setCycles([]);
      setRegistrations([]);
      setFeedback({ type: "error", message: "Falha ao carregar metas." });
    } finally {
      setIsLoading(false);
    }
  }, [session?.accessToken]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (!selectedCycle) {
      setCycleWorkdays("");
      setCycleNotes("");
      return;
    }
    setCycleWorkdays(String(selectedCycle.workdays));
    setCycleNotes(selectedCycle.notes ?? "");
    if (!isEditing && selectedCycle.targets?.length) {
      const savedTargets = new Map(selectedCycle.targets.map((item) => [item.teamTypeId, item]));
      setTargetDraft((current) => {
        const next = { ...current };
        for (const teamType of teamTypes) {
          const savedTarget = savedTargets.get(teamType.id);
          if (savedTarget) {
            next[teamType.id] = formatInputMoney(Number(savedTarget.dailyValue ?? 0));
          }
        }
        return next;
      });
      setMeasuredTeamDraft((current) => {
        const next = { ...current };
        for (const teamType of teamTypes) {
          const savedTarget = savedTargets.get(teamType.id);
          if (savedTarget) {
            next[teamType.id] = String(Number(savedTarget.measuredTeamCount ?? 0));
          }
        }
        return next;
      });
    } else if (!isEditing) {
      setTargetDraft(
        Object.fromEntries(teamTypes.map((item) => [item.id, formatInputMoney(Number(item.dailyValue ?? 0))])),
      );
      setMeasuredTeamDraft(
        Object.fromEntries(teamTypes.map((item) => [item.id, String(Number(item.activeTeamCount ?? 0))])),
      );
    }
  }, [isEditing, selectedCycle, teamTypes]);

  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session?.accessToken || !selectedCycle) {
      setFeedback({ type: "error", message: "Selecione um ciclo valido para salvar o cadastro." });
      return;
    }

    const targets = teamTypes.map((teamType) => {
      const dailyValue = parseInputMoney(targetDraft[teamType.id] ?? "");
      const measuredTeamCount = Number(measuredTeamDraft[teamType.id] ?? "");
      return {
        teamTypeId: teamType.id,
        dailyValue,
        measuredTeamCount,
      };
    });

    if (targets.some((target) => target.dailyValue === null)) {
      setFeedback({ type: "error", message: "Informe valores validos para todos os tipos de equipe." });
      return;
    }

    if (targets.some((target) => !Number.isInteger(target.measuredTeamCount) || target.measuredTeamCount < 0)) {
      setFeedback({ type: "error", message: "Informe equipes medida validas para todos os tipos de equipe." });
      return;
    }

    const parsedWorkdays = Number(cycleWorkdays);
    if (!Number.isInteger(parsedWorkdays) || parsedWorkdays < 0 || parsedWorkdays > 31) {
      setFeedback({ type: "error", message: "Dias uteis deve ser um numero entre 0 e 31." });
      return;
    }

    setIsSaving(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/meta", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          action: "SAVE_META_REGISTRATION",
          cycleId: editingCycleId,
          targets,
          cycleStart: selectedCycle.cycleStart,
          cycleEnd: selectedCycle.cycleEnd,
          workdays: parsedWorkdays,
          defaultWorkdays: selectedCycle.defaultWorkdays,
          workedDays: selectedCycle.workedDays,
          notes: cycleNotes,
          reason: editingCycleId ? "Edicao do cadastro de meta." : "Cadastro inicial da meta.",
        }),
      });
      const data = (await response.json().catch(() => ({}))) as SaveResponse;
      if (!response.ok || !data.success) {
        setFeedback({ type: "error", message: data.message ?? "Falha ao salvar cadastro de metas." });
        return;
      }

      setFeedback({ type: "success", message: data.message ?? "Cadastro de metas salvo com sucesso." });
      setEditingCycleId(null);
      await loadMeta();
    } catch {
      setFeedback({ type: "error", message: "Falha ao salvar cadastro de metas." });
    } finally {
      setIsSaving(false);
    }
  }

  function updateTargetDraft(teamTypeId: string, value: string) {
    setTargetDraft((current) => ({
      ...current,
      [teamTypeId]: normalizeMoneyInput(value),
    }));
  }

  function updateMeasuredTeamDraft(teamTypeId: string, value: string) {
    setMeasuredTeamDraft((current) => ({
      ...current,
      [teamTypeId]: value.replace(/\D/g, ""),
    }));
  }

  async function loadDetail(cycleId: string) {
    if (!session?.accessToken) return null;
    setIsLoadingDetail(true);
    try {
      const response = await fetch(`/api/meta?detailCycleId=${cycleId}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const data = (await response.json().catch(() => ({}))) as MetaDetailResponse;
      if (!response.ok || !data.detail) {
        setFeedback({ type: "error", message: data.message ?? "Falha ao carregar detalhes da meta." });
        return null;
      }
      return data.detail;
    } catch {
      setFeedback({ type: "error", message: "Falha ao carregar detalhes da meta." });
      return null;
    } finally {
      setIsLoadingDetail(false);
    }
  }

  async function openDetail(registration: MetaRegistration) {
    const loadedDetail = await loadDetail(registration.id);
    if (loadedDetail) setDetail(loadedDetail);
  }

  async function startEdit(registration: MetaRegistration) {
    const loadedDetail = await loadDetail(registration.id);
    if (!loadedDetail) return;

    setEditingCycleId(loadedDetail.id);
    setSelectedCycleStart(loadedDetail.cycleStart);
    setCycleWorkdays(String(loadedDetail.workdays));
    setCycleNotes(loadedDetail.notes ?? "");
    setTargetDraft((current) => {
      const next = { ...current };
      for (const item of loadedDetail.items) {
        next[item.teamTypeId] = formatInputMoney(item.dailyValue);
      }
      return next;
    });
    setMeasuredTeamDraft((current) => {
      const next = { ...current };
      for (const item of loadedDetail.items) {
        next[item.teamTypeId] = String(item.measuredTeamCount);
      }
      return next;
    });
    setDetail(null);
    closeHistoryModal();
    setFeedback({ type: "success", message: `Editando meta do ${loadedDetail.label}.` });
    scrollDashboardContentToTop();
  }

  async function openHistory(registration: MetaRegistration) {
    if (!session?.accessToken) return;
    setHistoryCycle(registration);
    setHistoryEntries([]);
    setHistoryPage(1);
    setIsLoadingHistory(true);
    try {
      const response = await fetch(`/api/meta?historyCycleId=${registration.id}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const data = (await response.json().catch(() => ({}))) as MetaHistoryResponse;
      if (!response.ok) {
        setFeedback({ type: "error", message: data.message ?? "Falha ao carregar historico da meta." });
        return;
      }
      setHistoryEntries(data.history ?? []);
    } catch {
      setFeedback({ type: "error", message: "Falha ao carregar historico da meta." });
    } finally {
      setIsLoadingHistory(false);
    }
  }

  function closeHistoryModal() {
    setHistoryCycle(null);
    setHistoryEntries([]);
    setHistoryPage(1);
  }

  function cancelEdit() {
    setEditingCycleId(null);
    setFeedback(null);
    void loadMeta();
  }

  async function exportRegistrationsCsv() {
    if (!registrations.length) {
      setFeedback({ type: "error", message: "Nenhuma meta salva encontrada para exportar." });
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
      const exportDate = new Date().toISOString().slice(0, 10);
      downloadCsvFile(buildRegistrationsCsv(registrations), `metas_medicao_${exportDate}.csv`);
      setFeedback({ type: "success", message: `${registrations.length} meta(s) exportada(s) com sucesso.` });
    } catch {
      setFeedback({ type: "error", message: "Falha ao exportar metas salvas." });
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

      <form className={styles.formStack} onSubmit={(event) => void submitRegistration(event)}>
        <article className={`${styles.card} ${isEditing ? styles.editingCard : ""}`}>
          <div className={styles.tableHeader}>
            <div>
              <h2 className={styles.cardTitle}>Cadastro de metas</h2>
              <p className={styles.cardSubtitle}>Valores por tipo de equipe e dias uteis do ciclo selecionado.</p>
            </div>
            <span className={styles.loadingHint}>
              {isLoading ? "Atualizando..." : isEditing ? "Modo edicao" : `${targetSummary.configured} tipos configurados`}
            </span>
          </div>

          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Valor diario</th>
                  <th>Equipes ativas</th>
                  <th>Equipes medida</th>
                  <th>Meta diaria</th>
                  <th>Atualizado em</th>
                </tr>
              </thead>
              <tbody>
                {teamTypes.length ? (
                  teamTypes.map((teamType) => {
                    const row = targetRows.find((item) => item.teamTypeId === teamType.id);
                    return (
                      <tr key={teamType.id}>
                        <td>{teamType.name}</td>
                        <td>
                          <label className={styles.moneyField}>
                            <span>R$</span>
                            <input
                              value={targetDraft[teamType.id] ?? ""}
                              onChange={(event) => updateTargetDraft(teamType.id, event.target.value)}
                              inputMode="decimal"
                              placeholder="0,00"
                              disabled={isSaving || isLoading}
                            />
                          </label>
                        </td>
                        <td>{teamType.activeTeamCount}</td>
                        <td>
                          <input
                            className={styles.countInput}
                            type="number"
                            min={0}
                            max={999}
                            value={measuredTeamDraft[teamType.id] ?? ""}
                            onChange={(event) => updateMeasuredTeamDraft(teamType.id, event.target.value)}
                            disabled={isSaving || isLoading}
                          />
                        </td>
                        <td>{formatCurrency(row?.dailyGoal ?? 0)}</td>
                        <td>{formatDateTime(teamType.updatedAt)}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className={styles.emptyRow}>
                      {isLoading ? "Carregando tipos de equipe..." : "Nenhum tipo de equipe ativo encontrado."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className={`${styles.card} ${isEditing ? styles.editingCard : ""}`}>
          <div className={styles.tableHeader}>
            <div>
              <h2 className={styles.cardTitle}>Ciclo da meta</h2>
              <p className={styles.cardSubtitle}>A lista de ciclos segue as datas existentes nas medicoes.</p>
            </div>
          </div>

          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>Ciclo</span>
              <select
                value={selectedCycleStart}
                onChange={(event) => setSelectedCycleStart(event.target.value)}
                disabled={isLoading || isSaving || cycles.length === 0}
              >
                {cycles.length ? (
                  cycles.map((cycle) => (
                    <option key={cycle.cycleStart} value={cycle.cycleStart}>
                      {cycle.label}
                    </option>
                  ))
                ) : (
                  <option value="">Nenhum ciclo com medicao</option>
                )}
              </select>
            </label>

            <label className={styles.field}>
              <span>Inicio</span>
              <input value={formatDate(selectedCycle?.cycleStart ?? "")} readOnly />
            </label>

            <label className={styles.field}>
              <span>Fim</span>
              <input value={formatDate(selectedCycle?.cycleEnd ?? "")} readOnly />
            </label>

            <label className={styles.field}>
              <span>Dias uteis</span>
              <input
                type="number"
                min={0}
                max={31}
                value={cycleWorkdays}
                onChange={(event) => setCycleWorkdays(event.target.value)}
                disabled={isLoading || isSaving || !selectedCycle}
              />
            </label>

            <label className={`${styles.field} ${styles.fieldWide}`}>
              <span>Observacao</span>
              <textarea
                rows={3}
                value={cycleNotes}
                onChange={(event) => setCycleNotes(event.target.value)}
                placeholder="Opcional: feriados ou ajuste manual do ciclo"
                disabled={isLoading || isSaving || !selectedCycle}
              />
            </label>

            <div className={styles.cycleInfo}>
              <div>
                <span>Dias padrao segunda a sexta</span>
                <strong>{selectedCycle?.defaultWorkdays ?? "-"}</strong>
              </div>
              <div>
                <span>Média Dias trabalhados</span>
                <strong>{selectedCycle ? selectedCycle.workedDays.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) : "-"}</strong>
              </div>
              <div>
                <span>Status do ciclo</span>
                <strong>{selectedCycle?.isEdited ? "Editado" : "Padrao automatico"}</strong>
              </div>
            </div>
          </div>
        </article>

        <article className={`${styles.card} ${isEditing ? styles.editingCard : ""}`}>
          <div className={styles.summaryBar}>
            <div>
              <span>Equipes ativas</span>
              <strong>{targetSummary.activeTeams}</strong>
            </div>
            <div>
              <span>Equipes medida</span>
              <strong>{targetSummary.measuredTeams}</strong>
            </div>
            <div>
              <span>Meta diaria cadastrada</span>
              <strong>{formatCurrency(targetSummary.totalDailyGoal)}</strong>
            </div>
            <div>
              <span>Dias uteis do ciclo</span>
              <strong>{cycleWorkdays || "-"}</strong>
            </div>
            <div>
              <span>Dias padrao segunda a sexta</span>
              <strong>{selectedCycle?.defaultWorkdays ?? "-"}</strong>
            </div>
            <div>
              <span>Meta do ciclo</span>
              <strong>{formatCurrency(targetSummary.cycleGoal)}</strong>
            </div>
            <div>
              <span>Meta ciclo padrao</span>
              <strong>{formatCurrency(targetSummary.standardCycleGoal)}</strong>
            </div>
            <div>
              <span>Meta ciclo trabalhado</span>
              <strong>{formatCurrency(targetSummary.workedCycleGoal)}</strong>
            </div>
          </div>

          <div className={styles.actions}>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={isSaving || isLoading || teamTypes.length === 0 || !selectedCycle}
            >
              {isSaving ? "Salvando..." : isEditing ? "Salvar alteracoes" : "Salvar cadastro"}
            </button>
            {isEditing ? (
              <button type="button" className={styles.ghostButton} onClick={cancelEdit} disabled={isLoading || isSaving}>
                Cancelar edicao
              </button>
            ) : null}
            <button type="button" className={styles.ghostButton} onClick={() => void loadMeta()} disabled={isLoading || isSaving}>
              Atualizar
            </button>
          </div>
        </article>
      </form>

      <article className={styles.card}>
        <div className={styles.tableHeader}>
          <div>
            <h2 className={styles.cardTitle}>Lista de metas salvas</h2>
            <p className={styles.cardSubtitle}>Cadastros por ciclo com a meta calculada no momento do salvamento.</p>
          </div>
          <div className={styles.tableHeaderActions}>
            <CsvExportButton
              className={styles.ghostButton}
              onClick={() => void exportRegistrationsCsv()}
              disabled={isExporting || isLoading || exportCooldown.isCoolingDown}
              isLoading={isExporting}
            />
            <button type="button" className={styles.ghostButton} onClick={() => void loadMeta()} disabled={isLoading || isSaving}>
              {isLoading ? "Atualizando..." : "Atualizar lista"}
            </button>
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Ciclo</th>
                <th>Dias uteis</th>
                <th>Dias padrao</th>
                <th>Média Dias trabalhados</th>
                <th>Equipes ativas</th>
                <th>Equipes medida</th>
                <th>Meta diaria</th>
                <th>Meta ciclo</th>
                <th>Meta ciclo padrao</th>
                <th>Meta ciclo trabalhado</th>
                <th>Atualizado em</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {registrations.length ? (
                registrations.map((registration) => (
                  <tr key={registration.id}>
                    <td>{registration.label}</td>
                    <td>{registration.workdays}</td>
                    <td>{registration.defaultWorkdays}</td>
                    <td>{registration.workedDays.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}</td>
                    <td>{registration.totalActiveTeams}</td>
                    <td>{registration.totalMeasuredTeams}</td>
                    <td>{formatCurrency(registration.totalDailyGoal)}</td>
                    <td>{formatCurrency(registration.totalCycleGoal)}</td>
                    <td>{formatCurrency(registration.totalStandardCycleGoal)}</td>
                    <td>{formatCurrency(registration.totalWorkedCycleGoal)}</td>
                    <td>{formatDateTime(registration.updatedAt)}</td>
                    <td className={styles.actionsCell}>
                      <div className={styles.tableActions}>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionView}`}
                          onClick={() => void openDetail(registration)}
                          title="Detalhes"
                          aria-label="Detalhes da meta"
                          disabled={isLoadingDetail}
                        >
                          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="M2.5 12s3.8-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.8 6.5-9.5 6.5S2.5 12 2.5 12Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                            <circle cx="12" cy="12" r="2.8" stroke="currentColor" strokeWidth="1.7" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionHistory}`}
                          onClick={() => void openHistory(registration)}
                          title="Historico"
                          aria-label="Historico da meta"
                        >
                          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="M3.75 12a8.25 8.25 0 1 0 2.25-5.69M3.75 4.75v4h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M12 8.5v3.75l2.5 1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionEdit}`}
                          onClick={() => void startEdit(registration)}
                          title="Editar"
                          aria-label="Editar meta"
                          disabled={isLoadingDetail}
                        >
                          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="m4 20 4.5-1 9-9a1.75 1.75 0 0 0-2.5-2.5l-9 9L4 20Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="m13.5 6.5 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={12} className={styles.emptyRow}>
                    {isLoading ? "Carregando metas salvas..." : "Nenhuma meta salva por ciclo."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>

      {detail ? (
        <div className={styles.modalOverlay} onClick={() => setDetail(null)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Detalhes da Meta</h4>
                <p className={styles.modalSubtitle}>{detail.label}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setDetail(null)}>
                Fechar
              </button>
            </header>

            <div className={styles.detailGrid}>
              <div><strong>Dias uteis:</strong> {detail.workdays}</div>
              <div><strong>Dias padrao:</strong> {detail.defaultWorkdays}</div>
              <div><strong>Média Dias trabalhados:</strong> {detail.workedDays.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}</div>
              <div><strong>Equipes medida:</strong> {detail.totalMeasuredTeams}</div>
              <div><strong>Meta diaria:</strong> {formatCurrency(detail.totalDailyGoal)}</div>
              <div><strong>Meta ciclo:</strong> {formatCurrency(detail.totalCycleGoal)}</div>
              <div><strong>Meta ciclo padrao:</strong> {formatCurrency(detail.totalStandardCycleGoal)}</div>
              <div><strong>Meta ciclo trabalhado:</strong> {formatCurrency(detail.totalWorkedCycleGoal)}</div>
              <div><strong>Atualizado em:</strong> {formatDateTime(detail.updatedAt)}</div>
              <div className={styles.detailWide}><strong>Observacao:</strong> {detail.notes || "-"}</div>
            </div>

            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr><th>Tipo</th><th>Valor diario</th><th>Equipes ativas</th><th>Equipes medida</th><th>Meta diaria</th><th>Meta ciclo</th><th>Meta ciclo padrao</th><th>Meta ciclo trabalhado</th></tr>
                </thead>
                <tbody>
                  {detail.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.teamTypeName}</td>
                      <td>{formatCurrency(item.dailyValue)}</td>
                      <td>{item.activeTeamCount}</td>
                      <td>{item.measuredTeamCount}</td>
                      <td>{formatCurrency(item.dailyGoal)}</td>
                      <td>{formatCurrency(item.cycleGoal)}</td>
                      <td>{formatCurrency(item.standardCycleGoal)}</td>
                      <td>{formatCurrency(item.workedCycleGoal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </div>
      ) : null}

      {historyCycle ? (
        <div className={styles.modalOverlay} onClick={closeHistoryModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Historico da Meta</h4>
                <p className={styles.modalSubtitle}>ID do cadastro: {historyCycle.id}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={closeHistoryModal}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              {isLoadingHistory ? <p>Carregando historico...</p> : null}
              {!isLoadingHistory && historyEntries.length === 0 ? <p>Nenhuma alteracao registrada.</p> : null}
              {!isLoadingHistory && pagedHistoryEntries.length > 0 ? pagedHistoryEntries.map((entry) => {
                const changes = resolveMetaHistoryChanges(entry);
                return (
                  <article key={entry.id} className={styles.historyCard}>
                    <header className={styles.historyCardHeader}>
                      <strong>{formatHistoryActionLabel(entry.actionType)}</strong>
                      <span>{formatDateTime(entry.createdAt)} | {entry.createdByName || "-"}</span>
                    </header>
                    {entry.reason ? <p className={styles.historyReason}>Motivo: {entry.reason}</p> : null}
                    <div className={styles.historyChanges}>
                      {changes.length ? changes.map((change) => (
                        <div key={change.field} className={styles.historyChangeItem}>
                          <strong>{change.label}</strong>
                          <span>De: {formatMetaHistoryValue(change.field, change.from)}</span>
                          <span>Para: {formatMetaHistoryValue(change.field, change.to)}</span>
                        </div>
                      )) : <div className={styles.historyChangeItem}><span>Sem alteracoes detalhadas.</span></div>}
                    </div>
                  </article>
                );
              }) : null}

              {!isLoadingHistory && historyEntries.length > 0 ? (
                <div className={styles.pagination}>
                  <span>
                    Pagina {Math.min(historyPage, historyTotalPages)} de {historyTotalPages} | Total: {historyEntries.length}
                  </span>
                  <div className={styles.paginationActions}>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      onClick={() => setHistoryPage((current) => Math.max(1, current - 1))}
                      disabled={historyPage <= 1}
                    >
                      Anterior
                    </button>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      onClick={() => setHistoryPage((current) => Math.min(historyTotalPages, current + 1))}
                      disabled={historyPage >= historyTotalPages}
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
    </section>
  );
}
