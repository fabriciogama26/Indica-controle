"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { CsvExportButton } from "@/components/ui/CsvExportButton";
import { useAuth } from "@/hooks/useAuth";
import styles from "./StockTransfersPageView.module.css";

type StockCenterOption = {
  id: string;
  name: string;
  centerType: "OWN" | "THIRD_PARTY";
  controlsBalance: boolean;
};

type ProjectOption = {
  id: string;
  projectCode: string;
};

type MaterialOption = {
  id: string;
  materialCode: string;
  description: string;
  materialType: string;
  isTransformer: boolean;
};

type MetaResponse = {
  stockCenters?: StockCenterOption[];
  projects?: ProjectOption[];
  materials?: MaterialOption[];
  message?: string;
};

type TransferListItem = {
  id: string;
  transferId: string;
  updatedAt: string;
  updatedByName: string;
  movementType: "ENTRY" | "EXIT" | "TRANSFER";
  materialId: string;
  materialCode: string;
  description: string;
  quantity: number;
  serialNumber: string | null;
  lotCode: string | null;
  entryDate: string;
  entryType: "SUCATA" | "NOVO";
  fromStockCenterId: string;
  fromStockCenterName: string;
  toStockCenterId: string;
  toStockCenterName: string;
  projectId: string;
  projectCode: string;
  notes: string | null;
  isReversed: boolean;
  reversalTransferId: string | null;
  isReversal: boolean;
  originalTransferId: string | null;
  reversalReason: string | null;
  reversedAt: string | null;
};

type TransferEditHistoryEntry = {
  id: string;
  action: "UPDATE" | string;
  changedAt: string;
  changedByName: string;
  changes?: Record<string, { from?: unknown; to?: unknown }>;
};

