"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

import { ActionIcon } from "@/components/ui/ActionIcon";
import { CsvExportButton } from "@/components/ui/CsvExportButton";
import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { useExportCooldown } from "@/hooks/useExportCooldown";
import { HISTORY_EXPORT_PAGE_SIZE, HISTORY_FIELD_LABELS, HISTORY_PAGE_SIZE, IMPORT_TEMPLATE_HEADERS, INITIAL_FILTERS, INITIAL_FORM } from "./constants";
import type {
  FilterState,
  FormState,
  ImportResponse,
  MassImportIssue,
  MassImportResultSummary,
  MetaResponse,
  TeamOperationFormItem,
  TeamOperationHistoryEntry,
  TeamOperationHistoryResponse,
  TeamOperationKind,
  TeamOperationListItem,
  TeamOperationListResponse,
} from "./types";
import {
  createMassImportErrorReport,
  downloadCsv,
  downloadMassImportErrorReport,
  formatDate,
  formatDateTime,
  formatHistoryActionLabel,
  formatHistoryValue,
  isTransformerQuantityValid,
  normalizeDateInput,
  normalizeHeaderName,
  normalizeMaterialEntryType,
  normalizeTeamOperationKind,
  normalizeText,
  operationDateLabel,
  operationKindLabel,
  parseCsvContent,
  parsePositiveNumber,
  readCsvField,
  rowStatusLabel,
  toIsoDate,
} from "./utils";
import styles from "../entrada/StockTransfersPageView.module.css";
import localStyles from "./TeamStockOperationsPageView.module.css";

const LIST_PAGE_SIZE = 20;

type FeedbackState = {
  type: "success" | "error";
  message: string;
};

type StockBalanceLookupResponse = {
  items?: Array<{
    stockCenterId: string;
    materialId: string;
    materialCode: string;
    balanceQuantity: number;
  }>;
  message?: string;
};

type TrafoPositionLookupResponse = {
  items?: Array<{
    materialId: string;
    materialCode: string;
    serialNumber: string;
    lotCode: string;
    currentStockCenterId: string | null;
    currentStatus?: "EM_ESTOQUE" | "COM_EQUIPE" | "FORA_ESTOQUE";
  }>;
  message?: string;
};

function operationSignalClass(value: TeamOperationKind | string | null | undefined) {
  const normalized = normalizeTeamOperationKind(value);
  if (normalized === "REQUISITION") return styles.signalChipExit;
  if (normalized === "RETURN") return styles.signalChipEntry;
  if (normalized === "FIELD_RETURN") return styles.signalChipEntry;
  return styles.signalChipTransfer;
}

function resolvePrimaryStockCenterName(item: Pick<TeamOperationListItem, "operationKind" | "fromStockCenterName" | "toStockCenterName">) {
  return item.operationKind === "REQUISITION" ? item.fromStockCenterName : item.toStockCenterName;
}

function resolveSupportCenterName(item: Pick<TeamOperationListItem, "operationKind" | "fromStockCenterName" | "toStockCenterName">) {
  return item.operationKind === "REQUISITION" ? item.toStockCenterName : item.fromStockCenterName;
}

