import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";

type ProjectRow = {
  id: string;
  sob: string | null;
  service_center: string | null;
  service_center_text: string | null;
  service_type: string | null;
  service_type_text: string | null;
  is_active: boolean | null;
  is_test?: boolean | null;
  is_withdrawn?: boolean | null;
  is_third_party?: boolean | null;
};

type ActivityRow = {
  id: string;
  ativo: boolean | null;
};

type ActivityCategoryRow = {
  id: string;
  type_service: string | null;
};

type TypeServiceRow = {
  id: string;
  name: string | null;
};

type WorkCompletionCatalogRow = {
  code: string;
  label_pt: string | null;
  sort_order: number | null;
};

type ProgrammingWorkCompletionRow = {
  project_id: string;
  work_completion_status: string | null;
  execution_date: string | null;
  updated_at: string | null;
};

type OrderIdRow = {
  id: string;
};

type OrderProjectRow = {
  id: string;
  project_id: string;
  ingresso_date?: string | null;
};

type MeasurementOrderProjectRow = OrderProjectRow & {
  execution_date: string | null;
  manual_rate: number | string | null;
};

type AsbuiltOrderProjectRow = OrderProjectRow & {
  service_coverage_end_date: string | null;
  updated_at: string | null;
};

type MeasurementItemRow = {
  measurement_order_id?: string;
  service_activity_id: string;
  activity_code: string;
  activity_description: string;
  activity_unit: string;
  quantity: number | string;
  rate?: number | string;
  voice_point?: number | string | null;
  manual_rate?: number | string | null;
  unit_value?: number | string | null;
  total_value?: number | string | null;
};

type CommercialItemRow = MeasurementItemRow & {
  activity_active_snapshot?: boolean | null;
  asbuilt_measurement_order_id?: string | null;
  billing_order_id?: string | null;
};

type OriginKey = "measurement" | "asbuilt" | "billing";
type ActivityStatusFilter = "TODAS" | "ATIVA" | "INATIVA";

type OriginTotals = {
  quantity: number;
  value: number;
  itemCount: number;
};

type AggregatedRow = {
  code: string;
  description: string;
  unit: string;
  activityStatus: "ATIVA" | "INATIVA" | "NAO_IDENTIFICADA";
  measurement: OriginTotals;
  asbuilt: OriginTotals;
  billing: OriginTotals;
  quantityDiffAsbuiltMeasurement: number;
  quantityDiffBillingMeasurement: number;
  valueDiffAsbuiltMeasurement: number;
  valueDiffBillingMeasurement: number;
  hasMeasurement: boolean;
  hasAsbuilt: boolean;
  hasBilling: boolean;
  isMissingInAnyBase: boolean;
  isDivergent: boolean;
  situation: string;
  activityIds: Set<string>;
  activeSignals: Set<boolean>;
};

type DashboardRow = Omit<AggregatedRow, "activityIds" | "activeSignals">;

type BillingCategoryRow = {
  categoryId: string;
  categoryName: string;
  quantity: number;
  value: number;
  itemCount: number;
  codes: string[];
};

type CategoryColumn = {
  categoryId: string;
  categoryName: string;
};

type CategoryTotals = OriginTotals & {
  codes: string[];
};

type CategorySummaryRow = {
  origin: OriginKey;
  label: string;
  totalQuantity: number;
  totalValue: number;
  categories: Record<string, CategoryTotals>;
};

type ChartItem = {
  key: string;
  label: string;
  value: number;
  projectCount: number;
  measurementCount: number;
  segments?: ChartSegment[];
};

type ChartSegment = {
  key: string;
  label: string;
  value: number;
};

type AsbuiltCoverageRange = {
  startDate: string | null;
  endDate: string | null;
};

type DateRange = {
  startDate: string;
  endDate: string;
};

type ChartIndicatorKey = "totalMeasurement" | "measurementAsbuilt" | "asbuilt" | "billing";

type ChartProjectDetailRow = {
  projectId: string;
  projectCode: string;
  serviceCenter: string;
  value: number;
  orderCount: number;
  rate: number | null;
  asbuiltFaixaEnd: string | null;
};

type AsbuiltBreakdownRow = {
  projectId: string;
  projectCode: string;
  serviceCenterId: string | null;
  serviceCenter: string;
  coverageStartDate: string | null;
  coverageEndDate: string | null;
  value: number;
  itemCount: number;
};

type OperationalCategoryMetric = {
  quantity: number;
  value: number;
  itemCount: number;
};

type OperationalMeasurementCategoryCard = {
  key: string;
  label: string;
  categoryName: string;
  categoryNames?: readonly string[];
  categoryPrefixes?: readonly string[];
  measurement: OperationalCategoryMetric;
  measurementAsbuilt: OperationalCategoryMetric;
  asbuilt: OperationalCategoryMetric;
  billing: OperationalCategoryMetric;
};

type OperationalMeasurementCategoryDetailRow = {
  projectId: string;
  projectCode: string;
  serviceCenter: string;
  executionDate: string | null;
  rate: number;
  measurementQuantity: number;
  measurementValue: number;
  orderCount: number;
};

type OperationalAsbuiltCategoryDetailRow = {
  projectId: string;
  projectCode: string;
  serviceCenter: string;
  coverageStartDate: string | null;
  coverageEndDate: string | null;
  rate: number;
  asbuiltQuantity: number;
  asbuiltValue: number;
  itemCount: number;
};

type OperationalBillingCategoryDetailRow = {
  projectId: string;
  projectCode: string;
  serviceCenter: string;
  rate: number;
  billingQuantity: number;
  billingValue: number;
  orderCount: number;
  itemCount: number;
};

type OperationalAverageTickets = {
  measurementByProject: number;
  measurementByService: number;
  asbuiltByProject: number;
  asbuiltByService: number;
};

type OperationalMeasurementIndicators = {
  categoryCards: OperationalMeasurementCategoryCard[];
  averageTickets: OperationalAverageTickets;
};

type ProjectValueRow = {
  projectId: string;
  projectCode: string;
  serviceCenterId: string | null;
  serviceCenter: string;
  workCompletionStatus: string;
  workCompletionStatusLabel: string;
  serviceTypeId: string | null;
  serviceTypeName: string;
  measurementValue: number;
  asbuiltValue: number;
  billingValue: number;
  asbuiltMeasurementDiff: number;
  billingAsbuiltDiff: number;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeUuid(value: unknown) {
  const normalized = normalizeText(value);
  return /^[0-9a-f-]{36}$/i.test(normalized) ? normalized : null;
}

function normalizeBoolean(value: unknown) {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "sim" || normalized === "yes";
}

function normalizeIsoDate(value: unknown) {
  const normalized = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeMonth(value: unknown) {
  const normalized = normalizeText(value);
  return /^\d{4}-\d{2}$/.test(normalized) ? normalized : null;
}

function buildMonthRange(month: string | null): DateRange | null {
  if (!month) return null;
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 1 || monthIndex > 12) return null;
  const endDate = new Date(Date.UTC(year, monthIndex, 0));
  return {
    startDate: `${month}-01`,
    endDate: endDate.toISOString().slice(0, 10),
  };
}

function formatDateLabel(value: string | null) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function normalizeActivityStatusFilter(value: unknown): ActivityStatusFilter {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === "ATIVA" || normalized === "INATIVA") return normalized;
  return "TODAS";
}

