import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
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
};

type StockTransferHeaderRow = {
  id: string;
  movement_type: "ENTRY" | "EXIT" | "TRANSFER";
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

type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

type TransferPayload = {
  transferId?: unknown;
  movementType?: unknown;
  fromStockCenterId?: unknown;
  toStockCenterId?: unknown;
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

type TransferListItem = {
  id: string;
  transferId: string;
  updatedAt: string;
  updatedByName: string;
  movementType: "ENTRY" | "EXIT" | "TRANSFER";
  materialId: string;
  materialCode: string;
  description: string;
  isTransformer: boolean;
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

async function loadTransferList(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar movimentacoes de estoque.",
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
  const movementType = normalizeMovementType(request.nextUrl.searchParams.get("movementType"));
  const entryType = normalizeEntryType(request.nextUrl.searchParams.get("entryType"));
  const projectCodeFilter = normalizeCodeFilter(request.nextUrl.searchParams.get("projectCode"));
  const materialCodeFilter = normalizeCodeFilter(request.nextUrl.searchParams.get("materialCode"));
  const reversalStatus = normalizeReversalStatus(request.nextUrl.searchParams.get("reversalStatus"));

  let transfersQuery = supabase
    .from("stock_transfers")
    .select(
      "id, movement_type, from_stock_center_id, to_stock_center_id, project_id, entry_date, entry_type, notes, created_at, updated_at, created_by, updated_by",
    )
    .eq("tenant_id", appUser.tenant_id)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (startDate) {
    transfersQuery = transfersQuery.gte("entry_date", startDate);
  }
  if (endDate) {
    transfersQuery = transfersQuery.lte("entry_date", endDate);
  }
  if (movementType) {
    transfersQuery = transfersQuery.eq("movement_type", movementType);
  }
  if (entryType) {
    transfersQuery = transfersQuery.eq("entry_type", entryType);
  }

  const { data: transferHeaders, error: transfersError } = await transfersQuery.returns<StockTransferHeaderRow[]>();

  if (transfersError) {
    return NextResponse.json({ message: "Falha ao carregar movimentacoes de estoque." }, { status: 500 });
  }

  if (!transferHeaders?.length) {
    return NextResponse.json({
      history: [],
      pagination: {
        page,
        pageSize,
        total: 0,
      },
    });
  }

  const transferIds = transferHeaders.map((row) => row.id);

  const { data: itemRows, error: itemsError } = await supabase
    .from("stock_transfer_items")
    .select("id, stock_transfer_id, material_id, quantity, serial_number, lot_code")
    .eq("tenant_id", appUser.tenant_id)
    .in("stock_transfer_id", transferIds)
    .returns<StockTransferItemRow[]>();

  if (itemsError) {
    return NextResponse.json({ message: "Falha ao carregar itens das movimentacoes de estoque." }, { status: 500 });
  }

  const materialIds = Array.from(new Set((itemRows ?? []).map((row) => row.material_id).filter(Boolean)));
  const stockCenterIds = Array.from(
    new Set(
      (transferHeaders ?? [])
        .flatMap((row) => [row.from_stock_center_id, row.to_stock_center_id])
        .filter(Boolean),
    ),
  );
  const projectIds = Array.from(new Set((transferHeaders ?? []).map((row) => row.project_id).filter(Boolean)));
  const userIds = Array.from(
    new Set(
      (transferHeaders ?? [])
        .flatMap((row) => [row.updated_by, row.created_by])
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const [materialsResult, stockCentersResult, projectsResult, usersResult, reversalsFromOriginalResult, reversalsByReversalResult] = await Promise.all([
    materialIds.length
      ? supabase
          .from("materials")
          .select("id, codigo, descricao, is_transformer")
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
    transferIds.length
      ? supabase
          .from("stock_transfer_reversals")
          .select("original_stock_transfer_id, reversal_stock_transfer_id, reversal_reason, created_at")
          .eq("tenant_id", appUser.tenant_id)
          .in("original_stock_transfer_id", transferIds)
          .returns<StockTransferReversalRow[]>()
      : Promise.resolve({ data: [], error: null } as { data: StockTransferReversalRow[]; error: null }),
    transferIds.length
      ? supabase
          .from("stock_transfer_reversals")
          .select("original_stock_transfer_id, reversal_stock_transfer_id, reversal_reason, created_at")
          .eq("tenant_id", appUser.tenant_id)
          .in("reversal_stock_transfer_id", transferIds)
          .returns<StockTransferReversalRow[]>()
      : Promise.resolve({ data: [], error: null } as { data: StockTransferReversalRow[]; error: null }),
  ]);

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

  const transferMap = new Map((transferHeaders ?? []).map((row) => [row.id, row]));
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
    ((reversalsFromOriginalResult.error ? [] : reversalsFromOriginalResult.data) ?? []).map((row) => [
      row.original_stock_transfer_id,
      {
        reversalTransferId: row.reversal_stock_transfer_id,
        reversalReason: row.reversal_reason,
        reversedAt: row.created_at,
      },
    ]),
  );
  const originalByReversalMap = new Map(
    ((reversalsByReversalResult.error ? [] : reversalsByReversalResult.data) ?? []).map((row) => [
      row.reversal_stock_transfer_id,
      {
        originalTransferId: row.original_stock_transfer_id,
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
    const projectCode = projectMap.get(transfer.project_id) ?? "-";

    const reversalFromOriginal = reversalByOriginalMap.get(transfer.id) ?? null;
    const reversalFromReversal = originalByReversalMap.get(transfer.id) ?? null;

    return [
      {
        id: item.id,
        transferId: transfer.id,
        updatedAt: transfer.updated_at ?? transfer.created_at,
        updatedByName: userMap.get(transfer.updated_by ?? transfer.created_by ?? "") ?? "Nao informado",
        movementType: transfer.movement_type,
        materialId: item.material_id,
        materialCode: material?.codigo ?? "-",
        description: material?.descricao ?? "-",
        isTransformer: Boolean(material?.is_transformer),
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
        notes: transfer.notes,
        isReversed: Boolean(reversalFromOriginal),
        reversalTransferId: reversalFromOriginal?.reversalTransferId ?? null,
        isReversal: Boolean(reversalFromReversal),
        originalTransferId: reversalFromReversal?.originalTransferId ?? null,
        reversalReason: reversalFromOriginal?.reversalReason ?? reversalFromReversal?.reversalReason ?? null,
        reversedAt: reversalFromOriginal?.reversedAt ?? reversalFromReversal?.reversedAt ?? null,
      },
    ];
  });

  const filteredRows = allRows.filter((row) => {
    const normalizedProjectCode = String(row.projectCode ?? "").trim().toUpperCase();
    const normalizedMaterialCode = String(row.materialCode ?? "").trim().toUpperCase();

    if (projectCodeFilter && !normalizedProjectCode.includes(projectCodeFilter)) {
      return false;
    }
    if (materialCodeFilter && !normalizedMaterialCode.includes(materialCodeFilter)) {
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

  filteredRows.sort((left, right) => {
    const leftTime = new Date(left.updatedAt).getTime();
    const rightTime = new Date(right.updatedAt).getTime();
    return rightTime - leftTime;
  });

  const from = (page - 1) * pageSize;
  const pagedRows = filteredRows.slice(from, from + pageSize);

  return NextResponse.json({
    history: pagedRows,
    pagination: {
      page,
      pageSize,
      total: filteredRows.length,
    },
  });
}

async function loadTransferEditHistory(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar historico da movimentacao de estoque.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
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

  const [stockHistoryResult, reversalByOriginalResult, reversalByReversalResult] = await Promise.all([
    stockHistoryQuery.returns<MaterialHistoryRow[]>(),
    reversalByOriginalQuery.returns<MaterialHistoryRow[]>(),
    reversalByReversalQuery.returns<MaterialHistoryRow[]>(),
  ]);

  if (stockHistoryResult.error || reversalByOriginalResult.error || reversalByReversalResult.error) {
    return NextResponse.json({ message: "Falha ao carregar historico da movimentacao de estoque." }, { status: 500 });
  }

  const historyById = new Map<string, MaterialHistoryRow>();
  [
    ...(stockHistoryResult.data ?? []),
    ...(reversalByOriginalResult.data ?? []),
    ...(reversalByReversalResult.data ?? []),
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

    const payload = (await request.json().catch(() => ({}))) as TransferPayload;

    const movementType = normalizeMovementType(payload.movementType);
    const fromStockCenterId = normalizeText(payload.fromStockCenterId);
    const toStockCenterId = normalizeText(payload.toStockCenterId);
    const projectId = normalizeText(payload.projectId);
    const entryDate = normalizeDateInput(payload.entryDate);
    const entryType = normalizeEntryType(payload.entryType);
    const notes = normalizeText(payload.notes) || null;
    const items = buildTransferItems(payload);
    const today = toIsoDate(new Date());

    if (!movementType || !fromStockCenterId || !toStockCenterId || !projectId || !entryDate || !entryType) {
      return NextResponse.json(
        {
          message:
            "Campos obrigatorios: movementType, fromStockCenterId, toStockCenterId, projectId, entryDate e entryType.",
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
    const saveResult = await saveStockTransferViaRpc(supabase, {
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      movementType,
      fromStockCenterId,
      toStockCenterId,
      projectId,
      entryDate,
      entryType,
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
