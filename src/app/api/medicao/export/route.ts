import { NextRequest, NextResponse } from "next/server";

import { buildCsvContent } from "@/lib/utils/csv";
import { formatDate, formatDateTime } from "@/lib/utils/formatters";
import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { authorizeMeasurementReadOrExportAction } from "@/server/modules/medicao/authorization";
import { fetchMeasurementOrderDetailsForExport } from "@/server/modules/medicao";
import { parseMeasurementOrderListFilters } from "@/server/modules/medicao/normalizers";
import { listMeasurementOrdersPage } from "@/server/modules/medicao/list";

type ExportType = "summary" | "details" | "score";
type MeasurementKind = "COM_PRODUCAO" | "SEM_PRODUCAO";
type ProgrammingMatchStatus = "PROGRAMADA" | "NAO_PROGRAMADA";
type WorkCompletionStatus = string | null;

type OrderItem = {
  id: string;
  orderNumber: string;
  projectCode: string;
  projectServiceCenter: string;
  executionDate: string;
  teamName: string;
  foremanName: string;
  measurementKind: MeasurementKind;
  noProductionReasonName: string;
  programmingMatchStatus: ProgrammingMatchStatus;
  programmingCompletionStatus: WorkCompletionStatus;
  programmingCompletionStatusChangedAfterMeasurement: boolean;
  itemCount: number;
  totalAmount: number;
  status: string;
  updatedAt: string;
  teamTypeName: string;
  scorePoints: number;
  pointTarget: number;
  financialTarget: number;
  hasTeamComposition: boolean;
};

type OrderDetailItem = {
  code: string;
  codeIdd: string;
  description: string;
  unit: string;
  quantity: number;
  mvaQuantity: number | null;
  workedHours: number | null;
  voicePoint: number;
  manualRate: number;
  unitValue: number;
  totalValue: number;
  observation: string;
};

type OrderDetail = {
  id: string;
  orderNumber: string;
  projectId: string | null;
  teamId: string;
  executionDate: string;
  measurementKind: MeasurementKind;
  noProductionReasonName: string;
  programmingMatchStatus: ProgrammingMatchStatus;
  programmingCompletionStatus: WorkCompletionStatus;
  programmingCompletionStatusChangedAfterMeasurement: boolean;
  status: string;
  manualRate: number;
  minimumBillingAmount: number;
  minimumBillingTargetPoints: number;
  minimumBillingUnitValueGroup: string;
  minimumBillingUnitValue: number;
  projectServiceCenter: string;
  updatedAt: string;
  notes: string;
  items: OrderDetailItem[];
};

type WorkCompletionCatalogRow = {
  code: string;
  label_pt: string | null;
};

const EXPORT_PAGE_SIZE = 500;

function normalizeExportType(value: string | null): ExportType | null {
  if (value === "summary" || value === "details" || value === "score") {
    return value;
  }
  return null;
}

function toIsoDate(value: Date) {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDecimal(value: number, digits = 2) {
  return Number(value ?? 0).toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatMoneyCsvValue(value: number, digits = 2) {
  const numericValue = Number(value ?? 0);
  return (Number.isFinite(numericValue) ? numericValue : 0).toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  });
}

function measurementKindLabel(value: MeasurementKind) {
  return value === "SEM_PRODUCAO" ? "Sem producao" : "Com producao";
}

function programmingMatchLabel(status: ProgrammingMatchStatus) {
  return status === "PROGRAMADA" ? "Programada" : "Nao programada";
}

