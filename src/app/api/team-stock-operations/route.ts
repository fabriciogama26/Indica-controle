import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";

import { isSerialTrackedMaterial, normalizeSerialTrackingType } from "@/lib/materialSerialTracking";
import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import {
  normalizeDateInput,
  normalizeEntryType,
  normalizeText,
  parsePositiveNumber,
  StockTransferItemInput,
} from "@/lib/server/stockTransfers";
import {
  normalizeTeamOperationKind,
  saveTeamStockOperationViaRpc,
  TeamOperationKind,
} from "@/lib/server/teamStockOperations";

type MaterialHistoryRow = {
  id: string;
  changes: unknown;
  created_at: string;
  created_by: string | null;
};

type MaterialRow = {
  id: string;
  codigo: string;
  descricao: string;
  is_transformer?: boolean | null;
  serial_tracking_type?: string | null;
};

type TransferHeaderRow = {
  id: string;
  movement_type: "TRANSFER";
  from_stock_center_id: string;
  to_stock_center_id: string;
  project_id: string;
  entry_date: string;
  entry_type: "SUCATA" | "NOVO";
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

type TransferItemRow = {
  id: string;
  stock_transfer_id: string;
  material_id: string;
  quantity: number;
  serial_number: string | null;
  lot_code: string | null;
};

type StockCenterRow = {
  id: string;
  name: string;
};

type ProjectRow = {
  id: string;
  sob: string;
};

type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

type TeamOperationMapRow = {
  transfer_id: string;
  team_id: string;
  operation_kind: "REQUISITION" | "RETURN" | "FIELD_RETURN" | null;
  technical_origin_stock_center_id: string | null;
  team_name_snapshot: string;
  foreman_name_snapshot: string;
};

type LegacyTeamOperationMapRow = {
  transfer_id: string;
  team_id: string;
};

type TeamRow = {
  id: string;
  stock_center_id: string | null;
};

type StockTransferReversalRow = {
  original_stock_transfer_id: string;
  reversal_stock_transfer_id: string;
  reversal_reason: string;
  created_at: string;
};

type StockTransferItemReversalRow = {
  original_stock_transfer_id: string;
  original_stock_transfer_item_id: string;
  reversal_stock_transfer_id: string;
  reversal_stock_transfer_item_id: string | null;
  reversal_reason: string;
  created_at: string;
};

type TransferPayload = {
  operationKind?: unknown;
  stockCenterId?: unknown;
  teamId?: unknown;
  projectId?: unknown;
  entryDate?: unknown;
  entryType?: unknown;
  notes?: unknown;
  materialId?: unknown;
  quantity?: unknown;
  serialNumber?: unknown;
  lotCode?: unknown;
  items?: Array<{
    materialId?: unknown;
    quantity?: unknown;
    serialNumber?: unknown;
    lotCode?: unknown;
  }>;
};

type HistoryValueMaps = {
  stockCenters: Map<string, string>;
  projects: Map<string, string>;
};

function parsePositiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function normalizeCodeFilter(value: string | null) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeReversalStatus(value: string | null) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "ESTORNADAS" || normalized === "NAO_ESTORNADAS" || normalized === "ESTORNOS") {
    return normalized as "ESTORNADAS" | "NAO_ESTORNADAS" | "ESTORNOS";
  }
  return "TODOS" as const;
}

function shouldFallbackToLegacyTeamOperationSelect(error: PostgrestError | null) {
  if (!error) {
    return false;
  }

  const normalized = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return (
    normalized.includes("operation_kind")
    || normalized.includes("technical_origin_stock_center_id")
    || normalized.includes("team_name_snapshot")
    || normalized.includes("foreman_name_snapshot")
    || error.code === "42703"
    || error.code === "PGRST204"
  );
}

function logTeamOperationLoadError(step: string, error: PostgrestError | null, context: Record<string, unknown> = {}) {
  if (!error) {
    return;
  }

  console.error("[team-stock-operations] load error", {
    step,
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
    ...context,
  });
}

function normalizeLegacyTeamOperationRows(rows: LegacyTeamOperationMapRow[] | null | undefined) {
  return (rows ?? []).map((row) => ({
    transfer_id: row.transfer_id,
    team_id: row.team_id,
    operation_kind: null,
    technical_origin_stock_center_id: null,
    team_name_snapshot: "Equipe nao informada",
    foreman_name_snapshot: "Encarregado nao informado",
  })) satisfies TeamOperationMapRow[];
}