function normalizeCode(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function normalizeCategoryName(value: unknown) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function normalizeStatusCatalogCode(value: unknown) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function itemTotalValue(item: MeasurementItemRow | CommercialItemRow) {
  if (item.total_value !== null && item.total_value !== undefined) {
    return numberValue(item.total_value);
  }

  return (
    numberValue(item.voice_point) *
    numberValue(item.quantity) *
    numberValue(item.manual_rate) *
    numberValue(item.unit_value)
  );
}

function normalizeMeasurementItemRow(item: MeasurementItemRow): MeasurementItemRow {
  if (item.total_value !== null && item.total_value !== undefined) return item;
  return { ...item, total_value: itemTotalValue(item) };
}

function normalizeRateFilter(value: unknown) {
  const normalized = normalizeText(value).replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function itemMatchesRate(value: unknown, rateFilter: number | null | undefined) {
  if (rateFilter === null || rateFilter === undefined) return true;
  return nearlyEqual(numberValue(value), rateFilter, 0.0001);
}

function emptyTotals(): OriginTotals {
  return { quantity: 0, value: 0, itemCount: 0 };
}

function emptyCategoryTotals(): CategoryTotals {
  return { quantity: 0, value: 0, itemCount: 0, codes: [] };
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

const OPERATIONAL_MEASUREMENT_CATEGORIES = [
  { key: "installed-poles", label: "Postes instalados", categoryName: "POSTE (INSTALADO)" },
  { key: "installed-network", label: "Rede instalada", categoryName: "CONDUTOR (REDE INSTALADO)" },
  { key: "installed-equipment", label: "Equipamentos instalados", categoryName: "EQUIPAMENTO (INSTALADO)" },
  { key: "installed-transformers", label: "Transformadores instalados", categoryName: "TRANSFORMADOR (INSTALADO)" },
  { key: "installed-crossarms", label: "Cruzetas instaladas", categoryName: "CRUZETA (INSTALADO)" },
  { key: "installed-structures", label: "Estruturas instaladas", categoryName: "ESTRUTURA (INSTALADO)" },
  { key: "pruning", label: "Poda", categoryName: "PODA", categoryNames: ["PODA"], categoryPrefixes: ["PODA"] },
  { key: "dragging", label: "Arrasto", categoryName: "ARRASTO", categoryNames: ["ARRASTO"], categoryPrefixes: ["ARRASTO"] },
  { key: "removed-poles", label: "Postes retirados", categoryName: "POSTE (RETIRADO)" },
  { key: "removed-network", label: "Rede retirada", categoryName: "CONDUTOR (REDE RETIRADO)" },
  { key: "removed-equipment", label: "Equipamentos retirados", categoryName: "EQUIPAMENTO (RETIRADO)" },
  { key: "removed-transformers", label: "Transformadores retirados", categoryName: "TRANSFORMADOR (RETIRADO)" },
  { key: "removed-crossarms", label: "Cruzetas retiradas", categoryName: "CRUZETA (RETIRADO)" },
  { key: "removed-structures", label: "Estruturas retiradas", categoryName: "ESTRUTURA (RETIRADO)" },
] as const;

type OperationalMeasurementCategoryDefinition = (typeof OPERATIONAL_MEASUREMENT_CATEGORIES)[number];

function matchesOperationalCategory(category: OperationalMeasurementCategoryDefinition, categoryName: string) {
  const normalizedName = normalizeCategoryName(categoryName);
  if (!normalizedName) return false;

  const exactNames = "categoryNames" in category && category.categoryNames ? category.categoryNames : [category.categoryName];
  if (exactNames.some((name) => normalizeCategoryName(name) === normalizedName)) return true;

  const prefixes = "categoryPrefixes" in category && category.categoryPrefixes ? category.categoryPrefixes : [];
  return prefixes.some((prefix) => normalizedName.startsWith(normalizeCategoryName(prefix)));
}

const QUERY_PAGE_SIZE = 1000;
const FILTER_CHUNK_SIZE = 100;

function createRow(code: string): AggregatedRow {
  return {
    code,
    description: "",
    unit: "",
    activityStatus: "NAO_IDENTIFICADA",
    measurement: emptyTotals(),
    asbuilt: emptyTotals(),
    billing: emptyTotals(),
    quantityDiffAsbuiltMeasurement: 0,
    quantityDiffBillingMeasurement: 0,
    valueDiffAsbuiltMeasurement: 0,
    valueDiffBillingMeasurement: 0,
    hasMeasurement: false,
    hasAsbuilt: false,
    hasBilling: false,
    isMissingInAnyBase: false,
    isDivergent: false,
    situation: "",
    activityIds: new Set<string>(),
    activeSignals: new Set<boolean>(),
  };
}

async function ensureDashPageAccess(resolution: AuthenticatedAppUserContext) {
  if (resolution.role.isAdmin) return true;

  const userPermission = await resolution.supabase
    .from("app_user_page_permissions")
    .select("can_access")
    .eq("tenant_id", resolution.appUser.tenant_id)
    .eq("user_id", resolution.appUser.id)
    .eq("page_key", "dash-operacional-faturamento")
    .maybeSingle<{ can_access: boolean }>();

  if (!userPermission.error && userPermission.data) {
    return Boolean(userPermission.data.can_access);
  }

  if (!resolution.appUser.role_id) return false;

  const rolePermission = await resolution.supabase
    .from("role_page_permissions")
    .select("can_access")
    .eq("tenant_id", resolution.appUser.tenant_id)
    .eq("role_id", resolution.appUser.role_id)
    .eq("page_key", "dash-operacional-faturamento")
    .maybeSingle<{ can_access: boolean }>();

  return !rolePermission.error && Boolean(rolePermission.data?.can_access);
}

async function resolveDashContext(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar Dash operacional e faturamento.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) return resolution;

  const canAccess = await ensureDashPageAccess(resolution);
  if (!canAccess) {
    return {
      error: {
        status: 403,
        message: "Acesso negado para carregar Dash operacional e faturamento.",
      },
    };
  }

  return resolution;
}

async function loadProjects(supabase: AuthenticatedAppUserContext["supabase"], tenantId: string) {
  const rows: ProjectRow[] = [];

  for (let from = 0; ; from += QUERY_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("project_with_labels")
      .select("id, sob, service_center, service_center_text, service_type, service_type_text, is_active, is_test, is_withdrawn, is_third_party")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("sob", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + QUERY_PAGE_SIZE - 1)
      .returns<ProjectRow[]>();

    if (error) {
      throw new Error("Falha ao carregar projetos do dashboard.");
    }

    rows.push(...(data ?? []));
    if ((data ?? []).length < QUERY_PAGE_SIZE) break;
  }

  return rows
    .filter((project) => !project.is_test && !project.is_withdrawn && !project.is_third_party)
    .map((project) => ({
      id: project.id,
      label: normalizeText(project.sob) || project.id,
      serviceCenterId: project.service_center,
      serviceCenter: normalizeText(project.service_center_text) || "Nao identificado",
      serviceTypeId: project.service_type,
      serviceType: normalizeText(project.service_type_text) || "Nao identificado",
    }));
}

async function loadOrderIds(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  table: "project_measurement_orders" | "project_asbuilt_measurement_orders" | "project_billing_orders";
  projectId: string;
}) {
  if (params.table === "project_asbuilt_measurement_orders") {
    const orders = await loadClosedAsbuiltOrderRows({
      supabase: params.supabase,
      tenantId: params.tenantId,
      projectIds: [params.projectId],
    });
    return orders.map((item) => item.id);
  }

  let query = params.supabase
    .from(params.table)
    .select("id")
    .eq("tenant_id", params.tenantId)
    .eq("project_id", params.projectId)
    .eq("is_active", true)
    .neq("status", "CANCELADA")
    .limit(5000);

  if (params.table === "project_measurement_orders") {
    query = query.eq("measurement_kind", "COM_PRODUCAO");
  }

  const { data, error } = await query.returns<OrderIdRow[]>();
  if (error) {
    throw new Error("Falha ao carregar ordens do dashboard.");
  }

  return (data ?? []).map((item) => item.id);
}

async function loadOrderProjectRows(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  table: "project_measurement_orders" | "project_asbuilt_measurement_orders" | "project_billing_orders";
  projectIds: string[];
  dateRange?: DateRange | null;
}) {
  if (params.table === "project_asbuilt_measurement_orders") {
    return loadClosedAsbuiltOrderRows({
      supabase: params.supabase,
      tenantId: params.tenantId,
      projectIds: params.projectIds,
    });
  }

  const rows: OrderProjectRow[] = [];
  const projectIds = Array.from(new Set(params.projectIds.filter(Boolean)));

  for (const projectIdChunk of chunk(projectIds, FILTER_CHUNK_SIZE)) {
    for (let from = 0; ; from += QUERY_PAGE_SIZE) {
      const selectColumns = params.table === "project_billing_orders"
        ? "id, project_id, ingresso_date"
        : "id, project_id";
      let query = params.supabase
        .from(params.table)
        .select(selectColumns)
        .eq("tenant_id", params.tenantId)
        .eq("is_active", true)
        .neq("status", "CANCELADA")
        .in("project_id", projectIdChunk)
        .order("id", { ascending: true })
        .range(from, from + QUERY_PAGE_SIZE - 1);

      if (params.table === "project_measurement_orders") {
        query = query.eq("measurement_kind", "COM_PRODUCAO");
      }

      if (params.dateRange && params.table === "project_billing_orders") {
        query = query
          .gte("ingresso_date", params.dateRange.startDate)
          .lte("ingresso_date", params.dateRange.endDate);
      }

      const { data, error } = await query.returns<OrderProjectRow[]>();
      if (error) {
        throw new Error("Falha ao carregar ordens do grafico.");
      }

      rows.push(...(data ?? []));
      if ((data ?? []).length < QUERY_PAGE_SIZE) break;
    }
  }

  return rows;
}

async function loadClosedAsbuiltOrderRows(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projectIds: string[];
  coverageEndDate?: string | null;
  coverageDateMode?: "exact" | "through";
  dateRange?: DateRange | null;
}) {
  const rows: AsbuiltOrderProjectRow[] = [];
  const projectIds = Array.from(new Set(params.projectIds.filter(Boolean)));

  for (const projectIdChunk of chunk(projectIds, FILTER_CHUNK_SIZE)) {
    for (let from = 0; ; from += QUERY_PAGE_SIZE) {
      let query = params.supabase
        .from("project_asbuilt_measurement_orders")
        .select("id, project_id, service_coverage_end_date, updated_at")
        .eq("tenant_id", params.tenantId)
        .eq("is_active", true)
        .eq("status", "FECHADA")
        .in("project_id", projectIdChunk);

      if (params.coverageEndDate && params.coverageDateMode === "through") {
        query = query.lte("service_coverage_end_date", params.coverageEndDate);
      } else if (params.coverageEndDate) {
        query = query.eq("service_coverage_end_date", params.coverageEndDate);
      }

      if (params.dateRange) {
        query = query
          .gte("service_coverage_end_date", params.dateRange.startDate)
          .lte("service_coverage_end_date", params.dateRange.endDate);
      }

      const { data, error } = await query
        .order("project_id", { ascending: true })
        .order("service_coverage_end_date", { ascending: true, nullsFirst: false })
        .order("updated_at", { ascending: true })
        .range(from, from + QUERY_PAGE_SIZE - 1)
        .returns<AsbuiltOrderProjectRow[]>();

      if (error) {
        throw new Error("Falha ao carregar os cortes fechados de Asbuilt por projeto.");
      }

      rows.push(...(data ?? []));
      if ((data ?? []).length < QUERY_PAGE_SIZE) break;
    }
  }

  return rows;
}

async function loadMeasurementItems(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  orderIds: string[];
}) {
  const rows: MeasurementItemRow[] = [];
  for (const ids of chunk(params.orderIds, FILTER_CHUNK_SIZE)) {
    for (let from = 0; ; from += QUERY_PAGE_SIZE) {
      const buildQuery = (selectColumns: string) => params.supabase
        .from("project_measurement_order_items")
        .select(selectColumns)
        .eq("tenant_id", params.tenantId)
        .eq("is_active", true)
        .in("measurement_order_id", ids)
        .order("id", { ascending: true })
        .range(from, from + QUERY_PAGE_SIZE - 1);

      let { data, error } = await buildQuery(
        "measurement_order_id, service_activity_id, activity_code, activity_description, activity_unit, quantity, total_value",
      )
        .returns<MeasurementItemRow[]>();

      if (error) {
        const fallback = await buildQuery(
          "measurement_order_id, service_activity_id, activity_code, activity_description, activity_unit, quantity, voice_point, manual_rate, unit_value",
        )
          .returns<MeasurementItemRow[]>();

        data = fallback.data;
        error = fallback.error;
      }

      if (error) {
        throw new Error(`Falha ao carregar itens da Medicao: ${error.message}`);
      }

      rows.push(...(data ?? []).map(normalizeMeasurementItemRow));
      if ((data ?? []).length < QUERY_PAGE_SIZE) break;
    }
  }
  return rows;
}

async function loadMeasurementOrderRows(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projectIds: string[];
  dateRange?: DateRange | null;
}) {
  const rows: MeasurementOrderProjectRow[] = [];
  const projectIds = Array.from(new Set(params.projectIds.filter(Boolean)));

  for (const projectIdChunk of chunk(projectIds, FILTER_CHUNK_SIZE)) {
    for (let from = 0; ; from += QUERY_PAGE_SIZE) {
      let query = params.supabase
        .from("project_measurement_orders")
        .select("id, project_id, execution_date, manual_rate")
        .eq("tenant_id", params.tenantId)
        .eq("is_active", true)
        .neq("status", "CANCELADA")
        .eq("measurement_kind", "COM_PRODUCAO")
        .in("project_id", projectIdChunk);

      if (params.dateRange) {
        query = query
          .gte("execution_date", params.dateRange.startDate)
          .lte("execution_date", params.dateRange.endDate);
      }

      const { data, error } = await query
        .order("execution_date", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true })
        .range(from, from + QUERY_PAGE_SIZE - 1)
        .returns<MeasurementOrderProjectRow[]>();

      if (error) {
        throw new Error("Falha ao carregar ordens detalhadas da Medicao.");
      }

      rows.push(...(data ?? []));
      if ((data ?? []).length < QUERY_PAGE_SIZE) break;
    }
  }

  return rows;
}

