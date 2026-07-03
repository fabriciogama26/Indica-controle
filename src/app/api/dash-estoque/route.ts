import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";

type StockCenterRow = {
  id: string;
  name: string;
  center_type: "OWN" | "THIRD_PARTY";
  controls_balance: boolean;
  is_active: boolean;
};

type TeamCenterRow = {
  id: string;
  name: string;
  stock_center_id: string | null;
};

type MaterialRow = {
  id: string;
  codigo: string;
  descricao: string;
  umb: string | null;
  tipo: string | null;
  unit_price: number | string | null;
  is_active: boolean;
};

type BalanceRow = {
  stock_center_id: string;
  material_id: string;
  quantity: number | string | null;
  updated_at: string | null;
  materials: MaterialRow | MaterialRow[] | null;
};

type TransferRow = {
  id: string;
  operation_event_id: string | null;
  movement_type: "ENTRY" | "EXIT" | "TRANSFER";
  from_stock_center_id: string;
  to_stock_center_id: string;
  project_id: string | null;
  entry_date: string;
  updated_at: string | null;
  created_at: string;
};

type TransferItemRow = {
  id: string;
  stock_transfer_id: string;
  material_id: string;
  quantity: number | string | null;
};

type TeamOperationRow = {
  transfer_id: string;
  team_id: string;
  operation_kind: "REQUISITION" | "RETURN" | "FIELD_RETURN" | null;
  team_name_snapshot: string | null;
  foreman_name_snapshot: string | null;
};

type TeamRow = {
  id: string;
  name: string;
  stock_center_id: string | null;
};

type ProjectRow = {
  id: string;
  sob: string | null;
};

type TransferReversalRow = {
  original_stock_transfer_id: string;
  reversal_stock_transfer_id: string;
};

type ItemReversalRow = {
  original_stock_transfer_item_id: string;
  reversal_stock_transfer_item_id: string | null;
};

type MaterialAggregate = {
  materialId: string;
  materialCode: string;
  description: string;
  unit: string;
  materialType: string;
  unitPrice: number;
  balanceQuantity: number;
  estimatedValue: number;
  lastMovementAt: string | null;
};

type MovementAggregate = {
  transferId: string;
  operationEventId: string;
  transferItemId: string;
  operationKind: "ENTRY" | "EXIT" | "TRANSFER" | "REQUISITION" | "RETURN" | "FIELD_RETURN";
  materialId: string;
  materialCode: string;
  description: string;
  unit: string;
  materialType: string;
  quantity: number;
  entryDate: string;
  changedAt: string;
  stockCenterId: string | null;
  teamId: string | null;
  teamName: string | null;
  projectId: string | null;
  projectCode: string | null;
};

type ScatterUnitSummary = {
  operationKind: "REQUISITION" | "RETURN";
  unit: string;
  quantity: number;
  materialIds: Set<string>;
  operationIds: Set<string>;
};

