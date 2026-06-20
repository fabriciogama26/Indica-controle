import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { normalizeDateInput, normalizeText } from "@/lib/server/stockTransfers";

type ReversalSource = "ESTOQUE" | "EQUIPE";
type ReversalType = "ITEM" | "INTEGRAL";

type ItemReversalRow = {
  original_stock_transfer_id: string;
  original_stock_transfer_item_id: string;
  reversal_stock_transfer_id: string;
  reversal_stock_transfer_item_id: string | null;
  reversal_reason: string;
  reversal_reason_code: string;
  reversal_reason_notes: string | null;
  created_at: string;
  created_by: string | null;
};

type FullReversalRow = {
  original_stock_transfer_id: string;
  reversal_stock_transfer_id: string;
  reversal_reason: string;
  reversal_reason_code: string;
  reversal_reason_notes: string | null;
  created_at: string;
  created_by: string | null;
};

type TransferRow = {
  id: string;
  movement_type: "ENTRY" | "EXIT" | "TRANSFER";
  from_stock_center_id: string;
  to_stock_center_id: string;
  project_id: string | null;
  entry_date: string;
  entry_type: "SUCATA" | "NOVO";
  created_at: string;
  updated_at: string;
};

type TransferItemRow = {
  id: string;
  stock_transfer_id: string;
  material_id: string;
  quantity: number | string | null;
  serial_number: string | null;
  lot_code: string | null;
};

type TeamOperationRow = {
  transfer_id: string;
  team_id: string;
  operation_kind: "REQUISITION" | "RETURN" | "FIELD_RETURN" | null;
  team_name_snapshot: string | null;
  foreman_name_snapshot: string | null;
};

type StockCenterRow = {
  id: string;
  name: string | null;
};

type ProjectRow = {
  id: string;
  sob: string | null;
};

type MaterialRow = {
  id: string;
  codigo: string | null;
  descricao: string | null;
  umb: string | null;
  tipo: string | null;
};

type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

type ReasonRow = {
  code: string;
  label_pt: string;
};

type ReversalListItem = {
  id: string;
  source: ReversalSource;
  sourceLabel: string;
  reversalType: ReversalType;
  reversalTypeLabel: string;
  operationCode: string;
  operationLabel: string;
  originalTransferId: string;
  originalTransferItemId: string | null;
  reversalTransferId: string;
  reversalTransferItemId: string | null;
  projectId: string | null;
  projectCode: string;
  teamId: string | null;
  teamName: string | null;
  foremanName: string | null;
  fromStockCenterName: string;
  toStockCenterName: string;
  materialId: string | null;
  materialCode: string;
  description: string;
  unit: string;
  materialType: string;
  quantity: number;
  serialNumber: string | null;
  lotCode: string | null;
  entryType: string;
  originalOperationDate: string;
  reversalOperationDate: string | null;
  reversedAt: string;
  reversalReasonCode: string;
  reversalReasonLabel: string;
  reversalReasonNotes: string | null;
  reversalReason: string;
  reversedByUserId: string | null;
  reversedByName: string;
};

function parsePositiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeUpper(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function uniqueValues(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean)));
}

function movementLabel(value: string) {
  if (value === "ENTRY") return "Entrada";
  if (value === "EXIT") return "Saida";
  if (value === "TRANSFER") return "Transferencia";
  return "Movimentacao";
}

function teamOperationLabel(value: string) {
  if (value === "REQUISITION") return "Requisicao";
  if (value === "RETURN") return "Devolucao";
  if (value === "FIELD_RETURN") return "Retorno de campo";
  return "Operacao de equipe";
}

async function ensureReversalsPageAccess(context: AuthenticatedAppUserContext) {
  if (context.role.isAdmin) return true;

  const userPermission = await context.supabase
    .from("app_user_page_permissions")
    .select("can_access")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("user_id", context.appUser.id)
    .eq("page_key", "estornos")
    .maybeSingle<{ can_access: boolean }>();

  if (!userPermission.error && userPermission.data) {
    return Boolean(userPermission.data.can_access);
  }

  if (!context.appUser.role_id) return false;

  const rolePermission = await context.supabase
    .from("role_page_permissions")
    .select("can_access")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("role_id", context.appUser.role_id)
    .eq("page_key", "estornos")
    .maybeSingle<{ can_access: boolean }>();

  return !rolePermission.error && Boolean(rolePermission.data?.can_access);
}

