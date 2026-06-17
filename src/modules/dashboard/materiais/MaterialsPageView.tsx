"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { ActionIcon } from "@/components/ui/ActionIcon";
import { CsvExportButton } from "@/components/ui/CsvExportButton";
import { useAuth } from "@/hooks/useAuth";
import { useExportCooldown } from "@/hooks/useExportCooldown";
import { SerialTrackingType, serialTrackingLabel } from "@/lib/materialSerialTracking";
import styles from "./MaterialsPageView.module.css";

type MaterialItem = {
  id: string;
  codigo: string;
  descricao: string;
  umb: string | null;
  tipo: string;
  isTransformer: boolean;
  serialTrackingType: SerialTrackingType;
  hasSerialTrackingUsage: boolean;
  unitPrice: number;
  isActive: boolean;
  cancellationReason: string | null;
  canceledAt: string | null;
  canceledByName: string | null;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

type MaterialHistoryEntry = {
  id: string;
  changeType: "UPDATE" | "CANCEL" | "ACTIVATE";
  createdAt: string;
  createdByName: string;
  changes: Record<string, { from: string | null; to: string | null }>;
};

type FormState = {
  codigo: string;
  descricao: string;
  tipo: string;
  isTransformer: boolean;
  serialTrackingType: SerialTrackingType;
  umb: string;
  unitPrice: string;
  updatedAt: string;
};

type FilterState = {
  codigo: string;
  descricao: string;
  umb: string;
  tipo: "" | "NOVO" | "SUCATA";
  status: "" | "ativo" | "inativo";
};

type MaterialsResponse = {
  materials?: MaterialItem[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

type MaterialsMetaResponse = {
  umbOptions?: string[];
  hasMaterialsWithoutUmb?: boolean;
  message?: string;
};

type MaterialHistoryResponse = {
  history?: MaterialHistoryEntry[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

type MassImportIssue = {
  rowNumber: number;
  column: string;
  value: string;
  error: string;
};

type MassImportErrorReportData = {
  fileName: string;
  content: string;
  errorRows: number;
  totalIssues: number;
};

type MassImportResultSummary = {
  status: "success" | "partial" | "error";
  message: string;
  successCount: number;
  errorRows: number;
};

type MaterialBatchImportResultItem = {
  rowNumber: number;
  success: boolean;
  message: string;
  code?: string;
};

type MaterialBatchImportResponse = {
  success?: boolean;
  message?: string;
  savedCount?: number;
  errorCount?: number;
  results?: MaterialBatchImportResultItem[];
};

const PAGE_SIZE = 20;
const HISTORY_PAGE_SIZE = 5;
const EXPORT_PAGE_SIZE = 100;
const WITHOUT_UMB_FILTER = "__SEM_UMB__";
const INITIAL_FORM: FormState = {
  codigo: "",
  descricao: "",
  tipo: "",
  isTransformer: false,
  serialTrackingType: "NONE",
  umb: "",
  unitPrice: "",
  updatedAt: "",
};

const INITIAL_FILTERS: FilterState = {
  codigo: "",
  descricao: "",
  umb: "",
  tipo: "",
  status: "",
};

const HISTORY_FIELD_LABELS: Record<string, string> = {
  codigo: "Codigo",
  descricao: "Descricao",
  tipo: "Tipo",
  isTransformer: "Trafo",
  serialTrackingType: "Rastreio por serial",
  umb: "UMB",
  unitPrice: "Preco",
  isActive: "Status",
  cancellationReason: "Motivo do cancelamento",
  canceledAt: "Data do cancelamento",
  activationReason: "Motivo da ativacao",
};

function normalizeText(value: string) {
  return String(value ?? "").trim();
}

function normalizeCode(value: string) {
  return normalizeText(value).toUpperCase();
}

function normalizeType(value: string) {
  return normalizeText(value).toUpperCase();
}

function normalizeMaterialType(value: string) {
  const normalized = normalizeType(value);
  if (normalized === "NOVO" || normalized === "SUCATA") {
    return normalized;
  }

  return "";
}

function buildQuery(filters: FilterState, page: number, pageSize = PAGE_SIZE) {
  const params = new URLSearchParams();
  if (filters.codigo.trim()) params.set("codigo", filters.codigo.trim());
  if (filters.descricao.trim()) params.set("descricao", filters.descricao.trim());
  if (filters.umb.trim()) params.set("umb", filters.umb.trim());
  if (filters.tipo.trim()) params.set("tipo", filters.tipo.trim());
  if (filters.status) params.set("status", filters.status);
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

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ";" && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function normalizeCsvHeader(value: string) {
  return normalizeText(value)
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function resolveCsvValue(row: Record<string, string>, aliases: string[]) {
  for (const alias of aliases) {
    const value = row[alias];
    if (value !== undefined) {
      return value;
    }
  }

  return "";
}

function normalizeSerialTrackingInput(value: string): SerialTrackingType | null {
  const normalized = normalizeCsvHeader(value);
  if (!normalized || normalized === "nao" || normalized === "none" || normalized === "sem_rastreio") {
    return "NONE";
  }

  if (normalized === "trafo" || normalized === "transformador") {
    return "TRAFO";
  }

  if (normalized === "religador") {
    return "RELIGADOR";
  }

  if (normalized === "chave" || normalized === "chaves") {
    return "CHAVE";
  }

  return null;
}

function parseNonNegativeCurrency(value: string) {
  const raw = normalizeText(value);
  if (!raw) {
    return 0;
  }

  const withoutSpaces = raw.replace(/\s+/g, "");
  const lastComma = withoutSpaces.lastIndexOf(",");
  const lastDot = withoutSpaces.lastIndexOf(".");
  const decimalSeparator = lastComma > lastDot ? "," : lastDot > -1 ? "." : "";
  const normalized = decimalSeparator
    ? withoutSpaces
        .replace(new RegExp(`\\${decimalSeparator === "," ? "." : ","}`, "g"), "")
        .replace(decimalSeparator, ".")
    : withoutSpaces;
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Number(parsed.toFixed(2));
}

function buildMaterialsCsv(materialItems: MaterialItem[]) {
  const header = [
    "Codigo",
    "Descricao",
    "Tipo",
    "Rastreio por serial",
    "UMB",
    "Preco",
    "Status",
    "Registrado por",
    "Registrado em",
    "Atualizado por",
    "Atualizado em",
  ];
  const rows = materialItems.map((material) => [
    material.codigo,
    material.descricao,
    material.tipo,
    serialTrackingLabel(material.serialTrackingType),
    material.umb ?? "",
    material.unitPrice.toFixed(2),
    material.isActive ? "Ativo" : "Inativo",
    formatAuditActor(material.createdByName),
    formatDateTime(material.createdAt),
    formatAuditActor(material.updatedByName),
    formatDateTime(material.updatedAt),
  ]);

  const csvLines = [header, ...rows].map((line) => line.map((item) => escapeCsvValue(item)).join(";"));
  return `\uFEFF${csvLines.join("\n")}`;
}

function buildMassImportErrorCsv(issues: MassImportIssue[]) {
  const header = ["linha", "coluna", "valor", "erro"];
  const rows = issues.map((issue) => [
    issue.rowNumber,
    issue.column,
    issue.value,
    issue.error,
  ]);
  const csvLines = [header, ...rows].map((line) => line.map((item) => escapeCsvValue(item)).join(";"));
  return `\uFEFF${csvLines.join("\n")}`;
}

function createMassImportErrorReport(issues: MassImportIssue[]) {
  if (!issues.length) {
    return null;
  }

  const errorRows = new Set(issues.map((issue) => issue.rowNumber)).size;
  return {
    fileName: `materiais_erros_${new Date().toISOString().slice(0, 10)}.csv`,
    content: buildMassImportErrorCsv(issues),
    errorRows,
    totalIssues: issues.length,
  };
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

function formatDateTime(value: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("pt-BR");
}

function formatAuditActor(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized || "Nao identificado";
}

function formatOptionalText(value: string | null | undefined, fallback = "-") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  }).format(value);
}

function formatHistoryValue(field: string, value: string | null) {
  if (!value) return "-";

  if (field === "unitPrice") {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? formatCurrency(numericValue) : value;
  }

  if (field === "isActive") {
    return value === "true" ? "Ativo" : "Inativo";
  }

  if (field === "isTransformer") {
    return value === "true" ? "Sim" : "Nao";
  }

  if (field === "serialTrackingType") {
    return serialTrackingLabel(value);
  }

  if (field === "canceledAt") {
    return formatDateTime(value);
  }

  return value;
}

function toFormState(material: MaterialItem): FormState {
  return {
    codigo: material.codigo,
    descricao: material.descricao,
    tipo: material.tipo,
    isTransformer: Boolean(material.isTransformer),
    serialTrackingType: material.serialTrackingType,
    umb: formatOptionalText(material.umb, ""),
    unitPrice: String(material.unitPrice ?? 0),
    updatedAt: material.updatedAt,
  };
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

export function MaterialsPageView() {
  const { session } = useAuth();
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [filterDraft, setFilterDraft] = useState<FilterState>(INITIAL_FILTERS);
  const [activeFilters, setActiveFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [umbOptions, setUmbOptions] = useState<string[]>([]);
  const [hasMaterialsWithoutUmb, setHasMaterialsWithoutUmb] = useState(false);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const exportCooldown = useExportCooldown();
  const [editingMaterialId, setEditingMaterialId] = useState<string | null>(null);
  const [historyMaterial, setHistoryMaterial] = useState<MaterialItem | null>(null);
  const [historyEntries, setHistoryEntries] = useState<MaterialHistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [statusMaterial, setStatusMaterial] = useState<MaterialItem | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isMassImportModalOpen, setIsMassImportModalOpen] = useState(false);
  const [massImportFile, setMassImportFile] = useState<File | null>(null);
  const [massImportErrorReport, setMassImportErrorReport] = useState<MassImportErrorReportData | null>(null);
  const [massImportResult, setMassImportResult] = useState<MassImportResultSummary | null>(null);
  const [isImportingMass, setIsImportingMass] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));
  const isEditing = Boolean(editingMaterialId);
  const editingMaterial = materials.find((material) => material.id === editingMaterialId) ?? null;
  const serialTrackingChangeBlocked = Boolean(
    isEditing
    && editingMaterial?.hasSerialTrackingUsage
    && editingMaterial.serialTrackingType !== "NONE",
  );
  const statusAction = statusMaterial?.isActive ? "cancel" : "activate";
  const canSubmitStatusChange = Boolean(statusReason.trim()) && !isChangingStatus;

  const loadMaterials = useCallback(
    async (targetPage: number, filters: FilterState) => {
      if (!session?.accessToken) return;

      setIsLoadingList(true);
      try {
        const query = buildQuery(filters, targetPage);
        const response = await fetch(`/api/materials?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as MaterialsResponse;
        if (!response.ok) {
          setMaterials([]);
          setTotal(0);
          setFeedback({ type: "error", message: data.message ?? "Falha ao carregar materiais." });
          return [] as MaterialItem[];
        }

        const nextMaterials = data.materials ?? [];
        setMaterials(nextMaterials);
        setTotal(data.pagination?.total ?? 0);
        return nextMaterials;
      } catch {
        setMaterials([]);
        setTotal(0);
        setFeedback({ type: "error", message: "Falha ao carregar materiais." });
        return [] as MaterialItem[];
      } finally {
        setIsLoadingList(false);
      }
    },
    [session?.accessToken],
  );

  useEffect(() => {
    void loadMaterials(page, activeFilters);
  }, [activeFilters, loadMaterials, page]);

  useEffect(() => {
    if (!session?.accessToken) {
      setUmbOptions([]);
      setHasMaterialsWithoutUmb(false);
      return;
    }

    let ignore = false;

    async function loadMaterialsMeta() {
      try {
        const response = await fetch("/api/materials/meta", {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session?.accessToken}`,
          },
        });
        const data = (await response.json().catch(() => ({}))) as MaterialsMetaResponse;
        if (!response.ok) {
          throw new Error(data.message ?? "Falha ao carregar UMBs dos materiais.");
        }
        if (!ignore) {
          setUmbOptions(data.umbOptions ?? []);
          setHasMaterialsWithoutUmb(Boolean(data.hasMaterialsWithoutUmb));
        }
      } catch (error) {
        if (!ignore) {
          setUmbOptions([]);
          setHasMaterialsWithoutUmb(false);
          setFeedback({
            type: "error",
            message: error instanceof Error ? error.message : "Falha ao carregar UMBs dos materiais.",
          });
        }
      }
    }

    void loadMaterialsMeta();
    return () => {
      ignore = true;
    };
  }, [session?.accessToken]);

  function resetFormState() {
    setForm(INITIAL_FORM);
    setEditingMaterialId(null);
  }

  function updateFormField<Key extends keyof FormState>(field: Key, value: FormState[Key]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateSerialTrackingType(value: SerialTrackingType, checked: boolean) {
    if (serialTrackingChangeBlocked) {
      setFeedback({
        type: "error",
        message:
          "Este material possui rastreio por serial em uso. Para alterar ou remover o rastreio, execute uma rotina de encerramento/reconciliacao.",
      });
      return;
    }

    setForm((current) => {
      const nextType = checked ? value : "NONE";
      return {
        ...current,
        serialTrackingType: nextType,
        isTransformer: nextType === "TRAFO",
      };
    });
  }

  function updateFilterField<Key extends keyof FilterState>(field: Key, value: FilterState[Key]) {
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

  function handleEditMaterial(material: MaterialItem) {
    setEditingMaterialId(material.id);
    setForm(toFormState(material));
    setFeedback(null);
    scrollDashboardContentToTop();
  }

  function closeHistoryModal() {
    setHistoryMaterial(null);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    setIsLoadingHistory(false);
  }

  function openStatusModal(material: MaterialItem) {
    setStatusMaterial(material);
    setStatusReason("");
  }

  function closeStatusModal() {
    setStatusMaterial(null);
    setStatusReason("");
    setIsChangingStatus(false);
  }

  async function loadMaterialHistory(material: MaterialItem, targetPage: number) {
    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para carregar historico." });
      return;
    }

    setIsLoadingHistory(true);
    try {
      const params = new URLSearchParams();
      params.set("historyMaterialId", material.id);
      params.set("historyPage", String(targetPage));
      params.set("historyPageSize", String(HISTORY_PAGE_SIZE));

      const response = await fetch(`/api/materials?${params.toString()}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      const data = (await response.json().catch(() => ({}))) as MaterialHistoryResponse;
      if (!response.ok) {
        setFeedback({ type: "error", message: data.message ?? "Falha ao carregar historico do material." });
        setHistoryEntries([]);
        setHistoryTotal(0);
        return;
      }

      setHistoryEntries(data.history ?? []);
      setHistoryPage(data.pagination?.page ?? targetPage);
      setHistoryTotal(data.pagination?.total ?? 0);
    } catch {
      setFeedback({ type: "error", message: "Falha ao carregar historico do material." });
      setHistoryEntries([]);
      setHistoryTotal(0);
    } finally {
      setIsLoadingHistory(false);
    }
  }

  async function openHistoryModal(material: MaterialItem) {
    setHistoryMaterial(material);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    await loadMaterialHistory(material, 1);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.accessToken) {
      setFeedback({
        type: "error",
        message: isEditing ? "Sessao invalida para editar material." : "Sessao invalida para registrar material.",
      });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    try {
      if (serialTrackingChangeBlocked && form.serialTrackingType !== editingMaterial?.serialTrackingType) {
        setFeedback({
          type: "error",
          message:
            "Este material possui rastreio por serial em uso. Para alterar ou remover o rastreio, execute uma rotina de encerramento/reconciliacao.",
        });
        return;
      }

      const payload = {
        ...(isEditing ? { id: editingMaterialId } : {}),
        codigo: normalizeCode(form.codigo),
        descricao: normalizeText(form.descricao),
        tipo: normalizeMaterialType(form.tipo),
        isTransformer: form.serialTrackingType === "TRAFO",
        serialTrackingType: form.serialTrackingType,
        umb: normalizeText(form.umb) || null,
        unitPrice: normalizeText(form.unitPrice),
        ...(isEditing ? { expectedUpdatedAt: form.updatedAt } : {}),
      };

      const response = await fetch("/api/materials", {
        method: isEditing ? "PUT" : "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json().catch(() => ({}))) as { message?: string; code?: string };

      if (!response.ok) {
        if (data.code === "CONCURRENT_MODIFICATION" || data.code === "RECORD_INACTIVE") {
          resetFormState();
          await loadMaterials(page, activeFilters);
        }

        setFeedback({
          type: "error",
          message:
            data.message ??
            (isEditing
              ? `Falha ao editar material ${normalizeCode(form.codigo)}.`
              : `Falha ao registrar material ${normalizeCode(form.codigo)}.`),
        });
        return;
      }

      setFeedback({
        type: "success",
        message:
          data.message ??
          (isEditing
            ? `Material ${normalizeCode(form.codigo)} atualizado com sucesso.`
            : `Material ${normalizeCode(form.codigo)} registrado com sucesso.`),
      });

      resetFormState();
      await loadMaterials(1, activeFilters);
      setPage(1);
    } catch {
      setFeedback({
        type: "error",
        message: isEditing
          ? `Falha ao editar material ${normalizeCode(form.codigo)}.`
          : `Falha ao registrar material ${normalizeCode(form.codigo)}.`,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmStatusChange() {
    if (!session?.accessToken || !statusMaterial || !statusReason.trim()) {
      return;
    }

    setIsChangingStatus(true);
    const actionLabel = statusAction === "cancel" ? "cancelar" : "ativar";

    try {
      const response = await fetch("/api/materials", {
        method: "PATCH",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          id: statusMaterial.id,
          reason: statusReason.trim(),
          action: statusAction,
          expectedUpdatedAt: statusMaterial.updatedAt,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { message?: string; code?: string };
      if (!response.ok) {
        if (
          data.code === "CONCURRENT_MODIFICATION"
          || data.code === "RECORD_INACTIVE"
          || data.code === "STATUS_ALREADY_CHANGED"
        ) {
          if (editingMaterialId === statusMaterial.id) {
            resetFormState();
          }
          closeStatusModal();
          await loadMaterials(page, activeFilters);
        }

        setFeedback({
          type: "error",
          message: data.message ?? `Falha ao ${actionLabel} material ${statusMaterial.codigo}.`,
        });
        return;
      }

      setFeedback({
        type: "success",
        message:
          data.message ??
          (statusAction === "cancel"
            ? `Material ${statusMaterial.codigo} cancelado com sucesso.`
            : `Material ${statusMaterial.codigo} ativado com sucesso.`),
      });

      if (editingMaterialId === statusMaterial.id) {
        resetFormState();
      }

      closeStatusModal();
      await loadMaterials(page, activeFilters);
    } catch {
      setFeedback({
        type: "error",
        message: `Falha ao ${actionLabel} material ${statusMaterial.codigo}.`,
      });
    } finally {
      setIsChangingStatus(false);
    }
  }

  async function handleExportMaterials() {
    if (!session?.accessToken) {
      setFeedback({
        type: "error",
        message: "Sessao invalida para exportar materiais.",
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
      const allMaterials: MaterialItem[] = [];
      let exportPage = 1;
      let totalItems = 0;

      while (true) {
        const query = buildQuery(activeFilters, exportPage, EXPORT_PAGE_SIZE);
        const response = await fetch(`/api/materials?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as MaterialsResponse;

        if (!response.ok) {
          setFeedback({
            type: "error",
            message: data.message ?? "Falha ao exportar materiais.",
          });
          return;
        }

        const pageItems = data.materials ?? [];
        totalItems = data.pagination?.total ?? totalItems;
        allMaterials.push(...pageItems);

        if (pageItems.length === 0 || allMaterials.length >= totalItems) {
          break;
        }

        exportPage += 1;
      }

      if (allMaterials.length === 0) {
        setFeedback({
          type: "error",
          message: "Nenhum material encontrado para exportar com os filtros atuais.",
        });
        return;
      }

      const csv = buildMaterialsCsv(allMaterials);
      const exportDate = new Date().toISOString().slice(0, 10);
      downloadCsvFile(csv, `materiais_${exportDate}.csv`);

      setFeedback({
        type: "success",
        message: `${allMaterials.length} material(is) exportado(s) com sucesso.`,
      });
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao exportar materiais.",
      });
    } finally {
      setIsExporting(false);
    }
  }

  function downloadMassTemplate() {
    const model = "\uFEFFcodigo;descricao;tipo;umb;preco;rastreio_por_serial\nMAT-001;Cabo multiplexado;NOVO;M;12,50;NAO\nMAT-002;Religador automatico;NOVO;UN;0;RELIGADOR\nMAT-003;Chave faca;SUCATA;UN;;CHAVE\n";
    downloadCsvFile(model, "modelo_materiais_cadastro_em_massa.csv");
  }

  function downloadLastMassImportErrorReport() {
    if (!massImportErrorReport) {
      return;
    }

    downloadCsvFile(massImportErrorReport.content, massImportErrorReport.fileName);
  }

  function openMassImportModal() {
    setMassImportFile(null);
    setMassImportErrorReport(null);
    setMassImportResult(null);
    setIsMassImportModalOpen(true);
  }

  function closeMassImportModal() {
    if (isImportingMass) {
      return;
    }

    setMassImportFile(null);
    setMassImportErrorReport(null);
    setMassImportResult(null);
    setIsMassImportModalOpen(false);
  }

  async function handleMassImportFile(file: File) {
    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para importar materiais em massa." });
      return;
    }

    setIsImportingMass(true);
    setMassImportErrorReport(null);
    setMassImportResult(null);

    try {
      const content = await file.text();
      const lines = content.split(/\r?\n/).filter((line) => normalizeText(line));
      const importIssues: MassImportIssue[] = [];

      if (lines.length < 2) {
        importIssues.push({
          rowNumber: 1,
          column: "arquivo",
          value: file.name,
          error: "Arquivo CSV sem linhas de dados.",
        });
      }

      const headers = parseCsvLine(lines[0] ?? "").map(normalizeCsvHeader);
      const requiredHeaders = ["codigo", "descricao", "tipo", "umb"];
      for (const header of requiredHeaders) {
        if (!headers.includes(header)) {
          importIssues.push({
            rowNumber: 1,
            column: header,
            value: "",
            error: `Coluna obrigatoria ausente: ${header}.`,
          });
        }
      }

      const validRows: Array<{
        rowNumber: number;
        codigo: string;
        descricao: string;
        tipo: string;
        umb: string;
        unitPrice: number;
        serialTrackingType: SerialTrackingType;
      }> = [];
      const seenCodes = new Set<string>();

      if (!importIssues.some((issue) => issue.rowNumber === 1 && issue.column !== "arquivo")) {
        for (let index = 1; index < lines.length; index += 1) {
          const rowNumber = index + 1;
          const values = parseCsvLine(lines[index]);
          const row = headers.reduce<Record<string, string>>((accumulator, header, headerIndex) => {
            accumulator[header] = values[headerIndex] ?? "";
            return accumulator;
          }, {});

          const codigo = normalizeCode(resolveCsvValue(row, ["codigo", "cod"]));
          const descricao = normalizeText(resolveCsvValue(row, ["descricao", "description"]));
          const tipo = normalizeMaterialType(resolveCsvValue(row, ["tipo", "type"]));
          const umb = normalizeText(resolveCsvValue(row, ["umb", "unidade", "unidade_medida"]));
          const unitPriceRaw = resolveCsvValue(row, ["preco", "preco_unitario", "unit_price"]);
          const serialRaw = resolveCsvValue(row, ["rastreio_por_serial", "rastreio", "serial_tracking_type"]);
          const unitPrice = parseNonNegativeCurrency(unitPriceRaw);
          const serialTrackingType = normalizeSerialTrackingInput(serialRaw);
          const rowIssuesBefore = importIssues.length;

          if (!codigo) {
            importIssues.push({ rowNumber, column: "codigo", value: codigo, error: "Codigo obrigatorio." });
          } else if (seenCodes.has(codigo)) {
            importIssues.push({ rowNumber, column: "codigo", value: codigo, error: "Codigo duplicado no arquivo." });
          }

          if (!descricao) {
            importIssues.push({ rowNumber, column: "descricao", value: descricao, error: "Descricao obrigatoria." });
          }

          if (!tipo) {
            importIssues.push({ rowNumber, column: "tipo", value: resolveCsvValue(row, ["tipo", "type"]), error: "Tipo invalido. Use NOVO ou SUCATA." });
          }

          if (!umb) {
            importIssues.push({ rowNumber, column: "umb", value: umb, error: "UMB obrigatorio." });
          }

          if (unitPrice === null) {
            importIssues.push({ rowNumber, column: "preco", value: unitPriceRaw, error: "Preco invalido. Informe valor maior ou igual a zero." });
          }

          if (!serialTrackingType) {
            importIssues.push({ rowNumber, column: "rastreio_por_serial", value: serialRaw, error: "Rastreio invalido. Use NAO, TRAFO, RELIGADOR ou CHAVE." });
          }

          if (importIssues.length === rowIssuesBefore) {
            validRows.push({
              rowNumber,
              codigo,
              descricao,
              tipo,
              umb,
              unitPrice: unitPrice ?? 0,
              serialTrackingType: serialTrackingType ?? "NONE",
            });
            seenCodes.add(codigo);
          } else if (codigo) {
            seenCodes.add(codigo);
          }
        }
      }

      if (!validRows.length) {
        const report = createMassImportErrorReport(importIssues);
        setMassImportErrorReport(report);
        setMassImportResult({
          status: "error",
          message: "Nenhum material valido foi encontrado para importar.",
          successCount: 0,
          errorRows: report?.errorRows ?? 0,
        });
        setFeedback({ type: "error", message: "Nenhum material valido foi encontrado para importar. Baixe o CSV de erros para corrigir." });
        return;
      }

      const response = await fetch("/api/materials", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          action: "BATCH_IMPORT",
          rows: validRows,
        }),
      });

      const data = (await response.json().catch(() => null)) as MaterialBatchImportResponse | null;
      if (!response.ok) {
        importIssues.push({
          rowNumber: 1,
          column: "salvamento",
          value: file.name,
          error: data?.message ?? "Falha ao importar materiais em massa.",
        });
      }

      for (const result of data?.results ?? []) {
        if (result.success) {
          continue;
        }

        importIssues.push({
          rowNumber: result.rowNumber,
          column: result.code === "DUPLICATE_MATERIAL_CODE" ? "codigo" : "salvamento",
          value: "",
          error: result.message || "Falha ao salvar material.",
        });
      }

      const successCount = Number(data?.savedCount ?? 0);
      const report = createMassImportErrorReport(importIssues);
      const errorRows = report?.errorRows ?? 0;
      setMassImportErrorReport(report);

      if (successCount > 0) {
        await loadMaterials(1, activeFilters);
        setPage(1);
      }

      if (!successCount) {
        setMassImportResult({
          status: "error",
          message: `Cadastro em massa sem sucesso. 0 materiais salvos e ${errorRows} linhas com erro.`,
          successCount: 0,
          errorRows,
        });
        setFeedback({ type: "error", message: `Cadastro em massa sem sucesso. ${errorRows} linhas com erro.` });
        return;
      }

      if (errorRows > 0) {
        setMassImportResult({
          status: "partial",
          message: `Cadastro em massa parcial: ${successCount} materiais salvos e ${errorRows} linhas com erro.`,
          successCount,
          errorRows,
        });
        setFeedback({ type: "success", message: `Cadastro em massa parcial: ${successCount} materiais salvos e ${errorRows} linhas com erro.` });
        return;
      }

      setMassImportResult({
        status: "success",
        message: "Incluido com sucesso.",
        successCount,
        errorRows: 0,
      });
      setFeedback({ type: "success", message: `Cadastro em massa concluido com sucesso. ${successCount} materiais salvos.` });
    } catch {
      setMassImportResult({
        status: "error",
        message: "Falha ao importar materiais em massa.",
        successCount: 0,
        errorRows: 0,
      });
      setFeedback({ type: "error", message: "Falha ao importar materiais em massa." });
    } finally {
      setIsImportingMass(false);
    }
  }

  async function submitMassImport() {
    if (!massImportFile) {
      return;
    }

    await handleMassImportFile(massImportFile);
  }

  return (
    <section className={styles.wrapper}>
      {feedback ? (
        <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>{feedback.message}</div>
      ) : null}

      <article className={`${styles.card} ${isEditing ? styles.editingCard : ""}`}>
        <h3 className={styles.cardTitle}>{isEditing ? "Editar Material" : "Cadastro de Material"}</h3>

        <form className={styles.formGrid} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>
              Codigo <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.codigo}
              onChange={(event) => updateFormField("codigo", normalizeCode(event.target.value))}
              placeholder="Digite o codigo"
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Descricao <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.descricao}
              onChange={(event) => updateFormField("descricao", event.target.value)}
              placeholder="Digite a descricao"
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Tipo <span className="requiredMark">*</span>
            </span>
            <select
              value={form.tipo}
              onChange={(event) => updateFormField("tipo", normalizeMaterialType(event.target.value))}
              required
            >
              <option value="">Selecione</option>
              <option value="NOVO">NOVO</option>
              <option value="SUCATA">SUCATA</option>
            </select>
          </label>

          <label className={styles.field}>
            <span>Preco</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.unitPrice}
              onChange={(event) => updateFormField("unitPrice", event.target.value)}
              placeholder="0,00"
            />
          </label>

          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={form.serialTrackingType === "TRAFO"}
              disabled={serialTrackingChangeBlocked}
              onChange={(event) => updateSerialTrackingType("TRAFO", event.target.checked)}
            />
            Material TRAFO (exige Serial e LP na movimentacao)
          </label>

          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={form.serialTrackingType === "RELIGADOR"}
              disabled={serialTrackingChangeBlocked}
              onChange={(event) => updateSerialTrackingType("RELIGADOR", event.target.checked)}
            />
            Material RELIGADOR (exige Serial na movimentacao)
          </label>

          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={form.serialTrackingType === "CHAVE"}
              disabled={serialTrackingChangeBlocked}
              onChange={(event) => updateSerialTrackingType("CHAVE", event.target.checked)}
            />
            Material CHAVES (exige Serial na movimentacao)
          </label>

          {serialTrackingChangeBlocked ? (
            <p className={styles.serialTrackingLockNotice}>
              Este material possui rastreio por serial em uso. Para alterar ou remover o rastreio, execute uma rotina de encerramento/reconciliacao.
            </p>
          ) : null}

          <label className={styles.field}>
            <span>
              UMB <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.umb}
              onChange={(event) => updateFormField("umb", event.target.value)}
              placeholder="Ex.: UN"
              required
            />
          </label>

          <div className={`${styles.actions} ${styles.formActions}`}>
            <button type="submit" className={styles.primaryButton} disabled={isSubmitting}>
              {isSubmitting ? (isEditing ? "Salvando..." : "Registrando...") : isEditing ? "Salvar alteracoes" : "Registrar material"}
            </button>
            {!isEditing ? (
              <button type="button" className={styles.secondaryButton} onClick={openMassImportModal}>
                Cadastro em massa
              </button>
            ) : null}
            {isEditing ? (
              <button type="button" className={styles.ghostButton} onClick={resetFormState} disabled={isSubmitting}>
                Cancelar edicao
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
              value={filterDraft.codigo}
              onChange={(event) => updateFilterField("codigo", event.target.value)}
              placeholder="Filtrar por codigo"
            />
          </label>

          <label className={styles.field}>
            <span>Descricao</span>
            <input
              type="text"
              value={filterDraft.descricao}
              onChange={(event) => updateFilterField("descricao", event.target.value)}
              placeholder="Filtrar por descricao"
            />
          </label>

          <label className={styles.field}>
            <span>UMB</span>
            <select
              value={filterDraft.umb}
              onChange={(event) => updateFilterField("umb", event.target.value)}
            >
              <option value="">Todas</option>
              {hasMaterialsWithoutUmb ? <option value={WITHOUT_UMB_FILTER}>Sem UMB</option> : null}
              {umbOptions.map((umb) => (
                <option key={umb} value={umb}>{umb}</option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Tipo</span>
            <select
              value={filterDraft.tipo}
              onChange={(event) => updateFilterField("tipo", event.target.value as FilterState["tipo"])}
            >
              <option value="">Todos</option>
              <option value="NOVO">NOVO</option>
              <option value="SUCATA">SUCATA</option>
            </select>
          </label>

          <label className={styles.field}>
            <span>Status</span>
            <select value={filterDraft.status} onChange={(event) => updateFilterField("status", event.target.value as FilterState["status"])}>
              <option value="">Todos</option>
              <option value="ativo">Ativo</option>
              <option value="inativo">Inativo</option>
            </select>
          </label>
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.secondaryButton} onClick={applyFilters}>
            Aplicar
          </button>
          <button type="button" className={styles.ghostButton} onClick={clearFilters}>
            Limpar
          </button>
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.tableHeader}>
          <h3 className={styles.cardTitle}>Lista de Materiais</h3>
          <div className={styles.tableHeaderActions}>
            <CsvExportButton
              className={styles.ghostButton}
              onClick={() => void handleExportMaterials()}
              disabled={isExporting || isLoadingList || exportCooldown.isCoolingDown}
              isLoading={isExporting}
            />
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Descricao</th>
                <th>Tipo</th>
                <th>Rastreio</th>
                <th>UMB</th>
                <th>Preco</th>
                <th>Registrado por</th>
                <th>Registrado em</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {materials.length > 0
                ? materials.map((material) => (
                    <tr key={material.id} className={!material.isActive ? styles.inactiveRow : undefined}>
                      <td>
                        <div className={styles.sobCell}>
                          <span>{material.codigo}</span>
                          {!material.isActive ? <span className={styles.statusTag}>Inativo</span> : null}
                        </div>
                      </td>
                      <td>{material.descricao}</td>
                      <td>{material.tipo}</td>
                      <td>{serialTrackingLabel(material.serialTrackingType)}</td>
                      <td>{formatOptionalText(material.umb)}</td>
                      <td>{formatCurrency(material.unitPrice)}</td>
                      <td>{material.createdByName}</td>
                      <td>{formatDateTime(material.createdAt)}</td>
                      <td className={styles.actionsCell}>
                        <div className={styles.tableActions}>
                          <button
                            type="button"
                            className={`${styles.actionButton} ${styles.actionEdit}`}
                            onClick={() => handleEditMaterial(material)}
                            aria-label={`Editar material ${material.codigo}`}
                            title="Editar"
                            disabled={!material.isActive}
                          >
                            <ActionIcon name="edit" />
                          </button>

                          <button
                            type="button"
                            className={`${styles.actionButton} ${styles.actionHistory}`}
                            onClick={() => void openHistoryModal(material)}
                            aria-label={`Historico do material ${material.codigo}`}
                            title="Historico"
                          >
                            <ActionIcon name="history" />
                          </button>

                          <button
                            type="button"
                            className={`${styles.actionButton} ${material.isActive ? styles.actionCancel : styles.actionActivate}`}
                            onClick={() => openStatusModal(material)}
                            aria-label={`${material.isActive ? "Cancelar" : "Ativar"} material ${material.codigo}`}
                            title={material.isActive ? "Cancelar" : "Ativar"}
                          >
                            <ActionIcon name={material.isActive ? "cancel" : "activate"} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                : (
                  <tr>
                    <td colSpan={9} className={styles.emptyRow}>
                      {isLoadingList ? "Carregando materiais..." : "Nenhum material encontrado para os filtros informados."}
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

      {historyMaterial ? (
        <div className={styles.modalOverlay} onClick={closeHistoryModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Historico do Material {historyMaterial.codigo}</h4>
                <p className={styles.modalSubtitle}>ID do material: {historyMaterial.id}</p>
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
                        void loadMaterialHistory(historyMaterial, target);
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
                        void loadMaterialHistory(historyMaterial, target);
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

      {isMassImportModalOpen ? (
        <div className={styles.modalOverlay} onClick={closeMassImportModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Cadastro em massa</h4>
                <p className={styles.modalSubtitle}>Importe um CSV para cadastrar materiais em lote.</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={closeMassImportModal}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <section className={styles.importStep}>
                <div className={styles.importStepHeader}>
                  <span className={styles.importStepNumber}>1</span>
                  <div>
                    <strong>Baixe o modelo</strong>
                    <p>Use o arquivo modelo com as colunas obrigatorias.</p>
                  </div>
                </div>
                <button type="button" className={styles.secondaryButton} onClick={downloadMassTemplate}>
                  Baixar modelo CSV
                </button>
              </section>

              <section className={styles.importStep}>
                <div className={styles.importStepHeader}>
                  <span className={styles.importStepNumber}>2</span>
                  <div>
                    <strong>Preencha a planilha</strong>
                    <p>Colunas obrigatorias: codigo, descricao, tipo e umb. Rastreio aceita NAO, TRAFO, RELIGADOR ou CHAVE.</p>
                  </div>
                </div>
              </section>

              <section className={styles.importStep}>
                <div className={styles.importStepHeader}>
                  <span className={styles.importStepNumber}>3</span>
                  <div>
                    <strong>Envie o arquivo</strong>
                    <p>Somente arquivo CSV separado por ponto e virgula.</p>
                  </div>
                </div>
                <label className={styles.importDropzone}>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => setMassImportFile(event.target.files?.[0] ?? null)}
                  />
                  <span>{massImportFile ? massImportFile.name : "Clique para selecionar o arquivo CSV"}</span>
                </label>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => void submitMassImport()}
                    disabled={!massImportFile || isImportingMass}
                  >
                    {isImportingMass ? "Importando..." : "Importar planilha"}
                  </button>
                  {massImportErrorReport ? (
                    <button type="button" className={styles.secondaryButton} onClick={downloadLastMassImportErrorReport}>
                      Baixar erros (CSV)
                    </button>
                  ) : null}
                </div>
                {massImportResult ? (
                  <div className={massImportResult.status === "error" ? styles.feedbackError : styles.feedbackSuccess}>
                    <strong>{massImportResult.status === "success" ? "Incluido com sucesso." : massImportResult.status === "partial" ? "Importacao parcial." : "Importacao com erros."}</strong>
                    <div>{massImportResult.successCount} materiais salvos.</div>
                    {massImportResult.errorRows > 0 ? <div>{massImportResult.errorRows} linhas com erro.</div> : null}
                    {massImportResult.message ? <div>{massImportResult.message}</div> : null}
                  </div>
                ) : null}
              </section>
            </div>
          </article>
        </div>
      ) : null}

      {statusMaterial ? (
        <div className={styles.modalOverlay} onClick={closeStatusModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>{statusMaterial.isActive ? "Cancelar Material" : "Ativar Material"}</h4>
                <p className={styles.modalSubtitle}>Material: {statusMaterial.codigo}</p>
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
                  placeholder={statusMaterial.isActive ? "Informe o motivo do cancelamento" : "Informe o motivo da ativacao"}
                  rows={4}
                />
              </label>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={statusMaterial.isActive ? styles.dangerButton : styles.primaryButton}
                  onClick={() => void confirmStatusChange()}
                  disabled={!canSubmitStatusChange}
                >
                  {isChangingStatus
                    ? statusMaterial.isActive
                      ? "Cancelando..."
                      : "Ativando..."
                    : statusMaterial.isActive
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
    </section>
  );
}