async function loadCommercialItems(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  table: "project_asbuilt_measurement_order_items" | "project_billing_order_items";
  orderColumn: "asbuilt_measurement_order_id" | "billing_order_id";
  orderIds: string[];
}) {
  const rows: CommercialItemRow[] = [];
  for (const ids of chunk(params.orderIds, FILTER_CHUNK_SIZE)) {
    for (let from = 0; ; from += QUERY_PAGE_SIZE) {
      const { data, error } = await params.supabase
        .from(params.table)
        .select(`${params.orderColumn}, service_activity_id, activity_code, activity_description, activity_unit, quantity, rate, total_value, activity_active_snapshot`)
        .eq("tenant_id", params.tenantId)
        .eq("is_active", true)
        .in(params.orderColumn, ids)
        .order("id", { ascending: true })
        .range(from, from + QUERY_PAGE_SIZE - 1)
        .returns<CommercialItemRow[]>();

      if (error) throw new Error("Falha ao carregar itens comerciais do dashboard.");
      rows.push(...(data ?? []));
      if ((data ?? []).length < QUERY_PAGE_SIZE) break;
    }
  }
  return rows;
}

async function loadActivityStatusMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  activityIds: string[];
}) {
  const result = new Map<string, boolean>();
  const ids = Array.from(new Set(params.activityIds.filter(Boolean)));
  for (const idChunk of chunk(ids, FILTER_CHUNK_SIZE)) {
    const { data, error } = await params.supabase
      .from("service_activities")
      .select("id, ativo")
      .eq("tenant_id", params.tenantId)
      .in("id", idChunk)
      .returns<ActivityRow[]>();

    if (error) throw new Error("Falha ao carregar status das atividades.");
    for (const row of data ?? []) {
      result.set(row.id, row.ativo !== false);
    }
  }
  return result;
}

async function loadActivityCategoryMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  activityIds: string[];
}) {
  const activityToCategory = new Map<string, string>();
  const categoryIds = new Set<string>();
  const ids = Array.from(new Set(params.activityIds.filter(Boolean)));

  for (const idChunk of chunk(ids, FILTER_CHUNK_SIZE)) {
    const { data, error } = await params.supabase
      .from("service_activities")
      .select("id, type_service")
      .eq("tenant_id", params.tenantId)
      .in("id", idChunk)
      .returns<ActivityCategoryRow[]>();

    if (error) throw new Error("Falha ao carregar categorias das atividades.");

    for (const row of data ?? []) {
      if (row.type_service) {
        activityToCategory.set(row.id, row.type_service);
        categoryIds.add(row.type_service);
      }
    }
  }

  const categoryNameById = new Map<string, string>();
  for (const idChunk of chunk(Array.from(categoryIds), FILTER_CHUNK_SIZE)) {
    const { data, error } = await params.supabase
      .from("types_service_activities")
      .select("id, name")
      .eq("tenant_id", params.tenantId)
      .in("id", idChunk)
      .returns<TypeServiceRow[]>();

    if (error) throw new Error("Falha ao carregar nomes das categorias.");

    for (const row of data ?? []) {
      categoryNameById.set(row.id, normalizeText(row.name) || "Nao identificado");
    }
  }

  return { activityToCategory, categoryNameById };
}

async function loadAsbuiltCoverageDateOptions(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projectIds: string[];
}) {
  const orders = await loadClosedAsbuiltOrderRows({
    supabase: params.supabase,
    tenantId: params.tenantId,
    projectIds: params.projectIds,
  });

  return Array.from(new Set(orders.map((order) => normalizeText(order.service_coverage_end_date)).filter(Boolean)))
    .sort((left, right) => right.localeCompare(left, "pt-BR"))
    .map((date) => ({ id: date, label: date }));
}

async function buildOperationalMeasurementCategoryCards(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projects: Array<{ id: string }>;
  asbuiltCoverageEndDate?: string | null;
  asbuiltCoverageRange?: AsbuiltCoverageRange;
  operationalDateRange?: DateRange | null;
}) {
  const projectIds = params.projects.map((project) => project.id);
  const [measurementOrders, asbuiltOrders, billingOrders] = await Promise.all([
    loadMeasurementOrderRows({
      supabase: params.supabase,
      tenantId: params.tenantId,
      projectIds,
      dateRange: params.operationalDateRange,
    }),
    loadClosedAsbuiltOrderRows({
      supabase: params.supabase,
      tenantId: params.tenantId,
      projectIds,
      coverageEndDate: params.asbuiltCoverageEndDate,
      dateRange: params.operationalDateRange,
    }),
    loadOrderProjectRows({
      supabase: params.supabase,
      tenantId: params.tenantId,
      table: "project_billing_orders",
      projectIds,
      dateRange: params.operationalDateRange,
    }),
  ]);
  const [measurementItems, asbuiltItems, billingItems] = await Promise.all([
    loadMeasurementItems({
      supabase: params.supabase,
      tenantId: params.tenantId,
      orderIds: measurementOrders.map((order) => order.id),
    }),
    loadCommercialItems({
      supabase: params.supabase,
      tenantId: params.tenantId,
      table: "project_asbuilt_measurement_order_items",
      orderColumn: "asbuilt_measurement_order_id",
      orderIds: asbuiltOrders.map((order) => order.id),
    }),
    loadCommercialItems({
      supabase: params.supabase,
      tenantId: params.tenantId,
      table: "project_billing_order_items",
      orderColumn: "billing_order_id",
      orderIds: billingOrders.map((order) => order.id),
    }),
  ]);
  const allItems = [...measurementItems, ...asbuiltItems, ...billingItems];
  const activityCategoryMap = await loadActivityCategoryMap({
    supabase: params.supabase,
    tenantId: params.tenantId,
    activityIds: allItems.map((item) => item.service_activity_id),
  });
  const buildMetricByCategory = (items: Array<MeasurementItemRow | CommercialItemRow>) => {
    const metricByCategory = new Map<string, OperationalCategoryMetric>();

    for (const item of items) {
      const categoryId = activityCategoryMap.activityToCategory.get(item.service_activity_id);
      const categoryName = normalizeCategoryName(activityCategoryMap.categoryNameById.get(categoryId ?? ""));
      if (!categoryName) continue;

      const current = metricByCategory.get(categoryName) ?? emptyTotals();
      current.quantity += numberValue(item.quantity);
      current.value += itemTotalValue(item);
      current.itemCount += 1;
      metricByCategory.set(categoryName, current);
    }

    return metricByCategory;
  };
  const measurementProjectIds = new Set(measurementOrders.map((order) => order.project_id));
  const asbuiltProjectIds = new Set(asbuiltOrders.map((order) => order.project_id));
  const comparableProjectIds = new Set(Array.from(measurementProjectIds).filter((projectId) => asbuiltProjectIds.has(projectId)));
  const comparableMeasurementOrders = measurementOrders.filter((order) => (
    comparableProjectIds.has(order.project_id)
    && isDateInAsbuiltCoverageRange(order.execution_date, params.asbuiltCoverageRange ?? { startDate: null, endDate: null })
  ));
  const comparableAsbuiltOrders = asbuiltOrders.filter((order) => comparableProjectIds.has(order.project_id));
  const comparableMeasurementOrderIds = new Set(comparableMeasurementOrders.map((order) => order.id));
  const measurementAsbuiltItems = measurementItems.filter((item) => comparableMeasurementOrderIds.has(normalizeText(item.measurement_order_id)));
  const measurementMetricByCategory = buildMetricByCategory(measurementItems);
  const measurementAsbuiltMetricByCategory = buildMetricByCategory(measurementAsbuiltItems);
  const asbuiltMetricByCategory = buildMetricByCategory(asbuiltItems);
  const billingMetricByCategory = buildMetricByCategory(billingItems);
  const sumCategoryMetrics = (source: Map<string, OperationalCategoryMetric>, category: OperationalMeasurementCategoryDefinition) => (
    Array.from(source.entries()).reduce(
      (accumulator, [categoryName, metric]) => {
        if (!matchesOperationalCategory(category, categoryName)) return accumulator;
        return {
          quantity: accumulator.quantity + metric.quantity,
          value: accumulator.value + metric.value,
          itemCount: accumulator.itemCount + metric.itemCount,
        };
      },
      emptyTotals(),
    )
  );
  const comparableServiceCount = comparableMeasurementOrders.length;
  const comparableAsbuiltOrderIds = new Set(comparableAsbuiltOrders.map((order) => order.id));
  const measurementValueForTickets = sumLoadedItems(measurementAsbuiltItems);
  const asbuiltValueForTickets = sumLoadedItems(
    asbuiltItems.filter((item) => comparableAsbuiltOrderIds.has(normalizeText(item.asbuilt_measurement_order_id))),
  );

  return {
    categoryCards: OPERATIONAL_MEASUREMENT_CATEGORIES.map((category) => ({
      ...category,
      measurement: sumCategoryMetrics(measurementMetricByCategory, category),
      measurementAsbuilt: sumCategoryMetrics(measurementAsbuiltMetricByCategory, category),
      asbuilt: sumCategoryMetrics(asbuiltMetricByCategory, category),
      billing: sumCategoryMetrics(billingMetricByCategory, category),
    })),
    averageTickets: {
      measurementByProject: comparableProjectIds.size > 0 ? measurementValueForTickets / comparableProjectIds.size : 0,
      measurementByService: comparableServiceCount > 0 ? measurementValueForTickets / comparableServiceCount : 0,
      asbuiltByProject: comparableProjectIds.size > 0 ? asbuiltValueForTickets / comparableProjectIds.size : 0,
      asbuiltByService: comparableServiceCount > 0 ? asbuiltValueForTickets / comparableServiceCount : 0,
    },
  } satisfies OperationalMeasurementIndicators;
}