async function resolveReversalsContext(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar Estornos.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) return resolution;

  const canAccess = await ensureReversalsPageAccess(resolution);
  if (!canAccess) {
    return {
      error: {
        status: 403,
        message: "Acesso negado para carregar Estornos.",
      },
    };
  }

  return resolution;
}

async function loadItemReversals(context: AuthenticatedAppUserContext, startDate: string | null, endDate: string | null) {
  let query = context.supabase
    .from("stock_transfer_item_reversals")
    .select(
      "original_stock_transfer_id, original_stock_transfer_item_id, reversal_stock_transfer_id, reversal_stock_transfer_item_id, reversal_reason, reversal_reason_code, reversal_reason_notes, created_at, created_by",
    )
    .eq("tenant_id", context.appUser.tenant_id)
    .order("created_at", { ascending: false })
    .limit(2000);

  if (startDate) query = query.gte("created_at", `${startDate}T00:00:00`);
  if (endDate) query = query.lte("created_at", `${endDate}T23:59:59.999`);

  const { data, error } = await query.returns<ItemReversalRow[]>();
  if (error) throw new Error("Falha ao carregar estornos por item.");
  return data ?? [];
}

async function loadFullReversals(context: AuthenticatedAppUserContext, startDate: string | null, endDate: string | null) {
  let query = context.supabase
    .from("stock_transfer_reversals")
    .select(
      "original_stock_transfer_id, reversal_stock_transfer_id, reversal_reason, reversal_reason_code, reversal_reason_notes, created_at, created_by",
    )
    .eq("tenant_id", context.appUser.tenant_id)
    .order("created_at", { ascending: false })
    .limit(2000);

  if (startDate) query = query.gte("created_at", `${startDate}T00:00:00`);
  if (endDate) query = query.lte("created_at", `${endDate}T23:59:59.999`);

  const { data, error } = await query.returns<FullReversalRow[]>();
  if (error) throw new Error("Falha ao carregar estornos integrais.");
  return data ?? [];
}

async function loadTransfers(context: AuthenticatedAppUserContext, transferIds: string[]) {
  const rows: TransferRow[] = [];
  for (const ids of chunk(transferIds, 500)) {
    const { data, error } = await context.supabase
      .from("stock_transfers")
      .select("id, movement_type, from_stock_center_id, to_stock_center_id, project_id, entry_date, entry_type, created_at, updated_at")
      .eq("tenant_id", context.appUser.tenant_id)
      .in("id", ids)
      .returns<TransferRow[]>();

    if (error) throw new Error("Falha ao carregar movimentacoes vinculadas aos estornos.");
    rows.push(...(data ?? []));
  }
  return rows;
}

async function loadTransferItems(context: AuthenticatedAppUserContext, transferIds: string[]) {
  const rows: TransferItemRow[] = [];
  for (const ids of chunk(transferIds, 500)) {
    const { data, error } = await context.supabase
      .from("stock_transfer_items")
      .select("id, stock_transfer_id, material_id, quantity, serial_number, lot_code")
      .eq("tenant_id", context.appUser.tenant_id)
      .in("stock_transfer_id", ids)
      .returns<TransferItemRow[]>();

    if (error) throw new Error("Falha ao carregar itens vinculados aos estornos.");
    rows.push(...(data ?? []));
  }
  return rows;
}

async function loadTeamOperations(context: AuthenticatedAppUserContext, transferIds: string[]) {
  const rows: TeamOperationRow[] = [];
  for (const ids of chunk(transferIds, 500)) {
    const { data, error } = await context.supabase
      .from("stock_transfer_team_operations")
      .select("transfer_id, team_id, operation_kind, team_name_snapshot, foreman_name_snapshot")
      .eq("tenant_id", context.appUser.tenant_id)
      .in("transfer_id", ids)
      .returns<TeamOperationRow[]>();

    if (error) throw new Error("Falha ao carregar vinculos de Operacoes de Equipe.");
    rows.push(...(data ?? []));
  }
  return rows;
}

async function loadLookupMap<T extends { id: string }>(
  supabase: SupabaseClient,
  tableName: string,
  tenantId: string,
  ids: string[],
  select: string,
) {
  const rows: T[] = [];
  for (const currentIds of chunk(ids, 500)) {
    const { data, error } = await supabase
      .from(tableName)
      .select(select)
      .eq("tenant_id", tenantId)
      .in("id", currentIds)
      .returns<T[]>();

    if (error) throw new Error(`Falha ao carregar ${tableName}.`);
    rows.push(...(data ?? []));
  }
  return new Map(rows.map((row) => [row.id, row]));
}