type TransferListResponse = {
  history?: TransferListItem[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

type TransferHistoryResponse = {
  history?: TransferEditHistoryEntry[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

type ImportResponse = {
  summary?: {
    total: number;
    successCount: number;
    errorCount: number;
  };
  results?: Array<{
    rowNumber: number;
    success: boolean;
    message: string;
    reason?: string;
  }>;
  message?: string;
};

type FormState = {
  movementType: "ENTRY" | "EXIT" | "TRANSFER";
  fromStockCenterId: string;
  toStockCenterId: string;
  projectCode: string;
  projectId: string;
  materialCode: string;
  materialId: string;
  description: string;
  quantity: string;
  serialNumber: string;
  lotCode: string;
  entryDate: string;
  entryType: "SUCATA" | "NOVO" | "";
  notes: string;
};

type FilterState = {
  startDate: string;
  endDate: string;
  movementType: "TODOS" | "ENTRY" | "EXIT" | "TRANSFER";
  projectCode: string;
  materialCode: string;
  entryType: "TODOS" | "NOVO" | "SUCATA";
  reversalStatus: "TODOS" | "ESTORNADAS" | "NAO_ESTORNADAS" | "ESTORNOS";
};

const HISTORY_PAGE_SIZE = 15;
const HISTORY_EXPORT_PAGE_SIZE = 100;
const HISTORY_FIELD_LABELS: Record<string, string> = {
  movementType: "Operacao",
  fromStockCenterId: "Centro DE",
  fromStockCenter: "Centro DE",
  toStockCenterId: "Centro PARA",
  toStockCenter: "Centro PARA",
  originalTransferId: "Transferencia original",
  reversalTransferId: "Transferencia de estorno",
  projectCode: "Projeto",
  materialCode: "Material (codigo)",
  description: "Descricao",
  quantity: "Quantidade",
  serialNumber: "Serial",
  lotCode: "LP",
  entryDate: "Data da entrada",
  entryType: "Tipo",
  reversalReason: "Motivo do estorno",
  notes: "Observacao",
};
const IMPORT_TEMPLATE_HEADERS = [
  "movement_type",
  "from_stock_center",
  "to_stock_center",
  "project_code",
  "material_code",
  "quantity",
  "serial_number",
  "lot_code",
  "entry_date",
  "notes",
] as const;
const INITIAL_FORM: FormState = {
  movementType: "TRANSFER",
  fromStockCenterId: "",
  toStockCenterId: "",
  projectCode: "",
  projectId: "",
  materialCode: "",
  materialId: "",
  description: "",
  quantity: "",
  serialNumber: "",
  lotCode: "",
  entryDate: new Date().toISOString().slice(0, 10),
  entryType: "",
  notes: "",
};
const INITIAL_FILTERS: FilterState = {
  startDate: "",
  endDate: "",
  movementType: "TODOS",
  projectCode: "",
  materialCode: "",
  entryType: "TODOS",
  reversalStatus: "TODOS",
};

function normalizeText(value: string) {
  return String(value ?? "").trim();
}

function normalizeCode(value: string) {
  return normalizeText(value).toUpperCase();
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("pt-BR");
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("pt-BR");
}

function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatHistoryActionLabel(value: string) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "REVERSAL") return "Estorno";
  if (normalized === "UPDATE") return "Edicao";
  return normalized || "Atualizacao";
}

function formatHistoryValue(value: unknown) {
  if (value === null || value === undefined) return "-";
  const normalized = String(value).trim();
  return normalized || "-";
}

function normalizeMaterialEntryType(value: string) {
  const normalized = normalizeCode(value);
  if (normalized === "SUCATA" || normalized === "NOVO") {
    return normalized;
  }
  return "";
}

function normalizeMovementType(value: unknown) {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (normalized === "ENTRY" || normalized === "ENTRADA") return "ENTRY" as const;
  if (normalized === "EXIT" || normalized === "SAIDA") return "EXIT" as const;
  if (normalized === "TRANSFER" || normalized === "TRANSFERENCIA") return "TRANSFER" as const;
  return null;
}

function movementTypeLabel(value: string | null | undefined) {
  const normalized = normalizeMovementType(value);
  if (normalized === "ENTRY") return "Entrada";
  if (normalized === "EXIT") return "Saida";
  if (normalized === "TRANSFER") return "Transferencia";
  return "-";
}

function parsePositiveNumber(value: string) {
  const normalized = normalizeText(value).replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Number(parsed.toFixed(3));
}

function csvEscape(value: string | number | null | undefined) {
  const raw = String(value ?? "").replace(/\r?\n|\r/g, " ").trim();
  if (raw.includes(";") || raw.includes('"')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function normalizeHeaderName(value: string) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, "_");
}

function parseCsvContent(content: string) {
  const normalizedContent = content.replace(/^\uFEFF/, "");
  const lines = normalizedContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [] as Array<Record<string, string>>;
  }

  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(delimiter).map((header) => normalizeHeaderName(header));

  return lines.slice(1).map((line) => {
    const values = line.split(delimiter).map((item) => normalizeText(item));
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

export function StockTransfersPageView() {
  const { session } = useAuth();
  const canReverseStockMovement = useMemo(() => {
    const normalizedRole = String(session?.user.role ?? "").trim().toUpperCase();
    return normalizedRole === "ADMIN" || normalizedRole === "MASTER";
  }, [session?.user.role]);

  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [stockCenters, setStockCenters] = useState<StockCenterOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [materials, setMaterials] = useState<MaterialOption[]>([]);

  const [historyItems, setHistoryItems] = useState<TransferListItem[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [filterDraft, setFilterDraft] = useState<FilterState>(INITIAL_FILTERS);
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [detailItem, setDetailItem] = useState<TransferListItem | null>(null);
  const [historyModalItem, setHistoryModalItem] = useState<TransferListItem | null>(null);
  const [historyModalItems, setHistoryModalItems] = useState<TransferEditHistoryEntry[]>([]);
  const [reversalModalItem, setReversalModalItem] = useState<TransferListItem | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [reversalDate, setReversalDate] = useState(toIsoDate(new Date()));

  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isLoadingHistoryModal, setIsLoadingHistoryModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isReversing, setIsReversing] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const selectedMaterial = useMemo(
    () => materials.find((material) => material.id === form.materialId) ?? null,
    [form.materialId, materials],
  );
  const ownCenters = useMemo(
    () => stockCenters.filter((center) => center.centerType === "OWN"),
    [stockCenters],
  );
  const thirdPartyCenters = useMemo(
    () => stockCenters.filter((center) => center.centerType === "THIRD_PARTY"),
    [stockCenters],
  );
  const fromCenterOptions = useMemo(() => {
    if (form.movementType === "ENTRY") return thirdPartyCenters;
    return ownCenters;
  }, [form.movementType, ownCenters, thirdPartyCenters]);
  const toCenterOptions = useMemo(() => {
    if (form.movementType === "EXIT") return thirdPartyCenters;
    return ownCenters;
  }, [form.movementType, ownCenters, thirdPartyCenters]);
  const centerMap = useMemo(
    () => new Map(stockCenters.map((center) => [center.id, center])),
    [stockCenters],
  );

  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));
  const requiresTransformerFields = Boolean(selectedMaterial?.isTransformer);
  const firstRowByTransferId = useMemo(() => {
    const seen = new Set<string>();
    const map = new Map<string, boolean>();
    historyItems.forEach((item) => {
      const key = item.transferId || item.id;
      if (!seen.has(key)) {
        seen.add(key);
        map.set(item.id, true);
      } else {
        map.set(item.id, false);
      }
    });
    return map;
  }, [historyItems]);

  const buildHistoryListParams = useCallback((targetPage: number, pageSize: number, activeFilters: FilterState) => {
    const params = new URLSearchParams();
    params.set("page", String(targetPage));
    params.set("pageSize", String(pageSize));
    if (activeFilters.startDate) params.set("startDate", activeFilters.startDate);
    if (activeFilters.endDate) params.set("endDate", activeFilters.endDate);
    if (activeFilters.movementType !== "TODOS") params.set("movementType", activeFilters.movementType);
    if (activeFilters.projectCode) params.set("projectCode", activeFilters.projectCode);
    if (activeFilters.materialCode) params.set("materialCode", activeFilters.materialCode);
    if (activeFilters.entryType !== "TODOS") params.set("entryType", activeFilters.entryType);
    if (activeFilters.reversalStatus !== "TODOS") params.set("reversalStatus", activeFilters.reversalStatus);
    return params;
  }, []);

  const loadMeta = useCallback(async () => {
    if (!session?.accessToken) {
      return;
    }

    setIsLoadingMeta(true);
    try {
      const response = await fetch("/api/stock-transfers/meta", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      const data = (await response.json().catch(() => ({}))) as MetaResponse;
      if (!response.ok) {
        setFeedback({ type: "error", message: data.message ?? "Falha ao carregar metadados da movimentacao de estoque." });
        return;
      }

      setStockCenters(data.stockCenters ?? []);
      setProjects(data.projects ?? []);
      setMaterials(data.materials ?? []);
    } catch {
      setFeedback({ type: "error", message: "Falha ao carregar metadados da movimentacao de estoque." });
    } finally {
      setIsLoadingMeta(false);
    }
  }, [session?.accessToken]);

  const loadHistory = useCallback(async (targetPage: number) => {
    if (!session?.accessToken) {
      return;
    }

    setIsLoadingHistory(true);
    try {
      const params = buildHistoryListParams(targetPage, HISTORY_PAGE_SIZE, filters);

      const response = await fetch(`/api/stock-transfers?${params.toString()}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      const data = (await response.json().catch(() => ({}))) as TransferListResponse;
      if (!response.ok) {
        setFeedback({ type: "error", message: data.message ?? "Falha ao carregar movimentacoes de estoque." });
        setHistoryItems([]);
        setHistoryTotal(0);
        return;
      }

      setHistoryItems(data.history ?? []);
      setHistoryPage(data.pagination?.page ?? targetPage);
      setHistoryTotal(data.pagination?.total ?? 0);
    } catch {
      setFeedback({ type: "error", message: "Falha ao carregar movimentacoes de estoque." });
      setHistoryItems([]);
      setHistoryTotal(0);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [
    buildHistoryListParams,
    filters,
    session?.accessToken,
  ]);

  async function handleExportHistory() {
    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para exportar movimentacoes." });
      return;
    }

    setIsExporting(true);
    setFeedback(null);

    try {
      const exportedItems: TransferListItem[] = [];
      let targetPage = 1;
      let totalItems = 0;

      while (true) {
        const params = buildHistoryListParams(targetPage, HISTORY_EXPORT_PAGE_SIZE, filters);
        const response = await fetch(`/api/stock-transfers?${params.toString()}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as TransferListResponse;
        if (!response.ok) {
          setFeedback({ type: "error", message: data.message ?? "Falha ao exportar movimentacoes de estoque." });
          return;
        }

        const pageItems = data.history ?? [];
        totalItems = data.pagination?.total ?? totalItems;
        exportedItems.push(...pageItems);

        if (pageItems.length === 0 || exportedItems.length >= totalItems || pageItems.length < HISTORY_EXPORT_PAGE_SIZE) {
          break;
        }

        targetPage += 1;
      }

      if (exportedItems.length === 0) {
        setFeedback({ type: "error", message: "Nao ha movimentacoes para exportar com os filtros atuais." });
        return;
      }

      const header = [
        "centro_de",
        "centro_para",
        "projeto",
        "material_codigo",
        "descricao",
        "quantidade",
        "serial",
        "lp",
        "data_entrada",
        "estornada",
        "estorno",
        "transferencia_original",
        "transferencia_estorno",
        "motivo_estorno",
        "data_estorno",
        "atualizado_em",
      ];

      const rows = exportedItems.map((item) => [
        item.fromStockCenterName,
        item.toStockCenterName,
        item.projectCode,
        item.materialCode,
        item.description,
        String(item.quantity),
        item.serialNumber ?? "",
        item.lotCode ?? "",
        formatDate(item.entryDate),
        item.isReversed ? "Sim" : "Nao",
        item.isReversal ? "Sim" : "Nao",
        item.originalTransferId ?? "",
        item.reversalTransferId ?? "",
        item.reversalReason ?? "",
        formatDateTime(item.reversedAt),
        formatDateTime(item.updatedAt),
      ].map((value) => csvEscape(value)).join(";"));

      const csv = `\uFEFF${header.join(";")}\n${rows.join("\n")}`;
      const fileDate = toIsoDate(new Date());
      downloadCsv(csv, `movimentacao_estoque_${fileDate}.csv`);

      setFeedback({
        type: "success",
        message: `CSV exportado com ${exportedItems.length} movimentacao(oes).`,
      });
    } catch {
      setFeedback({ type: "error", message: "Falha ao exportar movimentacoes de estoque." });
    } finally {
      setIsExporting(false);
    }
  }

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    void loadHistory(1);
  }, [filters, loadHistory]);

  function updateFormField<Key extends keyof FormState>(field: Key, value: FormState[Key]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleMaterialCodeChange(value: string) {
    const normalizedCode = normalizeCode(value);
    const matchedMaterial = materials.find((material) => normalizeCode(material.materialCode) === normalizedCode) ?? null;

    setForm((current) => ({
      ...current,
      materialCode: normalizedCode,
      materialId: matchedMaterial?.id ?? "",
      description: matchedMaterial?.description ?? "",
      entryType: normalizeMaterialEntryType(matchedMaterial?.materialType ?? ""),
      serialNumber: matchedMaterial?.isTransformer ? current.serialNumber : "",
      lotCode: matchedMaterial?.isTransformer ? current.lotCode : "",
    }));
  }

  function handleProjectCodeChange(value: string) {
    const normalizedProjectCode = normalizeCode(value);
    const matchedProject = projects.find((project) => normalizeCode(project.projectCode) === normalizedProjectCode) ?? null;

    setForm((current) => ({
      ...current,
      projectCode: normalizedProjectCode,
      projectId: matchedProject?.id ?? "",
    }));
  }

  function handleMovementTypeChange(value: FormState["movementType"]) {
    setForm((current) => ({
      ...current,
      movementType: value,
      fromStockCenterId: "",
      toStockCenterId: "",
    }));
  }

  function isValidCenterPairByMovementType() {
    const fromCenter = centerMap.get(form.fromStockCenterId);
    const toCenter = centerMap.get(form.toStockCenterId);
    if (!fromCenter || !toCenter) {
      return false;
    }

    if (form.movementType === "ENTRY") {
      return fromCenter.centerType === "THIRD_PARTY" && toCenter.centerType === "OWN";
    }
    if (form.movementType === "EXIT") {
      return fromCenter.centerType === "OWN" && toCenter.centerType === "THIRD_PARTY";
    }

    return fromCenter.centerType === "OWN" && toCenter.centerType === "OWN";
  }

  function validateManualForm() {
    const today = toIsoDate(new Date());

    if (!form.movementType || !form.fromStockCenterId || !form.toStockCenterId || !form.projectId || !form.entryDate || !form.entryType) {
      return "Preencha todos os campos obrigatorios do cabecalho.";
    }

    if (form.fromStockCenterId === form.toStockCenterId) {
      return "Centro de estoque DE e PARA precisam ser diferentes.";
    }

    if (!isValidCenterPairByMovementType()) {
      return "Combinacao de centro DE/PARA invalida para o tipo de operacao selecionado.";
    }

    if (!form.materialId) {
      return "Selecione um codigo de material valido.";
    }

    if (!form.entryType) {
      return "Tipo do material deve ser NOVO ou SUCATA no cadastro de materiais.";
    }

    if (form.entryDate > today) {
      return "Data da movimentacao nao pode ser futura.";
    }

    const quantity = parsePositiveNumber(form.quantity);
    if (quantity === null) {
      return "Quantidade deve ser maior que zero.";
    }

    if (requiresTransformerFields) {
      if (!normalizeText(form.serialNumber) || !normalizeText(form.lotCode)) {
        return "Serial e LP sao obrigatorios para material TRAFO.";
      }
    }

    return null;
  }

  function resetItemFields() {
    setForm((current) => ({
      ...current,
      materialCode: "",
      materialId: "",
      description: "",
      entryType: "",
      quantity: "",
      serialNumber: "",
      lotCode: "",
      notes: "",
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para salvar movimentacao de estoque." });
      return;
    }

    const validationError = validateManualForm();
    if (validationError) {
      setFeedback({ type: "error", message: validationError });
      return;
    }

    const quantity = parsePositiveNumber(form.quantity);
    if (quantity === null) {
      setFeedback({ type: "error", message: "Quantidade deve ser maior que zero." });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/stock-transfers", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          movementType: form.movementType,
          fromStockCenterId: form.fromStockCenterId,
          toStockCenterId: form.toStockCenterId,
          projectId: form.projectId,
          entryDate: form.entryDate,
          entryType: form.entryType,
          notes: normalizeText(form.notes) || null,
          items: [
            {
              materialId: form.materialId,
              quantity,
              serialNumber: normalizeText(form.serialNumber) || null,
              lotCode: normalizeText(form.lotCode) || null,
            },
          ],
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setFeedback({ type: "error", message: data.message ?? "Falha ao salvar movimentacao de estoque." });
        return;
      }

      setFeedback({ type: "success", message: data.message ?? "Movimentacao salva com sucesso." });
      resetItemFields();
      await loadHistory(1);
    } catch {
      setFeedback({ type: "error", message: "Falha ao salvar movimentacao de estoque." });
    } finally {
      setIsSubmitting(false);
    }
  }

  function downloadImportTemplate() {
    const sample = [
      "TRANSFER",
      "CENTRO A",
      "CENTRO B",
      "SOB-001",
      "MAT-001",
      "1",
      "SERIAL-001",
      "LOT-001",
      new Date().toISOString().slice(0, 10),
      "Cadastro em massa",
    ];

    const csv = `\uFEFF${IMPORT_TEMPLATE_HEADERS.join(";")}\n${sample.map((value) => csvEscape(value)).join(";")}`;
    downloadCsv(csv, "modelo_cadastro_massa_entrada.csv");
  }

  function onImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setImportFile(file);
  }

  function openImportModal() {
    setImportFile(null);
    setIsImportModalOpen(true);
  }

  function closeImportModal() {
    if (isImporting) return;
    setImportFile(null);
    setIsImportModalOpen(false);
  }

  function applyFilters() {
    setFilters({
      startDate: normalizeText(filterDraft.startDate),
      endDate: normalizeText(filterDraft.endDate),
      movementType: filterDraft.movementType,
      projectCode: normalizeCode(filterDraft.projectCode),
      materialCode: normalizeCode(filterDraft.materialCode),
      entryType: filterDraft.entryType,
      reversalStatus: filterDraft.reversalStatus,
    });
  }

  function clearFilters() {
    setFilterDraft(INITIAL_FILTERS);
    setFilters(INITIAL_FILTERS);
  }

  async function openHistoryModal(item: TransferListItem) {
    setHistoryModalItem(item);
    if (!session?.accessToken || !item.transferId) {
      setHistoryModalItems([]);
      return;
    }

    setIsLoadingHistoryModal(true);
    try {
      const params = new URLSearchParams();
      params.set("mode", "history");
      params.set("page", "1");
      params.set("pageSize", "100");
      params.set("transferId", item.transferId);

      const response = await fetch(`/api/stock-transfers?${params.toString()}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      const data = (await response.json().catch(() => ({}))) as TransferHistoryResponse;
      if (!response.ok) {
        setHistoryModalItems([]);
        setFeedback({ type: "error", message: data.message ?? "Falha ao carregar historico da movimentacao de estoque." });
        return;
      }

      const fetchedItems = data.history ?? [];
      setHistoryModalItems(fetchedItems);
    } catch {
      setHistoryModalItems([]);
      setFeedback({ type: "error", message: "Falha ao carregar historico da movimentacao de estoque." });
    } finally {
      setIsLoadingHistoryModal(false);
    }
  }

  function closeHistoryModal() {
    setHistoryModalItem(null);
    setHistoryModalItems([]);
    setIsLoadingHistoryModal(false);
  }

  function openReversalModal(item: TransferListItem) {
    if (!canReverseStockMovement || item.isReversed || item.isReversal) {
      return;
    }

    setReversalModalItem(item);
    setReversalReason("");
    setReversalDate(toIsoDate(new Date()));
  }

  function closeReversalModal() {
    if (isReversing) return;
    setReversalModalItem(null);
    setReversalReason("");
    setReversalDate(toIsoDate(new Date()));
  }

  async function handleConfirmReversal() {
    if (!session?.accessToken || !reversalModalItem) {
      setFeedback({ type: "error", message: "Sessao invalida para estornar movimentacao de estoque." });
      return;
    }

    const normalizedReason = normalizeText(reversalReason);
    if (!normalizedReason) {
      setFeedback({ type: "error", message: "Motivo do estorno e obrigatorio." });
      return;
    }

    const normalizedReversalDate = normalizeText(reversalDate);
    if (!normalizedReversalDate) {
      setFeedback({ type: "error", message: "Data do estorno e obrigatoria." });
      return;
    }

    if (normalizedReversalDate > toIsoDate(new Date())) {
      setFeedback({ type: "error", message: "Data do estorno nao pode ser futura." });
      return;
    }

    setIsReversing(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/stock-transfers/reversal", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          transferId: reversalModalItem.transferId,
          reversalReason: normalizedReason,
          reversalDate: normalizedReversalDate,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setFeedback({ type: "error", message: data.message ?? "Falha ao estornar movimentacao de estoque." });
        return;
      }

      setFeedback({ type: "success", message: data.message ?? "Estorno realizado com sucesso." });
      closeReversalModal();
      await loadHistory(1);
    } catch {
      setFeedback({ type: "error", message: "Falha ao estornar movimentacao de estoque." });
    } finally {
      setIsReversing(false);
    }
  }

  async function handleImportCsv() {
    if (!session?.accessToken || !importFile) {
      setFeedback({ type: "error", message: "Selecione um arquivo CSV para importar." });
      return;
    }

    setIsImporting(true);
    setFeedback(null);

    try {
      const content = await importFile.text();
      const rows = parseCsvContent(content);
      if (rows.length === 0) {
        setFeedback({ type: "error", message: "Arquivo CSV vazio ou invalido." });
        return;
      }

      const stockCenterByName = new Map(stockCenters.map((center) => [normalizeText(center.name).toLowerCase(), center]));
      const projectByCode = new Map(projects.map((project) => [normalizeCode(project.projectCode), project]));
      const materialByCode = new Map(materials.map((material) => [normalizeCode(material.materialCode), material]));

      const mappedEntries: Array<Record<string, unknown>> = [];
      const localErrors: string[] = [];

      rows.forEach((row, index) => {
        const today = toIsoDate(new Date());
        const rowNumber = index + 2;
        const movementType = normalizeMovementType(row.movement_type);
        const fromCenterName = normalizeText(row.from_stock_center);
        const toCenterName = normalizeText(row.to_stock_center);
        const projectCode = normalizeCode(row.project_code);
        const materialCode = normalizeCode(row.material_code);
        const quantity = parsePositiveNumber(row.quantity);
        const serialNumber = normalizeText(row.serial_number) || null;
        const lotCode = normalizeText(row.lot_code) || null;
        const entryDate = normalizeText(row.entry_date);
        const notes = normalizeText(row.notes) || null;

        const fromCenter = stockCenterByName.get(fromCenterName.toLowerCase()) ?? null;
        const toCenter = stockCenterByName.get(toCenterName.toLowerCase()) ?? null;
        const project = projectByCode.get(projectCode) ?? null;
        const material = materialByCode.get(materialCode) ?? null;

        if (!movementType || !fromCenter || !toCenter || !project || !material || quantity === null || !entryDate) {
          localErrors.push(`Linha ${rowNumber}: referencias invalidas ou campos obrigatorios ausentes.`);
          return;
        }

        if (entryDate > today) {
          localErrors.push(`Linha ${rowNumber}: data da movimentacao nao pode ser futura.`);
          return;
        }

        if (fromCenter.id === toCenter.id) {
          localErrors.push(`Linha ${rowNumber}: centro DE e PARA precisam ser diferentes.`);
          return;
        }

        const materialEntryType = normalizeMaterialEntryType(material.materialType);
        if (!materialEntryType) {
          localErrors.push(`Linha ${rowNumber}: tipo do material deve ser NOVO ou SUCATA no cadastro de materiais.`);
          return;
        }

        const isEntryPair = fromCenter.centerType === "THIRD_PARTY" && toCenter.centerType === "OWN";
        const isExitPair = fromCenter.centerType === "OWN" && toCenter.centerType === "THIRD_PARTY";
        const isTransferPair = fromCenter.centerType === "OWN" && toCenter.centerType === "OWN";
        if (
          (movementType === "ENTRY" && !isEntryPair)
          || (movementType === "EXIT" && !isExitPair)
          || (movementType === "TRANSFER" && !isTransferPair)
        ) {
          localErrors.push(`Linha ${rowNumber}: combinacao de centros invalida para movement_type informado.`);
          return;
        }

        if (material.isTransformer && (!serialNumber || !lotCode)) {
          localErrors.push(`Linha ${rowNumber}: serial_number e lot_code sao obrigatorios para material TRAFO.`);
          return;
        }

        mappedEntries.push({
          rowNumber,
          movementType,
          fromStockCenterId: fromCenter.id,
          toStockCenterId: toCenter.id,
          projectId: project.id,
          entryDate,
          entryType: materialEntryType,
          notes,
          items: [
            {
              materialId: material.id,
              quantity,
              serialNumber,
              lotCode,
            },
          ],
        });
      });

      if (mappedEntries.length === 0) {
        setFeedback({
          type: "error",
          message: `Nenhuma linha valida encontrada para importar. ${localErrors.slice(0, 5).join(" | ")}`,
        });
        return;
      }

      const response = await fetch("/api/stock-transfers/import", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({ entries: mappedEntries }),
      });

      const data = (await response.json().catch(() => ({}))) as ImportResponse;

      const localErrorText = localErrors.length > 0 ? ` Validacao local: ${localErrors.slice(0, 3).join(" | ")}.` : "";
      const summary = data.summary;
      const apiErrors = (data.results ?? [])
        .filter((result) => !result.success)
        .slice(0, 3)
        .map((result) => `Linha ${result.rowNumber}: ${result.message}`)
        .join(" | ");

      if (!response.ok && response.status !== 207) {
        setFeedback({
          type: "error",
          message: `${data.message ?? "Falha ao importar cadastro em massa."}${localErrorText}`,
        });
        return;
      }

      if ((summary?.errorCount ?? 0) > 0 || localErrors.length > 0) {
        setFeedback({
          type: "error",
          message:
            `Importacao concluida com pendencias. Sucesso: ${summary?.successCount ?? 0}, Erros: ${summary?.errorCount ?? 0}.`
            + `${apiErrors ? ` ${apiErrors}` : ""}${localErrorText}`,
        });
      } else {
        setFeedback({
          type: "success",
          message: `Importacao concluida com sucesso. ${summary?.successCount ?? mappedEntries.length} linhas salvas.`,
        });
      }

      setImportFile(null);
      await loadHistory(1);
    } catch {
      setFeedback({ type: "error", message: "Falha ao importar cadastro em massa." });
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <section className={styles.wrapper}>
      {feedback ? (
        <p className={feedback.type === "success" ? styles.successFeedback : styles.errorFeedback}>{feedback.message}</p>
      ) : null}

      <article className={styles.card}>
        <header className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>Cadastro de Movimentacao de Estoque</h3>
          <p>Selecione a operacao: Entrada, Saida ou Transferencia.</p>
        </header>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>
              Operacao <span className={styles.requiredMark}>*</span>
            </span>
            <select
              value={form.movementType}
              onChange={(event) => handleMovementTypeChange(event.target.value as FormState["movementType"])}
              disabled={isSubmitting || isLoadingMeta}
            >
              <option value="ENTRY">Entrada</option>
              <option value="EXIT">Saida</option>
              <option value="TRANSFER">Transferencia</option>
            </select>
          </label>

          <label className={styles.field}>
            <span>
              DE <span className={styles.requiredMark}>*</span>
            </span>
            <select
              value={form.fromStockCenterId}
              onChange={(event) => updateFormField("fromStockCenterId", event.target.value)}
              disabled={isSubmitting || isLoadingMeta}
            >
              <option value="">Selecione</option>
              {fromCenterOptions.map((center) => (
                <option key={center.id} value={center.id}>
                  {center.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>
              PARA <span className={styles.requiredMark}>*</span>
            </span>
            <select
              value={form.toStockCenterId}
              onChange={(event) => updateFormField("toStockCenterId", event.target.value)}
              disabled={isSubmitting || isLoadingMeta}
            >
              <option value="">Selecione</option>
              {toCenterOptions.map((center) => (
                <option key={center.id} value={center.id}>
                  {center.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>
              Projeto <span className={styles.requiredMark}>*</span>
            </span>
            <input
              type="text"
              value={form.projectCode}
              onChange={(event) => handleProjectCodeChange(event.target.value)}
              list="entrada-projeto-form-list"
              placeholder="Digite o codigo do projeto"
              disabled={isSubmitting || isLoadingMeta}
            />
            <datalist id="entrada-projeto-form-list">
              {projects.map((project) => (
                <option key={project.id} value={project.projectCode} />
              ))}
            </datalist>
          </label>

          <label className={styles.field}>
            <span>
              Material (codigo) <span className={styles.requiredMark}>*</span>
            </span>
            <input
              type="text"
              value={form.materialCode}
              onChange={(event) => handleMaterialCodeChange(event.target.value)}
              list="material-code-list"
              placeholder="Digite o codigo do material"
              disabled={isSubmitting || isLoadingMeta}
            />
            <datalist id="material-code-list">
              {materials.map((material) => (
                <option key={material.id} value={material.materialCode}>
                  {material.description}
                </option>
              ))}
            </datalist>
          </label>

          <label className={styles.field}>
            <span>Descricao</span>
            <input type="text" value={form.description} readOnly placeholder="Preenchido automaticamente ao selecionar o codigo" />
          </label>

          <label className={styles.field}>
            <span>
              Quantidade <span className={styles.requiredMark}>*</span>
            </span>
            <input
              type="number"
              step="0.001"
              min="0.001"
              value={form.quantity}
              onChange={(event) => updateFormField("quantity", event.target.value)}
              disabled={isSubmitting}
            />
          </label>

          <label className={styles.field}>
            <span>
              Serial
              {requiresTransformerFields ? <span className={styles.requiredMark}>*</span> : null}
            </span>
            <input
              type="text"
              value={form.serialNumber}
              onChange={(event) => updateFormField("serialNumber", event.target.value)}
              disabled={isSubmitting || !requiresTransformerFields}
              placeholder={requiresTransformerFields ? "Informe o serial" : "Disponivel apenas para material TRAFO"}
            />
          </label>

          <label className={styles.field}>
            <span>
              LP
              {requiresTransformerFields ? <span className={styles.requiredMark}>*</span> : null}
            </span>
            <input
              type="text"
              value={form.lotCode}
              onChange={(event) => updateFormField("lotCode", event.target.value)}
              disabled={isSubmitting || !requiresTransformerFields}
              placeholder={requiresTransformerFields ? "Informe o LP" : "Disponivel apenas para material TRAFO"}
            />
          </label>

          <p className={`${styles.fieldHint} ${styles.fullWidth}`}>
            Campos Serial e LP so pode ser ativo se o material selecionado for True para trafo.
          </p>

          <label className={styles.field}>
            <span>
              Data da entrada <span className={styles.requiredMark}>*</span>
            </span>
            <input
              type="date"
              value={form.entryDate}
              onChange={(event) => updateFormField("entryDate", event.target.value)}
              disabled={isSubmitting}
            />
          </label>

          <label className={styles.field}>
            <span>
              Tipo <span className={styles.requiredMark}>*</span>
            </span>
            <input
              type="text"
              value={form.entryType}
              readOnly
              disabled
              placeholder="Preenchido automaticamente pelo tipo do material"
            />
          </label>

          <label className={`${styles.field} ${styles.fullWidth}`}>
            <span>Observacao</span>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(event) => updateFormField("notes", event.target.value)}
              disabled={isSubmitting}
            />
          </label>

          <div className={`${styles.actions} ${styles.fullWidth}`}>
            <button type="submit" className={styles.primaryButton} disabled={isSubmitting || isLoadingMeta}>
              {isSubmitting ? "Salvando..." : "Salvar operacao"}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={openImportModal}
              disabled={isSubmitting || isLoadingMeta}
            >
              Cadastro em massa
            </button>
          </div>
        </form>
      </article>

      <article className={styles.card}>
        <header className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>Filtros</h3>
          <p>Refine a lista por operacao, periodo, projeto, material, tipo e estorno.</p>
        </header>

        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span>Data inicial</span>
            <input
              type="date"
              value={filterDraft.startDate}
              onChange={(event) => setFilterDraft((current) => ({ ...current, startDate: event.target.value }))}
            />
          </label>
          <label className={styles.field}>
            <span>Data final</span>
            <input
              type="date"
              value={filterDraft.endDate}
              onChange={(event) => setFilterDraft((current) => ({ ...current, endDate: event.target.value }))}
            />
          </label>
          <label className={styles.field}>
            <span>Operacao</span>
            <select
              value={filterDraft.movementType}
              onChange={(event) => setFilterDraft((current) => ({ ...current, movementType: event.target.value as FilterState["movementType"] }))}
            >
              <option value="TODOS">Todas</option>
              <option value="ENTRY">Entrada</option>
              <option value="EXIT">Saida</option>
              <option value="TRANSFER">Transferencia</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Projeto (codigo)</span>
            <input
              type="text"
              value={filterDraft.projectCode}
              onChange={(event) => setFilterDraft((current) => ({ ...current, projectCode: event.target.value }))}
              placeholder="Digite o codigo do projeto"
              list="entrada-projeto-list"
            />
          </label>
          <label className={styles.field}>
            <span>Material (codigo)</span>
            <input
              type="text"
              value={filterDraft.materialCode}
              onChange={(event) => setFilterDraft((current) => ({ ...current, materialCode: event.target.value }))}
              placeholder="Digite o codigo do material"
              list="entrada-material-list"
            />
          </label>
          <label className={styles.field}>
            <span>Tipo</span>
            <select
              value={filterDraft.entryType}
              onChange={(event) => setFilterDraft((current) => ({ ...current, entryType: event.target.value as FilterState["entryType"] }))}
            >
              <option value="TODOS">Todos</option>
              <option value="NOVO">NOVO</option>
              <option value="SUCATA">SUCATA</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Estorno</span>
            <select
              value={filterDraft.reversalStatus}
              onChange={(event) => setFilterDraft((current) => ({ ...current, reversalStatus: event.target.value as FilterState["reversalStatus"] }))}
            >
              <option value="TODOS">Todos</option>
              <option value="ESTORNADAS">Estornadas</option>
              <option value="NAO_ESTORNADAS">Nao estornadas</option>
              <option value="ESTORNOS">Somente estornos</option>
            </select>
          </label>
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.primaryButton} onClick={applyFilters} disabled={isLoadingHistory}>
            Aplicar filtros
          </button>
          <button type="button" className={styles.ghostButton} onClick={clearFilters} disabled={isLoadingHistory}>
            Limpar filtros
          </button>
        </div>
      </article>

      <article className={styles.card}>
        <header className={styles.tableHeader}>
          <div>
            <h3 className={styles.cardTitle}>Lista de Movimentacoes</h3>
            <p className={styles.tableHint}>Fonte: tabelas `stock_transfers` e `stock_transfer_items`.</p>
          </div>
          <div className={styles.tableHeaderActions}>
            <CsvExportButton
              className={styles.ghostButton}
              onClick={() => void handleExportHistory()}
              disabled={isExporting || isLoadingHistory}
              isLoading={isExporting}
            />
          </div>
        </header>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Centro DE</th>
                <th>Centro PARA</th>
                <th>Projeto</th>
                <th>Material (Codigo)</th>
                <th>Descricao</th>
                <th>Quantidade</th>
                <th>Serial</th>
                <th>LP</th>
                <th>Data entrada</th>
                <th>Atualizado em</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {!isLoadingHistory && historyItems.length === 0 ? (
                <tr>
                  <td colSpan={11} className={styles.emptyRow}>
                    Nenhuma movimentacao encontrada.
                  </td>
                </tr>
              ) : null}

              {historyItems.map((item) => (
                <tr key={item.id}>
                  <td>{item.fromStockCenterName}</td>
                  <td>{item.toStockCenterName}</td>
                  <td>{item.projectCode}</td>
                  <td>{item.materialCode}</td>
                  <td>{item.description}</td>
                  <td>{item.quantity}</td>
                  <td>{item.serialNumber ?? "-"}</td>
                  <td>{item.lotCode ?? "-"}</td>
                  <td>{formatDate(item.entryDate)}</td>
                  <td>{formatDateTime(item.updatedAt)}</td>
                  <td className={styles.actionsCell}>
                    <div className={styles.tableActions}>
                      <button
                        type="button"
                        className={`${styles.actionButton} ${styles.actionView}`}
                        onClick={() => setDetailItem(item)}
                        aria-label={`Detalhes da movimentacao ${item.transferId ?? item.id}`}
                        title="Detalhes"
                      >
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" stroke="currentColor" strokeWidth="1.7" />
                          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className={`${styles.actionButton} ${styles.actionHistory}`}
                        onClick={() => void openHistoryModal(item)}
                        aria-label={`Historico da movimentacao ${item.transferId ?? item.id}`}
                        title="Historico"
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
                        className={`${styles.actionButton} ${styles.actionReversal}`}
                        onClick={() => openReversalModal(item)}
                        disabled={!canReverseStockMovement || isReversing || item.isReversed || item.isReversal || firstRowByTransferId.get(item.id) === false}
                        aria-label={`Estornar movimentacao ${item.transferId ?? item.id}`}
                        title={
                          !canReverseStockMovement
                            ? "Apenas usuarios administrativos podem estornar"
                            : item.isReversed
                            ? "Movimentacao ja estornada"
                            : item.isReversal
                              ? "Movimentacao de estorno nao permite novo estorno"
                              : firstRowByTransferId.get(item.id) === false
                                ? "Use a primeira linha da transferencia para estornar"
                              : "Estornar"
                        }
                      >
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path
                            d="M4.75 7.75v4h4M4.75 11.75a7.25 7.25 0 1 0 1.95-4.95"
                            stroke="currentColor"
                            strokeWidth="1.7"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path d="M10.5 9.5h6.75M14.75 6.75 17.5 9.5l-2.75 2.75" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={styles.pagination}>
          <span>
            Pagina {Math.min(historyPage, historyTotalPages)} de {historyTotalPages} | Total: {historyTotal}
          </span>
          <div className={styles.paginationButtons}>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => void loadHistory(Math.max(1, historyPage - 1))}
              disabled={historyPage <= 1 || isLoadingHistory}
            >
              Anterior
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => void loadHistory(Math.min(historyTotalPages, historyPage + 1))}
              disabled={historyPage >= historyTotalPages || isLoadingHistory}
            >
              Proxima
            </button>
          </div>
        </div>
      </article>

      {detailItem ? (
        <div className={styles.modalOverlay} onClick={() => setDetailItem(null)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Detalhes da Movimentacao</h4>
                <p className={styles.modalSubtitle}>Transferencia: {detailItem.transferId ?? "-"}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setDetailItem(null)}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <div className={styles.detailGrid}>
                <div><strong>Atualizado em:</strong> {formatDateTime(detailItem.updatedAt)}</div>
                <div><strong>Usuario:</strong> {detailItem.updatedByName}</div>
                <div><strong>Projeto:</strong> {detailItem.projectCode}</div>
                <div><strong>Estornada:</strong> {detailItem.isReversed ? "Sim" : "Nao"}</div>
                <div><strong>Tipo:</strong> {detailItem.entryType ?? "-"}</div>
                <div><strong>Operacao:</strong> {movementTypeLabel(detailItem.movementType)}</div>
                <div><strong>Centro DE:</strong> {detailItem.fromStockCenterName}</div>
                <div><strong>Centro PARA:</strong> {detailItem.toStockCenterName}</div>
                <div><strong>Material:</strong> {detailItem.materialCode}</div>
                <div><strong>Quantidade:</strong> {detailItem.quantity.toLocaleString("pt-BR")}</div>
                <div><strong>Serial:</strong> {detailItem.serialNumber ?? "-"}</div>
                <div><strong>LP:</strong> {detailItem.lotCode ?? "-"}</div>
                <div><strong>Data da entrada:</strong> {formatDate(detailItem.entryDate)}</div>
                <div><strong>Transferencia de estorno:</strong> {detailItem.reversalTransferId ?? "-"}</div>
                <div><strong>Transferencia original:</strong> {detailItem.originalTransferId ?? "-"}</div>
                <div><strong>Motivo do estorno:</strong> {detailItem.reversalReason ?? "-"}</div>
                <div><strong>Data do estorno:</strong> {formatDateTime(detailItem.reversedAt)}</div>
                <div className={styles.detailWide}><strong>Descricao:</strong> {detailItem.description}</div>
                <div className={styles.detailWide}><strong>Observacao:</strong> {detailItem.notes ?? "-"}</div>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {historyModalItem ? (
        <div className={styles.modalOverlay} onClick={closeHistoryModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Historico da Movimentacao</h4>
                <p className={styles.modalSubtitle}>Transferencia: {historyModalItem.transferId ?? "-"}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={closeHistoryModal}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              {isLoadingHistoryModal ? <p>Carregando historico...</p> : null}
              {!isLoadingHistoryModal && historyModalItems.length === 0 ? <p>Nenhum historico registrado.</p> : null}
              {!isLoadingHistoryModal && historyModalItems.length > 0 ? historyModalItems.map((item) => (
                <article key={item.id} className={styles.historyCard}>
                  <header className={styles.historyCardHeader}>
                    <strong>{formatHistoryActionLabel(item.action)}</strong>
                    <span>{formatDateTime(item.changedAt)} | {item.changedByName}</span>
                  </header>
                  <div className={styles.historyChanges}>
                    {Object.entries(item.changes ?? {}).length > 0
                      ? Object.entries(item.changes ?? {}).map(([field, change]) => (
                        <div key={field} className={styles.historyChangeItem}>
                          <strong>{HISTORY_FIELD_LABELS[field] ?? field}</strong>
                          <span>De: {formatHistoryValue(change.from)}</span>
                          <span>Para: {formatHistoryValue(change.to)}</span>
                        </div>
                      ))
                      : <div className={styles.historyChangeItem}><span>Sem alteracoes detalhadas.</span></div>}
                  </div>
                </article>
              )) : null}
            </div>
          </article>
        </div>
      ) : null}

      {reversalModalItem ? (
        <div className={styles.modalOverlay} onClick={closeReversalModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Estornar movimentacao</h4>
                <p className={styles.modalSubtitle}>Transferencia original: {reversalModalItem.transferId ?? "-"}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={closeReversalModal} disabled={isReversing}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <p className={styles.reversalWarning}>
                O estorno cria uma nova movimentacao inversa e nao altera o registro original.
              </p>

              <div className={styles.detailGrid}>
                <div><strong>Operacao original:</strong> {movementTypeLabel(reversalModalItem.movementType)}</div>
                <div><strong>Projeto:</strong> {reversalModalItem.projectCode}</div>
                <div><strong>Centro DE:</strong> {reversalModalItem.fromStockCenterName}</div>
                <div><strong>Centro PARA:</strong> {reversalModalItem.toStockCenterName}</div>
                <div><strong>Material:</strong> {reversalModalItem.materialCode}</div>
                <div><strong>Quantidade:</strong> {reversalModalItem.quantity.toLocaleString("pt-BR")}</div>
                <div><strong>Data da entrada:</strong> {formatDate(reversalModalItem.entryDate)}</div>
                <div><strong>Tipo:</strong> {reversalModalItem.entryType}</div>
              </div>

              <label className={styles.field}>
                <span>
                  Motivo do estorno <span className={styles.requiredMark}>*</span>
                </span>
                <textarea
                  rows={3}
                  value={reversalReason}
                  onChange={(event) => setReversalReason(event.target.value)}
                  disabled={isReversing}
                  placeholder="Descreva o motivo do estorno"
                />
              </label>

              <label className={styles.field}>
                <span>
                  Data do estorno <span className={styles.requiredMark}>*</span>
                </span>
                <input
                  type="date"
                  value={reversalDate}
                  onChange={(event) => setReversalDate(event.target.value)}
                  disabled={isReversing}
                />
              </label>

              <div className={styles.actions}>
                <button type="button" className={styles.ghostButton} onClick={closeReversalModal} disabled={isReversing}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void handleConfirmReversal()}
                  disabled={isReversing || !normalizeText(reversalReason) || !normalizeText(reversalDate)}
                >
                  {isReversing ? "Estornando..." : "Confirmar estorno"}
                </button>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {isImportModalOpen ? (
        <div className={styles.modalOverlay} onClick={closeImportModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Cadastro em massa</h4>
                <p className={styles.modalSubtitle}>Importe um CSV para registrar movimentacoes em lote.</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={closeImportModal}>
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
                <div className={styles.importActions}>
                  <button type="button" className={`${styles.secondaryButton} ${styles.importTemplateButton}`} onClick={downloadImportTemplate}>
                    Baixar modelo CSV
                  </button>
                </div>
              </section>

              <section className={styles.importStep}>
                <div className={styles.importStepHeader}>
                  <span className={styles.importStepNumber}>2</span>
                  <div>
                    <strong>Preencha a planilha</strong>
                    <p>
                      Colunas obrigatorias: {IMPORT_TEMPLATE_HEADERS.join(", ")}.
                    </p>
                  </div>
                </div>
              </section>

              <section className={styles.importStep}>
                <div className={styles.importStepHeader}>
                  <span className={styles.importStepNumber}>3</span>
                  <div>
                    <strong>Envie o arquivo</strong>
                    <p>Somente arquivo CSV.</p>
                  </div>
                </div>
                <label className={styles.importDropzone}>
                  <input type="file" accept=".csv,text/csv" onChange={onImportFileChange} disabled={isImporting} />
                  <span>{importFile ? importFile.name : "Clique para selecionar o arquivo CSV"}</span>
                </label>
                <div className={styles.importActions}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => void handleImportCsv()}
                    disabled={!importFile || isImporting}
                  >
                    {isImporting ? "Importando..." : "Importar planilha"}
                  </button>
                </div>
              </section>
            </div>
          </article>
        </div>
      ) : null}

      <datalist id="entrada-projeto-list">
        {projects.map((project) => (
          <option key={project.id} value={project.projectCode} />
        ))}
      </datalist>
      <datalist id="entrada-material-list">
        {materials.map((material) => (
          <option key={material.id} value={material.materialCode}>
            {material.description}
          </option>
        ))}
      </datalist>
    </section>
  );
}