async function buildOperationalMeasurementCategoryDetailRows(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projects: Array<{ id: string; label: string; serviceCenter: string }>;
  categoryKey: string;
  onlyProjectsWithAsbuilt?: boolean;
  asbuiltCoverageEndDate?: string | null;
  asbuiltCoverageRange?: AsbuiltCoverageRange;
  operationalDateRange?: DateRange | null;
  operationalRate?: number | null;
}) {
  const category = OPERATIONAL_MEASUREMENT_CATEGORIES.find((item) => item.key === params.categoryKey);
  if (!category) {
    throw new Error("Categoria operacional nao encontrada para detalhamento.");
  }

  const projectIds = params.projects.map((project) => project.id);
  const measurementOrders = await loadMeasurementOrderRows({
    supabase: params.supabase,
    tenantId: params.tenantId,
    projectIds,
    dateRange: params.operationalDateRange,
  });
  const scopedMeasurementOrders = params.onlyProjectsWithAsbuilt
    ? measurementOrders.filter((order) => (
        isDateInAsbuiltCoverageRange(order.execution_date, params.asbuiltCoverageRange ?? { startDate: null, endDate: null })
      ))
    : measurementOrders;
  const asbuiltProjectIds = params.onlyProjectsWithAsbuilt
    ? new Set((await loadClosedAsbuiltOrderRows({
        supabase: params.supabase,
        tenantId: params.tenantId,
        projectIds,
        coverageEndDate: params.asbuiltCoverageEndDate,
        dateRange: params.operationalDateRange,
      })).map((order) => order.project_id))
    : null;
  const filteredMeasurementOrders = asbuiltProjectIds
    ? scopedMeasurementOrders.filter((order) => asbuiltProjectIds.has(order.project_id))
    : scopedMeasurementOrders;

  const measurementItemsResolved = await loadMeasurementItems({
    supabase: params.supabase,
    tenantId: params.tenantId,
    orderIds: filteredMeasurementOrders.map((order) => order.id),
  });

  const activityCategoryMap = await loadActivityCategoryMap({
    supabase: params.supabase,
    tenantId: params.tenantId,
    activityIds: measurementItemsResolved.map((item) => item.service_activity_id),
  });

  const projectById = new Map(params.projects.map((project) => [project.id, project]));
  const measurementOrderById = new Map(filteredMeasurementOrders.map((order) => [order.id, order]));
  const rowsByProjectDate = new Map<string, OperationalMeasurementCategoryDetailRow>();
  const orderIdsByProjectDate = new Map<string, Set<string>>();

  for (const item of measurementItemsResolved) {
    const categoryId = activityCategoryMap.activityToCategory.get(item.service_activity_id);
    const categoryName = normalizeCategoryName(activityCategoryMap.categoryNameById.get(categoryId ?? ""));
    if (!matchesOperationalCategory(category, categoryName)) continue;

    const measurementOrderId = normalizeText(item.measurement_order_id);
    const order = measurementOrderById.get(measurementOrderId);
    if (!order) continue;
    if (!itemMatchesRate(order.manual_rate, params.operationalRate)) continue;

    const project = projectById.get(order.project_id);
    if (!project) continue;

    const executionDate = normalizeText(order.execution_date) || null;
    const rate = numberValue(order.manual_rate);
    const groupKey = `${order.project_id}::${executionDate ?? "sem-data"}::${rate}`;
    const current = rowsByProjectDate.get(groupKey) ?? {
      projectId: order.project_id,
      projectCode: project.label,
      serviceCenter: project.serviceCenter,
      executionDate,
      rate,
      measurementQuantity: 0,
      measurementValue: 0,
      orderCount: 0,
    };

    current.measurementQuantity += numberValue(item.quantity);
    current.measurementValue += itemTotalValue(item);
    rowsByProjectDate.set(groupKey, current);

    const orderIds = orderIdsByProjectDate.get(groupKey) ?? new Set<string>();
    orderIds.add(order.id);
    orderIdsByProjectDate.set(groupKey, orderIds);
  }

  return Array.from(rowsByProjectDate.entries())
    .map(([groupKey, row]) => ({
      ...row,
      orderCount: orderIdsByProjectDate.get(groupKey)?.size ?? 0,
    }))
    .sort((left, right) => {
      const projectCompare = left.projectCode.localeCompare(right.projectCode, "pt-BR");
      if (projectCompare !== 0) return projectCompare;
      return (left.executionDate ?? "").localeCompare(right.executionDate ?? "", "pt-BR");
    });
}

async function buildOperationalAsbuiltCategoryDetailRows(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projects: Array<{ id: string; label: string; serviceCenter: string }>;
  categoryKey: string;
  asbuiltCoverageEndDate?: string | null;
  asbuiltCoverageRange?: AsbuiltCoverageRange;
  operationalDateRange?: DateRange | null;
  operationalRate?: number | null;
}) {
  const category = OPERATIONAL_MEASUREMENT_CATEGORIES.find((item) => item.key === params.categoryKey);
  if (!category) {
    throw new Error("Categoria operacional nao encontrada para detalhamento do Asbuilt.");
  }

  const projectIds = params.projects.map((project) => project.id);
  const asbuiltOrders = await loadClosedAsbuiltOrderRows({
    supabase: params.supabase,
    tenantId: params.tenantId,
    projectIds,
    coverageEndDate: params.asbuiltCoverageEndDate,
    dateRange: params.operationalDateRange,
  });
  const asbuiltOrdersForCoverageRanges = params.operationalDateRange && !params.asbuiltCoverageEndDate
    ? await loadClosedAsbuiltOrderRows({
        supabase: params.supabase,
        tenantId: params.tenantId,
        projectIds,
      })
    : asbuiltOrders;

  const asbuiltItems = await loadCommercialItems({
    supabase: params.supabase,
    tenantId: params.tenantId,
    table: "project_asbuilt_measurement_order_items",
    orderColumn: "asbuilt_measurement_order_id",
    orderIds: asbuiltOrders.map((order) => order.id),
  });

  const activityCategoryMap = await loadActivityCategoryMap({
    supabase: params.supabase,
    tenantId: params.tenantId,
    activityIds: asbuiltItems.map((item) => item.service_activity_id),
  });

  const projectById = new Map(params.projects.map((project) => [project.id, project]));
  const orderById = new Map(asbuiltOrders.map((order) => [order.id, order]));
  const previousCoverageByOrderId = new Map<string, string | null>();
  const latestCoverageByProject = new Map<string, string | null>();

  for (const order of asbuiltOrdersForCoverageRanges) {
    previousCoverageByOrderId.set(order.id, latestCoverageByProject.get(order.project_id) ?? null);
    latestCoverageByProject.set(order.project_id, normalizeText(order.service_coverage_end_date) || null);
  }

  const rowsByOrderId = new Map<string, OperationalAsbuiltCategoryDetailRow>();

  for (const item of asbuiltItems) {
    if (!itemMatchesRate(item.rate, params.operationalRate)) continue;

    const categoryId = activityCategoryMap.activityToCategory.get(item.service_activity_id);
    const categoryName = normalizeCategoryName(activityCategoryMap.categoryNameById.get(categoryId ?? ""));
    if (!matchesOperationalCategory(category, categoryName)) continue;

    const orderId = normalizeText((item as Record<string, unknown>).asbuilt_measurement_order_id);
    const order = orderById.get(orderId);
    if (!order) continue;

    const project = projectById.get(order.project_id);
    if (!project) continue;

    const coverageEndDate = normalizeText(order.service_coverage_end_date) || null;
    const previousCoverage = previousCoverageByOrderId.get(order.id) ?? null;
    const rate = numberValue(item.rate);
    const groupKey = `${order.id}::${rate}`;
    const current = rowsByOrderId.get(groupKey) ?? {
      projectId: order.project_id,
      projectCode: project.label,
      serviceCenter: project.serviceCenter,
      coverageStartDate: params.asbuiltCoverageEndDate
        ? params.asbuiltCoverageRange?.startDate ?? null
        : previousCoverage ? addDaysToIsoDate(previousCoverage, 1) : null,
      coverageEndDate,
      rate,
      asbuiltQuantity: 0,
      asbuiltValue: 0,
      itemCount: 0,
    };

    current.asbuiltQuantity += numberValue(item.quantity);
    current.asbuiltValue += itemTotalValue(item);
    current.itemCount += 1;
    rowsByOrderId.set(groupKey, current);
  }

  return Array.from(rowsByOrderId.values()).sort((left, right) => {
    const projectCompare = left.projectCode.localeCompare(right.projectCode, "pt-BR");
    if (projectCompare !== 0) return projectCompare;
    return (left.coverageEndDate ?? "").localeCompare(right.coverageEndDate ?? "", "pt-BR");
  });
}

async function buildOperationalBillingCategoryDetailRows(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projects: Array<{ id: string; label: string; serviceCenter: string }>;
  categoryKey: string;
  operationalDateRange?: DateRange | null;
  operationalRate?: number | null;
}) {
  const category = OPERATIONAL_MEASUREMENT_CATEGORIES.find((item) => item.key === params.categoryKey);
  if (!category) {
    throw new Error("Categoria operacional nao encontrada para detalhamento do Faturamento.");
  }

  const projectIds = params.projects.map((project) => project.id);
  const billingOrders = await loadOrderProjectRows({
    supabase: params.supabase,
    tenantId: params.tenantId,
    table: "project_billing_orders",
    projectIds,
    dateRange: params.operationalDateRange,
  });

  const billingItems = await loadCommercialItems({
    supabase: params.supabase,
    tenantId: params.tenantId,
    table: "project_billing_order_items",
    orderColumn: "billing_order_id",
    orderIds: billingOrders.map((order) => order.id),
  });

  const activityCategoryMap = await loadActivityCategoryMap({
    supabase: params.supabase,
    tenantId: params.tenantId,
    activityIds: billingItems.map((item) => item.service_activity_id),
  });

  const projectById = new Map(params.projects.map((project) => [project.id, project]));
  const orderById = new Map(billingOrders.map((order) => [order.id, order]));
  const rowsByProjectId = new Map<string, OperationalBillingCategoryDetailRow>();
  const orderIdsByProjectId = new Map<string, Set<string>>();

  for (const item of billingItems) {
    if (!itemMatchesRate(item.rate, params.operationalRate)) continue;

    const categoryId = activityCategoryMap.activityToCategory.get(item.service_activity_id);
    const categoryName = normalizeCategoryName(activityCategoryMap.categoryNameById.get(categoryId ?? ""));
    if (!matchesOperationalCategory(category, categoryName)) continue;

    const orderId = normalizeText((item as Record<string, unknown>).billing_order_id);
    const order = orderById.get(orderId);
    if (!order) continue;

    const project = projectById.get(order.project_id);
    if (!project) continue;

    const rate = numberValue(item.rate);
    const groupKey = `${order.project_id}::${rate}`;
    const current = rowsByProjectId.get(groupKey) ?? {
      projectId: order.project_id,
      projectCode: project.label,
      serviceCenter: project.serviceCenter,
      rate,
      billingQuantity: 0,
      billingValue: 0,
      orderCount: 0,
      itemCount: 0,
    };

    current.billingQuantity += numberValue(item.quantity);
    current.billingValue += itemTotalValue(item);
    current.itemCount += 1;
    rowsByProjectId.set(groupKey, current);

    const orderIds = orderIdsByProjectId.get(groupKey) ?? new Set<string>();
    orderIds.add(order.id);
    orderIdsByProjectId.set(groupKey, orderIds);
  }

  return Array.from(rowsByProjectId.values())
    .map((row) => ({
      ...row,
      orderCount: orderIdsByProjectId.get(`${row.projectId}::${row.rate}`)?.size ?? 0,
    }))
    .sort((left, right) => left.projectCode.localeCompare(right.projectCode, "pt-BR"));
}