async function loadReasonMap(context: AuthenticatedAppUserContext) {
  const { data, error } = await context.supabase
    .from("stock_transfer_reversal_reason_catalog")
    .select("code, label_pt")
    .returns<ReasonRow[]>();

  if (error) return new Map<string, string>();
  return new Map((data ?? []).map((row) => [row.code, row.label_pt]));
}

function buildItemReversalRow(params: {
  reversal: ItemReversalRow;
  originalTransfer: TransferRow;
  reversalTransfer: TransferRow | null;
  originalItem: TransferItemRow | null;
  reversalItem: TransferItemRow | null;
  teamOperation: TeamOperationRow | null;
  stockCenterMap: Map<string, StockCenterRow>;
  projectMap: Map<string, ProjectRow>;
  materialMap: Map<string, MaterialRow>;
  userMap: Map<string, AppUserRow>;
  reasonMap: Map<string, string>;
}) {
  const material = params.originalItem ? params.materialMap.get(params.originalItem.material_id) ?? null : null;
  const source: ReversalSource = params.teamOperation ? "EQUIPE" : "ESTOQUE";
  const operationCode = params.teamOperation?.operation_kind ?? params.originalTransfer.movement_type;
  const reasonLabel = params.reasonMap.get(params.reversal.reversal_reason_code) ?? params.reversal.reversal_reason;
  const user = params.reversal.created_by ? params.userMap.get(params.reversal.created_by) ?? null : null;

  return {
    id: `ITEM:${params.reversal.original_stock_transfer_item_id}:${params.reversal.reversal_stock_transfer_item_id ?? params.reversal.reversal_stock_transfer_id}`,
    source,
    sourceLabel: source === "EQUIPE" ? "Operacoes de Equipe" : "Movimentacao de Estoque",
    reversalType: "ITEM",
    reversalTypeLabel: "Por item",
    operationCode,
    operationLabel: params.teamOperation ? teamOperationLabel(operationCode) : movementLabel(operationCode),
    originalTransferId: params.reversal.original_stock_transfer_id,
    originalTransferItemId: params.reversal.original_stock_transfer_item_id,
    reversalTransferId: params.reversal.reversal_stock_transfer_id,
    reversalTransferItemId: params.reversal.reversal_stock_transfer_item_id,
    projectId: params.originalTransfer.project_id,
    projectCode: params.originalTransfer.project_id
      ? normalizeText(params.projectMap.get(params.originalTransfer.project_id)?.sob) || "-"
      : "-",
    teamId: params.teamOperation?.team_id ?? null,
    teamName: normalizeText(params.teamOperation?.team_name_snapshot) || null,
    foremanName: normalizeText(params.teamOperation?.foreman_name_snapshot) || null,
    fromStockCenterName: normalizeText(params.stockCenterMap.get(params.originalTransfer.from_stock_center_id)?.name) || "-",
    toStockCenterName: normalizeText(params.stockCenterMap.get(params.originalTransfer.to_stock_center_id)?.name) || "-",
    materialId: params.originalItem?.material_id ?? null,
    materialCode: normalizeText(material?.codigo) || "-",
    description: normalizeText(material?.descricao) || "-",
    unit: normalizeText(material?.umb) || "-",
    materialType: normalizeText(material?.tipo) || "-",
    quantity: numberValue(params.originalItem?.quantity),
    serialNumber: normalizeText(params.originalItem?.serial_number) || null,
    lotCode: normalizeText(params.originalItem?.lot_code) || null,
    entryType: params.originalTransfer.entry_type,
    originalOperationDate: params.originalTransfer.entry_date,
    reversalOperationDate: params.reversalTransfer?.entry_date ?? null,
    reversedAt: params.reversal.created_at,
    reversalReasonCode: params.reversal.reversal_reason_code,
    reversalReasonLabel: reasonLabel,
    reversalReasonNotes: normalizeText(params.reversal.reversal_reason_notes) || null,
    reversalReason: params.reversal.reversal_reason,
    reversedByUserId: params.reversal.created_by,
    reversedByName: normalizeText(user?.display ?? user?.login_name) || "Nao informado",
  } satisfies ReversalListItem;
}

