import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { requirePageAction } from "@/lib/server/pageAuthorization";
import { parsePositiveInteger } from "@/lib/server/apiHelpers";
import { allowsPendingSerialIdentification, isSerialTrackedMaterial, normalizeSerialTrackingType, requiresLotCode, SerialTrackingType, serialTrackingLabel } from "@/lib/materialSerialTracking";
import {
  normalizeDateInput,
  normalizeEntryType,
  normalizeMovementType,
  normalizeText,
  parsePositiveNumber,
  saveStockTransferViaRpc,
  StockTransferItemInput,
} from "@/lib/server/stockTransfers";

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
  allow_pending_serial_identification?: boolean | null;
};

type StockTransferHeaderRow = {
  id: string;
  movement_type: "ENTRY" | "EXIT" | "TRANSFER";
  operation_purpose?: "NORMAL" | "BALANCE_CORRECTION" | null;
  from_stock_center_id: string;
  to_stock_center_id: string;
  project_id: string | null;
  direct_purchase?: boolean | null;
  entry_date: string;
  entry_type: "SUCATA" | "NOVO";
  balance_correction_reason?: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

type StockTransferItemRow = {
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

type TeamStockOperationRow = {
  transfer_id: string;
};

type TeamStockCenterRow = {
  stock_center_id: string | null;
};

type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

type TransferPayload = {
  transferId?: unknown;
  movementType?: unknown;
  operationPurpose?: unknown;
  fromStockCenterId?: unknown;
  toStockCenterId?: unknown;
  projectId?: unknown;
  directPurchase?: unknown;
  entryDate?: unknown;
  entryType?: unknown;
  balanceCorrectionReason?: unknown;
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

type TransferListItem = {
  id: string;
  transferId: string;
  updatedAt: string;
  updatedByName: string;
  movementType: "ENTRY" | "EXIT" | "TRANSFER";
  operationPurpose: "NORMAL" | "BALANCE_CORRECTION";
  materialId: string;
  materialCode: string;
  description: string;
  isTransformer: boolean;
  serialTrackingType: SerialTrackingType;
  quantity: number;
  serialNumber: string | null;
  lotCode: string | null;
  entryDate: string;
  entryType: "SUCATA" | "NOVO";
  fromStockCenterId: string;
  fromStockCenterName: string;
  toStockCenterId: string;
  toStockCenterName: string;
  projectId: string | null;
  projectCode: string;
  directPurchase: boolean;
  balanceCorrectionReason: string | null;
  notes: string | null;
  isReversed: boolean;
  reversalTransferId: string | null;
  isReversal: boolean;
  originalTransferId: string | null;
  reversalReason: string | null;
  reversedAt: string | null;
};

type HistoryValueMaps = {
  stockCenters: Map<string, string>;
  projects: Map<string, string>;
};

type QueryError = {
  message: string;
  code?: string;
};

const RELATION_QUERY_CHUNK_SIZE = 100;

function chunkValues(values: string[], chunkSize = RELATION_QUERY_CHUNK_SIZE) {
  const chunks: string[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

async function loadRowsInChunks<T>(
  values: string[],
  loadChunk: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: QueryError | null }>,
) {
  const rows: T[] = [];

  for (const chunk of chunkValues(values)) {
    const result = await loadChunk(chunk);
    if (result.error) {
      return { data: null, error: result.error };
    }
    rows.push(...(result.data ?? []));
  }

  return { data: rows, error: null };
}

// Above this many IDs an IN/NOT IN filter makes the PostgREST query too large to send.
const IN_FILTER_MAX_IDS = 200;
// Rows read per block when exclusions are applied in memory, and how many blocks to read at most.
const TRANSFER_FETCH_BLOCK_SIZE = 200;
const MAX_TRANSFER_FETCH_BLOCKS = 10;

type PageInfo = {
  hasOlder: boolean;
  hasNewer: boolean;
  oldestCursor: { entryDate: string; id: string } | null;
  newestCursor: { entryDate: string; id: string } | null;
};

function emptyPageInfo(): PageInfo {
  return { hasOlder: false, hasNewer: false, oldestCursor: null, newestCursor: null };
}

function normalizeLoadDirection(value: unknown): "initial" | "older" | "newer" {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "older" || v === "newer") return v;
  return "initial";
}

async function preloadMaterialTransferIds(
  supabase: SupabaseClient,
  tenantId: string,
  materialCode: string,
): Promise<string[]> {
  const { data: materials } = await supabase
    .from("materials")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("codigo", `%${materialCode}%`)
    .limit(100)
    .returns<{ id: string }[]>();

  if (!materials?.length) return [];

  const materialIds = materials.map((m: { id: string }) => m.id);
  const result = await loadRowsInChunks<{ stock_transfer_id: string }>(
    materialIds,
    (chunk) => supabase
      .from("stock_transfer_items")
      .select("stock_transfer_id")
      .eq("tenant_id", tenantId)
      .in("material_id", chunk)
      .limit(5000)
      .returns<{ stock_transfer_id: string }[]>(),
  );

  return Array.from(new Set((result.data ?? []).map((r) => r.stock_transfer_id))).slice(0, 200);
}

async function preloadProjectIdsForCode(
  supabase: SupabaseClient,
  tenantId: string,
  projectCode: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("project")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("sob", `%${projectCode}%`)
    .limit(200)
    .returns<{ id: string }[]>();

  return (data ?? []).map((p: { id: string }) => p.id);
}

async function preloadTransferReversalSets(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ originalIds: Set<string>; reversalIds: Set<string> }> {
  const { data } = await supabase
    .from("stock_transfer_reversals")
    .select("original_stock_transfer_id, reversal_stock_transfer_id")
    .eq("tenant_id", tenantId)
    .limit(10000)
    .returns<{ original_stock_transfer_id: string; reversal_stock_transfer_id: string }[]>();

  return {
    originalIds: new Set((data ?? []).map((r) => r.original_stock_transfer_id)),
    reversalIds: new Set((data ?? []).map((r) => r.reversal_stock_transfer_id)),
  };
}

async function preloadTeamOpTransferIds(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("stock_transfer_team_operations")
    .select("transfer_id")
    .eq("tenant_id", tenantId)
    .limit(10000)
    .returns<{ transfer_id: string }[]>();

  return new Set((data ?? []).map((r) => r.transfer_id));
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

function normalizeOperationPurpose(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "NORMAL" || normalized === "BALANCE_CORRECTION") {
    return normalized as "NORMAL" | "BALANCE_CORRECTION";
  }
  return "NORMAL" as const;
}

function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function translateMovementTypeValue(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "ENTRY") return "Entrada";
  if (normalized === "EXIT") return "Saida";
  if (normalized === "TRANSFER") return "Transferencia";
  return value;
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

  if (field === "movementType") {
    return translateMovementTypeValue(value);
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
  const isCreate = entries.length > 0 && entries.every((change) => {
    const fromValue = String(change.from ?? "").trim();
    return fromValue === "";
  });

  if (isCreate) {
    return "CREATE";
  }

  return "UPDATE";
}

function buildTransferItems(payload: TransferPayload) {
  const batchItems = Array.isArray(payload.items) ? payload.items : [];

  if (batchItems.length > 0) {
    const parsed = batchItems
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

    return parsed;
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

function isWholeQuantity(value: number) {
  return Number.isInteger(value) && value > 0;
}

async function loadTransferList(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar movimentacoes de estoque.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const pageAuth = await requirePageAction({ context: resolution, pageKey: "entrada", action: "read" });
  if (!pageAuth.allowed) {
    return NextResponse.json({ message: pageAuth.error.message }, { status: pageAuth.error.status });
  }

  const { supabase, appUser } = resolution;

  const pageSize = Math.min(parsePositiveInteger(request.nextUrl.searchParams.get("pageSize"), 20), 100);
  const direction = normalizeLoadDirection(request.nextUrl.searchParams.get("direction"));
  const cursorDate = normalizeDateInput(request.nextUrl.searchParams.get("cursorDate"));
  const cursorId = normalizeText(request.nextUrl.searchParams.get("cursorId"));
  const startDate = normalizeDateInput(request.nextUrl.searchParams.get("startDate"));
  const endDate = normalizeDateInput(request.nextUrl.searchParams.get("endDate"));
  const movementType = normalizeMovementType(request.nextUrl.searchParams.get("movementType"));
  const operationPurposeFilter = normalizeText(request.nextUrl.searchParams.get("operationPurpose")).toUpperCase();
  const entryType = normalizeEntryType(request.nextUrl.searchParams.get("entryType"));
  const projectCodeFilter = normalizeCodeFilter(request.nextUrl.searchParams.get("projectCode"));
  const materialCodeFilter = normalizeCodeFilter(request.nextUrl.searchParams.get("materialCode"));
  const reversalStatus = normalizeReversalStatus(request.nextUrl.searchParams.get("reversalStatus"));

  // Pre-filters run in parallel before the main query
  const needsTeamOpExclusion = !movementType || movementType === "TRANSFER";
  const needsReversalSets = reversalStatus !== "TODOS";

  const [materialTransferIds, preloadedProjectIds, reversalSets, teamOpIds] = await Promise.all([
    materialCodeFilter
      ? preloadMaterialTransferIds(supabase, appUser.tenant_id, materialCodeFilter)
      : Promise.resolve(null),
    projectCodeFilter
      ? preloadProjectIdsForCode(supabase, appUser.tenant_id, projectCodeFilter)
      : Promise.resolve(null),
    needsReversalSets
      ? preloadTransferReversalSets(supabase, appUser.tenant_id)
      : Promise.resolve(null),
    needsTeamOpExclusion
      ? preloadTeamOpTransferIds(supabase, appUser.tenant_id)
      : Promise.resolve(new Set<string>()),
  ]);

  // Short-circuit on empty pre-filter results
  if (materialCodeFilter && materialTransferIds !== null && materialTransferIds.length === 0) {
    return NextResponse.json({ history: [], pageInfo: emptyPageInfo() });
  }
  if (projectCodeFilter && preloadedProjectIds !== null && preloadedProjectIds.length === 0) {
    return NextResponse.json({ history: [], pageInfo: emptyPageInfo() });
  }
  if (reversalSets && reversalStatus === "ESTORNADAS" && reversalSets.originalIds.size === 0) {
    return NextResponse.json({ history: [], pageInfo: emptyPageInfo() });
  }
  if (reversalSets && reversalStatus === "ESTORNOS" && reversalSets.reversalIds.size === 0) {
    return NextResponse.json({ history: [], pageInfo: emptyPageInfo() });
  }

  const ascending = direction === "newer";

  // Exclusion sets above IN_FILTER_MAX_IDS cannot go into the SQL query without blowing up its
  // size, so they are applied in memory. The fetch loop below compensates by reading further
  // blocks until the page is actually full.
  const excludedIds = new Set<string>();
  if (teamOpIds && teamOpIds.size > IN_FILTER_MAX_IDS) {
    for (const id of teamOpIds) excludedIds.add(id);
  }
  if (reversalSets && reversalStatus === "NAO_ESTORNADAS") {
    const allReversalIds = new Set([...reversalSets.originalIds, ...reversalSets.reversalIds]);
    if (allReversalIds.size > IN_FILTER_MAX_IDS) {
      for (const id of allReversalIds) excludedIds.add(id);
    }
  }

  const buildTransfersQuery = (cursor: { entryDate: string; id: string } | null, limit: number) => {
    let query = supabase
      .from("stock_transfers")
      .select(
        "id, movement_type, operation_purpose, from_stock_center_id, to_stock_center_id, project_id, direct_purchase, entry_date, entry_type, balance_correction_reason, notes, created_at, updated_at, created_by, updated_by",
      )
      .eq("tenant_id", appUser.tenant_id)
      .order("entry_date", { ascending })
      .order("id", { ascending });

    if (startDate) query = query.gte("entry_date", startDate);
    if (endDate) query = query.lte("entry_date", endDate);
    if (movementType) query = query.eq("movement_type", movementType);
    if (operationPurposeFilter === "NORMAL" || operationPurposeFilter === "BALANCE_CORRECTION") {
      query = query.eq("operation_purpose", operationPurposeFilter);
    }
    if (entryType) query = query.eq("entry_type", entryType);

    if (preloadedProjectIds !== null && preloadedProjectIds.length > 0) {
      query = query.in("project_id", preloadedProjectIds);
    }
    if (materialTransferIds !== null && materialTransferIds.length > 0) {
      query = query.in("id", materialTransferIds);
    }

    if (reversalSets) {
      if (reversalStatus === "ESTORNADAS") {
        query = query.in("id", [...reversalSets.originalIds].slice(0, IN_FILTER_MAX_IDS));
      } else if (reversalStatus === "ESTORNOS") {
        query = query.in("id", [...reversalSets.reversalIds].slice(0, IN_FILTER_MAX_IDS));
      } else if (reversalStatus === "NAO_ESTORNADAS") {
        const allReversalIds = [...new Set([...reversalSets.originalIds, ...reversalSets.reversalIds])];
        if (allReversalIds.length > 0 && allReversalIds.length <= IN_FILTER_MAX_IDS) {
          query = query.not("id", "in", `(${allReversalIds.join(",")})`);
        }
      }
    }

    if (teamOpIds && teamOpIds.size > 0 && teamOpIds.size <= IN_FILTER_MAX_IDS) {
      query = query.not("id", "in", `(${[...teamOpIds].join(",")})`);
    }

    if (cursor) {
      query = ascending
        ? query.or(`entry_date.gt.${cursor.entryDate},and(entry_date.eq.${cursor.entryDate},id.gt.${cursor.id})`)
        : query.or(`entry_date.lt.${cursor.entryDate},and(entry_date.eq.${cursor.entryDate},id.lt.${cursor.id})`);
    }

    return query.limit(limit).returns<StockTransferHeaderRow[]>();
  };

  // Read blocks until pageSize + 1 transfers survive the in-memory exclusion, so the page is
  // always full and hasOlder/hasNewer reflect what the user can actually reach.
  const collected: StockTransferHeaderRow[] = [];
  let blockCursor = cursorDate && cursorId && direction !== "initial"
    ? { entryDate: cursorDate, id: cursorId }
    : null;
  let exhausted = false;

  for (let block = 0; block < MAX_TRANSFER_FETCH_BLOCKS && collected.length <= pageSize; block += 1) {
    const blockSize = excludedIds.size > 0 ? TRANSFER_FETCH_BLOCK_SIZE : pageSize + 1;
    const { data: blockRows, error: transfersError } = await buildTransfersQuery(blockCursor, blockSize);

    if (transfersError) {
      return NextResponse.json({ message: "Falha ao carregar movimentacoes de estoque." }, { status: 500 });
    }

    if (!blockRows?.length) {
      exhausted = true;
      break;
    }

    for (const row of blockRows) {
      if (!excludedIds.has(row.id)) collected.push(row);
    }

    const lastRow = blockRows[blockRows.length - 1];
    blockCursor = { entryDate: lastRow.entry_date, id: lastRow.id };

    if (blockRows.length < blockSize) {
      exhausted = true;
      break;
    }
  }

  if (collected.length === 0) {
    return NextResponse.json({ history: [], pageInfo: emptyPageInfo() });
  }

  const hasMore = collected.length > pageSize || !exhausted;
  let pageTransfers = collected.slice(0, pageSize);
  if (direction === "newer") pageTransfers = [...pageTransfers].reverse();

  const hasOlder = direction === "newer" ? true : hasMore;
  const hasNewer = direction === "newer" ? hasMore : direction === "older" ? true : false;

  const newestTransfer = pageTransfers[0] ?? null;
  const oldestTransfer = pageTransfers[pageTransfers.length - 1] ?? null;

  const pageInfo: PageInfo = {
    hasOlder,
    hasNewer,
    oldestCursor: oldestTransfer ? { entryDate: oldestTransfer.entry_date, id: oldestTransfer.id } : null,
    newestCursor: newestTransfer ? { entryDate: newestTransfer.entry_date, id: newestTransfer.id } : null,
  };

  const transferIds = pageTransfers.map((t) => t.id);

  if (transferIds.length === 0) {
    return NextResponse.json({ history: [], pageInfo: emptyPageInfo() });
  }

  // Load items only for this page of transfers
  const { data: itemRows, error: itemsError } = await loadRowsInChunks<StockTransferItemRow>(
    transferIds,
    (chunk) => supabase
      .from("stock_transfer_items")
      .select("id, stock_transfer_id, material_id, quantity, serial_number, lot_code")
      .eq("tenant_id", appUser.tenant_id)
      .in("stock_transfer_id", chunk)
      .returns<StockTransferItemRow[]>(),
  );

  if (itemsError) {
    return NextResponse.json({ message: "Falha ao carregar itens das movimentacoes de estoque." }, { status: 500 });
  }

  const materialIds = Array.from(new Set((itemRows ?? []).map((row) => row.material_id).filter(Boolean)));
  const transferItemIds = Array.from(new Set((itemRows ?? []).map((row) => row.id).filter(Boolean)));
  const stockCenterIds = Array.from(
    new Set(pageTransfers.flatMap((row) => [row.from_stock_center_id, row.to_stock_center_id]).filter(Boolean)),
  );
  const enrichProjectIds = Array.from(
    new Set(pageTransfers.map((row) => row.project_id).filter((v): v is string => Boolean(v))),
  );
  const userIds = Array.from(
    new Set(pageTransfers.flatMap((row) => [row.updated_by, row.created_by]).filter((v): v is string => Boolean(v))),
  );

  const [
    materialsResult,
    stockCentersResult,
    projectsResult,
    usersResult,
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
    enrichProjectIds.length
      ? supabase
          .from("project")
          .select("id, sob")
          .eq("tenant_id", appUser.tenant_id)
          .in("id", enrichProjectIds)
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
    transferIds.length
      ? loadRowsInChunks<StockTransferReversalRow>(
          transferIds,
          (chunk) => supabase
            .from("stock_transfer_reversals")
            .select("original_stock_transfer_id, reversal_stock_transfer_id, reversal_reason, created_at")
            .eq("tenant_id", appUser.tenant_id)
            .in("original_stock_transfer_id", chunk)
            .returns<StockTransferReversalRow[]>(),
        )
      : Promise.resolve({ data: [], error: null } as { data: StockTransferReversalRow[]; error: null }),
    transferIds.length
      ? loadRowsInChunks<StockTransferReversalRow>(
          transferIds,
          (chunk) => supabase
            .from("stock_transfer_reversals")
            .select("original_stock_transfer_id, reversal_stock_transfer_id, reversal_reason, created_at")
            .eq("tenant_id", appUser.tenant_id)
            .in("reversal_stock_transfer_id", chunk)
            .returns<StockTransferReversalRow[]>(),
        )
      : Promise.resolve({ data: [], error: null } as { data: StockTransferReversalRow[]; error: null }),
    transferItemIds.length
      ? loadRowsInChunks<StockTransferItemReversalRow>(
          transferItemIds,
          (chunk) => supabase
            .from("stock_transfer_item_reversals")
            .select("original_stock_transfer_id, original_stock_transfer_item_id, reversal_stock_transfer_id, reversal_stock_transfer_item_id, reversal_reason, created_at")
            .eq("tenant_id", appUser.tenant_id)
            .in("original_stock_transfer_item_id", chunk)
            .returns<StockTransferItemReversalRow[]>(),
        )
      : Promise.resolve({ data: [], error: null } as { data: StockTransferItemReversalRow[]; error: null }),
    transferItemIds.length
      ? loadRowsInChunks<StockTransferItemReversalRow>(
          transferItemIds,
          (chunk) => supabase
            .from("stock_transfer_item_reversals")
            .select("original_stock_transfer_id, original_stock_transfer_item_id, reversal_stock_transfer_id, reversal_stock_transfer_item_id, reversal_reason, created_at")
            .eq("tenant_id", appUser.tenant_id)
            .in("reversal_stock_transfer_item_id", chunk)
            .returns<StockTransferItemReversalRow[]>(),
        )
      : Promise.resolve({ data: [], error: null } as { data: StockTransferItemReversalRow[]; error: null }),
  ]);

  if (
    reversalsFromOriginalResult.error
    || reversalsByReversalResult.error
    || itemReversalsFromOriginalResult.error
    || itemReversalsByReversalResult.error
  ) {
    return NextResponse.json(
      { message: "Falha ao validar o status de estorno das movimentacoes de estoque." },
      { status: 500 },
    );
  }

  let materialsData = materialsResult.data ?? [];
  if (materialsResult.error && materialIds.length) {
    const legacyMaterialsResult = await supabase
      .from("materials")
      .select("id, codigo, descricao")
      .eq("tenant_id", appUser.tenant_id)
      .in("id", materialIds)
      .returns<MaterialRow[]>();

    materialsData = legacyMaterialsResult.data ?? [];
  }

  const transferMap = new Map(pageTransfers.map((row) => [row.id, row]));
  const materialMap = new Map(materialsData.map((row) => [row.id, row]));
  const stockCenterMap = new Map((stockCentersResult.data ?? []).map((row) => [row.id, row.name]));
  const projectMap = new Map((projectsResult.data ?? []).map((row) => [row.id, row.sob]));
  const userMap = new Map(
    (usersResult.data ?? []).map((row) => [
      row.id,
      String(row.display ?? row.login_name ?? "").trim() || "Nao informado",
    ]),
  );
  const reversalByOriginalMap = new Map(
    (reversalsFromOriginalResult.data ?? []).map((row) => [
      row.original_stock_transfer_id,
      {
        reversalTransferId: row.reversal_stock_transfer_id,
        reversalReason: row.reversal_reason,
        reversedAt: row.created_at,
      },
    ]),
  );
  const originalByReversalMap = new Map(
    (reversalsByReversalResult.data ?? []).map((row) => [
      row.reversal_stock_transfer_id,
      {
        originalTransferId: row.original_stock_transfer_id,
        reversalReason: row.reversal_reason,
        reversedAt: row.created_at,
      },
    ]),
  );
  const itemReversalByOriginalMap = new Map(
    (itemReversalsFromOriginalResult.data ?? []).map((row) => [
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
    (itemReversalsByReversalResult.data ?? [])
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

  const allRows: TransferListItem[] = (itemRows ?? []).flatMap((item) => {
    const transfer = transferMap.get(item.stock_transfer_id);
    if (!transfer) return [];

    const material = materialMap.get(item.material_id);
    const fromStockCenterName = stockCenterMap.get(transfer.from_stock_center_id) ?? "-";
    const toStockCenterName = stockCenterMap.get(transfer.to_stock_center_id) ?? "-";
    const directPurchase = Boolean(transfer.direct_purchase);
    const projectCode = directPurchase && !transfer.project_id
      ? "Compra direta"
      : projectMap.get(transfer.project_id ?? "") ?? "-";

    const reversalFromOriginal = reversalByOriginalMap.get(transfer.id) ?? null;
    const reversalFromReversal = originalByReversalMap.get(transfer.id) ?? null;
    const itemReversalFromOriginal = itemReversalByOriginalMap.get(item.id) ?? null;
    const itemReversalFromReversal = originalByReversalItemMap.get(item.id) ?? null;

    return [
      {
        id: item.id,
        transferId: transfer.id,
        updatedAt: transfer.updated_at ?? transfer.created_at,
        updatedByName: userMap.get(transfer.updated_by ?? transfer.created_by ?? "") ?? "Nao informado",
        movementType: transfer.movement_type,
        operationPurpose: normalizeOperationPurpose(transfer.operation_purpose),
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
        fromStockCenterName,
        toStockCenterId: transfer.to_stock_center_id,
        toStockCenterName,
        projectId: transfer.project_id,
        projectCode,
        directPurchase,
        balanceCorrectionReason: transfer.balance_correction_reason ?? null,
        notes: transfer.notes,
        isReversed: Boolean(reversalFromOriginal || itemReversalFromOriginal),
        reversalTransferId: reversalFromOriginal?.reversalTransferId ?? itemReversalFromOriginal?.reversalTransferId ?? null,
        isReversal: Boolean(reversalFromReversal || itemReversalFromReversal),
        originalTransferId: reversalFromReversal?.originalTransferId ?? itemReversalFromReversal?.originalTransferId ?? null,
        reversalReason: reversalFromOriginal?.reversalReason ?? itemReversalFromOriginal?.reversalReason ?? reversalFromReversal?.reversalReason ?? itemReversalFromReversal?.reversalReason ?? null,
        reversedAt: reversalFromOriginal?.reversedAt ?? itemReversalFromOriginal?.reversedAt ?? reversalFromReversal?.reversedAt ?? itemReversalFromReversal?.reversedAt ?? null,
      },
    ];
  });

  return NextResponse.json({ history: allRows, pageInfo });
}

async function loadTransferEditHistory(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar historico da movimentacao de estoque.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const pageAuth = await requirePageAction({ context: resolution, pageKey: "entrada", action: "read" });
  if (!pageAuth.allowed) {
    return NextResponse.json({ message: pageAuth.error.message }, { status: pageAuth.error.status });
  }

  const { supabase, appUser } = resolution;

  const page = parsePositiveInteger(request.nextUrl.searchParams.get("page"), 1);
  const pageSize = Math.min(parsePositiveInteger(request.nextUrl.searchParams.get("pageSize"), 20), 100);
  const transferId = normalizeText(request.nextUrl.searchParams.get("transferId"));
  const startDate = normalizeDateInput(request.nextUrl.searchParams.get("startDate"));
  const endDate = normalizeDateInput(request.nextUrl.searchParams.get("endDate"));

  if (!transferId) {
    return NextResponse.json({ message: "transferId e obrigatorio para carregar o historico." }, { status: 400 });
  }

  const baseHistoryQuery = () =>
    supabase
      .from("material_history")
      .select("id, changes, created_at, created_by")
      .eq("tenant_id", appUser.tenant_id)
      .eq("change_type", "UPDATE");

  let stockHistoryQuery = baseHistoryQuery().contains("changes", {
    _context: "STOCK_TRANSFER",
    stockTransferId: transferId,
  });
  if (startDate) stockHistoryQuery = stockHistoryQuery.gte("created_at", `${startDate}T00:00:00`);
  if (endDate) stockHistoryQuery = stockHistoryQuery.lte("created_at", `${endDate}T23:59:59.999`);

  let reversalByOriginalQuery = baseHistoryQuery().contains("changes", {
    _context: "STOCK_TRANSFER_REVERSAL",
    originalStockTransferId: transferId,
  });
  if (startDate) reversalByOriginalQuery = reversalByOriginalQuery.gte("created_at", `${startDate}T00:00:00`);
  if (endDate) reversalByOriginalQuery = reversalByOriginalQuery.lte("created_at", `${endDate}T23:59:59.999`);

  let reversalByReversalQuery = baseHistoryQuery().contains("changes", {
    _context: "STOCK_TRANSFER_REVERSAL",
    reversalStockTransferId: transferId,
  });
  if (startDate) reversalByReversalQuery = reversalByReversalQuery.gte("created_at", `${startDate}T00:00:00`);
  if (endDate) reversalByReversalQuery = reversalByReversalQuery.lte("created_at", `${endDate}T23:59:59.999`);

  let balanceCorrectionQuery = baseHistoryQuery().contains("changes", {
    _context: "STOCK_TRANSFER_BALANCE_CORRECTION",
    stockTransferId: transferId,
  });
  if (startDate) balanceCorrectionQuery = balanceCorrectionQuery.gte("created_at", `${startDate}T00:00:00`);
  if (endDate) balanceCorrectionQuery = balanceCorrectionQuery.lte("created_at", `${endDate}T23:59:59.999`);

  const [stockHistoryResult, reversalByOriginalResult, reversalByReversalResult, balanceCorrectionResult] = await Promise.all([
    stockHistoryQuery.returns<MaterialHistoryRow[]>(),
    reversalByOriginalQuery.returns<MaterialHistoryRow[]>(),
    reversalByReversalQuery.returns<MaterialHistoryRow[]>(),
    balanceCorrectionQuery.returns<MaterialHistoryRow[]>(),
  ]);

  if (stockHistoryResult.error || reversalByOriginalResult.error || reversalByReversalResult.error || balanceCorrectionResult.error) {
    return NextResponse.json({ message: "Falha ao carregar historico da movimentacao de estoque." }, { status: 500 });
  }

  const historyById = new Map<string, MaterialHistoryRow>();
  [
    ...(stockHistoryResult.data ?? []),
    ...(reversalByOriginalResult.data ?? []),
    ...(reversalByReversalResult.data ?? []),
    ...(balanceCorrectionResult.data ?? []),
  ].forEach((row) => {
    historyById.set(row.id, row);
  });

  const historyRows = Array.from(historyById.values()).sort(
    (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
  );

  const userIds = Array.from(
    new Set((historyRows ?? []).map((row) => row.created_by).filter((value): value is string => Boolean(value))),
  );

  const usersResult = userIds.length
    ? await supabase
        .from("app_users")
        .select("id, display, login_name")
        .eq("tenant_id", appUser.tenant_id)
        .in("id", userIds)
        .returns<AppUserRow[]>()
    : ({ data: [], error: null } as { data: AppUserRow[]; error: null });

  if (usersResult.error) {
    return NextResponse.json({ message: "Falha ao carregar autores do historico da movimentacao." }, { status: 500 });
  }

  const userMap = new Map(
    (usersResult.data ?? []).map((row) => [
      row.id,
      String(row.display ?? row.login_name ?? "").trim() || "Nao informado",
    ]),
  );
  const historyStockCenterIds = new Set<string>();
  const historyProjectIds = new Set<string>();

  historyRows.forEach((row) => {
    const rawChanges = parseHistoryChanges(row.changes);
    const fromStockCenterId = String((rawChanges.fromStockCenterId as { from?: unknown; to?: unknown } | undefined)?.to ?? "").trim();
    const toStockCenterId = String((rawChanges.toStockCenterId as { from?: unknown; to?: unknown } | undefined)?.to ?? "").trim();
    const projectId = String((rawChanges.projectId as { from?: unknown; to?: unknown } | undefined)?.to ?? "").trim();
    if (fromStockCenterId) historyStockCenterIds.add(fromStockCenterId);
    if (toStockCenterId) historyStockCenterIds.add(toStockCenterId);
    if (projectId) historyProjectIds.add(projectId);
  });

  const [historyStockCentersResult, historyProjectsResult] = await Promise.all([
    historyStockCenterIds.size
      ? supabase
          .from("stock_centers")
          .select("id, name")
          .eq("tenant_id", appUser.tenant_id)
          .in("id", Array.from(historyStockCenterIds))
          .returns<StockCenterRow[]>()
      : Promise.resolve({ data: [], error: null } as { data: StockCenterRow[]; error: null }),
    historyProjectIds.size
      ? supabase
          .from("projects")
          .select("id, sob")
          .eq("tenant_id", appUser.tenant_id)
          .in("id", Array.from(historyProjectIds))
          .returns<ProjectRow[]>()
      : Promise.resolve({ data: [], error: null } as { data: ProjectRow[]; error: null }),
  ]);

  if (historyStockCentersResult.error || historyProjectsResult.error) {
    return NextResponse.json({ message: "Falha ao carregar detalhes do historico da movimentacao." }, { status: 500 });
  }

  const historyValueMaps: HistoryValueMaps = {
    stockCenters: new Map((historyStockCentersResult.data ?? []).map((row) => [row.id, row.name])),
    projects: new Map((historyProjectsResult.data ?? []).map((row) => [row.id, row.sob])),
  };

  const entries = (historyRows ?? []).map((row) => {
    const rawChanges = parseHistoryChanges(row.changes);
    const normalizedChanges = normalizeResolvedHistoryChangeSet(rawChanges, historyValueMaps);
    const action = resolveHistoryAction(rawChanges, normalizedChanges);

    return {
      id: row.id,
      action,
      changedAt: row.created_at,
      changedByName: userMap.get(row.created_by ?? "") ?? "Nao informado",
      changes: normalizedChanges,
    };
  });

  const from = (page - 1) * pageSize;
  const pagedEntries = entries.slice(from, from + pageSize);

  return NextResponse.json({
    history: pagedEntries,
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
      return await loadTransferEditHistory(request);
    }

    return await loadTransferList(request);
  } catch {
    return NextResponse.json({ message: "Falha ao carregar movimentacoes de estoque." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para salvar movimentacao de estoque.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const pageAuth = await requirePageAction({ context: resolution, pageKey: "entrada", action: "create" });
    if (!pageAuth.allowed) {
      return NextResponse.json({ message: pageAuth.error.message }, { status: pageAuth.error.status });
    }

    const payload = (await request.json().catch(() => ({}))) as TransferPayload;

    const movementType = normalizeMovementType(payload.movementType);
    const operationPurpose = normalizeOperationPurpose(payload.operationPurpose);
    const fromStockCenterId = normalizeText(payload.fromStockCenterId);
    const toStockCenterId = normalizeText(payload.toStockCenterId);
    const directPurchase = payload.directPurchase === true;
    const projectId = directPurchase && movementType === "ENTRY" ? null : normalizeText(payload.projectId);
    const entryDate = normalizeDateInput(payload.entryDate);
    const entryType = normalizeEntryType(payload.entryType);
    const balanceCorrectionReason = normalizeText(payload.balanceCorrectionReason) || null;
    const notes = normalizeText(payload.notes) || null;
    const items = buildTransferItems(payload);
    const today = toIsoDate(new Date());

    if (directPurchase && movementType !== "ENTRY") {
      return NextResponse.json(
        { message: "Compra direta e permitida somente para operacao Entrada." },
        { status: 400 },
      );
    }

    if (operationPurpose === "BALANCE_CORRECTION" && !balanceCorrectionReason) {
      return NextResponse.json(
        { message: "Motivo da correcao de saldo e obrigatorio." },
        { status: 400 },
      );
    }

    if (!movementType || !fromStockCenterId || !toStockCenterId || (!projectId && !directPurchase) || !entryDate || !entryType) {
      return NextResponse.json(
        {
          message:
            "Campos obrigatorios: movementType, fromStockCenterId, toStockCenterId, projectId, entryDate e entryType. Projeto e opcional somente em Entrada com Compra direta.",
        },
        { status: 400 },
      );
    }

    if (entryDate > today) {
      return NextResponse.json(
        { message: "Data da movimentacao nao pode ser futura." },
        { status: 400 },
      );
    }

    if (fromStockCenterId === toStockCenterId) {
      return NextResponse.json(
        { message: "fromStockCenterId e toStockCenterId devem ser diferentes." },
        { status: 400 },
      );
    }

    if (items.length === 0) {
      return NextResponse.json(
        { message: "Informe ao menos um item com materialId e quantity maior que zero." },
        { status: 400 },
      );
    }

    const { supabase, appUser } = resolution;
    const candidateCenterIds = Array.from(new Set([fromStockCenterId, toStockCenterId].filter(Boolean)));
    const teamCentersResult = candidateCenterIds.length
      ? await supabase
          .from("teams")
          .select("stock_center_id")
          .eq("tenant_id", appUser.tenant_id)
          .in("stock_center_id", candidateCenterIds)
          .returns<TeamStockCenterRow[]>()
      : { data: [], error: null };

    if (teamCentersResult.error) {
      return NextResponse.json({ message: "Falha ao validar centros da movimentacao de estoque." }, { status: 500 });
    }

    const blockedTeamCenter = (teamCentersResult.data ?? []).find((row) => String(row.stock_center_id ?? "").trim());
    if (blockedTeamCenter) {
      return NextResponse.json(
        {
          message:
            "Centros vinculados a equipes nao podem ser usados na Movimentacao de Estoque. Use Operacoes de Equipe para requisicao, devolucao ou retorno de campo.",
        },
        { status: 400 },
      );
    }

    const materialIds = Array.from(new Set(items.map((item) => item.materialId).filter(Boolean)));
    const materialsResult = materialIds.length
      ? await supabase
          .from("materials")
          .select("id, codigo, is_transformer, serial_tracking_type, allow_pending_serial_identification")
          .eq("tenant_id", appUser.tenant_id)
          .in("id", materialIds)
          .returns<MaterialRow[]>()
      : { data: [], error: null };

    if (materialsResult.error) {
      return NextResponse.json({ message: "Falha ao validar materiais da movimentacao de estoque." }, { status: 500 });
    }

    const materialMap = new Map((materialsResult.data ?? []).map((row) => [row.id, row]));
    for (const item of items) {
      const material = materialMap.get(item.materialId);
      const serialTrackingType = normalizeSerialTrackingType(material?.serial_tracking_type ?? (material?.is_transformer ? "TRAFO" : "NONE"));
      const hasSerial = Boolean(normalizeText(item.serialNumber));

      if (!isSerialTrackedMaterial(serialTrackingType)) {
        continue;
      }

      if (hasSerial && item.quantity !== 1) {
        return NextResponse.json(
          { message: `Material ${serialTrackingLabel(serialTrackingType)} permite somente quantidade 1 por movimentacao.` },
          { status: 400 },
        );
      }

      if (requiresLotCode(serialTrackingType) && !normalizeText(item.lotCode)) {
        return NextResponse.json(
          { message: "Serial e LP sao obrigatorios para material TRAFO." },
          { status: 400 },
        );
      }

      const canCreatePendingSerial = allowsPendingSerialIdentification(
        serialTrackingType,
        material?.allow_pending_serial_identification,
      ) && (movementType === "ENTRY" || movementType === "TRANSFER");

      if (!hasSerial && !canCreatePendingSerial) {
        return NextResponse.json(
          { message: `Serial e obrigatorio para material ${serialTrackingLabel(serialTrackingType)}.` },
          { status: 400 },
        );
      }

      if (!hasSerial && canCreatePendingSerial && !isWholeQuantity(item.quantity)) {
        return NextResponse.json(
          { message: `Material ${serialTrackingLabel(serialTrackingType)} pendente de serial deve usar quantidade inteira.` },
          { status: 400 },
        );
      }
    }

    const saveResult = await saveStockTransferViaRpc(supabase, {
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      movementType,
      operationPurpose,
      fromStockCenterId,
      toStockCenterId,
      projectId,
      directPurchase,
      entryDate,
      entryType,
      balanceCorrectionReason,
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
    return NextResponse.json({ message: "Falha ao salvar movimentacao de estoque." }, { status: 500 });
  }
}

export async function PUT() {
  return NextResponse.json(
    {
      message: "Edicao direta de movimentacao bloqueada por regra de negocio. Utilize estorno.",
      reason: "EDIT_BLOCKED",
    },
    { status: 409 },
  );
}