async function loadWorkCompletionCatalog(supabase: AuthenticatedAppUserContext["supabase"], tenantId: string) {
  const { data, error } = await supabase
    .from("programming_work_completion_catalog")
    .select("code, label_pt, sort_order")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("label_pt", { ascending: true })
    .returns<WorkCompletionCatalogRow[]>();

  if (error) {
    throw new Error("Falha ao carregar estados de trabalho.");
  }

  return (data ?? []).map((item) => {
    const code = normalizeStatusCatalogCode(item.code);
    return {
      id: code,
      label: normalizeText(item.label_pt) || code,
    };
  }).filter((item) => item.id);
}

async function loadLatestWorkCompletionByProject(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projectIds: string[];
  statusLabels: Map<string, string>;
}) {
  const latestByProject = new Map<string, ProgrammingWorkCompletionRow>();

  for (const projectIdChunk of chunk(Array.from(new Set(params.projectIds.filter(Boolean))), FILTER_CHUNK_SIZE)) {
    const { data, error } = await params.supabase
      .from("project_programming")
      .select("project_id, work_completion_status, execution_date, updated_at")
      .eq("tenant_id", params.tenantId)
      .in("project_id", projectIdChunk)
      .not("work_completion_status", "is", null)
      .order("updated_at", { ascending: false })
      .limit(2000)
      .returns<ProgrammingWorkCompletionRow[]>();

    if (error) {
      throw new Error("Falha ao carregar estado de trabalho dos projetos.");
    }

    for (const row of data ?? []) {
      const projectId = normalizeText(row.project_id);
      if (!projectId || latestByProject.has(projectId)) continue;
      latestByProject.set(projectId, row);
    }
  }

  return new Map(
    Array.from(latestByProject.entries()).map(([projectId, row]) => {
      const status = normalizeStatusCatalogCode(row.work_completion_status);
      return [
        projectId,
        {
          status: status || "NAO_INFORMADO",
          label: status ? params.statusLabels.get(status) ?? status : "Nao informado",
        },
      ];
    }),
  );
}

function buildBillingCategoryRows(params: {
  rows: DashboardRow[];
  billingItems: CommercialItemRow[];
  activityToCategory: Map<string, string>;
  categoryNameById: Map<string, string>;
}) {
  const categoryMap = new Map<string, BillingCategoryRow>();
  const categoryByCode = new Map<string, { categoryId: string; categoryName: string }>();

  for (const item of params.billingItems) {
    const code = normalizeCode(item.activity_code);
    if (!code) continue;

    const categoryId = params.activityToCategory.get(item.service_activity_id) ?? "__NO_CATEGORY__";
    categoryByCode.set(code, {
      categoryId,
      categoryName: categoryId === "__NO_CATEGORY__" ? "Nao identificada" : params.categoryNameById.get(categoryId) ?? "Nao identificada",
    });
  }

  for (const row of params.rows) {
    if (row.billing.itemCount <= 0) continue;

    const category = categoryByCode.get(row.code) ?? {
      categoryId: "__NO_CATEGORY__",
      categoryName: "Nao identificada",
    };
    const current = categoryMap.get(category.categoryId) ?? {
      categoryId: category.categoryId,
      categoryName: category.categoryName,
      quantity: 0,
      value: 0,
      itemCount: 0,
      codes: [],
    };

    current.quantity += row.billing.quantity;
    current.value += row.billing.value;
    current.itemCount += row.billing.itemCount;
    if (!current.codes.includes(row.code)) current.codes.push(row.code);
    categoryMap.set(category.categoryId, current);
  }

  return Array.from(categoryMap.values())
    .map((row) => ({
      ...row,
      codes: row.codes.sort((left, right) => left.localeCompare(right, "pt-BR")),
    }))
    .sort((left, right) => left.categoryName.localeCompare(right.categoryName, "pt-BR"));
}

function buildCategorySummary(params: {
  rows: DashboardRow[];
  items: Array<MeasurementItemRow | CommercialItemRow>;
  activityToCategory: Map<string, string>;
  categoryNameById: Map<string, string>;
}) {
  const categoryByCode = new Map<string, { categoryId: string; categoryName: string }>();
  for (const item of params.items) {
    const code = normalizeCode(item.activity_code);
    if (!code || categoryByCode.has(code)) continue;

    const categoryId = params.activityToCategory.get(item.service_activity_id) ?? "__NO_CATEGORY__";
    categoryByCode.set(code, {
      categoryId,
      categoryName: categoryId === "__NO_CATEGORY__" ? "Nao identificada" : params.categoryNameById.get(categoryId) ?? "Nao identificada",
    });
  }

  const columnMap = new Map<string, CategoryColumn>();
  const summaryRows: CategorySummaryRow[] = [
    { origin: "measurement", label: "Medicao", totalQuantity: 0, totalValue: 0, categories: {} },
    { origin: "asbuilt", label: "Medicao Asbuilt", totalQuantity: 0, totalValue: 0, categories: {} },
    { origin: "billing", label: "Faturamento", totalQuantity: 0, totalValue: 0, categories: {} },
  ];

  for (const row of params.rows) {
    const category = categoryByCode.get(row.code) ?? {
      categoryId: "__NO_CATEGORY__",
      categoryName: "Nao identificada",
    };
    columnMap.set(category.categoryId, category);

    for (const summaryRow of summaryRows) {
      const totals = row[summaryRow.origin];
      if (totals.itemCount <= 0) continue;

      const current = summaryRow.categories[category.categoryId] ?? emptyCategoryTotals();
      current.quantity += totals.quantity;
      current.value += totals.value;
      current.itemCount += totals.itemCount;
      if (!current.codes.includes(row.code)) current.codes.push(row.code);
      summaryRow.categories[category.categoryId] = current;
      summaryRow.totalQuantity += totals.quantity;
      summaryRow.totalValue += totals.value;
    }
  }

  const categoryColumns = Array.from(columnMap.values())
    .sort((left, right) => left.categoryName.localeCompare(right.categoryName, "pt-BR"));

  return {
    categoryColumns,
    categorySummaryRows: summaryRows.map((row) => ({
      ...row,
      categories: Object.fromEntries(
        Object.entries(row.categories).map(([categoryId, totals]) => [
          categoryId,
          {
            ...totals,
            codes: totals.codes.sort((left, right) => left.localeCompare(right, "pt-BR")),
          },
        ]),
      ),
    })),
  };
}

async function sumItemValuesByProject(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  table: "project_measurement_order_items" | "project_asbuilt_measurement_order_items" | "project_billing_order_items";
  orderColumn: "measurement_order_id" | "asbuilt_measurement_order_id" | "billing_order_id";
  orders: OrderProjectRow[];
}) {
  const totals = new Map<string, number>();
  const orderProjectById = new Map(params.orders.map((order) => [order.id, order.project_id]));
  const orderIds = Array.from(orderProjectById.keys());

  for (const orderIdChunk of chunk(orderIds, FILTER_CHUNK_SIZE)) {
    const buildQuery = (selectColumns: string) => params.supabase
      .from(params.table)
      .select(selectColumns)
      .eq("tenant_id", params.tenantId)
      .eq("is_active", true)
      .in(params.orderColumn, orderIdChunk);

    let { data, error } = await buildQuery(`${params.orderColumn}, total_value`)
      .returns<Array<Record<string, number | string | null>>>();

    if (error && params.table === "project_measurement_order_items") {
      const fallback = await buildQuery(`${params.orderColumn}, quantity, voice_point, manual_rate, unit_value`)
        .returns<Array<Record<string, number | string | null>>>();

      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      throw new Error(`Falha ao somar valores por projeto: ${error.message}`);
    }

    for (const item of data ?? []) {
      const orderId = normalizeText(item[params.orderColumn]);
      const projectId = orderProjectById.get(orderId);
      if (!projectId) continue;

      totals.set(projectId, (totals.get(projectId) ?? 0) + itemTotalValue(item as MeasurementItemRow));
    }
  }

  return totals;
}

function sumLoadedItemsByProject(
  orders: OrderProjectRow[],
  items: Array<MeasurementItemRow | CommercialItemRow>,
  orderColumn: "measurement_order_id" | "asbuilt_measurement_order_id" | "billing_order_id",
) {
  const totals = new Map<string, number>();
  const orderProjectById = new Map(orders.map((order) => [order.id, order.project_id]));

  for (const item of items) {
    const orderId = normalizeText((item as Record<string, unknown>)[orderColumn]);
    const projectId = orderProjectById.get(orderId);
    if (!projectId) continue;

    totals.set(projectId, (totals.get(projectId) ?? 0) + itemTotalValue(item));
  }

  return totals;
}

function sumLoadedItems(items: Array<MeasurementItemRow | CommercialItemRow>) {
  return items.reduce((sum, item) => sum + itemTotalValue(item), 0);
}

async function loadCommercialOrderMetrics(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  table: "project_asbuilt_measurement_order_items" | "project_billing_order_items";
  orderColumn: "asbuilt_measurement_order_id" | "billing_order_id";
  orderIds: string[];
}) {
  const metrics = new Map<string, { value: number; itemCount: number }>();
  const orderIds = Array.from(new Set(params.orderIds.filter(Boolean)));

  for (const orderIdChunk of chunk(orderIds, FILTER_CHUNK_SIZE)) {
    const { data, error } = await params.supabase
      .from(params.table)
      .select(`${params.orderColumn}, total_value`)
      .eq("tenant_id", params.tenantId)
      .eq("is_active", true)
      .in(params.orderColumn, orderIdChunk)
      .returns<Array<Record<string, number | string | null>>>();

    if (error) {
      throw new Error("Falha ao carregar metricas dos cortes comerciais.");
    }

    for (const item of data ?? []) {
      const orderId = normalizeText(item[params.orderColumn]);
      if (!orderId) continue;

      const current = metrics.get(orderId) ?? { value: 0, itemCount: 0 };
      current.value += numberValue(item.total_value);
      current.itemCount += 1;
      metrics.set(orderId, current);
    }
  }

  return metrics;
}

function addDaysToIsoDate(value: string | null, days: number) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildAsbuiltCoverageRange(coverageDates: string[], selectedEndDate: string | null): AsbuiltCoverageRange {
  if (!selectedEndDate) return { startDate: null, endDate: null };

  const orderedDates = Array.from(new Set(coverageDates.map(normalizeText).filter(Boolean))).sort((left, right) => (
    left.localeCompare(right, "pt-BR")
  ));
  const selectedIndex = orderedDates.indexOf(selectedEndDate);
  const previousEndDate = selectedIndex > 0 ? orderedDates[selectedIndex - 1] : null;

  return {
    startDate: previousEndDate ? addDaysToIsoDate(previousEndDate, 1) : null,
    endDate: selectedEndDate,
  };
}

function isDateInAsbuiltCoverageRange(value: string | null | undefined, range: AsbuiltCoverageRange) {
  const normalized = normalizeText(value);
  if (!range.endDate) return true;
  if (!normalized) return false;
  if (range.startDate && normalized < range.startDate) return false;
  return normalized <= range.endDate;
}