function buildFullReversalRows(params: {
  reversal: FullReversalRow;
  originalTransfer: TransferRow;
  reversalTransfer: TransferRow | null;
  originalItems: TransferItemRow[];
  reversalItems: TransferItemRow[];
  teamOperation: TeamOperationRow | null;
  stockCenterMap: Map<string, StockCenterRow>;
  projectMap: Map<string, ProjectRow>;
  materialMap: Map<string, MaterialRow>;
  userMap: Map<string, AppUserRow>;
  reasonMap: Map<string, string>;
}) {
  const source: ReversalSource = params.teamOperation ? "EQUIPE" : "ESTOQUE";
  const operationCode = params.teamOperation?.operation_kind ?? params.originalTransfer.movement_type;
  const reasonLabel = params.reasonMap.get(params.reversal.reversal_reason_code) ?? params.reversal.reversal_reason;
  const user = params.reversal.created_by ? params.userMap.get(params.reversal.created_by) ?? null : null;

  return params.originalItems.map((item) => {
    const material = params.materialMap.get(item.material_id) ?? null;
    const reversalItem = params.reversalItems.find(
      (candidate) =>
        candidate.material_id === item.material_id
        && normalizeText(candidate.serial_number) === normalizeText(item.serial_number)
        && normalizeText(candidate.lot_code) === normalizeText(item.lot_code)
        && numberValue(candidate.quantity) === numberValue(item.quantity),
    ) ?? null;

    return {
      id: `INTEGRAL:${params.reversal.original_stock_transfer_id}:${item.id}`,
      source,
      sourceLabel: source === "EQUIPE" ? "Operacoes de Equipe" : "Movimentacao de Estoque",
      reversalType: "INTEGRAL",
      reversalTypeLabel: "Integral legado",
      operationCode,
      operationLabel: params.teamOperation ? teamOperationLabel(operationCode) : movementLabel(operationCode),
      originalTransferId: params.reversal.original_stock_transfer_id,
      originalTransferItemId: item.id,
      reversalTransferId: params.reversal.reversal_stock_transfer_id,
      reversalTransferItemId: reversalItem?.id ?? null,
      projectId: params.originalTransfer.project_id,
      projectCode: params.originalTransfer.project_id
        ? normalizeText(params.projectMap.get(params.originalTransfer.project_id)?.sob) || "-"
        : "-",
      teamId: params.teamOperation?.team_id ?? null,
      teamName: normalizeText(params.teamOperation?.team_name_snapshot) || null,
      foremanName: normalizeText(params.teamOperation?.foreman_name_snapshot) || null,
      fromStockCenterName: normalizeText(params.stockCenterMap.get(params.originalTransfer.from_stock_center_id)?.name) || "-",
      toStockCenterName: normalizeText(params.stockCenterMap.get(params.originalTransfer.to_stock_center_id)?.name) || "-",
      materialId: item.material_id,
      materialCode: normalizeText(material?.codigo) || "-",
      description: normalizeText(material?.descricao) || "-",
      unit: normalizeText(material?.umb) || "-",
      materialType: normalizeText(material?.tipo) || "-",
      quantity: numberValue(item.quantity),
      serialNumber: normalizeText(item.serial_number) || null,
      lotCode: normalizeText(item.lot_code) || null,
      entryType: params.originalTransfer.entry_type,
      originalOperationDate: params.originalTransfer.entry_date,
      reversalOperationDate: params.reversalTransfer?.entry_date ?? null,
      reversedAt: params.reversal.created_at,
      reversalReasonCode: params.reversal.reversal_reason_code,
      reversalReasonLabel: reasonLabel,
      reversalReasonNotes: normalizeText(params.reversal.reversal_reason_notes) || null,
      reversalReason: params.reversal.reversal_reason,
      reversedByUserId: params.reversal.created_by,
      reversedByName: normalizeText(user?.display ?? user?.login_name) || "Nao informado",
    } satisfies ReversalListItem;
  });
}