async function loadTeamOperationRows(
  supabase: SupabaseClient,
  tenantId: string,
  teamIdFilter: string,
) {
  let fullQuery = supabase
    .from("stock_transfer_team_operations")
    .select("transfer_id, team_id, operation_kind, technical_origin_stock_center_id, team_name_snapshot, foreman_name_snapshot")
    .eq("tenant_id", tenantId);

  if (teamIdFilter) {
    fullQuery = fullQuery.eq("team_id", teamIdFilter);
  }

  const fullResult = await fullQuery.returns<TeamOperationMapRow[]>();

  if (!fullResult.error) {
    return fullResult;
  }

  if (!shouldFallbackToLegacyTeamOperationSelect(fullResult.error)) {
    return fullResult;
  }

  logTeamOperationLoadError("team-operations-full-select", fullResult.error, { fallback: "legacy-select" });

  let legacyQuery = supabase
    .from("stock_transfer_team_operations")
    .select("transfer_id, team_id")
    .eq("tenant_id", tenantId);

  if (teamIdFilter) {
    legacyQuery = legacyQuery.eq("team_id", teamIdFilter);
  }

  const legacyResult = await legacyQuery.returns<LegacyTeamOperationMapRow[]>();

  if (legacyResult.error) {
    return {
      data: null,
      error: legacyResult.error,
    };
  }

  return {
    data: normalizeLegacyTeamOperationRows(legacyResult.data),
    error: null,
  };
}

async function loadTeamOperationRowByTransfer(
  supabase: SupabaseClient,
  tenantId: string,
  transferId: string,
) {
  const fullResult = await supabase
    .from("stock_transfer_team_operations")
    .select("transfer_id, team_id, operation_kind, technical_origin_stock_center_id, team_name_snapshot, foreman_name_snapshot")
    .eq("tenant_id", tenantId)
    .eq("transfer_id", transferId)
    .maybeSingle<TeamOperationMapRow>();

  if (!fullResult.error) {
    return fullResult;
  }

  if (!shouldFallbackToLegacyTeamOperationSelect(fullResult.error)) {
    return fullResult;
  }

  logTeamOperationLoadError("team-operation-history-full-select", fullResult.error, { fallback: "legacy-select" });

  const legacyResult = await supabase
    .from("stock_transfer_team_operations")
    .select("transfer_id, team_id")
    .eq("tenant_id", tenantId)
    .eq("transfer_id", transferId)
    .maybeSingle<LegacyTeamOperationMapRow>();

  if (legacyResult.error) {
    return {
      data: null,
      error: legacyResult.error,
    };
  }

  return {
    data: legacyResult.data ? normalizeLegacyTeamOperationRows([legacyResult.data])[0] : null,
    error: null,
  };
}

function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildTransferItems(payload: TransferPayload) {
  const batchItems = Array.isArray(payload.items) ? payload.items : [];

  if (batchItems.length > 0) {
    return batchItems
      .map((item) => {
        const materialId = normalizeText(item.materialId);
        const quantity = parsePositiveNumber(item.quantity);
        const serialNumber = normalizeText(item.serialNumber) || null;
        const lotCode = normalizeText(item.lotCode) || null;
        return {
          materialId,
          quantity,
          serialNumber,
          lotCode,
        };
      })
      .filter((item) => item.materialId && item.quantity !== null)
      .map(
        (item) =>
          ({
            materialId: item.materialId,
            quantity: item.quantity as number,
            serialNumber: item.serialNumber,
            lotCode: item.lotCode,
          }) satisfies StockTransferItemInput,
      );
  }

  const singleMaterialId = normalizeText(payload.materialId);
  const singleQuantity = parsePositiveNumber(payload.quantity);
  if (!singleMaterialId || singleQuantity === null) {
    return [] as StockTransferItemInput[];
  }

  return [
    {
      materialId: singleMaterialId,
      quantity: singleQuantity,
      serialNumber: normalizeText(payload.serialNumber) || null,
      lotCode: normalizeText(payload.lotCode) || null,
    },
  ];
}

function parseHistoryChanges(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return value as Record<string, unknown>;
}

function normalizeHistoryChangeSet(rawChanges: Record<string, unknown>) {
  const changes: Record<string, { from?: unknown; to?: unknown }> = {};

  Object.entries(rawChanges).forEach(([key, value]) => {
    if (
      !key
      || key === "stockTransferId"
      || key === "originalStockTransferId"
      || key === "reversalStockTransferId"
      || key.startsWith("_")
    ) {
      return;
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return;
    }

    const fromValue = (value as { from?: unknown }).from;
    const toValue = (value as { to?: unknown }).to;

    if (
      String(fromValue ?? "").trim() === String(toValue ?? "").trim()
      && fromValue !== null
      && toValue !== null
    ) {
      return;
    }

    changes[key] = { from: fromValue, to: toValue };
  });

  return changes;
}

