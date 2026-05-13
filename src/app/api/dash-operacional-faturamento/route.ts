import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";

type ProjectRow = {
  id: string;
  sob: string | null;
  service_center: string | null;
  service_center_text: string | null;
  is_active: boolean | null;
  is_test?: boolean | null;
  is_withdrawn?: boolean | null;
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

type OrderIdRow = {
  id: string;
};

type MeasurementItemRow = {
  service_activity_id: string;
  activity_code: string;
  activity_description: string;
  activity_unit: string;
  quantity: number | string;
  total_value: number | string;
};

type CommercialItemRow = MeasurementItemRow & {
  activity_active_snapshot?: boolean | null;
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

function normalizeActivityStatusFilter(value: unknown): ActivityStatusFilter {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === "ATIVA" || normalized === "INATIVA") return normalized;
  return "TODAS";
}

function normalizeCode(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyTotals(): OriginTotals {
  return { quantity: 0, value: 0, itemCount: 0 };
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

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
  const { data, error } = await supabase
    .from("project_with_labels")
    .select("id, sob, service_center, service_center_text, is_active, is_test, is_withdrawn")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("sob", { ascending: true })
    .returns<ProjectRow[]>();

  if (error) {
    throw new Error("Falha ao carregar projetos do dashboard.");
  }

  return (data ?? [])
    .filter((project) => !project.is_test && !project.is_withdrawn)
    .map((project) => ({
      id: project.id,
      label: normalizeText(project.sob) || project.id,
      serviceCenterId: project.service_center,
      serviceCenter: normalizeText(project.service_center_text) || "Nao identificado",
    }));
}

async function loadOrderIds(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  table: "project_measurement_orders" | "project_asbuilt_measurement_orders" | "project_billing_orders";
  projectId: string;
}) {
  let query = params.supabase
    .from(params.table)
    .select("id")
    .eq("tenant_id", params.tenantId)
    .eq("project_id", params.projectId)
    .eq("is_active", true)
    .neq("status", "CANCELADA")
    .limit(50000);

  if (params.table === "project_measurement_orders") {
    query = query.eq("measurement_kind", "COM_PRODUCAO");
  }

  const { data, error } = await query.returns<OrderIdRow[]>();
  if (error) {
    throw new Error("Falha ao carregar ordens do dashboard.");
  }

  return (data ?? []).map((item) => item.id);
}

async function loadMeasurementItems(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  orderIds: string[];
}) {
  const rows: MeasurementItemRow[] = [];
  for (const ids of chunk(params.orderIds, 500)) {
    const { data, error } = await params.supabase
      .from("project_measurement_order_items")
      .select("service_activity_id, activity_code, activity_description, activity_unit, quantity, total_value")
      .eq("tenant_id", params.tenantId)
      .eq("is_active", true)
      .in("measurement_order_id", ids)
      .returns<MeasurementItemRow[]>();

    if (error) throw new Error("Falha ao carregar itens da Medicao.");
    rows.push(...(data ?? []));
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
  for (const ids of chunk(params.orderIds, 500)) {
    const { data, error } = await params.supabase
      .from(params.table)
      .select("service_activity_id, activity_code, activity_description, activity_unit, quantity, total_value, activity_active_snapshot")
      .eq("tenant_id", params.tenantId)
      .eq("is_active", true)
      .in(params.orderColumn, ids)
      .returns<CommercialItemRow[]>();

    if (error) throw new Error("Falha ao carregar itens comerciais do dashboard.");
    rows.push(...(data ?? []));
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
  for (const idChunk of chunk(ids, 500)) {
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

  for (const idChunk of chunk(ids, 500)) {
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
  for (const idChunk of chunk(Array.from(categoryIds), 500)) {
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
  row[origin].value += numberValue(item.total_value);
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

  try {
    const projects = await loadProjects(resolution.supabase, tenantId);
    const serviceCenters = Array.from(
      new Map(
        projects
          .filter((project) => project.serviceCenterId)
          .map((project) => [project.serviceCenterId as string, { id: project.serviceCenterId as string, label: project.serviceCenter }]),
      ).values(),
    ).sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));

    if (!projectId) {
      return NextResponse.json({
        filters: { projects, serviceCenters },
        selectedProject: null,
        rows: [],
        billingCategories: [],
        summary: null,
      });
    }

    const selectedProject = projects.find((project) => project.id === projectId) ?? null;
    if (!selectedProject) {
      return NextResponse.json({ message: "Projeto nao encontrado para o tenant atual." }, { status: 404 });
    }

    if (serviceCenterId && selectedProject.serviceCenterId !== serviceCenterId) {
      return NextResponse.json({
        filters: { projects, serviceCenters },
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
      loadActivityCategoryMap({ supabase: resolution.supabase, tenantId, activityIds: billingActivityIds }),
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

    return NextResponse.json({
      filters: { projects, serviceCenters },
      selectedProject,
      rows: allRows,
      billingCategories,
      summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar Dash operacional e faturamento.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