function applyFilters(rows: ReversalListItem[], request: NextRequest) {
  const originalStartDate = normalizeDateInput(request.nextUrl.searchParams.get("originalStartDate"));
  const originalEndDate = normalizeDateInput(request.nextUrl.searchParams.get("originalEndDate"));
  const source = normalizeUpper(request.nextUrl.searchParams.get("source"));
  const reversalType = normalizeUpper(request.nextUrl.searchParams.get("reversalType"));
  const operation = normalizeUpper(request.nextUrl.searchParams.get("operation"));
  const projectCode = normalizeUpper(request.nextUrl.searchParams.get("projectCode"));
  const teamName = normalizeUpper(request.nextUrl.searchParams.get("teamName"));
  const materialCode = normalizeUpper(request.nextUrl.searchParams.get("materialCode"));
  const serialNumber = normalizeUpper(request.nextUrl.searchParams.get("serialNumber"));
  const lotCode = normalizeUpper(request.nextUrl.searchParams.get("lotCode"));
  const reasonCode = normalizeUpper(request.nextUrl.searchParams.get("reasonCode"));
  const userId = normalizeText(request.nextUrl.searchParams.get("userId"));

  return rows.filter((row) => {
    if (originalStartDate && row.originalOperationDate < originalStartDate) return false;
    if (originalEndDate && row.originalOperationDate > originalEndDate) return false;
    if ((source === "ESTOQUE" || source === "EQUIPE") && row.source !== source) return false;
    if ((reversalType === "ITEM" || reversalType === "INTEGRAL") && row.reversalType !== reversalType) return false;
    if (operation && row.operationCode !== operation) return false;
    if (projectCode && !normalizeUpper(row.projectCode).includes(projectCode)) return false;
    if (teamName && !normalizeUpper(row.teamName).includes(teamName)) return false;
    if (materialCode && !normalizeUpper(row.materialCode).includes(materialCode)) return false;
    if (serialNumber && !normalizeUpper(row.serialNumber).includes(serialNumber)) return false;
    if (lotCode && !normalizeUpper(row.lotCode).includes(lotCode)) return false;
    if (reasonCode && row.reversalReasonCode !== reasonCode) return false;
    if (userId && row.reversedByUserId !== userId) return false;
    return true;
  });
}

function buildSummary(rows: ReversalListItem[]) {
  return rows.reduce(
    (accumulator, row) => ({
      total: accumulator.total + 1,
      stockMovementCount: accumulator.stockMovementCount + (row.source === "ESTOQUE" ? 1 : 0),
      teamOperationCount: accumulator.teamOperationCount + (row.source === "EQUIPE" ? 1 : 0),
      itemCount: accumulator.itemCount + (row.reversalType === "ITEM" ? 1 : 0),
      fullCount: accumulator.fullCount + (row.reversalType === "INTEGRAL" ? 1 : 0),
    }),
    {
      total: 0,
      stockMovementCount: 0,
      teamOperationCount: 0,
      itemCount: 0,
      fullCount: 0,
    },
  );
}