function createRowId() {
  return `team-operation-item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildHistoryListParams(targetPage: number, pageSize: number, activeFilters: FilterState) {
  const params = new URLSearchParams();
  params.set("page", String(targetPage));
  params.set("pageSize", String(pageSize));
  if (activeFilters.startDate) params.set("startDate", activeFilters.startDate);
  if (activeFilters.endDate) params.set("endDate", activeFilters.endDate);
  if (activeFilters.operationKind !== "TODOS") params.set("operationKind", activeFilters.operationKind);
  if (activeFilters.teamId) params.set("teamId", activeFilters.teamId);
  if (activeFilters.projectCode) params.set("projectCode", activeFilters.projectCode);
  if (activeFilters.materialCode) params.set("materialCode", activeFilters.materialCode);
  if (activeFilters.entryType !== "TODOS") params.set("entryType", activeFilters.entryType);
  if (activeFilters.reversalStatus !== "TODOS") params.set("reversalStatus", activeFilters.reversalStatus);
  return params;
}

function summarizeImportResponse(response: ImportResponse): MassImportResultSummary {
  const summary = response.summary;
  const successCount = Number(summary?.successCount ?? 0);
  const errorCount = Number(summary?.errorCount ?? 0);

  if (successCount > 0 && errorCount === 0) {
    return {
      status: "success",
      message: response.message ?? "Cadastro em massa concluido com sucesso.",
      successCount,
      errorRows: 0,
    };
  }

  if (successCount > 0 && errorCount > 0) {
    return {
      status: "partial",
      message: response.message ?? "Cadastro em massa concluido parcialmente.",
      successCount,
      errorRows: errorCount,
    };
  }

  return {
    status: "error",
    message: response.message ?? "Nenhuma linha foi salva no cadastro em massa.",
    successCount,
    errorRows: errorCount,
  };
}

function isPendingItemVisibleWithFilters(
  item: TeamOperationFormItem,
  filters: FilterState,
  context: Pick<FormState, "operationKind" | "teamId" | "projectCode" | "entryDate">,
) {
  if (filters.startDate && context.entryDate < filters.startDate) return false;
  if (filters.endDate && context.entryDate > filters.endDate) return false;
  if (filters.operationKind !== "TODOS" && context.operationKind !== filters.operationKind) return false;
  if (filters.teamId && context.teamId !== filters.teamId) return false;
  if (filters.projectCode && !context.projectCode.toUpperCase().includes(filters.projectCode.trim().toUpperCase())) return false;
  if (filters.materialCode && !item.materialCode.toUpperCase().includes(filters.materialCode.trim().toUpperCase())) return false;
  if (filters.entryType !== "TODOS" && item.entryType !== filters.entryType) return false;
  if (filters.reversalStatus === "ESTORNADAS" || filters.reversalStatus === "ESTORNOS") return false;
  return true;
}

export function TeamStockOperationsPageView() {
  const { session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const logError = useErrorLogger("operacoes_equipe");
  const exportCooldown = useExportCooldown();
  const canReverseTeamOperation = useMemo(() => {
    const normalizedRole = String(session?.user.role ?? "").trim().toUpperCase();
    return normalizedRole === "ADMIN" || normalizedRole === "MASTER" || normalizedRole === "USER";
  }, [session?.user.role]);

  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [stockCenters, setStockCenters] = useState<MetaResponse["stockCenters"]>([]);
  const [teams, setTeams] = useState<MetaResponse["teams"]>([]);
  const [projects, setProjects] = useState<MetaResponse["projects"]>([]);
  const [materials, setMaterials] = useState<MetaResponse["materials"]>([]);
  const [reversalReasons, setReversalReasons] = useState<MetaResponse["reversalReasons"]>([]);
  const [fieldReturnOriginName, setFieldReturnOriginName] = useState("CAMPO / INSTALADO");

  const [historyItems, setHistoryItems] = useState<TeamOperationListItem[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [filterDraft, setFilterDraft] = useState<FilterState>(INITIAL_FILTERS);
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);

  const [detailItem, setDetailItem] = useState<TeamOperationListItem | null>(null);
  const [historyModalItem, setHistoryModalItem] = useState<TeamOperationListItem | null>(null);
  const [historyModalItems, setHistoryModalItems] = useState<TeamOperationHistoryEntry[]>([]);
  const [reversalModalItem, setReversalModalItem] = useState<TeamOperationListItem | null>(null);
  const [reversalReasonCode, setReversalReasonCode] = useState("");
  const [reversalReasonNotes, setReversalReasonNotes] = useState("");
  const [reversalDate, setReversalDate] = useState(toIsoDate(new Date()));
  const [alertMessage, setAlertMessage] = useState<string | null>(null);

  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isLoadingHistoryModal, setIsLoadingHistoryModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isReversing, setIsReversing] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importErrorReport, setImportErrorReport] = useState<ReturnType<typeof createMassImportErrorReport> | null>(null);
  const [importResult, setImportResult] = useState<MassImportResultSummary | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const selectedMaterial = useMemo(
    () => (materials ?? []).find((material) => material.id === form.materialId) ?? null,
    [form.materialId, materials],
  );
  const selectedTeam = useMemo(
    () => (teams ?? []).find((team) => team.id === form.teamId && team.isActive) ?? null,
    [form.teamId, teams],
  );
  const activeTeams = useMemo(
    () => (teams ?? []).filter((team) => team.isActive),
    [teams],
  );
  const selectedStockCenter = useMemo(
    () => (stockCenters ?? []).find((center) => center.id === form.stockCenterId) ?? null,
    [form.stockCenterId, stockCenters],
  );
  const selectedReversalReason = useMemo(
    () => (reversalReasons ?? []).find((reason) => reason.code === reversalReasonCode) ?? null,
    [reversalReasonCode, reversalReasons],
  );

  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / LIST_PAGE_SIZE));
  const requiresTransformerFields = Boolean(selectedMaterial?.isTransformer);
  const formDateLabel = operationDateLabel(form.operationKind);
  const formCardTitle = "Cadastro de Operacoes de Equipe";
  const formCardDescription = `Selecione a operacao: Requisicao, Devolucao ou Retorno de campo via ${fieldReturnOriginName}.`;
  const submitButtonLabel = isSubmitting ? "Salvando..." : "Salvar operacao";
  const sourceStockCenterId = form.operationKind === "REQUISITION"
    ? form.stockCenterId
    : form.operationKind === "RETURN"
      ? (selectedTeam?.stockCenterId ?? "")
      : "";
  const sourceStockCenterName = form.operationKind === "REQUISITION"
    ? (selectedStockCenter?.name ?? "centro selecionado")
    : form.operationKind === "RETURN"
      ? (selectedTeam?.stockCenterName ?? "centro da equipe")
      : fieldReturnOriginName;
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

  function showError(message: string) {
    setFeedback({ type: "error", message });
    setAlertMessage(message);
  }

  useEffect(() => {
    if (!selectedMaterial) {
      setForm((current) => ({
        ...current,
        description: current.materialId ? current.description : "",
        entryType: current.materialId ? current.entryType : "",
      }));
      return;
    }

    const nextEntryType = normalizeMaterialEntryType(selectedMaterial.materialType ?? "");
    setForm((current) => ({
      ...current,
      description: selectedMaterial.description,
      entryType: current.operationKind === "FIELD_RETURN" ? "SUCATA" : nextEntryType,
      quantity: selectedMaterial.isTransformer ? "1" : current.quantity,
    }));
  }, [selectedMaterial]);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      teamName: selectedTeam?.name ?? "",
      foremanName: selectedTeam?.foremanName ?? "",
    }));
  }, [selectedTeam]);

  useEffect(() => {
    if (!form.teamId) {
      return;
    }

    const stillActive = activeTeams.some((team) => team.id === form.teamId);
    if (stillActive) {
      return;
    }

    setForm((current) => ({
      ...current,
      teamId: "",
      teamName: "",
      foremanName: "",
    }));
  }, [activeTeams, form.teamId]);

  useEffect(() => {
    if (!form.stockCenterId) {
      return;
    }

    const stillAllowed = (stockCenters ?? []).some((center) => center.id === form.stockCenterId);
    if (stillAllowed) {
      return;
    }

    setForm((current) => ({
      ...current,
      stockCenterId: "",
    }));
  }, [form.stockCenterId, stockCenters]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    let isMounted = true;

    async function loadMeta() {
      setIsLoadingMeta(true);
      try {
        const response = await fetch("/api/team-stock-operations/meta", {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as MetaResponse;
        if (!response.ok) {
          if (isMounted) {
            setFeedback({
              type: "error",
              message: data.message ?? "Falha ao carregar metadados das operacoes de equipe.",
            });
          }
          await logError("Falha ao carregar metadados das operacoes de equipe.", undefined, {
            responseStatus: response.status,
            responseMessage: data.message ?? null,
          });
          return;
        }

        if (!isMounted) {
          return;
        }

    const nextReversalReasons = data.reversalReasons ?? [];
    setStockCenters(data.stockCenters ?? []);
    setTeams((data.teams ?? []).filter((team) => team.isActive));
    setProjects(data.projects ?? []);
    setMaterials(data.materials ?? []);
    setReversalReasons(nextReversalReasons);
    setFieldReturnOriginName(String(data.fieldReturnOriginName ?? "CAMPO / INSTALADO"));
    setFeedback(null);

        if (!reversalReasonCode && nextReversalReasons.length > 0) {
          setReversalReasonCode(nextReversalReasons[0].code);
        }
      } catch (error) {
        if (isMounted) {
          setFeedback({ type: "error", message: "Falha ao carregar metadados das operacoes de equipe." });
        }
        await logError("Falha ao carregar metadados das operacoes de equipe.", error);
      } finally {
        if (isMounted) {
          setIsLoadingMeta(false);
        }
      }
    }

    void loadMeta();

    return () => {
      isMounted = false;
    };
  }, [accessToken, logError, reversalReasonCode]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    let isMounted = true;

    async function loadHistory(targetPage: number) {
      setIsLoadingHistory(true);
      try {
        const params = buildHistoryListParams(targetPage, LIST_PAGE_SIZE, filters);
        const response = await fetch(`/api/team-stock-operations?${params.toString()}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as TeamOperationListResponse;
        if (!response.ok) {
          if (isMounted) {
            setHistoryItems([]);
            setHistoryTotal(0);
            setFeedback({
              type: "error",
              message: data.message ?? "Falha ao carregar operacoes de equipe.",
            });
          }
          await logError("Falha ao carregar operacoes de equipe.", undefined, {
            responseStatus: response.status,
            responseMessage: data.message ?? null,
            filters,
            page: targetPage,
          });
          return;
        }

        if (isMounted) {
          setHistoryItems(data.history ?? []);
          setHistoryPage(data.pagination?.page ?? targetPage);
          setHistoryTotal(data.pagination?.total ?? 0);
        }
      } catch (error) {
        if (isMounted) {
          setHistoryItems([]);
          setHistoryTotal(0);
          setFeedback({ type: "error", message: "Falha ao carregar operacoes de equipe." });
        }
        await logError("Falha ao carregar operacoes de equipe.", error, {
          filters,
          page: targetPage,
        });
      } finally {
        if (isMounted) {
          setIsLoadingHistory(false);
        }
      }
    }

    void loadHistory(historyPage);

    return () => {
      isMounted = false;
    };
  }, [accessToken, filters, historyPage, logError]);

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function updateFilterDraft<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setFilterDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function resetForm() {
    setForm({
      ...INITIAL_FORM,
      entryDate: toIsoDate(new Date()),
    });
  }

  function handleProjectCodeChange(value: string) {
    const normalized = normalizeText(value).toUpperCase();
    const matchedProject = (projects ?? []).find((project) => project.projectCode.toUpperCase() === normalized) ?? null;

    setForm((current) => ({
      ...current,
      projectCode: value,
      projectId: matchedProject?.id ?? "",
    }));
  }

  function handleMaterialCodeChange(value: string) {
    const normalized = normalizeText(value).toUpperCase();
    const matchedMaterial = (materials ?? []).find((material) => material.materialCode.toUpperCase() === normalized) ?? null;

    setForm((current) => ({
      ...current,
      materialCode: value,
      materialId: matchedMaterial?.id ?? "",
      description: matchedMaterial?.description ?? "",
      entryType: current.operationKind === "FIELD_RETURN"
        ? (matchedMaterial ? "SUCATA" : "")
        : normalizeMaterialEntryType(matchedMaterial?.materialType ?? ""),
      quantity: matchedMaterial?.isTransformer ? "1" : current.quantity,
      serialNumber: matchedMaterial?.isTransformer ? current.serialNumber : "",
      lotCode: matchedMaterial?.isTransformer ? current.lotCode : "",
    }));
  }

  function handleOperationKindChange(value: TeamOperationKind) {
    if (form.items.length > 0) {
      showError("Remova os itens adicionados antes de trocar o tipo da operacao.");
      return;
    }

    setForm((current) => ({
      ...current,
      operationKind: value,
      entryType: value === "FIELD_RETURN"
        ? (current.materialId ? "SUCATA" : "")
        : normalizeMaterialEntryType(selectedMaterial?.materialType ?? ""),
    }));
  }

  function handleQuantityChange(value: string) {
    if (requiresTransformerFields) {
      updateForm("quantity", "1");
      return;
    }

    updateForm("quantity", value);
  }

  function handleAddFormItem() {
    if (!form.materialId || !selectedMaterial) {
      showError("Selecione um material valido antes de adicionar.");
      return;
    }

    const quantity = parsePositiveNumber(form.quantity);
    if (quantity === null) {
      showError("Informe uma quantidade maior que zero para adicionar o material.");
      return;
    }

    if (requiresTransformerFields && !isTransformerQuantityValid(quantity)) {
      showError("Material TRAFO permite somente quantidade 1 por operacao.");
      return;
    }

    if (requiresTransformerFields && (!normalizeText(form.serialNumber) || !normalizeText(form.lotCode))) {
      showError("Serial e LP sao obrigatorios para material TRAFO.");
      return;
    }

    const normalizedEntryType = form.operationKind === "FIELD_RETURN"
      ? "SUCATA"
      : normalizeMaterialEntryType(form.entryType);
    if (!normalizedEntryType) {
      showError("Tipo do material deve ser NOVO ou SUCATA no cadastro de materiais.");
      return;
    }

    if (form.items.length > 0 && form.items[0].entryType !== normalizedEntryType) {
      showError(`Todos os itens da mesma operacao devem ter o mesmo tipo (${form.items[0].entryType}).`);
      return;
    }

    const normalizedSerial = normalizeText(form.serialNumber);
    const normalizedLot = normalizeText(form.lotCode);
    const hasDuplicate = form.items.some((item) => {
      if (item.isTransformer || selectedMaterial.isTransformer) {
        return item.materialId === form.materialId
          && normalizeText(item.serialNumber).toUpperCase() === normalizedSerial.toUpperCase()
          && normalizeText(item.lotCode).toUpperCase() === normalizedLot.toUpperCase();
      }

      return item.materialId === form.materialId;
    });

    if (hasDuplicate) {
      showError(
        selectedMaterial.isTransformer
          ? "Esta unidade TRAFO ja foi adicionada na operacao."
          : "Este material ja foi adicionado na operacao. Remova a linha anterior para incluir novamente.",
      );
      return;
    }

    setForm((current) => ({
      ...current,
      materialCode: "",
      materialId: "",
      description: "",
      quantity: "",
      serialNumber: "",
      lotCode: "",
      entryType: "",
      items: [
        ...current.items,
        {
          rowId: createRowId(),
          materialId: selectedMaterial.id,
          materialCode: selectedMaterial.materialCode,
          description: selectedMaterial.description,
          quantity,
          serialNumber: normalizedSerial,
          lotCode: normalizedLot,
          entryType: normalizedEntryType,
          isTransformer: Boolean(selectedMaterial.isTransformer),
        },
      ],
    }));
    setFeedback(null);
  }

  function removeFormItem(rowId: string) {
    setForm((current) => ({
      ...current,
      items: current.items.filter((item) => item.rowId !== rowId),
    }));
  }

  function handleApplyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    setHistoryPage(1);
    setFilters({ ...filterDraft });
  }

  function handleClearFilters() {
    setFeedback(null);
    setHistoryPage(1);
    setFilterDraft(INITIAL_FILTERS);
    setFilters(INITIAL_FILTERS);
  }

  async function ensureSourceStockAvailability(params: {
    materialId: string;
    materialCode: string;
    quantity: number;
    serialNumber: string | null;
    lotCode: string | null;
    isTransformer: boolean;
  }) {
    if (!accessToken) {
      return { ok: false, message: "Sessao invalida para validar a operacao." } as const;
    }

    if (form.operationKind === "FIELD_RETURN") {
      if (!params.isTransformer) {
        return { ok: true } as const;
      }

      const searchParams = new URLSearchParams();
      searchParams.set("page", "1");
      searchParams.set("pageSize", "10");
      searchParams.set("materialCode", params.materialCode);
      searchParams.set("serialNumber", params.serialNumber ?? "");
      searchParams.set("lotCode", params.lotCode ?? "");

      const response = await fetch(`/api/trafo-positions?${searchParams.toString()}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const data = (await response.json().catch(() => ({}))) as TrafoPositionLookupResponse;
      if (!response.ok) {
        return {
          ok: false,
          message: data.message ?? "Falha ao validar a unidade TRAFO para retorno de campo.",
        } as const;
      }

      const matchedUnit = (data.items ?? []).find((item) =>
        item.materialId === params.materialId
        && String(item.serialNumber ?? "").trim().toUpperCase() === String(params.serialNumber ?? "").trim().toUpperCase()
        && String(item.lotCode ?? "").trim().toUpperCase() === String(params.lotCode ?? "").trim().toUpperCase(),
      );

      if (matchedUnit && matchedUnit.currentStatus !== "FORA_ESTOQUE") {
        return {
          ok: false,
          message: `Material ${params.materialCode}: a unidade TRAFO informada ja esta registrada no estoque ou vinculada a uma equipe. Utilize outra operacao em vez de Retorno de campo.`,
        } as const;
      }

      return { ok: true } as const;
    }

    if (!sourceStockCenterId) {
      return { ok: false, message: "Selecione um centro de origem valido antes de salvar." } as const;
    }

    if (params.isTransformer) {
      const searchParams = new URLSearchParams();
      searchParams.set("page", "1");
      searchParams.set("pageSize", "10");
      searchParams.set("stockCenterId", sourceStockCenterId);
      searchParams.set("materialCode", params.materialCode);
      searchParams.set("serialNumber", params.serialNumber ?? "");
      searchParams.set("lotCode", params.lotCode ?? "");

      const response = await fetch(`/api/trafo-positions?${searchParams.toString()}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const data = (await response.json().catch(() => ({}))) as TrafoPositionLookupResponse;
      if (!response.ok) {
        return {
          ok: false,
          message: data.message ?? "Falha ao validar a unidade TRAFO no estoque de origem.",
        } as const;
      }

      const matchedUnit = (data.items ?? []).find((item) =>
        item.materialId === params.materialId
        && String(item.serialNumber ?? "").trim().toUpperCase() === String(params.serialNumber ?? "").trim().toUpperCase()
        && String(item.lotCode ?? "").trim().toUpperCase() === String(params.lotCode ?? "").trim().toUpperCase()
        && item.currentStockCenterId === sourceStockCenterId,
      );

      if (!matchedUnit) {
        return {
          ok: false,
          message: `Material ${params.materialCode}: a unidade TRAFO informada nao esta no estoque de origem (${sourceStockCenterName}). Confira Material, Serial e LP.`,
        } as const;
      }

      return { ok: true } as const;
    }

    const searchParams = new URLSearchParams();
    searchParams.set("page", "1");
    searchParams.set("pageSize", "100");
    searchParams.set("stockCenterId", sourceStockCenterId);
    searchParams.set("materialCode", params.materialCode);
    searchParams.set("onlyPositive", "TODOS");
    searchParams.set("includeTeamCenters", "1");

    const response = await fetch(`/api/stock-balance?${searchParams.toString()}`, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const data = (await response.json().catch(() => ({}))) as StockBalanceLookupResponse;
    if (!response.ok) {
      return {
        ok: false,
        message: data.message ?? "Falha ao validar o saldo do estoque de origem.",
      } as const;
    }

    const matchedBalance = (data.items ?? []).find((item) =>
      item.stockCenterId === sourceStockCenterId && item.materialId === params.materialId,
    );

    if (!matchedBalance || Number(matchedBalance.balanceQuantity ?? 0) <= 0) {
      return {
        ok: false,
        message: `Material ${params.materialCode}: nao existe saldo disponivel no estoque de origem (${sourceStockCenterName}).`,
      } as const;
    }

    if (Number(matchedBalance.balanceQuantity ?? 0) < params.quantity) {
      return {
        ok: false,
        message: `Material ${params.materialCode}: saldo insuficiente no estoque de origem (${sourceStockCenterName}). Saldo atual: ${Number(matchedBalance.balanceQuantity ?? 0).toLocaleString("pt-BR")}.`,
      } as const;
    }

    return { ok: true } as const;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!accessToken) {
      showError("Sessao invalida para salvar operacao de equipe.");
      return;
    }

    if (!form.stockCenterId || !form.teamId || !form.projectId || !form.entryDate) {
      showError("Preencha centro de estoque, equipe, projeto e data.");
      return;
    }

    if (!selectedTeam?.stockCenterId) {
      showError("A equipe selecionada nao possui centro de estoque proprio vinculado no cadastro de Equipes.");
      return;
    }

    if (form.items.length === 0) {
      showError("Adicione ao menos um material na operacao antes de salvar.");
      return;
    }

    const operationEntryType = form.operationKind === "FIELD_RETURN"
      ? "SUCATA"
      : (form.items[0]?.entryType ?? "");
    if (!operationEntryType) {
      showError("Nao foi possivel determinar o tipo dos itens da operacao.");
      return;
    }

    if (form.items.some((item) => item.entryType !== operationEntryType)) {
      showError(`Todos os itens da mesma operacao devem ter o mesmo tipo (${operationEntryType}).`);
      return;
    }

    for (const item of form.items) {
      if (item.quantity <= 0) {
        showError(`Quantidade invalida para o material ${item.materialCode}.`);
        return;
      }

      if (item.isTransformer) {
        if (!isTransformerQuantityValid(item.quantity)) {
          showError(`Material TRAFO ${item.materialCode} permite somente quantidade 1 por operacao.`);
          return;
        }

        if (!normalizeText(item.serialNumber) || !normalizeText(item.lotCode)) {
          showError(`Serial e LP sao obrigatorios para o material TRAFO ${item.materialCode}.`);
          return;
        }
      }

      const sourceAvailability = await ensureSourceStockAvailability({
        materialId: item.materialId,
        materialCode: item.materialCode,
        quantity: item.quantity,
        serialNumber: normalizeText(item.serialNumber) || null,
        lotCode: normalizeText(item.lotCode) || null,
        isTransformer: item.isTransformer,
      });
      if (!sourceAvailability.ok) {
        showError(sourceAvailability.message);
        return;
      }
    }

    setIsSubmitting(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/team-stock-operations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          operationKind: form.operationKind,
          stockCenterId: form.stockCenterId,
          teamId: form.teamId,
          projectId: form.projectId,
          entryDate: form.entryDate,
          entryType: operationEntryType,
          notes: normalizeText(form.notes) || null,
          items: form.items.map((item) => ({
            materialId: item.materialId,
            quantity: item.quantity,
            serialNumber: normalizeText(item.serialNumber) || null,
            lotCode: normalizeText(item.lotCode) || null,
          })),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { transferId?: string; message?: string };
      if (!response.ok) {
        showError(data.message ?? "Falha ao salvar operacao de equipe.");
        await logError("Falha ao salvar operacao de equipe.", undefined, {
          responseStatus: response.status,
          responseMessage: data.message ?? null,
          form,
        });
        return;
      }

      const hiddenByFilters = !form.items.some((item) => isPendingItemVisibleWithFilters(item, filters, {
        operationKind: form.operationKind,
        teamId: form.teamId,
        projectCode: form.projectCode,
        entryDate: form.entryDate,
      }));
      setFeedback({
        type: "success",
        message: hiddenByFilters
          ? `${data.message ?? "Operacao salva com sucesso."} O registro salvo ficou fora dos filtros atuais.`
          : data.message ?? "Operacao salva com sucesso.",
      });

      resetForm();
      setHistoryPage(1);
      setFilters((current) => ({ ...current }));
    } catch (error) {
      showError("Falha ao salvar operacao de equipe.");
      await logError("Falha ao salvar operacao de equipe.", error, { form });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleExportHistory() {
    if (!accessToken) {
      showError("Sessao invalida para exportar operacoes de equipe.");
      return;
    }

    if (!exportCooldown.tryStart()) {
      setFeedback({
        type: "error",
        message: `Aguarde ${exportCooldown.getRemainingSeconds()}s para exportar novamente.`,
      });
      return;
    }

    setIsExporting(true);
    setFeedback(null);

    try {
      const exportedItems: TeamOperationListItem[] = [];
      let page = 1;
      let total = 0;

      while (true) {
        const params = buildHistoryListParams(page, HISTORY_EXPORT_PAGE_SIZE, filters);
        const response = await fetch(`/api/team-stock-operations?${params.toString()}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as TeamOperationListResponse;
        if (!response.ok) {
          showError(data.message ?? "Falha ao exportar operacoes de equipe.");
          await logError("Falha ao exportar operacoes de equipe.", undefined, {
            responseStatus: response.status,
            responseMessage: data.message ?? null,
            filters,
            page,
          });
          return;
        }

        const pageItems = data.history ?? [];
        total = data.pagination?.total ?? total;
        exportedItems.push(...pageItems);

        if (pageItems.length === 0 || exportedItems.length >= total || pageItems.length < HISTORY_EXPORT_PAGE_SIZE) {
          break;
        }

        page += 1;
      }

      if (exportedItems.length === 0) {
        showError("Nao ha registros para exportar com os filtros atuais.");
        return;
      }

      const lines = [
        "operacao;centro_estoque;equipe;encarregado;origem_apoio;projeto;material_codigo;descricao;quantidade;serial;lp;data_operacao;tipo;status;observacao",
        ...exportedItems.map((item) => {
          const stockCenterName = resolvePrimaryStockCenterName(item);
          const supportCenterName = resolveSupportCenterName(item);

          return [
            item.isReversal ? "ESTORNO" : operationKindLabel(item.operationKind),
            stockCenterName,
            item.teamName,
            item.foremanName ?? "",
            supportCenterName,
            item.projectCode,
            item.materialCode,
            item.description,
            item.quantity,
            item.serialNumber ?? "",
            item.lotCode ?? "",
            item.entryDate,
            item.entryType,
            rowStatusLabel(item) ?? "Ativa",
            item.notes ?? "",
          ].map((value) => String(value ?? "").replace(/;/g, ",")).join(";");
        }),
      ];

      downloadCsv(`\uFEFF${lines.join("\n")}\n`, `operacoes_equipe_${toIsoDate(new Date())}.csv`);
      setFeedback({ type: "success", message: "Exportacao concluida com sucesso." });
    } catch (error) {
      showError("Falha ao exportar operacoes de equipe.");
      await logError("Falha ao exportar operacoes de equipe.", error, { filters });
    } finally {
      setIsExporting(false);
    }
  }

  async function openHistoryModal(item: TeamOperationListItem) {
    if (!accessToken) {
      showError("Sessao invalida para carregar historico da operacao de equipe.");
      return;
    }

    setHistoryModalItem(item);
    setHistoryModalItems([]);
    setIsLoadingHistoryModal(true);

    try {
      const params = new URLSearchParams();
      params.set("mode", "history");
      params.set("transferId", item.transferId);
      params.set("page", "1");
      params.set("pageSize", String(HISTORY_PAGE_SIZE));

      const response = await fetch(`/api/team-stock-operations?${params.toString()}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const data = (await response.json().catch(() => ({}))) as TeamOperationHistoryResponse;
      if (!response.ok) {
        showError(data.message ?? "Falha ao carregar historico da operacao de equipe.");
        await logError("Falha ao carregar historico da operacao de equipe.", undefined, {
          responseStatus: response.status,
          responseMessage: data.message ?? null,
          transferId: item.transferId,
        });
        setHistoryModalItem(null);
        return;
      }

      setHistoryModalItems(data.history ?? []);
    } catch (error) {
      showError("Falha ao carregar historico da operacao de equipe.");
      await logError("Falha ao carregar historico da operacao de equipe.", error, { transferId: item.transferId });
      setHistoryModalItem(null);
    } finally {
      setIsLoadingHistoryModal(false);
    }
  }

  function closeHistoryModal() {
    setHistoryModalItem(null);
    setHistoryModalItems([]);
    setIsLoadingHistoryModal(false);
  }

  function openReversalModal(item: TeamOperationListItem) {
    setReversalModalItem(item);
    setReversalReasonCode((reversalReasons ?? [])[0]?.code ?? "");
    setReversalReasonNotes("");
    setReversalDate(toIsoDate(new Date()));
  }

  function closeReversalModal() {
    setReversalModalItem(null);
    setReversalReasonCode((reversalReasons ?? [])[0]?.code ?? "");
    setReversalReasonNotes("");
    setReversalDate(toIsoDate(new Date()));
    setIsReversing(false);
  }

  async function handleConfirmReversal() {
    if (!accessToken || !reversalModalItem) {
      showError("Sessao invalida para estornar operacao de equipe.");
      return;
    }

    if (!normalizeText(reversalReasonCode) || !normalizeText(reversalDate)) {
      showError("Informe motivo padrao e data do estorno.");
      return;
    }

    if (selectedReversalReason?.requiresNotes && !normalizeText(reversalReasonNotes)) {
      showError("Informe a observacao do motivo do estorno.");
      return;
    }

    setIsReversing(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/team-stock-operations/reversal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          transferId: reversalModalItem.transferId,
          reversalReasonCode,
          reversalReasonNotes: normalizeText(reversalReasonNotes) || null,
          reversalDate,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        showError(data.message ?? "Falha ao estornar operacao de equipe.");
        await logError("Falha ao estornar operacao de equipe.", undefined, {
          responseStatus: response.status,
          responseMessage: data.message ?? null,
          transferId: reversalModalItem.transferId,
        });
        return;
      }

      setFeedback({ type: "success", message: data.message ?? "Operacao estornada com sucesso." });
      closeReversalModal();
      setHistoryPage(1);
      setFilters((current) => ({ ...current }));
    } catch (error) {
      showError("Falha ao estornar operacao de equipe.");
      await logError("Falha ao estornar operacao de equipe.", error, {
        transferId: reversalModalItem.transferId,
      });
    } finally {
      setIsReversing(false);
    }
  }

  function downloadImportTemplate() {
    const headerLine = IMPORT_TEMPLATE_HEADERS.join(";");
    const sampleLines = [
      headerLine,
      "REQUISICAO;CENTRO-A;Equipe Norte;PROJ-001;MAT-001;5;;;2026-04-04;Requisicao operacional",
      "DEVOLUCAO;CENTRO-A;Equipe Norte;PROJ-001;TRAFO-001;1;SER-001;LP-001;2026-04-04;Devolucao de unidade",
      "RETORNO_DE_CAMPO;CENTRO-A;Equipe Norte;PROJ-001;TRAFO-RET-001;1;SER-RET-001;LP-RET-001;2026-04-04;Retirada de campo",
    ];
    downloadCsv(`\uFEFF${sampleLines.join("\n")}\n`, "operacoes_equipe_modelo.csv");
  }

  function closeImportModal() {
    setIsImportModalOpen(false);
    setImportFile(null);
    setImportResult(null);
    setImportErrorReport(null);
  }

  function openImportModal() {
    setIsImportModalOpen(true);
    setImportFile(null);
    setImportResult(null);
    setImportErrorReport(null);
  }

  function onImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setImportFile(file);
    setImportResult(null);
    setImportErrorReport(null);
  }

  function downloadLastImportErrorReport() {
    downloadMassImportErrorReport(importErrorReport ?? null);
  }

  async function handleImportCsv() {
    if (!accessToken) {
      showError("Sessao invalida para importar operacoes de equipe em massa.");
      return;
    }

    if (!importFile) {
      showError("Selecione um arquivo CSV para importar.");
      return;
    }

    setIsImporting(true);
    setFeedback(null);
    setImportResult(null);
    setImportErrorReport(null);

    try {
      const fileContent = await importFile.text();
      const rows = parseCsvContent(fileContent);

      if (rows.length === 0) {
        showError("O arquivo CSV precisa ter cabecalho e pelo menos uma linha de dados.");
        return;
      }

      const stockCenterMap = new Map(
        (stockCenters ?? []).map((item) => [normalizeHeaderName(item.name), item]),
      );
      const teamMap = new Map(
        activeTeams.map((item) => [normalizeHeaderName(item.name), item]),
      );
      const projectMap = new Map(
        (projects ?? []).map((item) => [normalizeHeaderName(item.projectCode), item]),
      );
      const materialMap = new Map(
        (materials ?? []).map((item) => [normalizeHeaderName(item.materialCode), item]),
      );

      const issues: MassImportIssue[] = [];
      const today = toIsoDate(new Date());
      const entries = rows.flatMap((row, index) => {
        const rowNumber = index + 2;
        const operationKindRaw = readCsvField(row, ["operacao", "operation", "tipo_operacao"]);
        const stockCenterRaw = readCsvField(row, ["centro_estoque", "centro", "stock_center", "stock_center_name"]);
        const teamRaw = readCsvField(row, ["equipe", "team", "team_name"]);
        const projectRaw = readCsvField(row, ["projeto", "project", "project_code"]);
        const materialRaw = readCsvField(row, ["material_codigo", "material", "material_code"]);
        const quantityRaw = readCsvField(row, ["quantidade", "quantity", "qty"]);
        const serialRaw = readCsvField(row, ["serial", "serial_number"]);
        const lotRaw = readCsvField(row, ["lp", "lot", "lot_code"]);
        const entryDateRaw = readCsvField(row, ["data_operacao", "data", "entry_date", "data_entrada"]);
        const entryDate = normalizeDateInput(entryDateRaw);
        const notesRaw = readCsvField(row, ["observacao", "observation", "notes"]);

        const operationKind = normalizeTeamOperationKind(operationKindRaw);
        const stockCenter = stockCenterMap.get(normalizeHeaderName(stockCenterRaw)) ?? null;
        const team = teamMap.get(normalizeHeaderName(teamRaw)) ?? null;
        const project = projectMap.get(normalizeHeaderName(projectRaw)) ?? null;
        const material = materialMap.get(normalizeHeaderName(materialRaw)) ?? null;
        const quantity = parsePositiveNumber(quantityRaw);
        const entryType = operationKind === "FIELD_RETURN"
          ? "SUCATA"
          : normalizeMaterialEntryType(material?.materialType ?? "");

        if (!operationKind) {
          issues.push({ rowNumber, column: "operacao", value: operationKindRaw, error: "Operacao deve ser REQUISICAO, DEVOLUCAO ou RETORNO_DE_CAMPO." });
        }
        if (!stockCenter) {
          issues.push({ rowNumber, column: "centro_estoque", value: stockCenterRaw, error: "Centro de estoque nao encontrado." });
        }
        if (!team) {
          issues.push({ rowNumber, column: "equipe", value: teamRaw, error: "Equipe nao encontrada ou sem centro proprio vinculado." });
        }
        if (!project) {
          issues.push({ rowNumber, column: "projeto", value: projectRaw, error: "Projeto nao encontrado." });
        }
        if (!material) {
          issues.push({ rowNumber, column: "material_codigo", value: materialRaw, error: "Material nao encontrado." });
        }
        if (quantity === null) {
          issues.push({ rowNumber, column: "quantidade", value: quantityRaw, error: "Quantidade deve ser maior que zero." });
        }
        if (!entryDateRaw) {
          issues.push({ rowNumber, column: "data_operacao", value: entryDateRaw, error: "Data da operacao e obrigatoria." });
        }
        if (entryDateRaw && !entryDate) {
          issues.push({ rowNumber, column: "data_operacao", value: entryDateRaw, error: "Data invalida. Use YYYY-MM-DD ou DD/MM/YYYY." });
        }
        if (entryDate && entryDate > today) {
          issues.push({ rowNumber, column: "data_operacao", value: entryDate, error: "Data da movimentacao nao pode ser futura." });
        }
        if (material && !entryType) {
          issues.push({ rowNumber, column: "material_codigo", value: materialRaw, error: "Tipo do material deve ser NOVO ou SUCATA no cadastro de materiais." });
        }

        if (material?.isTransformer) {
          if (!serialRaw) {
            issues.push({ rowNumber, column: "serial", value: serialRaw, error: "Serial e obrigatorio para material TRAFO." });
          }
          if (!lotRaw) {
            issues.push({ rowNumber, column: "lp", value: lotRaw, error: "LP e obrigatorio para material TRAFO." });
          }
          if (!isTransformerQuantityValid(quantity)) {
            issues.push({ rowNumber, column: "quantidade", value: quantityRaw, error: "Material TRAFO permite somente quantidade 1." });
          }

        }

        if (
          !operationKind
          || !stockCenter
          || !team
          || !project
          || !material
          || quantity === null
          || !entryDate
          || !entryType
          || (material.isTransformer && (!serialRaw || !lotRaw || !isTransformerQuantityValid(quantity)))
        ) {
          return [];
        }

        return [
          {
            rowNumber,
            operationKind,
            stockCenterId: stockCenter.id,
            teamId: team.id,
            projectId: project.id,
            entryDate,
            entryType,
            notes: notesRaw || null,
            materialId: material.id,
            quantity,
            serialNumber: serialRaw || null,
            lotCode: lotRaw || null,
          },
        ];
      });

      if (entries.length === 0) {
        const report = createMassImportErrorReport(issues, "operacoes_equipe_import_erros");
        setImportErrorReport(report);
        setImportResult({
          status: "error",
          message: "Nenhuma linha valida foi encontrada no CSV.",
          successCount: 0,
          errorRows: new Set(issues.map((item) => item.rowNumber)).size,
        });
        showError("Nenhuma linha valida foi encontrada no CSV. Revise o arquivo e baixe o relatorio de erros.");
        return;
      }

      const response = await fetch("/api/team-stock-operations/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ entries }),
      });

      const data = (await response.json().catch(() => ({}))) as ImportResponse;
      const resultSummary = summarizeImportResponse(data);
      setImportResult(resultSummary);

      const serverIssues: MassImportIssue[] = data.validationIssues?.length
        ? data.validationIssues
        : (data.results ?? [])
            .filter((item) => !item.success)
            .map((item) => ({
              rowNumber: item.rowNumber,
              column: "linha",
              value: "",
              error: item.message,
            }));

      const report = createMassImportErrorReport([...issues, ...serverIssues], "operacoes_equipe_import_erros");
      setImportErrorReport(report);

      if (!response.ok && response.status !== 207) {
        showError(
          report
            ? `${data.message ?? "Falha ao importar operacoes de equipe em massa."} Baixe o CSV de erros para revisar linha e coluna.`
            : (data.message ?? "Falha ao importar operacoes de equipe em massa."),
        );
        await logError("Falha ao importar operacoes de equipe em massa.", undefined, {
          responseStatus: response.status,
          responseMessage: data.message ?? null,
        });
        return;
      }

      setFeedback({
        type: resultSummary.status === "error" ? "error" : "success",
        message: resultSummary.message,
      });

      if (serverIssues.length > 0 || resultSummary.status !== "success") {
        showError(
          report
            ? `${resultSummary.message} Baixe o CSV de erros para revisar linha e coluna.`
            : resultSummary.message,
        );
      }

      setHistoryPage(1);
      setFilters((current) => ({ ...current }));
    } catch (error) {
      showError("Falha ao importar operacoes de equipe em massa.");
      await logError("Falha ao importar operacoes de equipe em massa.", error);
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <section className={styles.wrapper}>
      <article className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>{formCardTitle}</h2>
          <p>{formCardDescription}</p>
        </header>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>
              Operacao <span className={styles.requiredMark}>*</span>
            </span>
            <select
              value={form.operationKind}
              onChange={(event) => handleOperationKindChange(event.target.value as TeamOperationKind)}
              disabled={isSubmitting}
            >
              <option value="REQUISITION">Requisicao</option>
              <option value="RETURN">Devolucao</option>
              <option value="FIELD_RETURN">Retorno de campo</option>
            </select>
          </label>

          <label className={styles.field}>
            <span>
              Centro de estoque <span className={styles.requiredMark}>*</span>
            </span>
            <select
              value={form.stockCenterId}
              onChange={(event) => updateForm("stockCenterId", event.target.value)}
              disabled={isSubmitting || isLoadingMeta}
            >
              <option value="">Selecione</option>
              {(stockCenters ?? []).map((center) => (
                <option key={center.id} value={center.id}>
                  {center.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>
              Equipe <span className={styles.requiredMark}>*</span>
            </span>
            <select
              value={form.teamId}
              onChange={(event) => updateForm("teamId", event.target.value)}
              disabled={isSubmitting || isLoadingMeta}
            >
              <option value="">Selecione</option>
              {activeTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.stockCenterId ? team.name : `${team.name} (sem centro proprio)`}
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
              list="saida-projeto-list"
              placeholder="Digite o codigo do projeto"
              disabled={isSubmitting || isLoadingMeta}
            />
          </label>

          <label className={styles.field}>
            <span>
              {formDateLabel} <span className={styles.requiredMark}>*</span>
            </span>
            <input
              type="date"
              value={form.entryDate}
              onChange={(event) => updateForm("entryDate", event.target.value)}
              disabled={isSubmitting}
            />
          </label>

          <div className={`${styles.field} ${styles.fieldSpan2}`}>
            <span>Encarregado</span>
            <input type="text" value={form.foremanName || "-"} readOnly disabled />
          </div>

          <label className={`${styles.field} ${styles.fullWidth}`}>
            <span>Observacao</span>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(event) => updateForm("notes", event.target.value)}
              disabled={isSubmitting}
              placeholder="Informacoes complementares da operacao"
            />
          </label>

          <div className={`${styles.fullWidth} ${localStyles.subCard}`}>
            <div className={localStyles.subCardHeader}>
              <div>
                <h3 className={localStyles.subCardTitle}>Materiais da Operacao</h3>
                <p className={localStyles.subCardHint}>
                  Adicione os materiais antes de salvar a requisicao, devolucao ou retorno de campo.
                </p>
              </div>
              <span className={localStyles.subCardBadge}>
                {form.items.length} {form.items.length === 1 ? "item" : "itens"}
              </span>
            </div>

            <div className={localStyles.itemDraftGrid}>
              <label className={styles.field}>
                <span>
                  Material (codigo) <span className={styles.requiredMark}>*</span>
                </span>
                <input
                  type="text"
                  value={form.materialCode}
                  onChange={(event) => handleMaterialCodeChange(event.target.value)}
                  list="saida-material-list"
                  placeholder="Digite o codigo do material"
                  disabled={isSubmitting || isLoadingMeta}
                />
              </label>

              <label className={`${styles.field} ${styles.fieldSpan2}`}>
                <span>Descricao</span>
                <input type="text" value={form.description} readOnly disabled />
              </label>

              <label className={styles.field}>
                <span>
                  Quantidade <span className={styles.requiredMark}>*</span>
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  pattern={requiresTransformerFields ? "1" : "[0-9]+([,.][0-9]{1,3})?"}
                  value={form.quantity}
                  onChange={(event) => handleQuantityChange(event.target.value)}
                  disabled={isSubmitting || requiresTransformerFields}
                  readOnly={requiresTransformerFields}
                />
                {requiresTransformerFields ? <small className={styles.fieldHint}>TRAFO opera sempre com quantidade 1.</small> : null}
              </label>

              <label className={styles.field}>
                <span>
                  Tipo <span className={styles.requiredMark}>*</span>
                </span>
                <input type="text" value={form.entryType} readOnly disabled />
              </label>

              <label className={styles.field}>
                <span>
                  Serial {requiresTransformerFields ? <span className={styles.requiredMark}>*</span> : null}
                </span>
                <input
                  type="text"
                  value={form.serialNumber}
                  onChange={(event) => updateForm("serialNumber", event.target.value)}
                  disabled={isSubmitting || !requiresTransformerFields}
                />
              </label>

              <label className={styles.field}>
                <span>
                  LP {requiresTransformerFields ? <span className={styles.requiredMark}>*</span> : null}
                </span>
                <input
                  type="text"
                  value={form.lotCode}
                  onChange={(event) => updateForm("lotCode", event.target.value)}
                  disabled={isSubmitting || !requiresTransformerFields}
                />
              </label>

              <div className={localStyles.itemDraftActions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={handleAddFormItem}
                  disabled={isSubmitting || isLoadingMeta}
                >
                  Adicionar material
                </button>
              </div>
            </div>

            <div className={`${styles.tableWrapper} ${localStyles.itemTableWrapper}`}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Codigo</th>
                    <th>Descricao</th>
                    <th>Tipo</th>
                    <th>Serial</th>
                    <th>LP</th>
                    <th>Quantidade</th>
                    <th>Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {form.items.length ? form.items.map((item) => (
                    <tr key={item.rowId}>
                      <td>{item.materialCode}</td>
                      <td className={styles.tableDescriptionCell}>{item.description}</td>
                      <td>{item.entryType}</td>
                      <td>{item.serialNumber || "-"}</td>
                      <td>{item.lotCode || "-"}</td>
                      <td className={styles.tableQuantityCell}>{item.quantity.toLocaleString("pt-BR")}</td>
                      <td className={styles.actionsCell}>
                        <button
                          type="button"
                          className={styles.ghostButton}
                          onClick={() => removeFormItem(item.rowId)}
                          disabled={isSubmitting}
                        >
                          Remover
                        </button>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={7} className={styles.emptyRow}>
                        Nenhum material adicionado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className={localStyles.summaryBar}>
              <div>
                <span>Itens</span>
                <strong>{form.items.length}</strong>
              </div>
              <div>
                <span>Tipo da operacao</span>
                <strong>{form.items[0]?.entryType ?? "-"}</strong>
              </div>
            </div>
          </div>

          <div className={styles.actions}>
            <button type="submit" className={styles.primaryButton} disabled={isSubmitting || isLoadingMeta || form.items.length === 0}>
              {submitButtonLabel}
            </button>
            <button type="button" className={styles.secondaryButton} onClick={openImportModal} disabled={isSubmitting || isLoadingMeta}>
              Cadastro em massa
            </button>
          </div>
        </form>
      </article>

      <article className={styles.card}>
        <h3 className={styles.cardTitle}>Filtros</h3>

        <form className={styles.filterGrid} onSubmit={handleApplyFilters}>
          <label className={styles.field}>
            <span>Data inicial</span>
            <input
              type="date"
              value={filterDraft.startDate}
              onChange={(event) => updateFilterDraft("startDate", event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>Data final</span>
            <input
              type="date"
              value={filterDraft.endDate}
              onChange={(event) => updateFilterDraft("endDate", event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>Operacao</span>
            <select
              value={filterDraft.operationKind}
              onChange={(event) => updateFilterDraft("operationKind", event.target.value as FilterState["operationKind"])}
            >
              <option value="TODOS">Todos</option>
              <option value="REQUISITION">Requisicao</option>
              <option value="RETURN">Devolucao</option>
              <option value="FIELD_RETURN">Retorno de campo</option>
            </select>
          </label>

          <label className={styles.field}>
            <span>Equipe</span>
            <select
              value={filterDraft.teamId}
              onChange={(event) => updateFilterDraft("teamId", event.target.value)}
            >
              <option value="">Todas</option>
              {activeTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Projeto</span>
            <input
              type="text"
              value={filterDraft.projectCode}
              onChange={(event) => updateFilterDraft("projectCode", event.target.value)}
              placeholder="Filtrar por projeto"
            />
          </label>

          <label className={styles.field}>
            <span>Material (codigo)</span>
            <input
              type="text"
              value={filterDraft.materialCode}
              onChange={(event) => updateFilterDraft("materialCode", event.target.value)}
              placeholder="Filtrar por material"
            />
          </label>

          <label className={styles.field}>
            <span>Tipo</span>
            <select
              value={filterDraft.entryType}
              onChange={(event) => updateFilterDraft("entryType", event.target.value as FilterState["entryType"])}
            >
              <option value="TODOS">Todos</option>
              <option value="NOVO">NOVO</option>
              <option value="SUCATA">SUCATA</option>
            </select>
          </label>

          <label className={styles.field}>
            <span>Status de estorno</span>
            <select
              value={filterDraft.reversalStatus}
              onChange={(event) => updateFilterDraft("reversalStatus", event.target.value as FilterState["reversalStatus"])}
            >
              <option value="TODOS">Todos</option>
              <option value="ESTORNADAS">Estornadas</option>
              <option value="NAO_ESTORNADAS">Nao estornadas</option>
              <option value="ESTORNOS">Somente estornos</option>
            </select>
          </label>

          <div className={styles.actions}>
            <button type="submit" className={styles.secondaryButton} disabled={isLoadingHistory}>
              Aplicar
            </button>
            <button type="button" className={styles.ghostButton} onClick={handleClearFilters} disabled={isLoadingHistory}>
              Limpar
            </button>
          </div>
        </form>
      </article>

      {feedback ? (
        <div className={feedback.type === "error" ? styles.errorFeedback : styles.successFeedback}>
          {feedback.message}
        </div>
      ) : null}

      <article className={styles.card}>
        <div className={styles.tableHeader}>
          <div>
            <h3 className={styles.cardTitle}>Lista de Operacoes de Equipe</h3>
            <p className={styles.tableHint}>Historico operacional de requisicoes, devolucoes, retornos de campo, estornos e registros estornados.</p>
          </div>

          <div className={styles.tableHeaderActions}>
            <CsvExportButton
              onClick={() => void handleExportHistory()}
              disabled={isLoadingHistory || isExporting}
              isLoading={isExporting}
              className={styles.secondaryButton}
            />
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Centro estoque</th>
                <th>Equipe</th>
                <th>Encarregado</th>
                <th>Origem apoio</th>
                <th>Projeto</th>
                <th>Material</th>
                <th>Descricao</th>
                <th>Quantidade</th>
                <th>Sinalizacao</th>
                <th>Data da operacao</th>
                <th>Atualizado em</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {historyItems.length > 0 ? historyItems.map((item) => {
                const stockCenterName = resolvePrimaryStockCenterName(item);
                const supportCenterName = resolveSupportCenterName(item);
                const statusLabel = rowStatusLabel(item);

                return (
                  <tr
                    key={item.id}
                    className={item.isReversal ? styles.tableRowReversal : item.isReversed ? styles.tableRowReversed : undefined}
                  >
                    <td>{stockCenterName}</td>
                    <td>{item.teamName}</td>
                    <td>{item.foremanName ?? "-"}</td>
                    <td>{supportCenterName}</td>
                    <td>{item.projectCode}</td>
                    <td>{item.materialCode}</td>
                    <td className={styles.tableDescriptionCell}>{item.description}</td>
                    <td className={styles.tableQuantityCell}>{item.quantity.toLocaleString("pt-BR")}</td>
                    <td className={styles.tableSignalCell}>
                      <div className={styles.signalStack}>
                        <span className={`${styles.signalChip} ${operationSignalClass(item.operationKind)}`}>
                          {item.isReversal ? "Estorno" : operationKindLabel(item.operationKind)}
                        </span>
                        {statusLabel ? (
                          <span className={`${styles.signalChip} ${item.isReversal ? styles.signalChipReversal : styles.signalChipReversed}`}>
                            {statusLabel}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>{formatDate(item.entryDate)}</td>
                    <td>{formatDateTime(item.updatedAt)}</td>
                    <td className={styles.actionsCell}>
                      <div className={styles.tableActions}>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionView}`}
                          onClick={() => setDetailItem(item)}
                          aria-label={`Detalhes da operacao ${item.transferId}`}
                          title="Detalhes"
                        >
                          <ActionIcon name="details" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionHistory}`}
                          onClick={() => void openHistoryModal(item)}
                          aria-label={`Historico da operacao ${item.transferId}`}
                          title="Historico"
                        >
                          <ActionIcon name="history" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionReversal}`}
                          onClick={() => openReversalModal(item)}
                          disabled={!canReverseTeamOperation || isReversing || item.isReversal || item.isReversed || firstRowByTransferId.get(item.id) === false}
                          aria-label={`Estornar operacao ${item.transferId}`}
                          title="Estornar"
                        >
                          <ActionIcon name="cancel" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={12} className={styles.emptyRow}>
                    {isLoadingHistory ? "Carregando operacoes..." : "Nenhuma operacao encontrada para os filtros aplicados."}
                  </td>
                </tr>
              )}
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
              onClick={() => setHistoryPage((current) => Math.max(1, current - 1))}
              disabled={historyPage <= 1 || isLoadingHistory}
            >
              Anterior
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setHistoryPage((current) => Math.min(historyTotalPages, current + 1))}
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
                <h4>Detalhes da Operacao</h4>
                <p className={styles.modalSubtitle}>Transferencia: {detailItem.transferId}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setDetailItem(null)}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <div className={styles.detailGrid}>
                <div><strong>Operacao:</strong> {operationKindLabel(detailItem.operationKind)}</div>
                <div><strong>Equipe:</strong> {detailItem.teamName}</div>
                <div><strong>Encarregado:</strong> {detailItem.foremanName ?? "-"}</div>
                <div><strong>Centro estoque:</strong> {resolvePrimaryStockCenterName(detailItem)}</div>
                <div><strong>Origem apoio:</strong> {resolveSupportCenterName(detailItem)}</div>
                <div><strong>Projeto:</strong> {detailItem.projectCode}</div>
                <div><strong>Material:</strong> {detailItem.materialCode}</div>
                <div><strong>Descricao:</strong> {detailItem.description}</div>
                <div><strong>Quantidade:</strong> {detailItem.quantity.toLocaleString("pt-BR")}</div>
                <div><strong>Tipo:</strong> {detailItem.entryType}</div>
                <div><strong>{operationDateLabel(detailItem.operationKind)}:</strong> {formatDate(detailItem.entryDate)}</div>
                <div><strong>Serial:</strong> {detailItem.serialNumber ?? "-"}</div>
                <div><strong>LP:</strong> {detailItem.lotCode ?? "-"}</div>
                <div><strong>Atualizado em:</strong> {formatDateTime(detailItem.updatedAt)}</div>
                <div><strong>Atualizado por:</strong> {detailItem.updatedByName}</div>
                <div><strong>Transferencia original:</strong> {detailItem.originalTransferId ?? "-"}</div>
                <div><strong>Transferencia de estorno:</strong> {detailItem.reversalTransferId ?? "-"}</div>
                <div><strong>Motivo do estorno:</strong> {detailItem.reversalReason ?? "-"}</div>
                <div><strong>Data do estorno:</strong> {formatDateTime(detailItem.reversedAt)}</div>
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
                <h4>Historico da Operacao</h4>
                <p className={styles.modalSubtitle}>Transferencia: {historyModalItem.transferId}</p>
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
                <h4>Estornar operacao de equipe</h4>
                <p className={styles.modalSubtitle}>Transferencia original: {reversalModalItem.transferId}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={closeReversalModal} disabled={isReversing}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <p className={styles.reversalWarning}>
                O estorno cria uma nova movimentacao inversa no mesmo ledger. A operacao original permanece preservada para auditoria.
              </p>

              <div className={styles.detailGrid}>
                <div><strong>Operacao original:</strong> {operationKindLabel(reversalModalItem.operationKind)}</div>
                <div><strong>Equipe:</strong> {reversalModalItem.teamName}</div>
                <div><strong>Encarregado:</strong> {reversalModalItem.foremanName ?? "-"}</div>
                <div><strong>Projeto:</strong> {reversalModalItem.projectCode}</div>
                <div><strong>Material:</strong> {reversalModalItem.materialCode}</div>
                <div><strong>Quantidade:</strong> {reversalModalItem.quantity.toLocaleString("pt-BR")}</div>
                <div><strong>{operationDateLabel(reversalModalItem.operationKind)}:</strong> {formatDate(reversalModalItem.entryDate)}</div>
              </div>

              <label className={styles.field}>
                <span>
                  Motivo padrao do estorno <span className={styles.requiredMark}>*</span>
                </span>
                <select
                  value={reversalReasonCode}
                  onChange={(event) => setReversalReasonCode(event.target.value)}
                  disabled={isReversing}
                >
                  <option value="">Selecione</option>
                  {(reversalReasons ?? []).map((reason) => (
                    <option key={reason.code} value={reason.code}>
                      {reason.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span>
                  Observacao do motivo {selectedReversalReason?.requiresNotes ? <span className={styles.requiredMark}>*</span> : null}
                </span>
                <textarea
                  rows={3}
                  value={reversalReasonNotes}
                  onChange={(event) => setReversalReasonNotes(event.target.value)}
                  disabled={isReversing}
                  placeholder={selectedReversalReason?.requiresNotes ? "Descreva o motivo" : "Opcional"}
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
                  disabled={
                    isReversing
                    || !normalizeText(reversalReasonCode)
                    || !normalizeText(reversalDate)
                    || Boolean(selectedReversalReason?.requiresNotes && !normalizeText(reversalReasonNotes))
                  }
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
                <p className={styles.modalSubtitle}>Importe um CSV para registrar requisicoes, devolucoes e retornos de campo em lote.</p>
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
                    <p>Use o arquivo modelo com as colunas obrigatorias da tela.</p>
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
                    <p>Colunas obrigatorias: operacao, centro_estoque, equipe, projeto, material_codigo, quantidade, data_operacao.</p>
                    <p>Colunas condicionais: serial e lp para material TRAFO.</p>
                    <p>Coluna opcional: observacao.</p>
                    <p>Operacao aceita: REQUISICAO/REQUISITION, DEVOLUCAO/RETURN ou RETORNO_DE_CAMPO/FIELD_RETURN.</p>
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
                  {importErrorReport ? (
                    <button type="button" className={styles.secondaryButton} onClick={downloadLastImportErrorReport}>
                      Baixar erros (CSV)
                    </button>
                  ) : null}
                </div>
                {importResult ? (
                  <div className={importResult.status === "error" ? styles.errorFeedback : styles.successFeedback}>
                    <strong>
                      {importResult.status === "success"
                        ? "Incluido com sucesso."
                        : importResult.status === "partial"
                          ? "Importacao parcial."
                          : "Importacao com erros."}
                    </strong>
                    <div>{importResult.successCount} linhas salvas.</div>
                    {importResult.errorRows > 0 ? <div>{importResult.errorRows} linhas com erro.</div> : null}
                    <div>{importResult.message}</div>
                  </div>
                ) : null}
              </section>
            </div>
          </article>
        </div>
      ) : null}

      {alertMessage ? (
        <div className={styles.modalOverlay} onClick={() => setAlertMessage(null)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4 className={localStyles.alertTitle}>Alerta operacional</h4>
                <p className={`${styles.modalSubtitle} ${localStyles.alertSubtitle}`}>Revise a validacao antes de continuar.</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setAlertMessage(null)}>
                Fechar
              </button>
            </header>
            <div className={styles.modalBody}>
              <div className={localStyles.alertBox}>
                <strong className={localStyles.alertLabel}>Erro de validacao</strong>
                <p className={localStyles.alertMessageText}>{alertMessage}</p>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      <datalist id="saida-projeto-list">
        {(projects ?? []).map((project) => (
          <option key={project.id} value={project.projectCode} />
        ))}
      </datalist>
      <datalist id="saida-material-list">
        {(materials ?? []).map((material) => (
          <option key={material.id} value={material.materialCode}>
            {material.description}
          </option>
        ))}
      </datalist>
    </section>
  );
}