async function buildAsbuiltBreakdownRows(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  project: { id: string; label: string; serviceCenterId: string | null; serviceCenter: string };
  asbuiltCoverageEndDate?: string | null;
  asbuiltCoverageRange?: AsbuiltCoverageRange;
}) {
  const orders = await loadClosedAsbuiltOrderRows({
    supabase: params.supabase,
    tenantId: params.tenantId,
    projectIds: [params.project.id],
    coverageEndDate: params.asbuiltCoverageEndDate,
  });

  const metricsByOrderId = await loadCommercialOrderMetrics({
    supabase: params.supabase,
    tenantId: params.tenantId,
    table: "project_asbuilt_measurement_order_items",
    orderColumn: "asbuilt_measurement_order_id",
    orderIds: orders.map((order) => order.id),
  });

  const orderedRows = [...orders].sort((left, right) => {
    const leftCoverage = left.service_coverage_end_date ?? "";
    const rightCoverage = right.service_coverage_end_date ?? "";
    if (leftCoverage !== rightCoverage) {
      return leftCoverage.localeCompare(rightCoverage, "pt-BR");
    }
    return (left.updated_at ?? "").localeCompare(right.updated_at ?? "", "pt-BR");
  });

  let previousCoverageEndDate: string | null = null;

  return orderedRows.map((order) => {
    const metrics = metricsByOrderId.get(order.id) ?? { value: 0, itemCount: 0 };
    const coverageEndDate = normalizeText(order.service_coverage_end_date) || null;
    const coverageStartDate = params.asbuiltCoverageEndDate
      ? params.asbuiltCoverageRange?.startDate ?? null
      : previousCoverageEndDate ? addDaysToIsoDate(previousCoverageEndDate, 1) : null;

    if (coverageEndDate) {
      previousCoverageEndDate = coverageEndDate;
    }

    return {
      projectId: params.project.id,
      projectCode: params.project.label,
      serviceCenterId: params.project.serviceCenterId,
      serviceCenter: params.project.serviceCenter,
      coverageStartDate,
      coverageEndDate,
      value: metrics.value,
      itemCount: metrics.itemCount,
    } satisfies AsbuiltBreakdownRow;
  });
}

async function buildProjectValueRows(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projects: Array<{ id: string; label: string; serviceCenterId: string | null; serviceCenter: string; serviceTypeId: string | null; serviceType: string }>;
}) {
  const projectIds = params.projects.map((project) => project.id);
  if (!projectIds.length) return [] satisfies ProjectValueRow[];

  const workCompletionStatuses = await loadWorkCompletionCatalog(params.supabase, params.tenantId);
  const workCompletionStatusLabels = new Map(workCompletionStatuses.map((status) => [status.id, status.label]));

  const [measurementOrders, asbuiltOrders, billingOrders] = await Promise.all([
    loadOrderProjectRows({
      supabase: params.supabase,
      tenantId: params.tenantId,
      table: "project_measurement_orders",
      projectIds,
    }),
    loadOrderProjectRows({
      supabase: params.supabase,
      tenantId: params.tenantId,
      table: "project_asbuilt_measurement_orders",
      projectIds,
    }),
    loadOrderProjectRows({
      supabase: params.supabase,
      tenantId: params.tenantId,
      table: "project_billing_orders",
      projectIds,
    }),
  ]);

  const [measurementItems, asbuiltItems, billingItems] = await Promise.all([
    loadMeasurementItems({
      supabase: params.supabase,
      tenantId: params.tenantId,
      orderIds: measurementOrders.map((order) => order.id),
    }),
    loadCommercialItems({
      supabase: params.supabase,
      tenantId: params.tenantId,
      table: "project_asbuilt_measurement_order_items",
      orderColumn: "asbuilt_measurement_order_id",
      orderIds: asbuiltOrders.map((order) => order.id),
    }),
    loadCommercialItems({
      supabase: params.supabase,
      tenantId: params.tenantId,
      table: "project_billing_order_items",
      orderColumn: "billing_order_id",
      orderIds: billingOrders.map((order) => order.id),
    }),
  ]);
  const measurementTotals = sumLoadedItemsByProject(measurementOrders, measurementItems, "measurement_order_id");
  const asbuiltTotals = sumLoadedItemsByProject(asbuiltOrders, asbuiltItems, "asbuilt_measurement_order_id");
  const billingTotals = sumLoadedItemsByProject(billingOrders, billingItems, "billing_order_id");

  const workCompletionByProject = await loadLatestWorkCompletionByProject({
    supabase: params.supabase,
    tenantId: params.tenantId,
    projectIds,
    statusLabels: workCompletionStatusLabels,
  });

  return params.projects
    .map((project) => {
      const measurementValue = measurementTotals.get(project.id) ?? 0;
      const asbuiltValue = asbuiltTotals.get(project.id) ?? 0;
      const billingValue = billingTotals.get(project.id) ?? 0;
      const workCompletion = workCompletionByProject.get(project.id) ?? {
        status: "NAO_INFORMADO",
        label: "Nao informado",
      };

      return {
        projectId: project.id,
        projectCode: project.label,
        serviceCenterId: project.serviceCenterId,
        serviceCenter: project.serviceCenter,
        workCompletionStatus: workCompletion.status,
        workCompletionStatusLabel: workCompletion.label,
        serviceTypeId: project.serviceTypeId,
        serviceTypeName: project.serviceType,
        measurementValue,
        asbuiltValue,
        billingValue,
        asbuiltMeasurementDiff: asbuiltValue - measurementValue,
        billingAsbuiltDiff: billingValue - asbuiltValue,
      };
    })
    .sort((left, right) => left.projectCode.localeCompare(right.projectCode, "pt-BR"));
}

async function buildChartItems(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projects: Array<{ id: string; serviceCenterId: string | null }>;
  serviceCenterId: string | null;
  projectId: string | null;
  asbuiltCoverageEndDate?: string | null;
  asbuiltCoverageRange?: AsbuiltCoverageRange;
}) {
  const scopedProjectIds = params.projects
    .filter((project) => !params.serviceCenterId || project.serviceCenterId === params.serviceCenterId)
    .filter((project) => !params.projectId || project.id === params.projectId)
    .map((project) => project.id);

  if (!scopedProjectIds.length) {
    return [
      { key: "totalMeasurement", label: "Total medido", value: 0, projectCount: 0, measurementCount: 0 },
      { key: "measurementAsbuilt", label: "Medido (AS BUILT)", value: 0, projectCount: 0, measurementCount: 0 },
      { key: "asbuilt", label: "As Built", value: 0, projectCount: 0, measurementCount: 0 },
      { key: "billing", label: "Faturado", value: 0, projectCount: 0, measurementCount: 0 },
    ] satisfies ChartItem[];
  }

  const [measurementOrders, asbuiltOrders, billingOrders] = await Promise.all([
    loadMeasurementOrderRows({
      supabase: params.supabase,
      tenantId: params.tenantId,
      projectIds: scopedProjectIds,
    }),
    loadClosedAsbuiltOrderRows({
      supabase: params.supabase,
      tenantId: params.tenantId,
      projectIds: scopedProjectIds,
      coverageEndDate: params.asbuiltCoverageEndDate,
    }),
    loadOrderProjectRows({
      supabase: params.supabase,
      tenantId: params.tenantId,
      table: "project_billing_orders",
      projectIds: scopedProjectIds,
    }),
  ]);

  const emptyCoverageRange = { startDate: null, endDate: null };
  const selectedCoverageRange = params.asbuiltCoverageRange ?? emptyCoverageRange;
  const asbuiltProjectIds = new Set(asbuiltOrders.map((order) => order.project_id));
  const measurementProjectIds = new Set(measurementOrders.map((order) => order.project_id));
  const billingProjectIds = new Set(billingOrders.map((order) => order.project_id));
  const measurementAsbuiltOrders = measurementOrders.filter((order) => (
    asbuiltProjectIds.has(order.project_id) && isDateInAsbuiltCoverageRange(order.execution_date, selectedCoverageRange)
  ));
  const measurementAsbuiltProjectIds = new Set(measurementAsbuiltOrders.map((order) => order.project_id));
  const coverageDates = Array.from(
    new Set(asbuiltOrders.map((order) => normalizeText(order.service_coverage_end_date)).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right, "pt-BR"));
  const [measurementItems, asbuiltItems, billingItems] = await Promise.all([
    loadMeasurementItems({
      supabase: params.supabase,
      tenantId: params.tenantId,
      orderIds: measurementOrders.map((order) => order.id),
    }),
    loadCommercialItems({
      supabase: params.supabase,
      tenantId: params.tenantId,
      table: "project_asbuilt_measurement_order_items",
      orderColumn: "asbuilt_measurement_order_id",
      orderIds: asbuiltOrders.map((order) => order.id),
    }),
    loadCommercialItems({
      supabase: params.supabase,
      tenantId: params.tenantId,
      table: "project_billing_order_items",
      orderColumn: "billing_order_id",
      orderIds: billingOrders.map((order) => order.id),
    }),
  ]);
  const measurementOrderIds = new Set(measurementOrders.map((order) => order.id));
  const measurementAsbuiltOrderIds = new Set(measurementAsbuiltOrders.map((order) => order.id));
  const asbuiltOrderIds = new Set(asbuiltOrders.map((order) => order.id));
  const billingOrderIds = new Set(billingOrders.map((order) => order.id));
  const buildSegments = async (origin: "measurementAsbuilt" | "asbuilt") => Promise.all(
    coverageDates.map((coverageEndDate) => {
      const range = buildAsbuiltCoverageRange(coverageDates, coverageEndDate);
      const periodAsbuiltOrders = asbuiltOrders.filter((order) => normalizeText(order.service_coverage_end_date) === coverageEndDate);
      const periodAsbuiltProjectIds = new Set(periodAsbuiltOrders.map((order) => order.project_id));
      const periodMeasurementOrders = measurementOrders.filter((order) => (
        periodAsbuiltProjectIds.has(order.project_id) && isDateInAsbuiltCoverageRange(order.execution_date, range)
      ));
      const periodAsbuiltOrderIds = new Set(periodAsbuiltOrders.map((order) => order.id));
      const periodMeasurementOrderIds = new Set(periodMeasurementOrders.map((order) => order.id));
      const value = origin === "asbuilt"
        ? sumLoadedItems(asbuiltItems.filter((item) => periodAsbuiltOrderIds.has(normalizeText(item.asbuilt_measurement_order_id))))
        : sumLoadedItems(measurementItems.filter((item) => periodMeasurementOrderIds.has(normalizeText(item.measurement_order_id))));

      return {
        key: coverageEndDate,
        label: formatDateLabel(coverageEndDate),
        value,
      } satisfies ChartSegment;
    }),
  );

  const [measurementAsbuiltSegments, asbuiltSegments] = await Promise.all([
    params.asbuiltCoverageEndDate ? Promise.resolve([]) : buildSegments("measurementAsbuilt"),
    params.asbuiltCoverageEndDate ? Promise.resolve([]) : buildSegments("asbuilt"),
  ]);
  const totalMeasurement = sumLoadedItems(measurementItems.filter((item) => measurementOrderIds.has(normalizeText(item.measurement_order_id))));
  const measurementAsbuilt = sumLoadedItems(measurementItems.filter((item) => measurementAsbuiltOrderIds.has(normalizeText(item.measurement_order_id))));
  const asbuilt = sumLoadedItems(asbuiltItems.filter((item) => asbuiltOrderIds.has(normalizeText(item.asbuilt_measurement_order_id))));
  const billing = sumLoadedItems(billingItems.filter((item) => billingOrderIds.has(normalizeText(item.billing_order_id))));

  return [
    {
      key: "totalMeasurement",
      label: "Total medido",
      value: totalMeasurement,
      projectCount: measurementProjectIds.size,
      measurementCount: measurementOrders.length,
    },
    {
      key: "measurementAsbuilt",
      label: "Medido (AS BUILT)",
      value: measurementAsbuilt,
      projectCount: measurementAsbuiltProjectIds.size,
      measurementCount: measurementAsbuiltOrders.length,
      segments: measurementAsbuiltSegments,
    },
    {
      key: "asbuilt",
      label: "As Built",
      value: asbuilt,
      projectCount: asbuiltProjectIds.size,
      measurementCount: asbuiltOrders.length,
      segments: asbuiltSegments,
    },
    {
      key: "billing",
      label: "Faturado",
      value: billing,
      projectCount: billingProjectIds.size,
      measurementCount: billingOrders.length,
    },
  ] satisfies ChartItem[];
}