function translateEntryTypeValue(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "NOVO" || normalized === "SUCATA") {
    return normalized;
  }
  return value;
}

function translateHistoryFieldValue(field: string, value: unknown, maps: HistoryValueMaps) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return value;
  }

  if (field === "entryType") {
    return translateEntryTypeValue(value);
  }

  if (field === "projectId") {
    return maps.projects.get(normalized) ?? value;
  }

  if (field === "fromStockCenterId" || field === "toStockCenterId") {
    return maps.stockCenters.get(normalized) ?? value;
  }

  return value;
}

function normalizeResolvedHistoryChangeSet(rawChanges: Record<string, unknown>, maps: HistoryValueMaps) {
  const baseChanges = normalizeHistoryChangeSet(rawChanges);
  const resolvedChanges: Record<string, { from?: unknown; to?: unknown }> = {};

  Object.entries(baseChanges).forEach(([field, change]) => {
    if (field === "reversalReasonCode") {
      return;
    }

    resolvedChanges[field] = {
      from: translateHistoryFieldValue(field, change.from, maps),
      to: translateHistoryFieldValue(field, change.to, maps),
    };
  });

  return resolvedChanges;
}

function resolveHistoryAction(rawChanges: Record<string, unknown>, normalizedChanges: Record<string, { from?: unknown; to?: unknown }>) {
  const explicitAction = String(rawChanges["_action"] ?? "").trim().toUpperCase();
  if (explicitAction) {
    return explicitAction;
  }

  const entries = Object.values(normalizedChanges);
  const isCreate = entries.length > 0 && entries.every((change) => String(change.from ?? "").trim() === "");
  if (isCreate) {
    return "CREATE";
  }

  return "UPDATE";
}

function resolveOperationKind(
  header: TransferHeaderRow,
  teamStockCenterId: string | null,
  explicitOperationKind: TeamOperationKind | null,
): TeamOperationKind {
  if (explicitOperationKind) {
    return explicitOperationKind;
  }

  if (teamStockCenterId && header.to_stock_center_id === teamStockCenterId) {
    return "REQUISITION";
  }

  return "RETURN";
}