export async function GET(request: NextRequest) {
  const context = await resolveReversalsContext(request);
  if ("error" in context) {
    return NextResponse.json({ message: context.error.message }, { status: context.error.status });
  }

  const page = parsePositiveInteger(request.nextUrl.searchParams.get("page"), 1);
  const pageSize = Math.min(parsePositiveInteger(request.nextUrl.searchParams.get("pageSize"), 20), 100);
  const reversalStartDate = normalizeDateInput(request.nextUrl.searchParams.get("reversalStartDate"));
  const reversalEndDate = normalizeDateInput(request.nextUrl.searchParams.get("reversalEndDate"));

  try {
    const [itemReversals, fullReversals] = await Promise.all([
      loadItemReversals(context, reversalStartDate, reversalEndDate),
      loadFullReversals(context, reversalStartDate, reversalEndDate),
    ]);

    const transferIds = uniqueValues([
      ...itemReversals.flatMap((row) => [row.original_stock_transfer_id, row.reversal_stock_transfer_id]),
      ...fullReversals.flatMap((row) => [row.original_stock_transfer_id, row.reversal_stock_transfer_id]),
    ]);

    if (transferIds.length === 0) {
      return NextResponse.json({
        rows: [],
        summary: buildSummary([]),
        pagination: { page, pageSize, total: 0 },
        filters: { users: [], reasons: [] },
      });
    }

    const [transfers, items, teamOperations, reasonMap] = await Promise.all([
      loadTransfers(context, transferIds),
      loadTransferItems(context, transferIds),
      loadTeamOperations(context, transferIds),
      loadReasonMap(context),
    ]);

    const transferMap = new Map(transfers.map((row) => [row.id, row]));
    const itemMap = new Map(items.map((row) => [row.id, row]));
    const itemsByTransfer = new Map<string, TransferItemRow[]>();
    for (const item of items) {
      const current = itemsByTransfer.get(item.stock_transfer_id) ?? [];
      current.push(item);
      itemsByTransfer.set(item.stock_transfer_id, current);
    }

    const teamOperationMap = new Map(teamOperations.map((row) => [row.transfer_id, row]));
    const stockCenterIds = uniqueValues(transfers.flatMap((row) => [row.from_stock_center_id, row.to_stock_center_id]));
    const projectIds = uniqueValues(transfers.map((row) => row.project_id));
    const materialIds = uniqueValues(items.map((row) => row.material_id));
    const userIds = uniqueValues([
      ...itemReversals.map((row) => row.created_by),
      ...fullReversals.map((row) => row.created_by),
    ]);

    const [stockCenterMap, projectMap, materialMap, userMap] = await Promise.all([
      loadLookupMap<StockCenterRow>(context.supabase, "stock_centers", context.appUser.tenant_id, stockCenterIds, "id, name"),
      loadLookupMap<ProjectRow>(context.supabase, "project", context.appUser.tenant_id, projectIds, "id, sob"),
      loadLookupMap<MaterialRow>(context.supabase, "materials", context.appUser.tenant_id, materialIds, "id, codigo, descricao, umb, tipo"),
      loadLookupMap<AppUserRow>(context.supabase, "app_users", context.appUser.tenant_id, userIds, "id, display, login_name"),
    ]);

    const itemRows = itemReversals.flatMap((reversal) => {
      const originalTransfer = transferMap.get(reversal.original_stock_transfer_id);
      if (!originalTransfer) return [];
      return [
        buildItemReversalRow({
          reversal,
          originalTransfer,
          reversalTransfer: transferMap.get(reversal.reversal_stock_transfer_id) ?? null,
          originalItem: itemMap.get(reversal.original_stock_transfer_item_id) ?? null,
          reversalItem: reversal.reversal_stock_transfer_item_id
            ? itemMap.get(reversal.reversal_stock_transfer_item_id) ?? null
            : null,
          teamOperation: teamOperationMap.get(reversal.original_stock_transfer_id)
            ?? teamOperationMap.get(reversal.reversal_stock_transfer_id)
            ?? null,
          stockCenterMap,
          projectMap,
          materialMap,
          userMap,
          reasonMap,
        }),
      ];
    });

    const fullRows = fullReversals.flatMap((reversal) => {
      const originalTransfer = transferMap.get(reversal.original_stock_transfer_id);
      if (!originalTransfer) return [];
      return buildFullReversalRows({
        reversal,
        originalTransfer,
        reversalTransfer: transferMap.get(reversal.reversal_stock_transfer_id) ?? null,
        originalItems: itemsByTransfer.get(reversal.original_stock_transfer_id) ?? [],
        reversalItems: itemsByTransfer.get(reversal.reversal_stock_transfer_id) ?? [],
        teamOperation: teamOperationMap.get(reversal.original_stock_transfer_id)
          ?? teamOperationMap.get(reversal.reversal_stock_transfer_id)
          ?? null,
        stockCenterMap,
        projectMap,
        materialMap,
        userMap,
        reasonMap,
      });
    });

    const allRows = [...itemRows, ...fullRows].sort(
      (left, right) => new Date(right.reversedAt).getTime() - new Date(left.reversedAt).getTime(),
    );
    const filteredRows = applyFilters(allRows, request);
    const from = (page - 1) * pageSize;
    const pagedRows = filteredRows.slice(from, from + pageSize);

    const users = Array.from(
      new Map(
        filteredRows
          .filter((row) => row.reversedByUserId)
          .map((row) => [row.reversedByUserId as string, { id: row.reversedByUserId as string, name: row.reversedByName }]),
      ).values(),
    ).sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));

    const reasons = Array.from(
      new Map(
        filteredRows.map((row) => [
          row.reversalReasonCode,
          { code: row.reversalReasonCode, label: row.reversalReasonLabel },
        ]),
      ).values(),
    ).sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));

    return NextResponse.json({
      rows: pagedRows,
      summary: buildSummary(filteredRows),
      pagination: {
        page,
        pageSize,
        total: filteredRows.length,
      },
      filters: {
        users,
        reasons,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar Estornos.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