async function buildChartProjectDetailRows(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projects: Array<{ id: string; label: string; serviceCenterId: string | null; serviceCenter: string }>;
  serviceCenterId: string | null;
  projectId: string | null;
  indicatorKey: ChartIndicatorKey;
  asbuiltCoverageEndDate?: string | null;
  asbuiltCoverageRange?: AsbuiltCoverageRange;
}) {
  const scopedProjects = params.projects
    .filter((project) => !params.serviceCenterId || project.serviceCenterId === params.serviceCenterId)
    .filter((project) => !params.projectId || project.id === params.projectId);
  const scopedProjectIds = scopedProjects.map((project) => project.id);
  const projectById = new Map(scopedProjects.map((project) => [project.id, project]));
  if (!scopedProjectIds.length) return [] satisfies ChartProjectDetailRow[];

  const [measurementOrders, asbuiltOrders, billingOrders] = await Promise.all([
    loadMeasurementOrderRows({
      supabase: params.supabase,
      tenantId: params.tenantId,
      projectIds: scopedProjectIds,
    }),
    loadClosedAsbuiltOrderRows({
      supabase: params.supabase,
      tenantId: params.tenantId,
      projectIds: scopedProjectIds,
      coverageEndDate: params.asbuiltCoverageEndDate,
    }),
    loadOrderProjectRows({
      supabase: params.supabase,
      tenantId: params.tenantId,
      table: "project_billing_orders",
      projectIds: scopedProjectIds,
    }),
  ]);

  const asbuiltProjectIds = new Set(asbuiltOrders.map((order) => order.project_id));
  const selectedOrders =
    params.indicatorKey === "totalMeasurement"
      ? measurementOrders
      : params.indicatorKey === "measurementAsbuilt"
        ? measurementOrders.filter((order) => (
            asbuiltProjectIds.has(order.project_id)
            && isDateInAsbuiltCoverageRange(order.execution_date, params.asbuiltCoverageRange ?? { startDate: null, endDate: null })
          ))
        : params.indicatorKey === "asbuilt"
          ? asbuiltOrders
          : billingOrders;

  const totals = await sumItemValuesByProject({
    supabase: params.supabase,
    tenantId: params.tenantId,
    table: params.indicatorKey === "asbuilt"
      ? "project_asbuilt_measurement_order_items"
      : params.indicatorKey === "billing"
        ? "project_billing_order_items"
        : "project_measurement_order_items",
    orderColumn: params.indicatorKey === "asbuilt"
      ? "asbuilt_measurement_order_id"
      : params.indicatorKey === "billing"
        ? "billing_order_id"
        : "measurement_order_id",
    orders: selectedOrders,
  });

  const orderCountByProject = new Map<string, number>();
  for (const order of selectedOrders) {
    orderCountByProject.set(order.project_id, (orderCountByProject.get(order.project_id) ?? 0) + 1);
  }

  const rateByProject = new Map<string, number | null>();
  for (const order of measurementOrders) {
    const rate = order.manual_rate !== null && order.manual_rate !== undefined ? Number(order.manual_rate) : null;
    rateByProject.set(order.project_id, Number.isFinite(rate) ? (rate as number) : null);
  }

  const asbuiltFaixaEndByProject = new Map<string, string | null>();
  for (const order of asbuiltOrders) {
    if (order.service_coverage_end_date) {
      asbuiltFaixaEndByProject.set(order.project_id, order.service_coverage_end_date);
    }
  }

  return Array.from(totals.entries())
    .map(([projectId, value]) => {
      const project = projectById.get(projectId);
      return project
        ? {
            projectId,
            projectCode: project.label,
            serviceCenter: project.serviceCenter,
            value,
            orderCount: orderCountByProject.get(projectId) ?? 0,
            rate: rateByProject.get(projectId) ?? null,
            asbuiltFaixaEnd: asbuiltFaixaEndByProject.get(projectId) ?? null,
          }
        : null;
    })
    .filter((row): row is ChartProjectDetailRow => Boolean(row))
    .sort((left, right) => left.projectCode.localeCompare(right.projectCode, "pt-BR"));
}

function addItem(
  target: Map<string, AggregatedRow>,
  origin: OriginKey,
  item: MeasurementItemRow | CommercialItemRow,
) {
  const code = normalizeCode(item.activity_code);
  if (!code) return;

  const row = target.get(code) ?? createRow(code);
  row.description = row.description || normalizeText(item.activity_description);
  row.unit = row.unit || normalizeText(item.activity_unit);
  row.activityIds.add(item.service_activity_id);

  if ("activity_active_snapshot" in item && item.activity_active_snapshot !== null && item.activity_active_snapshot !== undefined) {
    row.activeSignals.add(Boolean(item.activity_active_snapshot));
  }

  row[origin].quantity += numberValue(item.quantity);
  row[origin].value += itemTotalValue(item);
  row[origin].itemCount += 1;
  target.set(code, row);
}

function nearlyEqual(left: number, right: number, tolerance: number) {
  return Math.abs(left - right) <= tolerance;
}

function finalizeRows(rows: AggregatedRow[], activityStatusMap: Map<string, boolean>): DashboardRow[] {
  return rows.map((row) => {
    for (const activityId of row.activityIds) {
      const active = activityStatusMap.get(activityId);
      if (active !== undefined) row.activeSignals.add(active);
    }

    const hasActive = row.activeSignals.has(true);
    const hasInactive = row.activeSignals.has(false);
    const activityStatus: DashboardRow["activityStatus"] = hasActive ? "ATIVA" : hasInactive ? "INATIVA" : "NAO_IDENTIFICADA";
    const hasMeasurement = row.measurement.itemCount > 0;
    const hasAsbuilt = row.asbuilt.itemCount > 0;
    const hasBilling = row.billing.itemCount > 0;
    const isMissingInAnyBase = !hasMeasurement || !hasAsbuilt || !hasBilling;
    const quantityDiffAsbuiltMeasurement = row.asbuilt.quantity - row.measurement.quantity;
    const quantityDiffBillingMeasurement = row.billing.quantity - row.measurement.quantity;
    const valueDiffAsbuiltMeasurement = row.asbuilt.value - row.measurement.value;
    const valueDiffBillingMeasurement = row.billing.value - row.measurement.value;
    const isQuantityDivergent =
      !nearlyEqual(row.measurement.quantity, row.asbuilt.quantity, 0.0001) ||
      !nearlyEqual(row.measurement.quantity, row.billing.quantity, 0.0001);
    const isValueDivergent =
      !nearlyEqual(row.measurement.value, row.asbuilt.value, 0.01) ||
      !nearlyEqual(row.measurement.value, row.billing.value, 0.01);
    const isDivergent = isMissingInAnyBase || isQuantityDivergent || isValueDivergent;
    const missingLabels = [
      hasMeasurement ? "" : "Medicao",
      hasAsbuilt ? "" : "Asbuilt",
      hasBilling ? "" : "Faturamento",
    ].filter(Boolean);

    return {
      code: row.code,
      description: row.description,
      unit: row.unit,
      activityStatus,
      measurement: row.measurement,
      asbuilt: row.asbuilt,
      billing: row.billing,
      quantityDiffAsbuiltMeasurement,
      quantityDiffBillingMeasurement,
      valueDiffAsbuiltMeasurement,
      valueDiffBillingMeasurement,
      hasMeasurement,
      hasAsbuilt,
      hasBilling,
      isMissingInAnyBase,
      isDivergent,
      situation: missingLabels.length ? `Ausente em ${missingLabels.join(", ")}` : isDivergent ? "Divergente" : "Conferido",
    };
  });
}