const DASH_IN_FILTER_CHUNK_SIZE = 100;

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeCode(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function normalizeUuid(value: unknown) {
  const normalized = normalizeText(value);
  return /^[0-9a-f-]{36}$/i.test(normalized) ? normalized : null;
}

function normalizeIsoDate(value: unknown) {
  const normalized = normalizeText(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeMaterialType(value: unknown) {
  const normalized = normalizeCode(value);
  return normalized === "NOVO" || normalized === "SUCATA" ? normalized : "";
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function unwrapRelation<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function toTimestamp(value: string | null) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickLatestDate(left: string | null, right: string | null) {
  return toTimestamp(right) > toTimestamp(left) ? right : left;
}

function currentYearPeriod() {
  const year = new Date().getFullYear();
  return {
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
  };
}

function monthKey(value: string) {
  return normalizeText(value).slice(0, 7);
}

function formatMonthLabel(value: string) {
  const [year, month] = value.split("-");
  return `${month}/${year}`;
}

function buildFallbackOperationEventId(params: {
  entryDate: string;
  teamId: string | null;
  projectId: string | null;
  operationKind: string;
}) {
  return [
    normalizeText(params.entryDate).slice(0, 10),
    params.teamId ?? "SEM_EQUIPE",
    params.projectId ?? "SEM_PROJETO",
    normalizeCode(params.operationKind),
  ].join(":");
}

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function ensureDashPageAccess(resolution: AuthenticatedAppUserContext) {
  if (resolution.role.isAdmin) return true;

  const userPermission = await resolution.supabase
    .from("app_user_page_permissions")
    .select("can_access")
    .eq("tenant_id", resolution.appUser.tenant_id)
    .eq("user_id", resolution.appUser.id)
    .eq("page_key", "dash-estoque")
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
    .eq("page_key", "dash-estoque")
    .maybeSingle<{ can_access: boolean }>();

  return !rolePermission.error && Boolean(rolePermission.data?.can_access);
}

async function resolveDashContext(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar Dashboard Estoque.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) return resolution;

  const canAccess = await ensureDashPageAccess(resolution);
  if (!canAccess) {
    return {
      error: {
        status: 403,
        message: "Acesso negado para carregar Dashboard Estoque.",
      },
    };
  }

  return resolution;
}

async function loadPhysicalStockCenters(context: AuthenticatedAppUserContext) {
  const [stockCentersResult, teamCentersResult] = await Promise.all([
    context.supabase
      .from("stock_centers")
      .select("id, name, center_type, controls_balance, is_active")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("is_active", true)
      .eq("center_type", "OWN")
      .order("name", { ascending: true })
      .returns<StockCenterRow[]>(),
    context.supabase
      .from("teams")
      .select("id, name, stock_center_id")
      .eq("tenant_id", context.appUser.tenant_id)
      .returns<TeamCenterRow[]>(),
  ]);

  if (stockCentersResult.error || teamCentersResult.error) {
    throw new Error("Falha ao carregar centros de estoque do dashboard.");
  }

  const teamStockCenterIds = new Set(
    (teamCentersResult.data ?? [])
      .map((team) => normalizeText(team.stock_center_id))
      .filter(Boolean),
  );

  const stockCenters = (stockCentersResult.data ?? [])
    .filter((center) => !teamStockCenterIds.has(center.id))
    .map((center) => ({
      id: center.id,
      name: center.name,
      controlsBalance: Boolean(center.controls_balance),
    }));

  const teamByStockCenterId = new Map(
    (teamCentersResult.data ?? [])
      .filter((team) => team.stock_center_id)
      .map((team) => [team.stock_center_id as string, { id: team.id, name: team.name }]),
  );

  return { stockCenters, teamByStockCenterId };
}

async function loadBalances(params: {
  context: AuthenticatedAppUserContext;
  stockCenterIds: string[];
  materialCode: string;
  materialType: string;
}) {
  if (!params.stockCenterIds.length) return [] as BalanceRow[];

  const rows: BalanceRow[] = [];
  for (const centerIds of chunk(params.stockCenterIds, 500)) {
    let query = params.context.supabase
      .from("stock_center_balances")
      .select("stock_center_id, material_id, quantity, updated_at, materials!inner(id, codigo, descricao, umb, tipo, unit_price, is_active)")
      .eq("tenant_id", params.context.appUser.tenant_id)
      .eq("materials.is_active", true)
      .in("stock_center_id", centerIds);

    if (params.materialCode) query = query.ilike("materials.codigo", `%${params.materialCode}%`);
    if (params.materialType) query = query.eq("materials.tipo", params.materialType);

    const { data, error } = await query.returns<BalanceRow[]>();
    if (error) throw new Error("Falha ao carregar saldos do dashboard.");
    rows.push(...(data ?? []));
  }

  return rows;
}

async function loadTransfers(params: {
  context: AuthenticatedAppUserContext;
  startDate: string;
  endDate: string;
}) {
  const { data, error } = await params.context.supabase
    .from("stock_transfers")
    .select("id, operation_event_id, movement_type, from_stock_center_id, to_stock_center_id, project_id, entry_date, updated_at, created_at")
    .eq("tenant_id", params.context.appUser.tenant_id)
    .gte("entry_date", params.startDate)
    .lte("entry_date", params.endDate)
    .order("entry_date", { ascending: true })
    .limit(5000)
    .returns<TransferRow[]>();

  if (error) throw new Error("Falha ao carregar movimentacoes do dashboard.");
  return data ?? [];
}

async function loadTransferItems(params: {
  context: AuthenticatedAppUserContext;
  transferIds: string[];
}) {
  const rows: TransferItemRow[] = [];
  for (const ids of chunk(params.transferIds, DASH_IN_FILTER_CHUNK_SIZE)) {
    const { data, error } = await params.context.supabase
      .from("stock_transfer_items")
      .select("id, stock_transfer_id, material_id, quantity")
      .eq("tenant_id", params.context.appUser.tenant_id)
      .in("stock_transfer_id", ids)
      .returns<TransferItemRow[]>();

    if (error) {
      console.error("[dash-estoque] Falha ao carregar stock_transfer_items", {
        tenantId: params.context.appUser.tenant_id,
        transferCount: params.transferIds.length,
        chunkSize: ids.length,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      throw new Error("Falha ao carregar itens das movimentacoes do dashboard.");
    }
    rows.push(...(data ?? []));
  }
  return rows;
}

async function loadMovementMaterials(params: {
  context: AuthenticatedAppUserContext;
  materialIds: string[];
  materialCode: string;
  materialType: string;
}) {
  const result = new Map<string, MaterialRow>();
  const materialIds = Array.from(new Set(params.materialIds.filter(Boolean)));

  for (const ids of chunk(materialIds, 500)) {
    let query = params.context.supabase
      .from("materials")
      .select("id, codigo, descricao, umb, tipo, unit_price, is_active")
      .eq("tenant_id", params.context.appUser.tenant_id)
      .eq("is_active", true)
      .in("id", ids);

    if (params.materialCode) query = query.ilike("codigo", `%${params.materialCode}%`);
    if (params.materialType) query = query.eq("tipo", params.materialType);

    const { data, error } = await query.returns<MaterialRow[]>();
    if (error) throw new Error("Falha ao carregar materiais das movimentacoes do dashboard.");

    for (const row of data ?? []) result.set(row.id, row);
  }

  return result;
}

async function loadTeamOperations(params: {
  context: AuthenticatedAppUserContext;
  transferIds: string[];
}) {
  const rows: TeamOperationRow[] = [];
  for (const ids of chunk(params.transferIds, DASH_IN_FILTER_CHUNK_SIZE)) {
    const { data, error } = await params.context.supabase
      .from("stock_transfer_team_operations")
      .select("transfer_id, team_id, operation_kind, team_name_snapshot, foreman_name_snapshot")
      .eq("tenant_id", params.context.appUser.tenant_id)
      .in("transfer_id", ids)
      .returns<TeamOperationRow[]>();

    if (error) throw new Error("Falha ao carregar operacoes de equipe do dashboard.");
    rows.push(...(data ?? []));
  }
  return rows;
}

async function loadProjects(params: {
  context: AuthenticatedAppUserContext;
  projectIds: string[];
}) {
  const result = new Map<string, string>();
  const projectIds = Array.from(new Set(params.projectIds.filter(Boolean)));

  for (const ids of chunk(projectIds, 500)) {
    const { data, error } = await params.context.supabase
      .from("project")
      .select("id, sob")
      .eq("tenant_id", params.context.appUser.tenant_id)
      .in("id", ids)
      .returns<ProjectRow[]>();

    if (error) throw new Error("Falha ao carregar projetos do dashboard.");
    for (const row of data ?? []) {
      result.set(row.id, normalizeText(row.sob) || row.id);
    }
  }

  return result;
}

async function loadTeams(params: {
  context: AuthenticatedAppUserContext;
  teamIds: string[];
}) {
  const result = new Map<string, TeamRow>();
  const teamIds = Array.from(new Set(params.teamIds.filter(Boolean)));

  for (const ids of chunk(teamIds, 500)) {
    const { data, error } = await params.context.supabase
      .from("teams")
      .select("id, name, stock_center_id")
      .eq("tenant_id", params.context.appUser.tenant_id)
      .in("id", ids)
      .returns<TeamRow[]>();

    if (error) throw new Error("Falha ao carregar equipes do dashboard.");
    for (const row of data ?? []) result.set(row.id, row);
  }

  return result;
}

async function loadReversalSets(params: {
  context: AuthenticatedAppUserContext;
  transferIds: string[];
  itemIds: string[];
}) {
  const reversedTransferIds = new Set<string>();
  const reversalTransferIds = new Set<string>();
  const reversedItemIds = new Set<string>();
  const reversalItemIds = new Set<string>();

  for (const ids of chunk(params.transferIds, DASH_IN_FILTER_CHUNK_SIZE)) {
    const [fromOriginal, fromReversal] = await Promise.all([
      params.context.supabase
        .from("stock_transfer_reversals")
        .select("original_stock_transfer_id, reversal_stock_transfer_id")
        .eq("tenant_id", params.context.appUser.tenant_id)
        .in("original_stock_transfer_id", ids)
        .returns<TransferReversalRow[]>(),
      params.context.supabase
        .from("stock_transfer_reversals")
        .select("original_stock_transfer_id, reversal_stock_transfer_id")
        .eq("tenant_id", params.context.appUser.tenant_id)
        .in("reversal_stock_transfer_id", ids)
        .returns<TransferReversalRow[]>(),
    ]);

    for (const row of fromOriginal.data ?? []) {
      reversedTransferIds.add(row.original_stock_transfer_id);
      reversalTransferIds.add(row.reversal_stock_transfer_id);
    }
    for (const row of fromReversal.data ?? []) {
      reversedTransferIds.add(row.original_stock_transfer_id);
      reversalTransferIds.add(row.reversal_stock_transfer_id);
    }
  }

  for (const ids of chunk(params.itemIds, DASH_IN_FILTER_CHUNK_SIZE)) {
    const [fromOriginal, fromReversal] = await Promise.all([
      params.context.supabase
        .from("stock_transfer_item_reversals")
        .select("original_stock_transfer_item_id, reversal_stock_transfer_item_id")
        .eq("tenant_id", params.context.appUser.tenant_id)
        .in("original_stock_transfer_item_id", ids)
        .returns<ItemReversalRow[]>(),
      params.context.supabase
        .from("stock_transfer_item_reversals")
        .select("original_stock_transfer_item_id, reversal_stock_transfer_item_id")
        .eq("tenant_id", params.context.appUser.tenant_id)
        .in("reversal_stock_transfer_item_id", ids)
        .returns<ItemReversalRow[]>(),
    ]);

    if (!fromOriginal.error) {
      for (const row of fromOriginal.data ?? []) {
        reversedItemIds.add(row.original_stock_transfer_item_id);
        if (row.reversal_stock_transfer_item_id) reversalItemIds.add(row.reversal_stock_transfer_item_id);
      }
    }
    if (!fromReversal.error) {
      for (const row of fromReversal.data ?? []) {
        reversedItemIds.add(row.original_stock_transfer_item_id);
        if (row.reversal_stock_transfer_item_id) reversalItemIds.add(row.reversal_stock_transfer_item_id);
      }
    }
  }

  return { reversedTransferIds, reversalTransferIds, reversedItemIds, reversalItemIds };
}

function resolveOperationKind(params: {
  transfer: TransferRow;
  teamOperation: TeamOperationRow | null;
  team: TeamRow | null;
}) {
  if (!params.teamOperation) return params.transfer.movement_type;
  if (params.teamOperation.operation_kind) return params.teamOperation.operation_kind;
  if (params.team?.stock_center_id && params.transfer.to_stock_center_id === params.team.stock_center_id) return "REQUISITION";
  return "RETURN";
}

function applyBalanceRow(target: Map<string, MaterialAggregate>, row: BalanceRow) {
  const material = unwrapRelation(row.materials);
  if (!material) return;

  const current = target.get(row.material_id) ?? {
    materialId: row.material_id,
    materialCode: material.codigo,
    description: material.descricao,
    unit: normalizeText(material.umb).toUpperCase() || "SEM UMB",
    materialType: normalizeText(material.tipo).toUpperCase() || "NAO INFORMADO",
    unitPrice: numberValue(material.unit_price),
    balanceQuantity: 0,
    estimatedValue: 0,
    lastMovementAt: null,
  };

  current.balanceQuantity += numberValue(row.quantity);
  current.unitPrice = numberValue(material.unit_price);
  current.estimatedValue = current.balanceQuantity * current.unitPrice;
  current.lastMovementAt = pickLatestDate(current.lastMovementAt, row.updated_at);
  target.set(row.material_id, current);
}

function ensureMovementMaterial(target: Map<string, MaterialAggregate>, movement: MovementAggregate) {
  const current = target.get(movement.materialId);
  if (current) {
    current.lastMovementAt = pickLatestDate(current.lastMovementAt, movement.changedAt);
    target.set(current.materialId, current);
    return;
  }

  target.set(movement.materialId, {
    materialId: movement.materialId,
    materialCode: movement.materialCode,
    description: movement.description,
    unit: movement.unit || "SEM UMB",
    materialType: movement.materialType || "NAO INFORMADO",
    unitPrice: 0,
    balanceQuantity: 0,
    estimatedValue: 0,
    lastMovementAt: movement.changedAt,
  });
}

function buildCriticalRows(items: MaterialAggregate[], criticalQty: number) {
  return items
    .filter((item) => item.balanceQuantity <= criticalQty)
    .sort((left, right) => left.balanceQuantity - right.balanceQuantity || left.materialCode.localeCompare(right.materialCode, "pt-BR"))
    .slice(0, 12)
    .map((item) => ({
      materialId: item.materialId,
      materialCode: item.materialCode,
      description: item.description,
      unit: item.unit,
      balanceQuantity: item.balanceQuantity,
      status: item.balanceQuantity <= 0 ? "ZERADO" : "CRITICO",
    }));
}

function buildTopBalanceRows(items: MaterialAggregate[]) {
  return [...items]
    .sort((left, right) => right.balanceQuantity - left.balanceQuantity)
    .slice(0, 12)
    .map((item) => ({
      materialId: item.materialId,
      materialCode: item.materialCode,
      description: item.description,
      unit: item.unit,
      balanceQuantity: item.balanceQuantity,
    }));
}

function buildIdleBuckets(items: MaterialAggregate[]) {
  const now = new Date();
  const buckets = [
    { key: "ate30", label: "Ate 30 dias", minDays: 0, maxDays: 30, materialCount: 0, balanceQuantity: 0 },
    { key: "31a60", label: "31 a 60 dias", minDays: 31, maxDays: 60, materialCount: 0, balanceQuantity: 0 },
    { key: "61a90", label: "61 a 90 dias", minDays: 61, maxDays: 90, materialCount: 0, balanceQuantity: 0 },
    { key: "mais90", label: "Mais de 90 dias", minDays: 91, maxDays: null, materialCount: 0, balanceQuantity: 0 },
    { key: "semData", label: "Sem movimento", minDays: null, maxDays: null, materialCount: 0, balanceQuantity: 0 },
  ];

  for (const item of items) {
    let bucket = buckets[buckets.length - 1];
    if (item.lastMovementAt) {
      const days = Math.max(0, Math.floor((now.getTime() - new Date(item.lastMovementAt).getTime()) / 86400000));
      bucket = buckets.find((candidate) => {
        if (candidate.minDays === null) return false;
        if (candidate.maxDays === null) return days >= candidate.minDays;
        return days >= candidate.minDays && days <= candidate.maxDays;
      }) ?? bucket;
    }

    bucket.materialCount += 1;
    bucket.balanceQuantity += item.balanceQuantity;
  }

  return buckets.map(({ key, label, materialCount, balanceQuantity }) => ({ key, label, materialCount, balanceQuantity }));
}

function buildAbcRows(items: MaterialAggregate[], mode: "value" | "quantity" = "value") {
  const rankedItems = [...items]
    .map((item) => ({
      ...item,
      estimatedValue: item.balanceQuantity * item.unitPrice,
      abcMetric: mode === "quantity" ? Math.max(0, item.balanceQuantity) : item.balanceQuantity * item.unitPrice,
    }))
    .sort((left, right) => right.abcMetric - left.abcMetric);
  const totalMetric = rankedItems.reduce((sum, item) => sum + item.abcMetric, 0);
  let cumulative = 0;
  const classes = new Map([
    ["A", { className: "A", materialCount: 0, estimatedValue: 0, balanceQuantity: 0, metricValue: 0 }],
    ["B", { className: "B", materialCount: 0, estimatedValue: 0, balanceQuantity: 0, metricValue: 0 }],
    ["C", { className: "C", materialCount: 0, estimatedValue: 0, balanceQuantity: 0, metricValue: 0 }],
  ]);

  for (const item of rankedItems) {
    cumulative += item.abcMetric;
    const percentage = totalMetric > 0 ? (cumulative / totalMetric) * 100 : 100;
    const className = percentage <= 80 ? "A" : percentage <= 95 ? "B" : "C";
    const row = classes.get(className)!;
    row.materialCount += 1;
    row.estimatedValue += item.estimatedValue;
    row.balanceQuantity += item.balanceQuantity;
    row.metricValue += item.abcMetric;
  }

  return Array.from(classes.values()).map((row) => ({
    className: row.className,
    materialCount: row.materialCount,
    estimatedValue: row.estimatedValue,
    balanceQuantity: row.balanceQuantity,
    percentage: totalMetric > 0 ? (row.metricValue / totalMetric) * 100 : 0,
  }));
}

function buildEvolutionRows(movements: MovementAggregate[], startDate: string, endDate: string) {
  const keys = new Set<string>();
  let current = new Date(`${startDate.slice(0, 7)}-01T00:00:00.000Z`);
  const end = new Date(`${endDate.slice(0, 7)}-01T00:00:00.000Z`);
  while (current <= end) {
    keys.add(current.toISOString().slice(0, 7));
    current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1));
  }

  const map = new Map(
    Array.from(keys).map((key) => [
      key,
      { period: key, label: formatMonthLabel(key), entry: 0, exit: 0, transfer: 0, requisition: 0, return: 0, fieldReturn: 0 },
    ]),
  );

  const countedOperations = new Set<string>();
  for (const movement of movements) {
    const key = monthKey(movement.entryDate);
    const row = map.get(key);
    if (!row) continue;
    const operationKey = `${key}:${movement.operationKind}:${movement.operationEventId}`;
    if (countedOperations.has(operationKey)) continue;
    countedOperations.add(operationKey);
    if (movement.operationKind === "ENTRY") row.entry += 1;
    if (movement.operationKind === "EXIT") row.exit += 1;
    if (movement.operationKind === "TRANSFER") row.transfer += 1;
    if (movement.operationKind === "REQUISITION") row.requisition += 1;
    if (movement.operationKind === "RETURN") row.return += 1;
    if (movement.operationKind === "FIELD_RETURN") row.fieldReturn += 1;
  }

  return Array.from(map.values()).sort((left, right) => left.period.localeCompare(right.period));
}

function buildScatterRows(movements: MovementAggregate[], balanceByMaterial: Map<string, MaterialAggregate>) {
  const map = new Map<string, {
    materialId: string;
    materialCode: string;
    description: string;
    unit: string;
    operationKind: "REQUISITION" | "RETURN";
    quantity: number;
    operationIds: Set<string>;
    projectIds: Set<string>;
    currentBalance: number;
  }>();

  for (const movement of movements) {
    if (movement.operationKind !== "REQUISITION" && movement.operationKind !== "RETURN") continue;
    const key = `${movement.operationKind}:${movement.materialId}`;
    const current = map.get(key) ?? {
      materialId: movement.materialId,
      materialCode: movement.materialCode,
      description: movement.description,
      unit: movement.unit,
      operationKind: movement.operationKind,
      quantity: 0,
      operationIds: new Set<string>(),
      projectIds: new Set<string>(),
      currentBalance: balanceByMaterial.get(movement.materialId)?.balanceQuantity ?? 0,
    };

    current.quantity += movement.quantity;
    current.operationIds.add(movement.transferId);
    if (movement.projectId) current.projectIds.add(movement.projectId);
    map.set(key, current);
  }

  return Array.from(map.values())
    .map((row) => ({
      materialId: row.materialId,
      materialCode: row.materialCode,
      description: row.description,
      unit: row.unit,
      operationKind: row.operationKind,
      quantity: row.quantity,
      operationCount: row.operationIds.size,
      projectCount: row.projectIds.size,
      currentBalance: row.currentBalance,
    }))
    .sort((left, right) => right.quantity - left.quantity)
    .slice(0, 80);
}

function buildScatterUnitSummary(movements: MovementAggregate[]) {
  const map = new Map<string, ScatterUnitSummary>();

  for (const movement of movements) {
    if (movement.operationKind !== "REQUISITION" && movement.operationKind !== "RETURN") continue;

    const unit = movement.unit || "SEM UMB";
    const key = `${movement.operationKind}:${unit}`;
    const current = map.get(key) ?? {
      operationKind: movement.operationKind,
      unit,
      quantity: 0,
      materialIds: new Set<string>(),
      operationIds: new Set<string>(),
    };

    current.quantity += movement.quantity;
    current.materialIds.add(movement.materialId);
    current.operationIds.add(movement.transferId);
    map.set(key, current);
  }

  return Array.from(map.values())
    .map((row) => ({
      operationKind: row.operationKind,
      unit: row.unit,
      quantity: row.quantity,
      materialCount: row.materialIds.size,
      operationCount: row.operationIds.size,
    }))
    .sort(
      (left, right) =>
        left.operationKind.localeCompare(right.operationKind) ||
        left.unit.localeCompare(right.unit, "pt-BR"),
    );
}

export async function GET(request: NextRequest) {
  const context = await resolveDashContext(request);
  if ("error" in context) {
    return NextResponse.json({ message: context.error.message }, { status: context.error.status });
  }

  const defaultPeriod = currentYearPeriod();
  const startDate = normalizeIsoDate(request.nextUrl.searchParams.get("startDate")) ?? defaultPeriod.startDate;
  const endDate = normalizeIsoDate(request.nextUrl.searchParams.get("endDate")) ?? defaultPeriod.endDate;
  const stockCenterId = normalizeUuid(request.nextUrl.searchParams.get("stockCenterId"));
  const teamId = normalizeUuid(request.nextUrl.searchParams.get("teamId"));
  const projectId = normalizeUuid(request.nextUrl.searchParams.get("projectId"));
  const materialCode = normalizeCode(request.nextUrl.searchParams.get("materialCode"));
  const materialType = normalizeMaterialType(request.nextUrl.searchParams.get("materialType"));
  const criticalQty = Math.max(0, Math.min(numberValue(request.nextUrl.searchParams.get("criticalQty")) || 5, 999999));

  if (startDate > endDate) {
    return NextResponse.json({ message: "Data inicial nao pode ser maior que a data final." }, { status: 400 });
  }

  try {
    const { stockCenters } = await loadPhysicalStockCenters(context);
    const availableStockCenterIds = stockCenters.map((center) => center.id);
    const scopedStockCenterIds = stockCenterId ? availableStockCenterIds.filter((id) => id === stockCenterId) : availableStockCenterIds;
    const stockCenterIdSet = new Set(scopedStockCenterIds);

    const [balances, transfers] = await Promise.all([
      loadBalances({ context, stockCenterIds: scopedStockCenterIds, materialCode, materialType }),
      loadTransfers({ context, startDate, endDate }),
    ]);

    const balanceByMaterial = new Map<string, MaterialAggregate>();
    for (const balance of balances) applyBalanceRow(balanceByMaterial, balance);

    const relevantTransfers = transfers.filter((transfer) => {
      const touchesScopedCenter = stockCenterIdSet.has(transfer.from_stock_center_id) || stockCenterIdSet.has(transfer.to_stock_center_id);
      if (!touchesScopedCenter) return false;
      if (projectId && transfer.project_id !== projectId) return false;
      return true;
    });
    const transferIds = relevantTransfers.map((transfer) => transfer.id);
    const transferMap = new Map(relevantTransfers.map((transfer) => [transfer.id, transfer]));
    const items = transferIds.length ? await loadTransferItems({ context, transferIds }) : [];
    const [teamOperations, projects, reversals, movementMaterials] = await Promise.all([
      transferIds.length ? loadTeamOperations({ context, transferIds }) : Promise.resolve([]),
      loadProjects({ context, projectIds: relevantTransfers.map((transfer) => transfer.project_id ?? "").filter(Boolean) }),
      loadReversalSets({ context, transferIds, itemIds: items.map((item) => item.id) }),
      loadMovementMaterials({ context, materialIds: items.map((item) => item.material_id), materialCode, materialType }),
    ]);
    const teamIds = Array.from(new Set(teamOperations.map((operation) => operation.team_id).filter(Boolean)));
    const teams = await loadTeams({ context, teamIds });
    const teamOperationByTransfer = new Map(teamOperations.map((operation) => [operation.transfer_id, operation]));

    const movements: MovementAggregate[] = [];
    for (const item of items) {
      const transfer = transferMap.get(item.stock_transfer_id);
      if (!transfer) continue;
      if (reversals.reversedTransferIds.has(transfer.id) || reversals.reversalTransferIds.has(transfer.id)) continue;
      if (reversals.reversedItemIds.has(item.id) || reversals.reversalItemIds.has(item.id)) continue;

      const material = movementMaterials.get(item.material_id) ?? null;
      if (!material) continue;
      const teamOperation = teamOperationByTransfer.get(transfer.id) ?? null;
      if (teamId && teamOperation?.team_id !== teamId) continue;
      const team = teamOperation?.team_id ? teams.get(teamOperation.team_id) ?? null : null;
      const operationKind = resolveOperationKind({ transfer, teamOperation, team });
      const operationEventId = transfer.operation_event_id ?? buildFallbackOperationEventId({
        entryDate: transfer.entry_date,
        teamId: teamOperation?.team_id ?? null,
        projectId: transfer.project_id,
        operationKind,
      });
      const movementStockCenterId = stockCenterIdSet.has(transfer.from_stock_center_id)
        ? transfer.from_stock_center_id
        : stockCenterIdSet.has(transfer.to_stock_center_id)
          ? transfer.to_stock_center_id
          : null;

      movements.push({
        transferId: transfer.id,
        operationEventId,
        transferItemId: item.id,
        operationKind,
        materialId: item.material_id,
        materialCode: material.codigo,
        description: material.descricao,
        unit: normalizeText(material.umb).toUpperCase() || "SEM UMB",
        materialType: normalizeText(material.tipo).toUpperCase() || "NAO INFORMADO",
        quantity: numberValue(item.quantity),
        entryDate: transfer.entry_date,
        changedAt: transfer.updated_at ?? transfer.created_at,
        stockCenterId: movementStockCenterId,
        teamId: teamOperation?.team_id ?? null,
        teamName: teamOperation?.team_name_snapshot ?? team?.name ?? null,
        projectId: transfer.project_id,
        projectCode: transfer.project_id ? projects.get(transfer.project_id) ?? transfer.project_id : null,
      });
    }

    for (const movement of movements) ensureMovementMaterial(balanceByMaterial, movement);

    const materials = Array.from(balanceByMaterial.values())
      .map((item) => ({
        ...item,
        estimatedValue: item.balanceQuantity * item.unitPrice,
      }))
      .sort((left, right) => left.materialCode.localeCompare(right.materialCode, "pt-BR"));

    const summaryByUnit = Array.from(
      materials.reduce((summary, item) => {
        const current = summary.get(item.unit) ?? { unit: item.unit, balanceQuantity: 0, materialCount: 0 };
        current.balanceQuantity += item.balanceQuantity;
        current.materialCount += 1;
        summary.set(item.unit, current);
        return summary;
      }, new Map<string, { unit: string; balanceQuantity: number; materialCount: number }>()),
      ([, value]) => value,
    ).sort((left, right) => left.unit.localeCompare(right.unit, "pt-BR"));

    const projectOptions = Array.from(
      new Map(
        movements
          .filter((movement) => movement.projectId && movement.projectCode)
          .map((movement) => [movement.projectId as string, { id: movement.projectId as string, label: movement.projectCode as string }]),
      ).values(),
    ).sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));

    const teamOptions = Array.from(
      new Map(
        teamOperations
          .map((operation) => {
            const team = teams.get(operation.team_id);
            return [operation.team_id, { id: operation.team_id, label: normalizeText(operation.team_name_snapshot) || team?.name || "Equipe nao informada" }] as const;
          }),
      ).values(),
    ).sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));

    const totalBalanceQuantity = materials.reduce((sum, item) => sum + item.balanceQuantity, 0);
    const totalEstimatedValue = materials.reduce((sum, item) => sum + item.estimatedValue, 0);
    const criticalCount = materials.filter((item) => item.balanceQuantity <= criticalQty).length;
    const zeroCount = materials.filter((item) => item.balanceQuantity <= 0).length;
    const movementCount = new Set(movements.map((movement) => movement.operationEventId)).size;
    const totalMovementQuantity = movements.reduce((sum, movement) => sum + movement.quantity, 0);

    return NextResponse.json({
      filters: {
        stockCenters,
        teams: teamOptions,
        projects: projectOptions,
      },
      appliedFilters: {
        startDate,
        endDate,
        stockCenterId,
        teamId,
        projectId,
        materialCode,
        materialType,
        criticalQty,
      },
      summary: {
        materialCount: materials.length,
        totalBalanceQuantity,
        totalEstimatedValue,
        criticalCount,
        zeroCount,
        movementCount,
        totalMovementQuantity,
      },
      summaryByUnit,
      criticalMaterials: buildCriticalRows(materials, criticalQty),
      topBalanceMaterials: buildTopBalanceRows(materials),
      idleBuckets: buildIdleBuckets(materials),
      abcRows: buildAbcRows(materials),
      abcQuantityRows: buildAbcRows(materials, "quantity"),
      movementEvolution: buildEvolutionRows(movements, startDate, endDate),
      scatterSummaryByUnit: buildScatterUnitSummary(movements),
      scatter: buildScatterRows(movements, balanceByMaterial),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar Dashboard Estoque.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