async function loadTeamOperationList(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar operacoes de equipe.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const { supabase, appUser } = resolution;
  const page = parsePositiveInteger(request.nextUrl.searchParams.get("page"), 1);
  const pageSize = Math.min(parsePositiveInteger(request.nextUrl.searchParams.get("pageSize"), 20), 100);
  const startDate = normalizeDateInput(request.nextUrl.searchParams.get("startDate"));
  const endDate = normalizeDateInput(request.nextUrl.searchParams.get("endDate"));
  const operationKindFilter = normalizeTeamOperationKind(request.nextUrl.searchParams.get("operationKind"));
  const teamIdFilter = normalizeText(request.nextUrl.searchParams.get("teamId"));
  const projectCodeFilter = normalizeCodeFilter(request.nextUrl.searchParams.get("projectCode"));
  const materialCodeFilter = normalizeCodeFilter(request.nextUrl.searchParams.get("materialCode"));
  const entryTypeFilter =
    String(request.nextUrl.searchParams.get("entryType") ?? "").trim().toUpperCase() === "TODOS"
      ? null
      : normalizeEntryType(request.nextUrl.searchParams.get("entryType"));
  const reversalStatus = normalizeReversalStatus(request.nextUrl.searchParams.get("reversalStatus"));

  const { data: teamOperationRows, error: teamOperationError } = await loadTeamOperationRows(
    supabase,
    appUser.tenant_id,
    teamIdFilter,
  );

  if (teamOperationError) {
    logTeamOperationLoadError("team-operations", teamOperationError, { tenantId: appUser.tenant_id, teamIdFilter });
    return NextResponse.json({ message: "Falha ao carregar operacoes de equipe." }, { status: 500 });
  }

  if (!teamOperationRows?.length) {
    return NextResponse.json({
      history: [],
      pagination: { page, pageSize, total: 0 },
    });
  }

  const transferIds = teamOperationRows.map((row) => row.transfer_id);
  const teamIds = Array.from(new Set(teamOperationRows.map((row) => row.team_id).filter(Boolean)));

  let transfersQuery = supabase
    .from("stock_transfers")
    .select(
      "id, movement_type, from_stock_center_id, to_stock_center_id, project_id, entry_date, entry_type, notes, created_at, updated_at, created_by, updated_by",
    )
    .eq("tenant_id", appUser.tenant_id)
    .in("id", transferIds)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (startDate) {
    transfersQuery = transfersQuery.gte("entry_date", startDate);
  }
  if (endDate) {
    transfersQuery = transfersQuery.lte("entry_date", endDate);
  }

  const { data: transferHeaders, error: transfersError } = await transfersQuery.returns<TransferHeaderRow[]>();
  if (transfersError) {
    logTeamOperationLoadError("stock-transfers", transfersError, {
      tenantId: appUser.tenant_id,
      transferCount: transferIds.length,
    });
    return NextResponse.json({ message: "Falha ao carregar operacoes de equipe." }, { status: 500 });
  }

  if (!transferHeaders?.length) {
    return NextResponse.json({
      history: [],
      pagination: { page, pageSize, total: 0 },
    });
  }

  const currentTransferIds = transferHeaders.map((row) => row.id);
  const { data: itemRows, error: itemsError } = await supabase
    .from("stock_transfer_items")
    .select("id, stock_transfer_id, material_id, quantity, serial_number, lot_code")
    .eq("tenant_id", appUser.tenant_id)
    .in("stock_transfer_id", currentTransferIds)
    .returns<TransferItemRow[]>();

  if (itemsError) {
    logTeamOperationLoadError("stock-transfer-items", itemsError, {
      tenantId: appUser.tenant_id,
      transferCount: currentTransferIds.length,
    });
    return NextResponse.json({ message: "Falha ao carregar itens das operacoes de equipe." }, { status: 500 });
  }

  const materialIds = Array.from(new Set((itemRows ?? []).map((row) => row.material_id).filter(Boolean)));
  const transferItemIds = Array.from(new Set((itemRows ?? []).map((row) => row.id).filter(Boolean)));
  const stockCenterIds = Array.from(
    new Set((transferHeaders ?? []).flatMap((row) => [row.from_stock_center_id, row.to_stock_center_id]).filter(Boolean)),
  );
  const projectIds = Array.from(new Set((transferHeaders ?? []).map((row) => row.project_id).filter(Boolean)));
  const userIds = Array.from(
    new Set((transferHeaders ?? []).flatMap((row) => [row.updated_by, row.created_by]).filter((value): value is string => Boolean(value))),
  );

  const [
    materialsResult,
    stockCentersResult,
    projectsResult,
    usersResult,
    teamsResult,
    reversalsFromOriginalResult,
    reversalsByReversalResult,
    itemReversalsFromOriginalResult,
    itemReversalsByReversalResult,
  ] = await Promise.all([
    materialIds.length
      ? supabase
          .from("materials")
          .select("id, codigo, descricao, is_transformer, serial_tracking_type")
          .eq("tenant_id", appUser.tenant_id)
          .in("id", materialIds)
          .returns<MaterialRow[]>()
      : Promise.resolve({ data: [], error: null } as { data: MaterialRow[]; error: null }),
    stockCenterIds.length
      ? supabase
          .from("stock_centers")
          .select("id, name")
          .eq("tenant_id", appUser.tenant_id)
          .in("id", stockCenterIds)
          .returns<StockCenterRow[]>()
      : Promise.resolve({ data: [], error: null } as { data: StockCenterRow[]; error: null }),
    projectIds.length
      ? supabase
          .from("project")
          .select("id, sob")
          .eq("tenant_id", appUser.tenant_id)
          .in("id", projectIds)
          .returns<ProjectRow[]>()
      : Promise.resolve({ data: [], error: null } as { data: ProjectRow[]; error: null }),
    userIds.length
      ? supabase
          .from("app_users")
          .select("id, display, login_name")
          .eq("tenant_id", appUser.tenant_id)
          .in("id", userIds)
          .returns<AppUserRow[]>()
      : Promise.resolve({ data: [], error: null } as { data: AppUserRow[]; error: null }),
    teamIds.length
      ? supabase
          .from("teams")
          .select("id, stock_center_id")
          .eq("tenant_id", appUser.tenant_id)
          .in("id", teamIds)
          .returns<TeamRow[]>()
      : Promise.resolve({ data: [], error: null } as { data: TeamRow[]; error: null }),
    currentTransferIds.length
      ? supabase
          .from("stock_transfer_reversals")
          .select("original_stock_transfer_id, reversal_stock_transfer_id, reversal_reason, created_at")
          .eq("tenant_id", appUser.tenant_id)
          .in("original_stock_transfer_id", currentTransferIds)
          .returns<StockTransferReversalRow[]>()
      : Promise.resolve({ data: [], error: null } as { data: StockTransferReversalRow[]; error: null }),
    currentTransferIds.length
      ? supabase
          .from("stock_transfer_reversals")
          .select("original_stock_transfer_id, reversal_stock_transfer_id, reversal_reason, created_at")
          .eq("tenant_id", appUser.tenant_id)
          .in("reversal_stock_transfer_id", currentTransferIds)
          .returns<StockTransferReversalRow[]>()
      : Promise.resolve({ data: [], error: null } as { data: StockTransferReversalRow[]; error: null }),
    transferItemIds.length
      ? supabase
          .from("stock_transfer_item_reversals")
          .select("original_stock_transfer_id, original_stock_transfer_item_id, reversal_stock_transfer_id, reversal_stock_transfer_item_id, reversal_reason, created_at")
          .eq("tenant_id", appUser.tenant_id)
          .in("original_stock_transfer_item_id", transferItemIds)
          .returns<StockTransferItemReversalRow[]>()
      : Promise.resolve({ data: [], error: null } as { data: StockTransferItemReversalRow[]; error: null }),
    transferItemIds.length
      ? supabase
          .from("stock_transfer_item_reversals")
          .select("original_stock_transfer_id, original_stock_transfer_item_id, reversal_stock_transfer_id, reversal_stock_transfer_item_id, reversal_reason, created_at")
          .eq("tenant_id", appUser.tenant_id)
          .in("reversal_stock_transfer_item_id", transferItemIds)
          .returns<StockTransferItemReversalRow[]>()
      : Promise.resolve({ data: [], error: null } as { data: StockTransferItemReversalRow[]; error: null }),
  ]);

  let materialsData = materialsResult.data ?? [];
  if (materialsResult.error && materialIds.length) {
    logTeamOperationLoadError("materials-full-select", materialsResult.error, { fallback: "legacy-select" });

    const legacyMaterialsResult = await supabase
      .from("materials")
      .select("id, codigo, descricao")
      .eq("tenant_id", appUser.tenant_id)
      .in("id", materialIds)
      .returns<MaterialRow[]>();

    if (legacyMaterialsResult.error) {
      logTeamOperationLoadError("materials-legacy-select", legacyMaterialsResult.error, {
        tenantId: appUser.tenant_id,
        materialCount: materialIds.length,
      });
    }

    materialsData = legacyMaterialsResult.data ?? [];
  }

  const teamByTransferId = new Map(teamOperationRows.map((row) => [row.transfer_id, row.team_id]));
  const transferMap = new Map((transferHeaders ?? []).map((row) => [row.id, row]));
  const materialMap = new Map(materialsData.map((row) => [row.id, row]));
  const stockCenterMap = new Map((stockCentersResult.data ?? []).map((row) => [row.id, row.name]));
  const projectMap = new Map((projectsResult.data ?? []).map((row) => [row.id, row.sob]));
  const userMap = new Map((usersResult.data ?? []).map((row) => [
    row.id,
    String(row.display ?? row.login_name ?? "").trim() || "Nao informado",
  ]));
  const teamMap = new Map((teamsResult.data ?? []).map((row) => [row.id, row]));
  const teamOperationByTransferId = new Map((teamOperationRows ?? []).map((row) => [row.transfer_id, row]));
  const reversalByOriginalMap = new Map(((reversalsFromOriginalResult.data ?? [])).map((row) => [
    row.original_stock_transfer_id,
    {
      reversalTransferId: row.reversal_stock_transfer_id,
      reversalReason: row.reversal_reason,
      reversedAt: row.created_at,
    },
  ]));
  const originalByReversalMap = new Map(((reversalsByReversalResult.data ?? [])).map((row) => [
    row.reversal_stock_transfer_id,
    {
      originalTransferId: row.original_stock_transfer_id,
      reversalReason: row.reversal_reason,
      reversedAt: row.created_at,
    },
  ]));
  const itemReversalByOriginalMap = new Map(
    ((itemReversalsFromOriginalResult.error ? [] : itemReversalsFromOriginalResult.data) ?? []).map((row) => [
      row.original_stock_transfer_item_id,
      {
        originalTransferId: row.original_stock_transfer_id,
        reversalTransferId: row.reversal_stock_transfer_id,
        reversalReason: row.reversal_reason,
        reversedAt: row.created_at,
      },
    ]),
  );
  const originalByReversalItemMap = new Map(
    ((itemReversalsByReversalResult.error ? [] : itemReversalsByReversalResult.data) ?? [])
      .filter((row) => row.reversal_stock_transfer_item_id)
      .map((row) => [
        row.reversal_stock_transfer_item_id as string,
        {
          originalTransferId: row.original_stock_transfer_id,
          reversalTransferId: row.reversal_stock_transfer_id,
          reversalReason: row.reversal_reason,
          reversedAt: row.created_at,
        },
      ]),
  );

  const allRows = (itemRows ?? []).flatMap((item) => {
    const transfer = transferMap.get(item.stock_transfer_id);
    const teamId = teamByTransferId.get(item.stock_transfer_id) ?? "";
    const team = teamMap.get(teamId);
    const teamOperation = teamOperationByTransferId.get(item.stock_transfer_id);
    if (!transfer || !teamOperation) return [];

    const operationKind = resolveOperationKind(transfer, team?.stock_center_id ?? null, teamOperation.operation_kind);
    const reversalFromOriginal = reversalByOriginalMap.get(transfer.id) ?? null;
    const reversalFromReversal = originalByReversalMap.get(transfer.id) ?? null;
    const itemReversalFromOriginal = itemReversalByOriginalMap.get(item.id) ?? null;
    const itemReversalFromReversal = originalByReversalItemMap.get(item.id) ?? null;
    const material = materialMap.get(item.material_id);

    return [
      {
        id: item.id,
        transferId: transfer.id,
        updatedAt: transfer.updated_at ?? transfer.created_at,
        updatedByName: userMap.get(transfer.updated_by ?? transfer.created_by ?? "") ?? "Nao informado",
        movementType: transfer.movement_type,
        operationKind,
        teamId,
        teamName: teamOperation.team_name_snapshot,
        foremanName: teamOperation.foreman_name_snapshot,
        materialId: item.material_id,
        materialCode: material?.codigo ?? "-",
        description: material?.descricao ?? "-",
        isTransformer: isSerialTrackedMaterial(normalizeSerialTrackingType(material?.serial_tracking_type ?? (material?.is_transformer ? "TRAFO" : "NONE"))),
        serialTrackingType: normalizeSerialTrackingType(material?.serial_tracking_type ?? (material?.is_transformer ? "TRAFO" : "NONE")),
        quantity: Number(item.quantity ?? 0),
        serialNumber: item.serial_number,
        lotCode: item.lot_code,
        entryDate: transfer.entry_date,
        entryType: transfer.entry_type,
        fromStockCenterId: transfer.from_stock_center_id,
        fromStockCenterName: stockCenterMap.get(transfer.from_stock_center_id) ?? "-",
        toStockCenterId: transfer.to_stock_center_id,
        toStockCenterName: stockCenterMap.get(transfer.to_stock_center_id) ?? "-",
        projectId: transfer.project_id,
        projectCode: projectMap.get(transfer.project_id) ?? "-",
        notes: transfer.notes,
        isReversed: Boolean(reversalFromOriginal || itemReversalFromOriginal),
        reversalTransferId: reversalFromOriginal?.reversalTransferId ?? itemReversalFromOriginal?.reversalTransferId ?? null,
        isReversal: Boolean(reversalFromReversal || itemReversalFromReversal),
        originalTransferId: reversalFromReversal?.originalTransferId ?? itemReversalFromReversal?.originalTransferId ?? null,
        reversalReason: reversalFromOriginal?.reversalReason ?? itemReversalFromOriginal?.reversalReason ?? reversalFromReversal?.reversalReason ?? itemReversalFromReversal?.reversalReason ?? null,
        reversedAt: reversalFromOriginal?.reversedAt ?? itemReversalFromOriginal?.reversedAt ?? reversalFromReversal?.reversedAt ?? itemReversalFromReversal?.reversedAt ?? null,
        technicalOriginStockCenterId: teamOperation.technical_origin_stock_center_id ?? null,
      },
    ];
  });

  const filteredRows = allRows.filter((row) => {
    const normalizedProjectCode = String(row.projectCode ?? "").trim().toUpperCase();
    const normalizedMaterialCode = String(row.materialCode ?? "").trim().toUpperCase();

    if (operationKindFilter && row.operationKind !== operationKindFilter) {
      return false;
    }
    if (projectCodeFilter && !normalizedProjectCode.includes(projectCodeFilter)) {
      return false;
    }
    if (materialCodeFilter && !normalizedMaterialCode.includes(materialCodeFilter)) {
      return false;
    }
    if (entryTypeFilter && row.entryType !== entryTypeFilter) {
      return false;
    }
    if (reversalStatus === "ESTORNADAS" && !row.isReversed) {
      return false;
    }
    if (reversalStatus === "NAO_ESTORNADAS" && (row.isReversed || row.isReversal)) {
      return false;
    }
    if (reversalStatus === "ESTORNOS" && !row.isReversal) {
      return false;
    }
    return true;
  });

  filteredRows.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  const from = (page - 1) * pageSize;

  return NextResponse.json({
    history: filteredRows.slice(from, from + pageSize),
    pagination: {
      page,
      pageSize,
      total: filteredRows.length,
    },
  });
}