function normalizeWorkCompletionCodeToken(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function workCompletionStatusLabel(status: WorkCompletionStatus, labelMap: Map<string, string>) {
  const normalized = normalizeWorkCompletionCodeToken(status);
  if (!normalized) return "-";
  return labelMap.get(normalized) ?? normalized;
}

function executionStatusLabel(
  order: Pick<OrderItem | OrderDetail, "programmingCompletionStatus" | "programmingCompletionStatusChangedAfterMeasurement">,
  labelMap: Map<string, string>,
) {
  const label = workCompletionStatusLabel(order.programmingCompletionStatus, labelMap);
  return order.programmingCompletionStatusChangedAfterMeasurement
    ? `${label} (Atualizado apos medicao)`
    : label;
}

function getFilename(type: ExportType) {
  const today = toIsoDate(new Date());
  if (type === "details") return `ordens_medicao_detalhamento_${today}.csv`;
  if (type === "score") return `ordens_medicao_pontuacao_${today}.csv`;
  return `ordens_medicao_${today}.csv`;
}

// Carrega todas as ordens que batem no filtro, pagina a pagina.
//
// O laco de paginas foi mantido de proposito: o pipeline aplica tres filtros em
// memoria DEPOIS da pagina do banco, e `total` e aproximado por causa disso.
// Buscar tudo numa consulta so mudaria a semantica. O que sumiu foi o HTTP: antes
// cada pagina forjava um NextRequest e chamava GET /api/medicao, refazendo
// resolucao de sessao a cada volta.
async function loadOrdersForExport(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  searchParams: URLSearchParams;
}) {
  const parsed = parseMeasurementOrderListFilters(params.searchParams);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }

  const orders: OrderItem[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const result = await listMeasurementOrdersPage({
      supabase: params.supabase,
      tenantId: params.tenantId,
      ...parsed.filters,
      page,
      pageSize: EXPORT_PAGE_SIZE,
    });

    if (!result.ok) {
      throw new Error(result.message);
    }

    orders.push(...(result.orders as OrderItem[]));
    const total = result.total || orders.length;
    totalPages = Math.max(1, Math.ceil(total / EXPORT_PAGE_SIZE));
    page += 1;
  } while (page <= totalPages);

  return orders;
}

async function fetchWorkCompletionLabelMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
}) {
  const { data, error } = await params.supabase
    .from("programming_work_completion_catalog")
    .select("code, label_pt")
    .eq("tenant_id", params.tenantId)
    .eq("is_active", true)
    .returns<WorkCompletionCatalogRow[]>();

  if (error) {
    return new Map<string, string>();
  }

  return new Map(
    (data ?? []).map((item) => {
      const code = normalizeWorkCompletionCodeToken(item.code);
      const label = String(item.label_pt ?? "").trim() || code;
      return [code, label] as const;
    }),
  );
}

function buildSummaryCsv(orders: OrderItem[], labelMap: Map<string, string>) {
  return buildCsvContent(
    [
      "Ordem",
      "Projeto",
      "Centro de Servicos",
      "Data execucao",
      "Equipe",
      "Composicao equipe",
      "Encarregado",
      "Tipo da medicao",
      "Motivo sem producao",
      "Programacao",
      "Status execucao",
      "Itens",
      "Valor total (R$)",
      "Status",
      "Atualizado em",
    ],
    orders.map((order) => [
      order.orderNumber,
      order.projectCode || "Sem projeto",
      order.projectServiceCenter || "Sem base",
      formatDate(order.executionDate),
      order.teamName,
      order.hasTeamComposition ? "Sim" : "Nao",
      order.foremanName || "-",
      measurementKindLabel(order.measurementKind),
      order.noProductionReasonName || "-",
      programmingMatchLabel(order.programmingMatchStatus),
      executionStatusLabel(order, labelMap),
      String(order.itemCount),
      formatMoneyCsvValue(Number(order.totalAmount ?? 0)),
      order.status,
      formatDateTime(order.updatedAt),
    ]),
  );
}

