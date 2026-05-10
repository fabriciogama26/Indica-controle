"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { ActionIcon } from "@/components/ui/ActionIcon";
import { CsvExportButton } from "@/components/ui/CsvExportButton";
import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { useExportCooldown } from "@/hooks/useExportCooldown";
import { ASBUILT_MEASUREMENT_PAGE_SIZE, HISTORY_FIELD_LABELS, HISTORY_PAGE_SIZE, IMPORT_TEMPLATE_HEADERS, INITIAL_FILTERS, INITIAL_FORM } from "./constants";
import type {
  ActivityOption,
  AsbuiltMeasurementCatalogResponse,
  AsbuiltMeasurementDetail,
  AsbuiltMeasurementFilters,
  AsbuiltMeasurementFormItem,
  AsbuiltMeasurementHistoryEntry,
  AsbuiltMeasurementImportIssue,
  AsbuiltMeasurementImportResult,
  AsbuiltMeasurementKind,
  AsbuiltMeasurementListItem,
  AsbuiltMeasurementListResponse,
  AsbuiltMeasurementMetaResponse,
  FeedbackState,
  NoProductionReasonOption,
  ProjectOption,
} from "./types";
import {
  asbuiltMeasurementKindLabel,
  asbuiltMeasurementStatusLabel,
  downloadCsv,
  formatCurrency,
  formatDateTime,
  formatDecimal,
  normalizeAsbuiltMeasurementKind,
  normalizeCodeToken,
  normalizeHeaderName,
  normalizeSearchText,
  normalizeText,
  parseCsvContent,
  parsePositiveDecimal,
  readCsvField,
  toIsoDate,
} from "./utils";
import styles from "./AsbuiltMeasurementPageView.module.css";

type HistoryResponse = {
  history?: AsbuiltMeasurementHistoryEntry[];
  message?: string;
};

type DetailResponse = {
  order?: AsbuiltMeasurementDetail;
  message?: string;
};

type SaveResponse = {
  success?: boolean;
  order?: AsbuiltMeasurementDetail;
  message?: string;
};

type StatusModalState = {
  order: AsbuiltMeasurementListItem;
  action: "FECHAR" | "CANCELAR" | "ABRIR";
};

type MassImportGroup = {
  rowNumbers: number[];
  projectId: string;
  asbuiltMeasurementKind: AsbuiltMeasurementKind;
  noProductionReasonId: string;
  notes: string;
  items: Array<{
    activityId: string;
    quantity: number;
    rate: number;
    observation: string;
  }>;
};

function buildRowId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function calculateItemTotal(item: Pick<AsbuiltMeasurementFormItem, "voicePoint" | "quantity" | "rate" | "unitValue">) {
  const quantity = parsePositiveDecimal(item.quantity) ?? 0;
  const rate = parsePositiveDecimal(item.rate) ?? 0;
  return item.voicePoint * quantity * rate * item.unitValue;
}

function formatHistoryValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function AsbuiltMeasurementPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("medicao-asbuilt");
  const exportCooldown = useExportCooldown();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [noProductionReasons, setNoProductionReasons] = useState<NoProductionReasonOption[]>([]);
  const [activityOptions, setActivityOptions] = useState<ActivityOption[]>([]);
  const [form, setForm] = useState(INITIAL_FORM);
  const [filters, setFilters] = useState<AsbuiltMeasurementFilters>(INITIAL_FILTERS);
  const [filterDraft, setFilterDraft] = useState<AsbuiltMeasurementFilters>(INITIAL_FILTERS);
  const [orders, setOrders] = useState<AsbuiltMeasurementListItem[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: ASBUILT_MEASUREMENT_PAGE_SIZE, total: 0 });
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingDetails, setIsExportingDetails] = useState(false);
  const [detailOrder, setDetailOrder] = useState<AsbuiltMeasurementDetail | null>(null);
  const [historyOrder, setHistoryOrder] = useState<AsbuiltMeasurementListItem | null>(null);
  const [historyEntries, setHistoryEntries] = useState<AsbuiltMeasurementHistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [statusModal, setStatusModal] = useState<StatusModalState | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [isMassImportOpen, setIsMassImportOpen] = useState(false);
  const [massImportFile, setMassImportFile] = useState<File | null>(null);
  const [massImportIssues, setMassImportIssues] = useState<AsbuiltMeasurementImportIssue[]>([]);
  const [massImportSummary, setMassImportSummary] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const authHeaders = useMemo(() => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (session?.accessToken) {
      headers.Authorization = `Bearer ${session.accessToken}`;
    }
    const tenantId = session?.user.activeTenantId ?? session?.user.tenantId;
    if (tenantId) {
      headers["x-tenant-id"] = tenantId;
    }
    return headers;
  }, [session?.accessToken, session?.user.activeTenantId, session?.user.tenantId]);

  const formTotalAmount = useMemo(
    () => form.items.reduce((sum, item) => sum + calculateItemTotal(item), 0),
    [form.items],
  );

  const listTotalAmount = useMemo(
    () => orders.reduce((sum, item) => sum + Number(item.totalAmount ?? 0), 0),
    [orders],
  );

  const selectedProject = useMemo(
    () => projects.find((item) => item.id === form.projectId) ?? null,
    [form.projectId, projects],
  );

  const historyPageCount = Math.max(1, Math.ceil(historyEntries.length / HISTORY_PAGE_SIZE));
  const pagedHistory = historyEntries.slice((historyPage - 1) * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE);

  function setError(message: string) {
    setFeedback({ type: "error", message });
  }

  function setSuccess(message: string) {
    setFeedback({ type: "success", message });
  }

  function findProjectOption(input: string) {
    const normalizedInput = normalizeSearchText(input);
    const codeToken = normalizeCodeToken(input);
    return projects.find((project) => {
      const label = normalizeSearchText(`${project.code} - ${project.label}`);
      return (
        project.id === input
        || normalizeSearchText(project.code) === normalizedInput
        || label === normalizedInput
        || normalizeCodeToken(project.code) === codeToken
      );
    }) ?? null;
  }

  function findReasonOption(input: string) {
    const normalizedInput = normalizeSearchText(input);
    const codeToken = normalizeCodeToken(input);
    return noProductionReasons.find((reason) => (
      reason.id === input
      || normalizeSearchText(reason.code) === normalizedInput
      || normalizeSearchText(reason.name) === normalizedInput
      || normalizeCodeToken(reason.code) === codeToken
    )) ?? null;
  }

  function findActivityOption(input: string, options = activityOptions) {
    const normalizedInput = normalizeSearchText(input);
    const codeToken = normalizeCodeToken(input.split("-")[0] ?? input);
    return options.find((activity) => {
      const label = normalizeSearchText(`${activity.code} - ${activity.description}`);
      return (
        activity.id === input
        || normalizeSearchText(activity.code) === normalizedInput
        || label === normalizedInput
        || normalizeCodeToken(activity.code) === codeToken
      );
    }) ?? null;
  }

  async function loadMeta() {
    if (!session?.accessToken) return;
    setIsLoadingMeta(true);
    try {
      const response = await fetch("/api/medicao-asbuilt/meta", { headers: authHeaders });
      const payload = (await response.json().catch(() => ({}))) as AsbuiltMeasurementMetaResponse;
      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao carregar metadados.");
      }
      setProjects(payload.projects ?? []);
      setNoProductionReasons(payload.noProductionReasons ?? []);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Falha ao carregar metadados.");
      await logError("Falha ao carregar metadados do medicao-asbuilt", error);
    } finally {
      setIsLoadingMeta(false);
    }
  }

  async function loadOrders(page = pagination.page) {
    if (!session?.accessToken) return;
    setIsLoadingOrders(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(ASBUILT_MEASUREMENT_PAGE_SIZE),
      });
      if (filters.projectId) params.set("projectId", filters.projectId);
      if (filters.status !== "TODOS") params.set("status", filters.status);
      if (filters.asbuiltMeasurementKind !== "TODOS") params.set("asbuiltMeasurementKind", filters.asbuiltMeasurementKind);
      if (filters.noProductionReasonId) params.set("noProductionReasonId", filters.noProductionReasonId);

      const response = await fetch(`/api/medicao-asbuilt?${params.toString()}`, { headers: authHeaders });
      const payload = (await response.json().catch(() => ({}))) as AsbuiltMeasurementListResponse;
      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao carregar medicoes asbuilt.");
      }
      setOrders(payload.orders ?? []);
      setPagination({
        page: payload.pagination?.page ?? page,
        pageSize: payload.pagination?.pageSize ?? ASBUILT_MEASUREMENT_PAGE_SIZE,
        total: payload.pagination?.total ?? 0,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Falha ao carregar medicoes asbuilt.");
      await logError("Falha ao carregar lista de medicao-asbuilt", error, { filters });
    } finally {
      setIsLoadingOrders(false);
    }
  }

  useEffect(() => {
    void loadMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.accessToken]);

  useEffect(() => {
    void loadOrders(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.accessToken, filters]);

  useEffect(() => {
    const query = normalizeText(form.activitySearch);
    if (!session?.accessToken || query.length < 2) {
      setActivityOptions([]);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/medicao-asbuilt/activities/catalog?q=${encodeURIComponent(query)}`, {
          headers: authHeaders,
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => ({}))) as AsbuiltMeasurementCatalogResponse;
        if (response.ok) {
          setActivityOptions(payload.items ?? []);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          await logError("Falha ao pesquisar atividade do medicao-asbuilt", error, { query });
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [authHeaders, form.activitySearch, logError, session?.accessToken]);

  function updateProjectFromInput(value: string) {
    const option = findProjectOption(value);
    setForm((current) => ({
      ...current,
      projectSearch: value,
      projectId: option?.id ?? "",
    }));
  }

  function updateFilterProjectFromInput(value: string) {
    const option = findProjectOption(value);
    setFilterDraft((current) => ({
      ...current,
      projectSearch: value,
      projectId: option?.id ?? "",
    }));
  }

  async function addActivity() {
    const activity = findActivityOption(form.activitySearch) ?? await lookupActivityByCode(form.activitySearch);
    const quantity = parsePositiveDecimal(form.quantity);
    const rate = parsePositiveDecimal(form.rate);
    if (!activity) {
      setError("Selecione uma atividade valida do catalogo.");
      return;
    }
    if (quantity === null) {
      setError("Informe a quantidade da atividade.");
      return;
    }
    if (rate === null) {
      setError("Informe a taxa da atividade.");
      return;
    }
    if (form.items.some((item) => item.activityId === activity.id)) {
      setError("A mesma atividade nao pode ser repetida no medicao-asbuilt.");
      return;
    }

    const nextItem: AsbuiltMeasurementFormItem = {
      rowId: buildRowId(),
      activityId: activity.id,
      code: activity.code,
      description: activity.description,
      unit: activity.unit,
      voicePoint: activity.voicePoint,
      unitValue: activity.unitValue,
      activityIsActive: activity.isActive,
      quantity: String(quantity),
      rate: String(rate),
      observation: form.itemObservation,
    };

    setForm((current) => ({
      ...current,
      activitySearch: "",
      quantity: "",
      rate: "",
      itemObservation: "",
      items: [...current.items, nextItem],
    }));
    setActivityOptions([]);
  }

  function updateRow(rowId: string, field: keyof Pick<AsbuiltMeasurementFormItem, "quantity" | "rate" | "observation">, value: string) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item) => item.rowId === rowId ? { ...item, [field]: value } : item),
    }));
  }

  function removeRow(rowId: string) {
    setForm((current) => ({
      ...current,
      items: current.items.filter((item) => item.rowId !== rowId),
    }));
  }

  function resetForm() {
    setForm(INITIAL_FORM);
    setActivityOptions([]);
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    if (!form.projectId) {
      setError("Selecione um projeto valido.");
      return;
    }
    if (form.asbuiltMeasurementKind === "SEM_PRODUCAO" && !form.noProductionReasonId) {
      setError("Selecione o motivo de sem producao.");
      return;
    }
    if (!form.items.length) {
      setError("Informe ao menos uma atividade com quantidade e taxa.");
      return;
    }

    const items = form.items.map((item) => ({
      activityId: item.activityId,
      quantity: parsePositiveDecimal(item.quantity),
      rate: parsePositiveDecimal(item.rate),
      observation: item.observation,
    }));

    if (items.some((item) => item.quantity === null || item.rate === null)) {
      setError("Revise as quantidades e taxas das atividades.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/medicao-asbuilt", {
        method: form.id ? "PUT" : "POST",
        headers: authHeaders,
        body: JSON.stringify({
          id: form.id,
          projectId: form.projectId,
          asbuiltMeasurementKind: form.asbuiltMeasurementKind,
          noProductionReasonId: form.asbuiltMeasurementKind === "SEM_PRODUCAO" ? form.noProductionReasonId : null,
          notes: form.notes,
          expectedUpdatedAt: form.expectedUpdatedAt,
          items,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as SaveResponse;
      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao salvar medicao-asbuilt.");
      }

      setSuccess(payload.message ?? "Medicao Asbuilt salvo com sucesso.");
      resetForm();
      await loadOrders(1);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Falha ao salvar medicao-asbuilt.");
      await logError("Falha ao salvar medicao-asbuilt", error, { formId: form.id });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function fetchDetail(order: AsbuiltMeasurementListItem) {
    const response = await fetch(`/api/medicao-asbuilt?orderId=${encodeURIComponent(order.id)}`, { headers: authHeaders });
    const payload = (await response.json().catch(() => ({}))) as DetailResponse;
    if (!response.ok || !payload.order) {
      throw new Error(payload.message ?? "Falha ao carregar detalhes do medicao-asbuilt.");
    }
    return payload.order;
  }

  async function openDetail(order: AsbuiltMeasurementListItem) {
    try {
      setDetailOrder(await fetchDetail(order));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Falha ao carregar detalhes.");
      await logError("Falha ao carregar detalhe do medicao-asbuilt", error, { orderId: order.id });
    }
  }

  async function startEdit(order: AsbuiltMeasurementListItem) {
    try {
      const detail = await fetchDetail(order);
      const project = projects.find((item) => item.id === detail.projectId);
      setForm({
        id: detail.id,
        expectedUpdatedAt: detail.updatedAt,
        projectId: detail.projectId,
        projectSearch: project?.code ?? detail.projectCode,
        asbuiltMeasurementKind: detail.asbuiltMeasurementKind,
        noProductionReasonId: detail.noProductionReasonId ?? "",
        notes: detail.notes,
        activitySearch: "",
        quantity: "",
        rate: "",
        itemObservation: "",
        items: detail.items.map((item) => ({
          rowId: buildRowId(),
          activityId: item.activityId,
          code: item.code,
          description: item.description,
          unit: item.unit,
          voicePoint: item.voicePoint,
          unitValue: item.unitValue,
          activityIsActive: item.activityIsActive,
          quantity: String(item.quantity),
          rate: String(item.rate),
          observation: item.observation,
        })),
      });
      document.querySelector("[data-main-content-scroll='true']")?.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Falha ao carregar edicao.");
      await logError("Falha ao iniciar edicao do medicao-asbuilt", error, { orderId: order.id });
    }
  }

  async function openHistory(order: AsbuiltMeasurementListItem) {
    try {
      const response = await fetch(`/api/medicao-asbuilt?historyOrderId=${encodeURIComponent(order.id)}`, { headers: authHeaders });
      const payload = (await response.json().catch(() => ({}))) as HistoryResponse;
      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao carregar historico.");
      }
      setHistoryOrder(order);
      setHistoryEntries(payload.history ?? []);
      setHistoryPage(1);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Falha ao carregar historico.");
      await logError("Falha ao carregar historico do medicao-asbuilt", error, { orderId: order.id });
    }
  }

  async function changeStatus() {
    if (!statusModal) return;
    setIsChangingStatus(true);
    try {
      const response = await fetch("/api/medicao-asbuilt", {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({
          id: statusModal.order.id,
          action: statusModal.action,
          reason: statusReason,
          expectedUpdatedAt: statusModal.order.updatedAt,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as SaveResponse;
      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao alterar status.");
      }
      setSuccess(payload.message ?? "Status atualizado com sucesso.");
      setStatusModal(null);
      setStatusReason("");
      await loadOrders(pagination.page);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Falha ao alterar status.");
      await logError("Falha ao alterar status do medicao-asbuilt", error, {
        orderId: statusModal.order.id,
        action: statusModal.action,
      });
    } finally {
      setIsChangingStatus(false);
    }
  }

  function applyFilters() {
    setFilters(filterDraft);
  }

  function clearFilters() {
    setFilterDraft(INITIAL_FILTERS);
    setFilters(INITIAL_FILTERS);
  }

  async function exportOrders() {
    if (!exportCooldown.tryStart()) {
      setError(`Aguarde ${exportCooldown.getRemainingSeconds()}s para exportar novamente.`);
      return;
    }
    setIsExporting(true);
    try {
      const params = new URLSearchParams({ page: "1", pageSize: "10000" });
      if (filters.projectId) params.set("projectId", filters.projectId);
      if (filters.status !== "TODOS") params.set("status", filters.status);
      if (filters.asbuiltMeasurementKind !== "TODOS") params.set("asbuiltMeasurementKind", filters.asbuiltMeasurementKind);
      if (filters.noProductionReasonId) params.set("noProductionReasonId", filters.noProductionReasonId);
      const response = await fetch(`/api/medicao-asbuilt?${params.toString()}`, { headers: authHeaders });
      const payload = (await response.json().catch(() => ({}))) as AsbuiltMeasurementListResponse;
      if (!response.ok) throw new Error(payload.message ?? "Falha ao exportar medicoes asbuilt.");

      downloadCsv("medicao_asbuilt.csv", [
        ["numero", "projeto", "tipo", "motivo_sem_producao", "status", "itens", "valor_total", "observacao", "atualizado_em"],
        ...(payload.orders ?? []).map((order) => [
          order.asbuiltMeasurementNumber,
          order.projectCode,
          asbuiltMeasurementKindLabel(order.asbuiltMeasurementKind),
          order.noProductionReasonName,
          asbuiltMeasurementStatusLabel(order.status),
          String(order.itemCount),
          String(order.totalAmount).replace(".", ","),
          order.notes,
          formatDateTime(order.updatedAt),
        ]),
      ]);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Falha ao exportar medicoes asbuilt.");
      await logError("Falha ao exportar medicao-asbuilt", error, { filters });
    } finally {
      setIsExporting(false);
    }
  }

  async function exportOrdersDetailed() {
    if (!exportCooldown.tryStart()) {
      setError(`Aguarde ${exportCooldown.getRemainingSeconds()}s para exportar novamente.`);
      return;
    }
    setIsExportingDetails(true);
    try {
      const params = new URLSearchParams({ page: "1", pageSize: "10000" });
      if (filters.projectId) params.set("projectId", filters.projectId);
      if (filters.status !== "TODOS") params.set("status", filters.status);
      if (filters.asbuiltMeasurementKind !== "TODOS") params.set("asbuiltMeasurementKind", filters.asbuiltMeasurementKind);
      if (filters.noProductionReasonId) params.set("noProductionReasonId", filters.noProductionReasonId);
      const response = await fetch(`/api/medicao-asbuilt?${params.toString()}`, { headers: authHeaders });
      const payload = (await response.json().catch(() => ({}))) as AsbuiltMeasurementListResponse;
      if (!response.ok) throw new Error(payload.message ?? "Falha ao exportar detalhamento.");

      const exportOrders = payload.orders ?? [];
      if (!exportOrders.length) {
        throw new Error("Nenhuma medicao asbuilt encontrada para exportar detalhamento.");
      }

      const detailResults = await Promise.allSettled(exportOrders.map((order) => fetchDetail(order)));
      const details = detailResults
        .filter((result): result is PromiseFulfilledResult<AsbuiltMeasurementDetail> => result.status === "fulfilled")
        .map((result) => result.value);
      const failedCount = detailResults.length - details.length;

      if (!details.length) {
        throw new Error("Falha ao carregar detalhes das medicoes asbuilt para exportar.");
      }

      const rows: string[][] = [];
      for (const detail of details) {
        const detailItems = detail.items.length ? detail.items : [{
          id: `${detail.id}-empty`,
          activityId: "",
          code: "",
          description: "",
          unit: "",
          voicePoint: 0,
          unitValue: 0,
          activityIsActive: true,
          quantity: 0,
          rate: 0,
          totalValue: 0,
          observation: "",
        }];

        for (const item of detailItems) {
          rows.push([
            detail.asbuiltMeasurementNumber,
            detail.projectCode,
            asbuiltMeasurementKindLabel(detail.asbuiltMeasurementKind),
            detail.noProductionReasonName || "-",
            asbuiltMeasurementStatusLabel(detail.status),
            item.code || "-",
            item.description || "-",
            item.unit || "-",
            item.activityIsActive ? "Ativa" : "Inativa",
            item.voicePoint ? item.voicePoint.toLocaleString("pt-BR") : "0",
            item.quantity ? item.quantity.toLocaleString("pt-BR") : "0",
            item.rate ? item.rate.toLocaleString("pt-BR") : "0",
            formatCurrency(item.unitValue),
            formatCurrency(item.totalValue),
            item.observation || "-",
            detail.notes || "-",
            formatDateTime(detail.updatedAt),
          ]);
        }
      }

      downloadCsv(`medicao_asbuilt_detalhamento_${toIsoDate(new Date())}.csv`, [
        ["numero", "projeto", "tipo", "motivo_sem_producao", "status", "codigo_atividade", "descricao_atividade", "unidade", "status_atividade", "pontos", "quantidade", "taxa", "valor_unitario", "valor_item", "observacao_item", "observacao_medicao_asbuilt", "atualizado_em"],
        ...rows,
      ]);

      if (failedCount > 0) {
        setSuccess(`Detalhamento exportado com sucesso. ${failedCount} medicoes asbuilt foram ignoradas por falha ao carregar detalhes.`);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Falha ao exportar detalhamento.");
      await logError("Falha ao exportar detalhamento da medicao-asbuilt", error, { filters });
    } finally {
      setIsExportingDetails(false);
    }
  }

  function downloadMassTemplate() {
    downloadCsv("modelo_medicao_asbuilt.csv", [
      [...IMPORT_TEMPLATE_HEADERS],
      ["OBRA-001", "COM_PRODUCAO", "", "ATV001", "10", "1,5", "Atividade faturada"],
      ["OBRA-002", "SEM_PRODUCAO", "GARANTIA_FATURAMENTO_MINIMO", "ATV999", "1", "1", "Garantia minima"],
    ]);
  }

  function downloadMassErrors() {
    downloadCsv("erros_medicao_asbuilt.csv", [
      ["linha", "coluna", "valor", "erro"],
      ...massImportIssues.map((issue) => [String(issue.linha), issue.coluna, issue.valor, issue.erro]),
    ]);
  }

  async function lookupActivityByCode(code: string) {
    const response = await fetch(`/api/medicao-asbuilt/activities/catalog?q=${encodeURIComponent(code)}&includeInactive=true`, { headers: authHeaders });
    const payload = (await response.json().catch(() => ({}))) as AsbuiltMeasurementCatalogResponse;
    if (!response.ok) return null;
    return findActivityOption(code, payload.items ?? []);
  }

  async function importMassFile(file: File) {
    if (!file) return;

    setIsImporting(true);
    setMassImportIssues([]);
    setMassImportSummary(null);

    try {
      const content = await file.text();
      const rows = parseCsvContent(content);
      if (rows.length < 2) {
        setMassImportIssues([{ linha: 1, coluna: "arquivo", valor: file.name, erro: "Arquivo sem linhas de dados." }]);
        return;
      }

      const headerMap = new Map(rows[0].map((header, index) => [normalizeHeaderName(header), index]));
      const missingHeaders = IMPORT_TEMPLATE_HEADERS.filter((header) => !headerMap.has(normalizeHeaderName(header)));
      if (missingHeaders.length) {
        setMassImportIssues(missingHeaders.map((header) => ({ linha: 1, coluna: header, valor: "", erro: "Coluna obrigatoria ausente." })));
        return;
      }

      const issues: AsbuiltMeasurementImportIssue[] = [];
      const groups = new Map<string, MassImportGroup>();

      for (let index = 1; index < rows.length; index += 1) {
        const rowNumber = index + 1;
        const row = rows[index];
        const projectInput = readCsvField(row, headerMap, "projeto");
        const kindInput = readCsvField(row, headerMap, "tipo_medicao_asbuilt");
        const reasonInput = readCsvField(row, headerMap, "motivo_sem_producao");
        const activityInput = readCsvField(row, headerMap, "codigo_atividade");
        const quantityInput = readCsvField(row, headerMap, "quantidade");
        const rateInput = readCsvField(row, headerMap, "taxa");
        const observation = readCsvField(row, headerMap, "observacao");
        const project = findProjectOption(projectInput);
        const asbuiltMeasurementKind = normalizeAsbuiltMeasurementKind(kindInput);
        const reason = asbuiltMeasurementKind === "SEM_PRODUCAO" ? findReasonOption(reasonInput) : null;
        const quantity = parsePositiveDecimal(quantityInput);
        const rate = parsePositiveDecimal(rateInput);

        if (!project) issues.push({ linha: rowNumber, coluna: "projeto", valor: projectInput, erro: "Projeto nao encontrado." });
        if (asbuiltMeasurementKind === "SEM_PRODUCAO" && !reason) issues.push({ linha: rowNumber, coluna: "motivo_sem_producao", valor: reasonInput, erro: "Motivo sem producao nao encontrado." });
        if (!activityInput) issues.push({ linha: rowNumber, coluna: "codigo_atividade", valor: activityInput, erro: "Atividade obrigatoria." });
        if (quantity === null) issues.push({ linha: rowNumber, coluna: "quantidade", valor: quantityInput, erro: "Quantidade invalida." });
        if (rate === null) issues.push({ linha: rowNumber, coluna: "taxa", valor: rateInput, erro: "Taxa invalida." });

        if (!project || (asbuiltMeasurementKind === "SEM_PRODUCAO" && !reason) || !activityInput || quantity === null || rate === null) {
          continue;
        }

        const activity = await lookupActivityByCode(activityInput);
        if (!activity) {
          issues.push({ linha: rowNumber, coluna: "codigo_atividade", valor: activityInput, erro: "Atividade nao encontrada." });
          continue;
        }

        const groupKey = [project.id, asbuiltMeasurementKind, reason?.id ?? "", observation].join("|");
        const group = groups.get(groupKey) ?? {
          rowNumbers: [],
          projectId: project.id,
          asbuiltMeasurementKind,
          noProductionReasonId: reason?.id ?? "",
          notes: observation,
          items: [],
        };

        if (group.items.some((item) => item.activityId === activity.id)) {
          issues.push({ linha: rowNumber, coluna: "codigo_atividade", valor: activityInput, erro: "Atividade duplicada no mesmo medicao-asbuilt." });
          continue;
        }

        group.rowNumbers.push(rowNumber);
        group.items.push({ activityId: activity.id, quantity, rate, observation });
        groups.set(groupKey, group);
      }

      if (groups.size === 0) {
        setMassImportIssues(issues.length ? issues : [{ linha: 0, coluna: "arquivo", valor: file.name, erro: "Nenhuma linha valida para importar." }]);
        return;
      }

      const response = await fetch("/api/medicao-asbuilt", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          action: "BATCH_IMPORT_PARTIAL",
          rows: Array.from(groups.values()),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as AsbuiltMeasurementImportResult;
      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao importar medicao-asbuilt.");
      }

      const apiIssues = (payload.results ?? [])
        .filter((item) => item.success !== true)
        .flatMap((item) => (item.rowNumbers?.length ? item.rowNumbers : [0]).map((rowNumber) => ({
          linha: rowNumber,
          coluna: "salvamento",
          valor: "",
          erro: item.message ?? "Falha ao salvar linha.",
        })));

      const allIssues = [...issues, ...apiIssues];
      setMassImportIssues(allIssues);
      setMassImportSummary(`Ordens salvas: ${payload.savedCount ?? 0}. Linhas com erro: ${allIssues.length}.`);
      await loadOrders(1);
    } catch (error) {
      setMassImportIssues([{ linha: 0, coluna: "arquivo", valor: file.name, erro: error instanceof Error ? error.message : "Falha ao importar arquivo." }]);
      await logError("Falha no cadastro em massa do medicao-asbuilt", error);
    } finally {
      setIsImporting(false);
    }
  }

  async function submitMassImport() {
    if (!massImportFile) {
      setMassImportIssues([{ linha: 0, coluna: "arquivo", valor: "", erro: "Selecione um arquivo CSV para importar." }]);
      return;
    }

    await importMassFile(massImportFile);
  }

  return (
    <section className={styles.wrapper}>
      <article className={`${styles.card} ${form.id ? styles.editingCard : ""}`}>
        <h2 className={styles.cardTitle}>{form.id ? "Editar Medicao Asbuilt" : "Cadastro de Medicao Asbuilt"}</h2>
        <form id="asbuiltMeasurement-form" className={styles.formGrid} onSubmit={submitOrder}>
          <label className={styles.field}>
            <span>Projeto</span>
            <input list="asbuiltMeasurement-projects" value={form.projectSearch} onChange={(event) => updateProjectFromInput(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Tipo de medicao-asbuilt</span>
            <select
              value={form.asbuiltMeasurementKind}
              onChange={(event) => setForm((current) => ({
                ...current,
                asbuiltMeasurementKind: event.target.value as AsbuiltMeasurementKind,
                noProductionReasonId: event.target.value === "SEM_PRODUCAO" ? current.noProductionReasonId : "",
              }))}
            >
              <option value="COM_PRODUCAO">Com producao</option>
              <option value="SEM_PRODUCAO">Sem producao</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Motivo sem producao</span>
            <select
              value={form.noProductionReasonId}
              disabled={form.asbuiltMeasurementKind !== "SEM_PRODUCAO"}
              onChange={(event) => setForm((current) => ({ ...current, noProductionReasonId: event.target.value }))}
            >
              <option value="">Selecione</option>
              {noProductionReasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}
            </select>
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Observacao</span>
            <textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
          </label>
          <div className={styles.formActions}>
            {selectedProject ? <span className={styles.loadingHint}>Projeto selecionado: {selectedProject.code || selectedProject.label}</span> : null}
            {isLoadingMeta ? <span className={styles.loadingHint}>Atualizando dados...</span> : null}
          </div>
        </form>

        <datalist id="asbuiltMeasurement-projects">
          {projects.map((project) => <option key={project.id} value={project.code}>{project.label}</option>)}
        </datalist>
        <datalist id="asbuiltMeasurement-activities">
          {activityOptions.map((activity) => <option key={activity.id} value={`${activity.code} - ${activity.description}`} />)}
        </datalist>

        <div className={styles.subCard}>
          <div className={styles.tableHeader}>
            <h3 className={styles.tableTitle}>Atividades Asbuilt</h3>
            <span className={styles.tableHint}>Informe o codigo da atividade, quantidade e taxa. O valor e calculado por Pontos x Quantidade x Taxa x Valor unitario.</span>
          </div>
          <div className={styles.inlineForm}>
            <label className={styles.field}>
              <span>Atividade</span>
              <input list="asbuiltMeasurement-activities" value={form.activitySearch} onChange={(event) => setForm((current) => ({ ...current, activitySearch: event.target.value }))} />
            </label>
            <label className={`${styles.field} ${styles.compactField}`}>
              <span>Quantidade</span>
              <input value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} placeholder="1" />
            </label>
            <label className={`${styles.field} ${styles.compactField}`}>
              <span>Taxa</span>
              <input value={form.rate} onChange={(event) => setForm((current) => ({ ...current, rate: event.target.value }))} placeholder="1" />
            </label>
            <label className={`${styles.field} ${styles.itemObservationField}`}>
              <span>Observacao do item</span>
              <input value={form.itemObservation} onChange={(event) => setForm((current) => ({ ...current, itemObservation: event.target.value }))} />
            </label>
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={() => void addActivity()}>Adicionar</button>
            </div>
          </div>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Codigo</th>
                  <th>Descricao</th>
                  <th>Unidade</th>
                  <th>Status atividade</th>
                  <th>Pontos</th>
                  <th>Quantidade</th>
                  <th>Taxa</th>
                  <th>Valor unitario</th>
                  <th>Valor</th>
                  <th>Observacao</th>
                  <th>Acao</th>
                </tr>
              </thead>
              <tbody>
                {form.items.length ? form.items.map((item) => (
                  <tr key={item.rowId}>
                    <td>{item.code}</td>
                    <td>{item.description}</td>
                    <td>{item.unit}</td>
                    <td>{item.activityIsActive ? "Ativa" : "Inativa"}</td>
                    <td>{formatDecimal(item.voicePoint)}</td>
                    <td><input className={styles.tableInput} value={item.quantity} onChange={(event) => updateRow(item.rowId, "quantity", event.target.value)} /></td>
                    <td><input className={styles.tableInput} value={item.rate} onChange={(event) => updateRow(item.rowId, "rate", event.target.value)} /></td>
                    <td>{formatCurrency(item.unitValue)}</td>
                    <td>{formatCurrency(calculateItemTotal(item))}</td>
                    <td><input className={styles.tableInput} value={item.observation} onChange={(event) => updateRow(item.rowId, "observation", event.target.value)} /></td>
                    <td><button type="button" className={styles.ghostButton} onClick={() => removeRow(item.rowId)}>Remover</button></td>
                  </tr>
                )) : <tr><td colSpan={11} className={styles.emptyRow}>Nenhuma atividade adicionada.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className={styles.summaryBar}>
            <div><span>Itens</span><strong>{form.items.length}</strong></div>
            <div><span>Valor total</span><strong>{formatCurrency(formTotalAmount)}</strong></div>
          </div>
          <div className={styles.actions}>
            <button type="submit" form="asbuiltMeasurement-form" className={styles.primaryButton} disabled={isSubmitting}>{isSubmitting ? "Salvando..." : "Salvar medicao-asbuilt"}</button>
            {!form.id ? <button type="button" className={styles.secondaryButton} onClick={() => setIsMassImportOpen(true)}>Cadastro em massa</button> : null}
            {form.id ? <button type="button" className={styles.ghostButton} onClick={resetForm}>Cancelar edicao</button> : null}
          </div>
        </div>
        {feedback ? <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>{feedback.message}</div> : null}
      </article>

      <article className={styles.card}>
        <h2 className={styles.cardTitle}>Filtros</h2>
        <div className={styles.filterGrid}>
          <label className={styles.field}><span>Projeto</span><input list="asbuiltMeasurement-projects" value={filterDraft.projectSearch} onChange={(event) => updateFilterProjectFromInput(event.target.value)} /></label>
          <label className={styles.field}><span>Status</span><select value={filterDraft.status} onChange={(event) => setFilterDraft((current) => ({ ...current, status: event.target.value as AsbuiltMeasurementFilters["status"] }))}><option value="TODOS">Todos</option><option value="ABERTA">Aberta</option><option value="FECHADA">Fechada</option><option value="CANCELADA">Cancelada</option></select></label>
          <label className={styles.field}><span>Tipo</span><select value={filterDraft.asbuiltMeasurementKind} onChange={(event) => setFilterDraft((current) => ({ ...current, asbuiltMeasurementKind: event.target.value as AsbuiltMeasurementFilters["asbuiltMeasurementKind"] }))}><option value="TODOS">Todos</option><option value="COM_PRODUCAO">Com producao</option><option value="SEM_PRODUCAO">Sem producao</option></select></label>
          <label className={styles.field}><span>Motivo sem producao</span><select value={filterDraft.noProductionReasonId} onChange={(event) => setFilterDraft((current) => ({ ...current, noProductionReasonId: event.target.value }))}><option value="">Todos</option>{noProductionReasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}</select></label>
        </div>
        <div className={styles.actions}><button type="button" className={styles.primaryButton} onClick={applyFilters}>Aplicar</button><button type="button" className={styles.ghostButton} onClick={clearFilters}>Limpar</button></div>
      </article>

      <article className={styles.card}>
        <div className={styles.tableHeader}>
          <h2 className={styles.cardTitle}>Lista de Medicoes Asbuilt</h2>
          <div className={styles.tableHeaderActions}>
            {isLoadingOrders ? <span className={styles.loadingHint}>Carregando...</span> : null}
            <CsvExportButton onClick={() => void exportOrders()} disabled={isExporting || isExportingDetails || exportCooldown.isCoolingDown || pagination.total <= 0} isLoading={isExporting} className={styles.secondaryButton} />
            <button type="button" className={styles.ghostButton} onClick={() => void exportOrdersDetailed()} disabled={isExportingDetails || isExporting || exportCooldown.isCoolingDown || pagination.total <= 0}>
              {isExportingDetails ? "Gerando..." : "Detalhamento (CSV)"}
            </button>
            <button type="button" className={styles.ghostButton} onClick={() => void loadOrders(pagination.page)} disabled={isLoadingOrders || isExporting || isExportingDetails}>Atualizar lista</button>
          </div>
        </div>
        <div className={styles.summaryBar}>
          <div><span>Medicoes Asbuilt na pagina</span><strong>{orders.length}</strong></div>
          <div><span>Total filtrado</span><strong>{pagination.total}</strong></div>
          <div><span>Valor total</span><strong>{formatCurrency(listTotalAmount)}</strong></div>
        </div>
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Numero</th>
                <th>Projeto</th>
                <th>Tipo</th>
                <th>Motivo</th>
                <th>Itens</th>
                <th>Valor</th>
                <th>Status</th>
                <th>Atualizado em</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {orders.length ? orders.map((order) => (
                <tr key={order.id}>
                  <td>{order.asbuiltMeasurementNumber}</td>
                  <td>{order.projectCode}</td>
                  <td>{asbuiltMeasurementKindLabel(order.asbuiltMeasurementKind)}</td>
                  <td>{order.noProductionReasonName || "-"}</td>
                  <td>{order.itemCount}</td>
                  <td>{formatCurrency(order.totalAmount)}</td>
                  <td><span className={order.status === "ABERTA" ? styles.statusTag : styles.statusTagDanger}>{asbuiltMeasurementStatusLabel(order.status)}</span></td>
                  <td>{formatDateTime(order.updatedAt)}</td>
                  <td className={styles.actionsCell}>
                    <div className={styles.tableActions}>
                      <button type="button" className={`${styles.actionButton} ${styles.actionView}`} title="Detalhes" onClick={() => void openDetail(order)}><ActionIcon name="details" /></button>
                      <button type="button" className={`${styles.actionButton} ${styles.actionHistory}`} title="Historico" onClick={() => void openHistory(order)}><ActionIcon name="history" /></button>
                      {order.status === "ABERTA" ? <button type="button" className={`${styles.actionButton} ${styles.actionEdit}`} title="Editar" onClick={() => void startEdit(order)}><ActionIcon name="edit" /></button> : null}
                      {order.status === "ABERTA" ? <button type="button" className={`${styles.actionButton} ${styles.actionClose}`} title="Fechar" onClick={() => setStatusModal({ order, action: "FECHAR" })}><ActionIcon name="activate" /></button> : null}
                      {order.status === "FECHADA" ? <button type="button" className={`${styles.actionButton} ${styles.actionClose}`} title="Abrir" onClick={() => setStatusModal({ order, action: "ABRIR" })}><ActionIcon name="activate" /></button> : null}
                      {order.status !== "CANCELADA" ? <button type="button" className={`${styles.actionButton} ${styles.actionCancel}`} title="Cancelar" onClick={() => setStatusModal({ order, action: "CANCELAR" })}><ActionIcon name="cancel" /></button> : null}
                    </div>
                  </td>
                </tr>
              )) : <tr><td colSpan={9} className={styles.emptyRow}>{isLoadingOrders ? "Carregando medicoes asbuilt..." : "Nenhum medicao-asbuilt encontrado."}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className={styles.pagination}>
          <span>Pagina {pagination.page} de {Math.max(1, Math.ceil(pagination.total / pagination.pageSize))}</span>
          <div className={styles.paginationActions}>
            <button type="button" className={styles.ghostButton} disabled={pagination.page <= 1} onClick={() => void loadOrders(pagination.page - 1)}>Anterior</button>
            <button type="button" className={styles.ghostButton} disabled={pagination.page >= Math.max(1, Math.ceil(pagination.total / pagination.pageSize))} onClick={() => void loadOrders(pagination.page + 1)}>Proxima</button>
          </div>
        </div>
      </article>

      {detailOrder ? (
        <div className={styles.modalOverlay} onClick={() => setDetailOrder(null)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div><h4>Detalhes do Medicao Asbuilt</h4><p className={styles.modalSubtitle}>ID: {detailOrder.id}</p></div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setDetailOrder(null)}>Fechar</button>
            </header>
            <div className={styles.modalBody}>
              <div className={styles.detailGrid}>
                <div><strong>Numero:</strong> {detailOrder.asbuiltMeasurementNumber}</div>
                <div><strong>Projeto:</strong> {detailOrder.projectCode}</div>
                <div><strong>Status:</strong> {asbuiltMeasurementStatusLabel(detailOrder.status)}</div>
                <div><strong>Tipo:</strong> {asbuiltMeasurementKindLabel(detailOrder.asbuiltMeasurementKind)}</div>
                <div><strong>Motivo:</strong> {detailOrder.noProductionReasonName || "-"}</div>
                <div><strong>Valor total:</strong> {formatCurrency(detailOrder.totalAmount)}</div>
                <div className={styles.detailWide}><strong>Observacao:</strong> {detailOrder.notes || "-"}</div>
              </div>
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead><tr><th>Codigo</th><th>Descricao</th><th>Unidade</th><th>Status atividade</th><th>Pontos</th><th>Quantidade</th><th>Taxa</th><th>Valor unitario</th><th>Valor</th><th>Observacao</th></tr></thead>
                  <tbody>
                    {detailOrder.items.map((item) => <tr key={item.id}><td>{item.code}</td><td>{item.description}</td><td>{item.unit}</td><td>{item.activityIsActive ? "Ativa" : "Inativa"}</td><td>{formatDecimal(item.voicePoint)}</td><td>{formatDecimal(item.quantity)}</td><td>{formatDecimal(item.rate)}</td><td>{formatCurrency(item.unitValue)}</td><td>{formatCurrency(item.totalValue)}</td><td>{item.observation || "-"}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {historyOrder ? (
        <div className={styles.modalOverlay} onClick={() => setHistoryOrder(null)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div><h4>Historico do Medicao Asbuilt</h4><p className={styles.modalSubtitle}>{historyOrder.asbuiltMeasurementNumber}</p></div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setHistoryOrder(null)}>Fechar</button>
            </header>
            <div className={styles.modalBody}>
              {pagedHistory.length ? pagedHistory.map((entry) => (
                <article key={entry.id} className={styles.historyCard}>
                  <div className={styles.historyCardHeader}><strong>{entry.action}</strong><span>{formatDateTime(entry.changedAt)} por {entry.changedByName}</span></div>
                  {entry.reason ? <p className={styles.historyReason}>Motivo: {entry.reason}</p> : null}
                  {Object.entries(entry.changes ?? {}).length
                    ? Object.entries(entry.changes ?? {}).map(([field, value]) => <div key={field}><strong>{HISTORY_FIELD_LABELS[field] ?? field}:</strong> {formatHistoryValue(value)}</div>)
                    : <div className={styles.loadingHint}>Registro criado.</div>}
                </article>
              )) : <div className={styles.emptyRow}>Nenhum historico encontrado.</div>}
              <div className={styles.pagination}>
                <span>Pagina {historyPage} de {historyPageCount}</span>
                <div className={styles.paginationActions}>
                  <button type="button" className={styles.ghostButton} disabled={historyPage <= 1} onClick={() => setHistoryPage((current) => Math.max(1, current - 1))}>Anterior</button>
                  <button type="button" className={styles.ghostButton} disabled={historyPage >= historyPageCount} onClick={() => setHistoryPage((current) => Math.min(historyPageCount, current + 1))}>Proxima</button>
                </div>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {statusModal ? (
        <div className={styles.modalOverlay} onClick={() => setStatusModal(null)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div><h4>{statusModal.action === "FECHAR" ? "Fechar medicao-asbuilt" : statusModal.action === "ABRIR" ? "Abrir medicao-asbuilt" : "Cancelar medicao-asbuilt"}</h4><p className={styles.modalSubtitle}>{statusModal.order.asbuiltMeasurementNumber}</p></div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setStatusModal(null)}>Fechar</button>
            </header>
            <div className={styles.modalBody}>
              {statusModal.action !== "FECHAR" ? <label className={styles.field}><span>Motivo</span><textarea value={statusReason} onChange={(event) => setStatusReason(event.target.value)} /></label> : null}
              <div className={styles.actions}>
                <button type="button" className={styles.ghostButton} onClick={() => setStatusModal(null)} disabled={isChangingStatus}>Cancelar</button>
                <button type="button" className={statusModal.action === "CANCELAR" ? styles.dangerButton : styles.primaryButton} onClick={() => void changeStatus()} disabled={isChangingStatus}>{isChangingStatus ? "Salvando..." : "Confirmar"}</button>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {isMassImportOpen ? (
        <div className={styles.modalOverlay} onClick={() => setIsMassImportOpen(false)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div><h4>Cadastro em massa</h4><p className={styles.modalSubtitle}>Importe um CSV para criar medicoes asbuilt em lote.</p></div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setIsMassImportOpen(false)}>Fechar</button>
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
                <button type="button" className={styles.secondaryButton} onClick={downloadMassTemplate}>Baixar modelo CSV</button>
              </section>
              <section className={styles.importStep}>
                <div className={styles.importStepHeader}>
                  <span className={styles.importStepNumber}>2</span>
                  <div>
                    <strong>Preencha a planilha</strong>
                    <p>Colunas do modelo: projeto, tipo_medicao_asbuilt, motivo_sem_producao, codigo_atividade, quantidade, taxa, observacao. Obrigatorias: projeto, tipo_medicao_asbuilt, codigo_atividade, quantidade e taxa. Motivo e obrigatorio somente em Sem producao.</p>
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
                  <input type="file" accept=".csv,text/csv" onChange={(event) => setMassImportFile(event.target.files?.[0] ?? null)} disabled={isImporting} />
                  <span>{massImportFile ? massImportFile.name : "Clique para selecionar o arquivo CSV"}</span>
                </label>
                <div className={styles.actions}>
                  <button type="button" className={styles.primaryButton} onClick={() => void submitMassImport()} disabled={!massImportFile || isImporting}>
                    {isImporting ? "Importando..." : "Importar planilha"}
                  </button>
                  {massImportIssues.length ? (
                    <button type="button" className={styles.secondaryButton} onClick={downloadMassErrors}>Baixar erros (CSV)</button>
                  ) : null}
                </div>
                {massImportSummary ? <div className={styles.feedbackSuccess}>{massImportSummary}</div> : null}
                {massImportIssues.length ? (
                  <div className={styles.feedbackError}>
                    <strong>Importacao com erros.</strong>
                    <div>{massImportIssues.length} linhas com erro.</div>
                  </div>
                ) : null}
              </section>
            </div>
          </article>
        </div>
      ) : null}
    </section>
  );
}