async function loadTeamOperationHistory(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar historico da operacao de equipe.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const { supabase, appUser } = resolution;
  const page = parsePositiveInteger(request.nextUrl.searchParams.get("page"), 1);
  const pageSize = Math.min(parsePositiveInteger(request.nextUrl.searchParams.get("pageSize"), 20), 100);
  const transferId = normalizeText(request.nextUrl.searchParams.get("transferId"));

  if (!transferId) {
    return NextResponse.json({ message: "transferId e obrigatorio para carregar o historico." }, { status: 400 });
  }

  const { data: teamOperation, error: teamOperationError } = await loadTeamOperationRowByTransfer(
    supabase,
    appUser.tenant_id,
    transferId,
  );

  if (teamOperationError || !teamOperation) {
    logTeamOperationLoadError("team-operation-history", teamOperationError, { tenantId: appUser.tenant_id, transferId });
    return NextResponse.json({ message: "Operacao de equipe nao encontrada." }, { status: 404 });
  }

  const [transferResult, teamResult] = await Promise.all([
    supabase
      .from("stock_transfers")
      .select("id, movement_type, from_stock_center_id, to_stock_center_id, project_id, entry_date, entry_type, notes, created_at, updated_at, created_by, updated_by")
      .eq("tenant_id", appUser.tenant_id)
      .eq("id", transferId)
      .maybeSingle<TransferHeaderRow>(),
    supabase
      .from("teams")
      .select("id, stock_center_id")
      .eq("tenant_id", appUser.tenant_id)
      .eq("id", teamOperation.team_id)
      .maybeSingle<TeamRow>(),
  ]);

  if (transferResult.error || !transferResult.data || teamResult.error || !teamResult.data) {
    return NextResponse.json({ message: "Operacao de equipe nao encontrada." }, { status: 404 });
  }

  const baseHistoryQuery = () =>
    supabase
      .from("material_history")
      .select("id, changes, created_at, created_by")
      .eq("tenant_id", appUser.tenant_id)
      .eq("change_type", "UPDATE");

  const [stockHistoryResult, reversalByOriginalResult, reversalByReversalResult] = await Promise.all([
    baseHistoryQuery().contains("changes", { _context: "STOCK_TRANSFER", stockTransferId: transferId }).returns<MaterialHistoryRow[]>(),
    baseHistoryQuery().contains("changes", { _context: "STOCK_TRANSFER_REVERSAL", originalStockTransferId: transferId }).returns<MaterialHistoryRow[]>(),
    baseHistoryQuery().contains("changes", { _context: "STOCK_TRANSFER_REVERSAL", reversalStockTransferId: transferId }).returns<MaterialHistoryRow[]>(),
  ]);

  if (stockHistoryResult.error || reversalByOriginalResult.error || reversalByReversalResult.error) {
    return NextResponse.json({ message: "Falha ao carregar historico da operacao de equipe." }, { status: 500 });
  }

  const historyRows = Array.from(
    new Map(
      [
        ...(stockHistoryResult.data ?? []),
        ...(reversalByOriginalResult.data ?? []),
        ...(reversalByReversalResult.data ?? []),
      ].map((row) => [row.id, row]),
    ).values(),
  ).sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());

  const userIds = Array.from(new Set(historyRows.map((row) => row.created_by).filter((value): value is string => Boolean(value))));
  const stockCenterIds = Array.from(new Set([transferResult.data.from_stock_center_id, transferResult.data.to_stock_center_id].filter(Boolean)));
  const projectIds = Array.from(new Set([transferResult.data.project_id].filter(Boolean)));

  const [usersResult, historyStockCentersResult, historyProjectsResult] = await Promise.all([
    userIds.length
      ? supabase
          .from("app_users")
          .select("id, display, login_name")
          .eq("tenant_id", appUser.tenant_id)
          .in("id", userIds)
          .returns<AppUserRow[]>()
      : Promise.resolve({ data: [], error: null } as { data: AppUserRow[]; error: null }),
    stockCenterIds.length
      ? supabase
          .from("stock_centers")
          .select("id, name")
          .eq("tenant_id", appUser.tenant_id)
          .in("id", stockCenterIds)
          .returns<StockCenterRow[]>()
      : Promise.resolve({ data: [], error: null } as { data: StockCenterRow[]; error: null }),
    projectIds.length
      ? supabase
          .from("project")
          .select("id, sob")
          .eq("tenant_id", appUser.tenant_id)
          .in("id", projectIds)
          .returns<ProjectRow[]>()
      : Promise.resolve({ data: [], error: null } as { data: ProjectRow[]; error: null }),
  ]);

  const historyValueMaps: HistoryValueMaps = {
    stockCenters: new Map((historyStockCentersResult.data ?? []).map((row) => [row.id, row.name])),
    projects: new Map((historyProjectsResult.data ?? []).map((row) => [row.id, row.sob])),
  };
  const userMap = new Map((usersResult.data ?? []).map((row) => [
    row.id,
    String(row.display ?? row.login_name ?? "").trim() || "Nao informado",
  ]));
  const transferRow = transferResult.data;
  const teamRow = teamResult.data;
  const operationKind = resolveOperationKind(transferRow, teamRow.stock_center_id, teamOperation.operation_kind);

  const entries = historyRows.map((row) => {
    const rawChanges = parseHistoryChanges(row.changes);
    let normalizedChanges = normalizeResolvedHistoryChangeSet(rawChanges, historyValueMaps);
    const action = resolveHistoryAction(rawChanges, normalizedChanges);

    if (action === "CREATE") {
      normalizedChanges = {};
    }

    if (action !== "CREATE" && !normalizedChanges.teamName) {
      normalizedChanges.teamName = { from: null, to: teamOperation.team_name_snapshot };
    }
    if (action !== "CREATE" && !normalizedChanges.foremanName) {
      normalizedChanges.foremanName = { from: null, to: teamOperation.foreman_name_snapshot };
    }
    if (action !== "CREATE" && !normalizedChanges.operationKind) {
      normalizedChanges.operationKind = { from: null, to: operationKind };
    }
    if (action !== "CREATE" && !normalizedChanges.technicalOriginStockCenterId && teamOperation.technical_origin_stock_center_id) {
      normalizedChanges.technicalOriginStockCenterId = {
        from: null,
        to: historyValueMaps.stockCenters.get(teamOperation.technical_origin_stock_center_id) ?? teamOperation.technical_origin_stock_center_id,
      };
    }

    return {
      id: row.id,
      action,
      changedAt: row.created_at,
      changedByName: userMap.get(row.created_by ?? "") ?? "Nao informado",
      changes: normalizedChanges,
    };
  });

  const from = (page - 1) * pageSize;
  return NextResponse.json({
    history: entries.slice(from, from + pageSize),
    pagination: {
      page,
      pageSize,
      total: entries.length,
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    const mode = normalizeText(request.nextUrl.searchParams.get("mode")).toLowerCase();
    if (mode === "history") {
      return await loadTeamOperationHistory(request);
    }

    return await loadTeamOperationList(request);
  } catch {
    return NextResponse.json({ message: "Falha ao carregar operacoes de equipe." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para salvar operacao de equipe.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const payload = (await request.json().catch(() => ({}))) as TransferPayload;
    const operationKind = normalizeTeamOperationKind(payload.operationKind);
    const stockCenterId = normalizeText(payload.stockCenterId);
    const teamId = normalizeText(payload.teamId);
    const projectId = normalizeText(payload.projectId);
    const entryDate = normalizeDateInput(payload.entryDate);
    const entryType = normalizeEntryType(payload.entryType);
    const notes = normalizeText(payload.notes) || null;
    const items = buildTransferItems(payload);
    const today = toIsoDate(new Date());

    if (!operationKind || !stockCenterId || !teamId || !projectId || !entryDate) {
      return NextResponse.json(
        {
          message:
            "Campos obrigatorios: operationKind, stockCenterId, teamId, projectId e entryDate.",
        },
        { status: 400 },
      );
    }

    const effectiveEntryType = operationKind === "FIELD_RETURN" ? "SUCATA" : entryType;

    if (!effectiveEntryType) {
      return NextResponse.json(
        { message: "Tipo do material deve ser NOVO ou SUCATA." },
        { status: 400 },
      );
    }

    if (entryDate > today) {
      return NextResponse.json({ message: "Data da movimentacao nao pode ser futura." }, { status: 400 });
    }

    if (items.length === 0) {
      return NextResponse.json(
        { message: "Informe ao menos um item com materialId e quantity maior que zero." },
        { status: 400 },
      );
    }

    const { supabase, appUser } = resolution;
    const saveResult = await saveTeamStockOperationViaRpc(supabase, {
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      operationKind,
      stockCenterId,
      teamId,
      projectId,
      entryDate,
      entryType: effectiveEntryType,
      notes,
      items,
    });

    if (!saveResult.ok) {
      return NextResponse.json(
        {
          message: saveResult.message,
          reason: saveResult.reason,
          details: saveResult.details,
        },
        { status: saveResult.status },
      );
    }

    return NextResponse.json({
      success: true,
      transferId: saveResult.transferId,
      message: saveResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao salvar operacao de equipe." }, { status: 500 });
  }
}