export async function GET(request: NextRequest) {
  const resolution = await resolveDashContext(request);
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const tenantId = resolution.appUser.tenant_id;
  const projectId = normalizeUuid(request.nextUrl.searchParams.get("projectId"));
  const serviceCenterId = normalizeUuid(request.nextUrl.searchParams.get("serviceCenterId"));
  const activityCodeFilter = normalizeCode(request.nextUrl.searchParams.get("activityCode"));
  const activityStatusFilter = normalizeActivityStatusFilter(request.nextUrl.searchParams.get("activityStatus"));
  const onlyDivergences = normalizeBoolean(request.nextUrl.searchParams.get("onlyDivergences"));
  const onlyMissing = normalizeBoolean(request.nextUrl.searchParams.get("onlyMissing"));
  const includeChart = normalizeBoolean(request.nextUrl.searchParams.get("includeChart"));
  const includeProjectValues = normalizeBoolean(request.nextUrl.searchParams.get("includeProjectValues"));
  const includeOperationalCategoryCards = normalizeBoolean(request.nextUrl.searchParams.get("includeOperationalCategoryCards"));
  const includeAsbuiltBreakdown = normalizeBoolean(request.nextUrl.searchParams.get("includeAsbuiltBreakdown"));
  const includeOperationalCategoryDetail = normalizeBoolean(request.nextUrl.searchParams.get("includeOperationalCategoryDetail"));
  const includeChartProjectDetail = normalizeBoolean(request.nextUrl.searchParams.get("includeChartProjectDetail"));
  const chartProjectId = normalizeUuid(request.nextUrl.searchParams.get("chartProjectId"));
  const chartServiceCenterId = normalizeUuid(request.nextUrl.searchParams.get("chartServiceCenterId"));
  const asbuiltBreakdownProjectId = normalizeUuid(request.nextUrl.searchParams.get("asbuiltBreakdownProjectId"));
  const operationalCategoryKey = normalizeText(request.nextUrl.searchParams.get("operationalCategoryKey"));
  const chartIndicatorKey = normalizeText(request.nextUrl.searchParams.get("chartIndicatorKey")) as ChartIndicatorKey;
  const asbuiltCoverageEndDate = normalizeIsoDate(request.nextUrl.searchParams.get("asbuiltCoverageEndDate"));
  const operationalMonth = normalizeMonth(request.nextUrl.searchParams.get("operationalMonth"));
  const operationalDateRange = buildMonthRange(operationalMonth);
  const operationalRate = normalizeRateFilter(request.nextUrl.searchParams.get("operationalRate"));

  try {
    const projects = await loadProjects(resolution.supabase, tenantId);
    const serviceCenters = Array.from(
      new Map(
        projects
          .filter((project) => project.serviceCenterId)
          .map((project) => [project.serviceCenterId as string, { id: project.serviceCenterId as string, label: project.serviceCenter }]),
      ).values(),
    ).sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));
    const asbuiltCoverageDates = await loadAsbuiltCoverageDateOptions({
      supabase: resolution.supabase,
      tenantId,
      projectIds: projects.map((project) => project.id),
    });
    const asbuiltCoverageRange = buildAsbuiltCoverageRange(
      asbuiltCoverageDates.map((coverageDate) => coverageDate.id),
      asbuiltCoverageEndDate,
    );

    if (includeAsbuiltBreakdown) {
      const breakdownProject = projects.find((project) => project.id === asbuiltBreakdownProjectId) ?? null;

      if (!breakdownProject) {
        return NextResponse.json({ message: "Projeto nao encontrado para detalhar o Asbuilt." }, { status: 404 });
      }

      const asbuiltBreakdownRows = await buildAsbuiltBreakdownRows({
        supabase: resolution.supabase,
        tenantId,
        project: breakdownProject,
        asbuiltCoverageEndDate,
        asbuiltCoverageRange,
      });

      return NextResponse.json({
        filters: { projects, serviceCenters, asbuiltCoverageDates },
        selectedProject: breakdownProject,
        asbuiltBreakdownRows,
      });
    }

    if (includeOperationalCategoryDetail) {
      const [operationalCategoryDetailRows, operationalMeasurementAsbuiltCategoryDetailRows, operationalAsbuiltCategoryDetailRows, operationalBillingCategoryDetailRows] = await Promise.all([
        buildOperationalMeasurementCategoryDetailRows({
          supabase: resolution.supabase,
          tenantId,
          projects,
          categoryKey: operationalCategoryKey,
          operationalDateRange,
          operationalRate,
        }),
        buildOperationalMeasurementCategoryDetailRows({
          supabase: resolution.supabase,
          tenantId,
          projects,
          categoryKey: operationalCategoryKey,
          onlyProjectsWithAsbuilt: true,
          asbuiltCoverageEndDate,
          asbuiltCoverageRange,
          operationalDateRange,
          operationalRate,
        }),
        buildOperationalAsbuiltCategoryDetailRows({
          supabase: resolution.supabase,
          tenantId,
          projects,
          categoryKey: operationalCategoryKey,
          asbuiltCoverageEndDate,
          asbuiltCoverageRange,
          operationalDateRange,
          operationalRate,
        }),
        buildOperationalBillingCategoryDetailRows({
          supabase: resolution.supabase,
          tenantId,
          projects,
          categoryKey: operationalCategoryKey,
          operationalDateRange,
          operationalRate,
        }),
      ]);

      return NextResponse.json({
        filters: { projects, serviceCenters, asbuiltCoverageDates },
        operationalCategoryDetailRows,
        operationalMeasurementAsbuiltCategoryDetailRows,
        operationalAsbuiltCategoryDetailRows,
        operationalBillingCategoryDetailRows,
      });
    }

    if (includeChartProjectDetail) {
      if (!["totalMeasurement", "measurementAsbuilt", "asbuilt", "billing"].includes(chartIndicatorKey)) {
        return NextResponse.json({ message: "Indicador do grafico invalido para detalhamento." }, { status: 400 });
      }

      const chartProjectDetailRows = await buildChartProjectDetailRows({
        supabase: resolution.supabase,
        tenantId,
        projects,
        serviceCenterId: chartServiceCenterId,
        projectId: chartProjectId,
        indicatorKey: chartIndicatorKey,
        asbuiltCoverageEndDate,
        asbuiltCoverageRange,
      });

      return NextResponse.json({
        filters: { projects, serviceCenters, asbuiltCoverageDates },
        chartProjectDetailRows,
      });
    }

    if (!projectId) {
      const [chartItems, projectValueRows, operationalIndicators] = await Promise.all([
        includeChart
          ? buildChartItems({
              supabase: resolution.supabase,
              tenantId,
              projects,
              serviceCenterId: chartServiceCenterId,
              projectId: chartProjectId,
              asbuiltCoverageEndDate,
              asbuiltCoverageRange,
            })
          : Promise.resolve([]),
        includeProjectValues
          ? buildProjectValueRows({
              supabase: resolution.supabase,
              tenantId,
              projects,
            })
          : Promise.resolve([]),
        includeOperationalCategoryCards
          ? buildOperationalMeasurementCategoryCards({
              supabase: resolution.supabase,
              tenantId,
              projects,
              asbuiltCoverageEndDate,
              asbuiltCoverageRange,
              operationalDateRange,
            })
          : Promise.resolve(null),
      ]);

      return NextResponse.json({
        filters: { projects, serviceCenters, asbuiltCoverageDates },
        selectedProject: null,
        rows: [],
        billingCategories: [],
        categoryColumns: [],
        categorySummaryRows: [],
        chartItems,
        projectValueRows,
        operationalCategoryCards: operationalIndicators?.categoryCards ?? [],
        operationalAverageTickets: operationalIndicators?.averageTickets ?? null,
        summary: null,
      });
    }

    const selectedProject = projects.find((project) => project.id === projectId) ?? null;
    if (!selectedProject) {
      return NextResponse.json({ message: "Projeto nao encontrado para o tenant atual." }, { status: 404 });
    }

    if (serviceCenterId && selectedProject.serviceCenterId !== serviceCenterId) {
      return NextResponse.json({
        filters: { projects, serviceCenters, asbuiltCoverageDates },
        selectedProject,
        rows: [],
        billingCategories: [],
        summary: {
          totalRows: 0,
          divergentRows: 0,
          missingRows: 0,
          conferredRows: 0,
          measurementValue: 0,
          asbuiltValue: 0,
          billingValue: 0,
        },
      });
    }

    const [measurementOrderIds, asbuiltOrderIds, billingOrderIds] = await Promise.all([
      loadOrderIds({ supabase: resolution.supabase, tenantId, table: "project_measurement_orders", projectId }),
      loadOrderIds({ supabase: resolution.supabase, tenantId, table: "project_asbuilt_measurement_orders", projectId }),
      loadOrderIds({ supabase: resolution.supabase, tenantId, table: "project_billing_orders", projectId }),
    ]);

    const [measurementItems, asbuiltItems, billingItems] = await Promise.all([
      loadMeasurementItems({ supabase: resolution.supabase, tenantId, orderIds: measurementOrderIds }),
      loadCommercialItems({
        supabase: resolution.supabase,
        tenantId,
        table: "project_asbuilt_measurement_order_items",
        orderColumn: "asbuilt_measurement_order_id",
        orderIds: asbuiltOrderIds,
      }),
      loadCommercialItems({
        supabase: resolution.supabase,
        tenantId,
        table: "project_billing_order_items",
        orderColumn: "billing_order_id",
        orderIds: billingOrderIds,
      }),
    ]);

    const aggregate = new Map<string, AggregatedRow>();
    for (const item of measurementItems) addItem(aggregate, "measurement", item);
    for (const item of asbuiltItems) addItem(aggregate, "asbuilt", item);
    for (const item of billingItems) addItem(aggregate, "billing", item);

    const activityIds = Array.from(aggregate.values()).flatMap((row) => Array.from(row.activityIds));
    const billingActivityIds = billingItems.map((item) => item.service_activity_id);
    const allActivityIds = Array.from(new Set([...activityIds, ...billingActivityIds].filter(Boolean)));
    const [activityStatusMap, activityCategoryMap] = await Promise.all([
      loadActivityStatusMap({ supabase: resolution.supabase, tenantId, activityIds: allActivityIds }),
      loadActivityCategoryMap({ supabase: resolution.supabase, tenantId, activityIds: allActivityIds }),
    ]);
    const allRows = finalizeRows(Array.from(aggregate.values()), activityStatusMap)
      .filter((row) => !activityCodeFilter || row.code.includes(activityCodeFilter))
      .filter((row) => activityStatusFilter === "TODAS" || row.activityStatus === activityStatusFilter)
      .filter((row) => !onlyDivergences || row.isDivergent)
      .filter((row) => !onlyMissing || row.isMissingInAnyBase)
      .sort((left, right) => left.code.localeCompare(right.code, "pt-BR"));

    const billingCategories = buildBillingCategoryRows({
      rows: allRows,
      billingItems,
      activityToCategory: activityCategoryMap.activityToCategory,
      categoryNameById: activityCategoryMap.categoryNameById,
    });
    const categorySummary = buildCategorySummary({
      rows: allRows,
      items: [...measurementItems, ...asbuiltItems, ...billingItems],
      activityToCategory: activityCategoryMap.activityToCategory,
      categoryNameById: activityCategoryMap.categoryNameById,
    });

    const summary = allRows.reduce(
      (accumulator, row) => ({
        totalRows: accumulator.totalRows + 1,
        divergentRows: accumulator.divergentRows + (row.isDivergent ? 1 : 0),
        missingRows: accumulator.missingRows + (row.isMissingInAnyBase ? 1 : 0),
        conferredRows: accumulator.conferredRows + (!row.isDivergent ? 1 : 0),
        measurementValue: accumulator.measurementValue + row.measurement.value,
        asbuiltValue: accumulator.asbuiltValue + row.asbuilt.value,
        billingValue: accumulator.billingValue + row.billing.value,
      }),
      {
        totalRows: 0,
        divergentRows: 0,
        missingRows: 0,
        conferredRows: 0,
        measurementValue: 0,
        asbuiltValue: 0,
        billingValue: 0,
      },
    );

    const payload = {
      filters: { projects, serviceCenters, asbuiltCoverageDates },
      selectedProject,
      rows: allRows,
      billingCategories,
      categoryColumns: categorySummary.categoryColumns,
      categorySummaryRows: categorySummary.categorySummaryRows,
      summary,
    };
    const payloadSize = JSON.stringify(payload).length;
    if (payloadSize > 100_000) {
      console.warn(`[resp-size] GET /api/dash-operacional-faturamento ${Math.round(payloadSize / 1024)}KB tenant=${tenantId}`);
    }
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar Dash operacional e faturamento.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