async function buildDetailsCsv(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  windowEndDate: string | null;
  orders: OrderItem[];
  labelMap: Map<string, string>;
}) {
  const { orders, labelMap } = params;
  // Uma passada para todas as ordens, em vez de uma chamada HTTP interna por ordem.
  const details = (await fetchMeasurementOrderDetailsForExport({
    supabase: params.supabase,
    tenantId: params.tenantId,
    orderIds: orders.map((order) => order.id),
    windowEndDate: params.windowEndDate,
  })) as OrderDetail[];

  const orderMap = new Map(orders.map((order) => [order.id, order]));
  const rows = details.flatMap((detail) => {
    const summary = orderMap.get(detail.id);
    const detailItems = detail.items.length ? detail.items : [{
      code: "",
      codeIdd: "",
      description: detail.minimumBillingAmount > 0 ? "Garantia de faturamento minimo" : "",
      unit: detail.minimumBillingAmount > 0 ? detail.minimumBillingUnitValueGroup : "",
      quantity: detail.minimumBillingAmount > 0 ? 1 : 0,
      mvaQuantity: null,
      workedHours: null,
      voicePoint: detail.minimumBillingTargetPoints,
      manualRate: detail.manualRate,
      unitValue: detail.minimumBillingUnitValue,
      totalValue: detail.minimumBillingAmount,
      observation: "",
    }];

    return detailItems.map((item, itemIndex) => {
      const itemRate = item.manualRate || detail.manualRate;
      const totalItem = item.totalValue || (item.voicePoint * item.quantity * itemRate * item.unitValue);
      const observation = itemIndex === 0 ? (detail.notes || item.observation || "-") : "-";
      return [
        detail.orderNumber,
        summary?.projectCode || detail.projectId || "Sem projeto",
        summary?.projectServiceCenter ?? detail.projectServiceCenter ?? "Sem base",
        formatDate(detail.executionDate),
        summary?.teamName ?? detail.teamId,
        summary?.foremanName || "-",
        measurementKindLabel(detail.measurementKind),
        detail.noProductionReasonName || "-",
        programmingMatchLabel(detail.programmingMatchStatus),
        executionStatusLabel(detail, labelMap),
        detail.status,
        item.code || "-",
        item.codeIdd || "-",
        item.description || "-",
        item.unit || "-",
        item.voicePoint ? item.voicePoint.toLocaleString("pt-BR") : "0",
        item.mvaQuantity ? item.mvaQuantity.toLocaleString("pt-BR") : "-",
        item.workedHours ? item.workedHours.toLocaleString("pt-BR") : "-",
        item.quantity ? item.quantity.toLocaleString("pt-BR") : "0",
        itemRate.toLocaleString("pt-BR"),
        formatMoneyCsvValue(item.unitValue),
        formatMoneyCsvValue(totalItem),
        observation,
        formatDateTime(detail.updatedAt),
      ];
    });
  });

  return buildCsvContent(
    [
      "Ordem",
      "Projeto",
      "Centro de Servicos",
      "Data execucao",
      "Equipe",
      "Encarregado",
      "Tipo da medicao",
      "Motivo sem producao",
      "Programacao",
      "Status execucao",
      "Status ordem",
      "Codigo atividade",
      "Codigo IDD",
      "Descricao atividade",
      "Unidade",
      "Pontos",
      "MVA",
      "Horas",
      "Quantidade",
      "Taxa manual",
      "Valor unitario (R$)",
      "Total item (R$)",
      "Observacao",
      "Atualizado em",
    ],
    rows,
  );
}

function buildScoreCsv(orders: OrderItem[]) {
  return buildCsvContent(
    ["Tipo", "Nome", "Data", "Projeto", "Pontos", "Valor (R$)", "Status", "Compensatorio"],
    orders.map((order) => {
      const points = Number(order.scorePoints ?? 0);
      const pointTarget = Number(order.pointTarget ?? 0);
      const financialTarget = Number(order.financialTarget ?? 0);
      const totalAmount = Number(order.totalAmount ?? 0);
      const scoreStatus = pointTarget > 0 && points >= pointTarget ? "Superou Ponto" : "Nao Superou Ponto";
      const compensatory = financialTarget > 0 && totalAmount >= financialTarget ? "NAO" : "SIM";
      return [
        order.teamTypeName || "Nao identificado",
        order.foremanName || order.teamName || "Nao identificado",
        formatDate(order.executionDate),
        order.projectCode || "Sem projeto",
        formatDecimal(points),
        formatMoneyCsvValue(totalAmount),
        scoreStatus,
        compensatory,
      ];
    }),
  );
}

function csvResponse(csv: string, filename: string, request: NextRequest) {
  const size = Buffer.byteLength(csv);
  if (size > 102_400) {
    console.warn(`[EGRESS] ${request.nextUrl.pathname} -> ${(size / 1024).toFixed(1)}KB`);
  }

  return new NextResponse(csv, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "text/csv; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para exportar ordens de medicao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizeMeasurementReadOrExportAction(resolution, "export");
  if (authorizationError) {
    return authorizationError;
  }

  const exportType = normalizeExportType(request.nextUrl.searchParams.get("type") ?? request.nextUrl.searchParams.get("kind"));
  if (!exportType) {
    return NextResponse.json({ message: "Tipo de exportacao invalido." }, { status: 400 });
  }

  try {
    const orders = await loadOrdersForExport({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      searchParams: request.nextUrl.searchParams,
    });
    if (!orders.length) {
      return NextResponse.json({ message: "Nenhuma ordem encontrada para exportar com os filtros atuais." }, { status: 404 });
    }

    const workCompletionLabelMap = await fetchWorkCompletionLabelMap({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
    });

    const csv = exportType === "details"
      ? await buildDetailsCsv({
          supabase: resolution.supabase,
          tenantId: resolution.appUser.tenant_id,
          windowEndDate: request.nextUrl.searchParams.get("endDate"),
          orders,
          labelMap: workCompletionLabelMap,
        })
      : exportType === "score"
        ? buildScoreCsv(orders)
        : buildSummaryCsv(orders, workCompletionLabelMap);

    return csvResponse(csv, getFilename(exportType), request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao exportar ordens de medicao.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
