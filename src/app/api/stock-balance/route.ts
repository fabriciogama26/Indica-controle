import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { loadAllRows, loadRowsInChunks, parsePagination } from "@/lib/server/apiHelpers";

type MaterialRelation = {
  id: string;
  codigo: string;
  descricao: string;
  umb: string | null;
  tipo: string | null;
  is_active: boolean;
};

type BalanceQueryRow = {
  stock_center_id: string;
  material_id: string;
  quantity: number | string | null;
  updated_at: string | null;
  materials: MaterialRelation | MaterialRelation[] | null;
};

type CurrentStockCenterRow = {
  id: string;
  name: string;
  center_type: "OWN" | "THIRD_PARTY";
  controls_balance: boolean;
  is_active: boolean;
};

type HistoricalTransferSummaryRow = {
  id: string;
  from_stock_center_id: string;
  to_stock_center_id: string;
  created_at: string;
  updated_at: string | null;
};

type HistoricalTransferItemRow = {
  stock_transfer_id: string;
  material_id: string;
  materials: MaterialRelation | MaterialRelation[] | null;
};

type StockTransferHeaderRow = {
  id: string;
  movement_type: "ENTRY" | "EXIT" | "TRANSFER";
  operation_purpose?: "NORMAL" | "BALANCE_CORRECTION" | null;
  from_stock_center_id: string;
  to_stock_center_id: string;
  project_id: string;
  entry_date: string;
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

type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

type BalanceSummaryRow = {
  quantity: number | string | null;
  materials: { umb: string | null } | { umb: string | null }[] | null;
};

type StockTransferReversalRow = {
  original_stock_transfer_id: string;
  reversal_stock_transfer_id: string;
  reversal_reason: string;
  created_at: string;
};

type TeamOperationRow = {
  transfer_id: string;
  team_id: string;
  operation_kind: "REQUISITION" | "RETURN" | "FIELD_RETURN" | null;
  technical_origin_stock_center_id: string | null;
  team_name_snapshot: string;
  foreman_name_snapshot: string;
};

type TeamRow = {
  id: string;
  stock_center_id: string | null;
};

type TeamStockCenterRow = {
  stock_center_id: string | null;
};

const RELATION_QUERY_CHUNK_SIZE = 100;
const QUERY_PAGE_SIZE = 1000;

function normalizeText(value: string | null) {
  return String(value ?? "").trim();
}

function normalizeCode(value: string | null) {
  return normalizeText(value).toUpperCase();
}

function normalizeOnlyPositive(value: string | null) {
  return String(value ?? "").trim().toUpperCase() === "TODOS" ? "TODOS" : "SIM";
}

function normalizeHistoryOperationKind(value: string | null) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (["ENTRY", "EXIT", "TRANSFER", "REQUISITION", "RETURN", "FIELD_RETURN"].includes(normalized)) {
    return normalized as "ENTRY" | "EXIT" | "TRANSFER" | "REQUISITION" | "RETURN" | "FIELD_RETURN";
  }
  return null;
}

function parseNonNegativeDecimal(value: string | null) {
  const normalized = normalizeText(value).replace(",", ".");
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function normalizeOperationPurpose(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "NORMAL" || normalized === "BALANCE_CORRECTION") {
    return normalized as "NORMAL" | "BALANCE_CORRECTION";
  }
  return "NORMAL" as const;
}

function unwrapRelation<T>(value: T | T[] | null) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function toTimestamp(value: string | null) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickLatestDate(currentValue: string | null, nextValue: string | null) {
  return toTimestamp(nextValue) > toTimestamp(currentValue) ? nextValue : currentValue;
}

function resolveOperationKind(
  movementType: "ENTRY" | "EXIT" | "TRANSFER",
  transferId: string,
  toStockCenterId: string,
  teamOperationMap: Map<string, { teamStockCenterId: string | null; operationKind: "REQUISITION" | "RETURN" | "FIELD_RETURN" | null }>,
) {
  const team = teamOperationMap.get(transferId);
  if (!team) {
    return movementType;
  }

  if (team.operationKind) {
    return team.operationKind;
  }

  if (!team.teamStockCenterId) {
    return movementType;
  }

  return toStockCenterId === team.teamStockCenterId ? "REQUISITION" : "RETURN";
}

async function loadStockHistory(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar o historico do estoque atual.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const { supabase, appUser } = resolution;
  const stockCenterId = normalizeText(request.nextUrl.searchParams.get("stockCenterId"));
  const materialId = normalizeText(request.nextUrl.searchParams.get("materialId"));
  const historyOperationKind = normalizeHistoryOperationKind(request.nextUrl.searchParams.get("historyOperationKind"));
  const historyOrigin = normalizeCode(request.nextUrl.searchParams.get("historyOrigin"));
  const { page, pageSize } = parsePagination(request.nextUrl.searchParams, {
    defaultPageSize: 5,
    maxPageSize: 50,
  });

  if (!stockCenterId || !materialId) {
    return NextResponse.json(
      { message: "stockCenterId e materialId sao obrigatorios para carregar o historico." },
      { status: 400 },
    );
  }

  // Historico completo do material: o `.limit(2000)` anterior nunca passou de 1.000
  // linhas (teto do PostgREST, sem aviso), entao material com muita movimentacao
  // perdia parte do historico na tela e no CSV.
  const { data: allMaterialItems, error: itemsError } = await loadAllRows<StockTransferItemRow>((from, to) => supabase
    .from("stock_transfer_items")
    .select("id, stock_transfer_id, material_id, quantity, serial_number, lot_code")
    .eq("tenant_id", appUser.tenant_id)
    .eq("material_id", materialId)
    .order("id", { ascending: true })
    .range(from, to)
    .returns<StockTransferItemRow[]>());

  if (itemsError) {
    return NextResponse.json({ message: "Falha ao carregar os itens do historico do estoque atual." }, { status: 500 });
  }

  if (!allMaterialItems?.length) {
    return NextResponse.json({ history: [], pagination: { page, pageSize, total: 0 } });
  }

  const allTransferIds = Array.from(new Set(allMaterialItems.map((row) => row.stock_transfer_id)));
  const { data: transferHeaders, error: transfersError } = await loadRowsInChunks<StockTransferHeaderRow>(
    allTransferIds,
    (chunk, from, to) => supabase
      .from("stock_transfers")
      .select(
        "id, movement_type, operation_purpose, from_stock_center_id, to_stock_center_id, project_id, entry_date, balance_correction_reason, notes, created_at, updated_at, created_by, updated_by",
      )
      .eq("tenant_id", appUser.tenant_id)
      .or(`from_stock_center_id.eq.${stockCenterId},to_stock_center_id.eq.${stockCenterId}`)
      .in("id", chunk)
      .order("id", { ascending: true })
      .range(from, to)
      .returns<StockTransferHeaderRow[]>(),
  { chunkSize: RELATION_QUERY_CHUNK_SIZE },
  );

  if (transfersError) {
    return NextResponse.json({ message: "Falha ao carregar o historico do estoque atual." }, { status: 500 });
  }

  if (!transferHeaders?.length) {
    return NextResponse.json({ history: [], pagination: { page, pageSize, total: 0 } });
  }

  const transferMap = new Map((transferHeaders ?? []).map((row) => [row.id, row]));
  const itemRows = allMaterialItems.filter((row) => transferMap.has(row.stock_transfer_id));

  if (!itemRows.length) {
    return NextResponse.json({ history: [], pagination: { page, pageSize, total: 0 } });
  }

  const stockCenterIds = Array.from(
    new Set(
      transferHeaders.flatMap((row) => [row.from_stock_center_id, row.to_stock_center_id]).filter(Boolean),
    ),
  );
  const projectIds = Array.from(new Set(transferHeaders.map((row) => row.project_id).filter(Boolean)));
  const transferIdsWithItems = Array.from(new Set(itemRows.map((row) => row.stock_transfer_id).filter(Boolean)));
  const userIds = Array.from(
    new Set(
      transferHeaders.flatMap((row) => [row.updated_by, row.created_by]).filter((value): value is string => Boolean(value)),
    ),
  );

  const transferIds = (transferHeaders ?? []).map((row) => row.id);

  const [
    stockCentersResult,
    projectsResult,
    usersResult,
    teamOperationsResult,
    teamsResult,
    reversalsFromOriginalResult,
    reversalsByReversalResult,
  ] = await Promise.all([
    stockCenterIds.length
      ? loadRowsInChunks<StockCenterRow>(
          stockCenterIds,
          (stockCenterIdChunk, from, to) => supabase
            .from("stock_centers")
            .select("id, name")
            .eq("tenant_id", appUser.tenant_id)
            .in("id", stockCenterIdChunk)
            .order("id", { ascending: true })
            .range(from, to)
            .returns<StockCenterRow[]>(),
    { chunkSize: RELATION_QUERY_CHUNK_SIZE },
        )
      : Promise.resolve({ data: [], error: null } as { data: StockCenterRow[]; error: null }),
    projectIds.length
      ? loadRowsInChunks<ProjectRow>(
          projectIds,
          (projectIdChunk, from, to) => supabase
            .from("project")
            .select("id, sob")
            .eq("tenant_id", appUser.tenant_id)
            .in("id", projectIdChunk)
            .order("id", { ascending: true })
            .range(from, to)
            .returns<ProjectRow[]>(),
    { chunkSize: RELATION_QUERY_CHUNK_SIZE },
        )
      : Promise.resolve({ data: [], error: null } as { data: ProjectRow[]; error: null }),
    userIds.length
      ? loadRowsInChunks<AppUserRow>(
          userIds,
          (userIdChunk, from, to) => supabase
            .from("app_users")
            .select("id, display, login_name")
            .eq("tenant_id", appUser.tenant_id)
            .in("id", userIdChunk)
            .order("id", { ascending: true })
            .range(from, to)
            .returns<AppUserRow[]>(),
    { chunkSize: RELATION_QUERY_CHUNK_SIZE },
        )
      : Promise.resolve({ data: [], error: null } as { data: AppUserRow[]; error: null }),
    transferIdsWithItems.length
      ? loadRowsInChunks<TeamOperationRow>(
          transferIdsWithItems,
          (transferIdChunk, from, to) => supabase
            .from("stock_transfer_team_operations")
            .select("transfer_id, team_id, operation_kind, technical_origin_stock_center_id, team_name_snapshot, foreman_name_snapshot")
            .eq("tenant_id", appUser.tenant_id)
            .in("transfer_id", transferIdChunk)
            .order("transfer_id", { ascending: true })
            .range(from, to)
            .returns<TeamOperationRow[]>(),
    { chunkSize: RELATION_QUERY_CHUNK_SIZE },
        )
      : Promise.resolve({ data: [], error: null } as { data: TeamOperationRow[]; error: null }),
    transferIdsWithItems.length
      ? supabase
          .from("teams")
          .select("id, stock_center_id")
          .eq("tenant_id", appUser.tenant_id)
          .returns<TeamRow[]>()
      : Promise.resolve({ data: [], error: null } as { data: TeamRow[]; error: null }),
    transferIds.length
      ? loadRowsInChunks<StockTransferReversalRow>(
          transferIds,
          (transferIdChunk, from, to) => supabase
            .from("stock_transfer_reversals")
            .select("original_stock_transfer_id, reversal_stock_transfer_id, reversal_reason, created_at")
            .eq("tenant_id", appUser.tenant_id)
            .in("original_stock_transfer_id", transferIdChunk)
            .order("id", { ascending: true })
            .range(from, to)
            .returns<StockTransferReversalRow[]>(),
    { chunkSize: RELATION_QUERY_CHUNK_SIZE },
        )
      : Promise.resolve({ data: [], error: null } as { data: StockTransferReversalRow[]; error: null }),
    transferIds.length
      ? loadRowsInChunks<StockTransferReversalRow>(
          transferIds,
          (transferIdChunk, from, to) => supabase
            .from("stock_transfer_reversals")
            .select("original_stock_transfer_id, reversal_stock_transfer_id, reversal_reason, created_at")
            .eq("tenant_id", appUser.tenant_id)
            .in("reversal_stock_transfer_id", transferIdChunk)
            .order("id", { ascending: true })
            .range(from, to)
            .returns<StockTransferReversalRow[]>(),
    { chunkSize: RELATION_QUERY_CHUNK_SIZE },
        )
      : Promise.resolve({ data: [], error: null } as { data: StockTransferReversalRow[]; error: null }),
  ]);

  if (
    stockCentersResult.error
    || projectsResult.error
    || usersResult.error
    || teamOperationsResult.error
    || teamsResult.error
    || reversalsFromOriginalResult.error
    || reversalsByReversalResult.error
  ) {
    return NextResponse.json({ message: "Falha ao carregar detalhes do historico do estoque atual." }, { status: 500 });
  }

  const stockCenterMap = new Map((stockCentersResult.data ?? []).map((row) => [row.id, row.name]));
  const projectMap = new Map((projectsResult.data ?? []).map((row) => [row.id, row.sob]));
  const userMap = new Map(
    (usersResult.data ?? []).map((row) => [row.id, String(row.display ?? row.login_name ?? "").trim() || "Nao informado"]),
  );
  const teamById = new Map((teamsResult.data ?? []).map((row) => [row.id, row]));
  const teamOperationMap = new Map(
    (teamOperationsResult.data ?? [])
      .map((row) => [
        row.transfer_id,
        {
          teamStockCenterId: teamById.get(row.team_id)?.stock_center_id ?? null,
          operationKind: row.operation_kind,
          teamName: row.team_name_snapshot,
          foremanName: row.foreman_name_snapshot,
        },
      ] as const),
  );
  const reversalByOriginalMap = new Map(
    (reversalsFromOriginalResult.data ?? []).map((row) => [
      row.original_stock_transfer_id,
      {
        reversalTransferId: row.reversal_stock_transfer_id,
        reversalReason: row.reversal_reason,
      },
    ]),
  );
  const originalByReversalMap = new Map(
    (reversalsByReversalResult.data ?? []).map((row) => [
      row.reversal_stock_transfer_id,
      {
        originalTransferId: row.original_stock_transfer_id,
        reversalReason: row.reversal_reason,
      },
    ]),
  );

  const allEntries = (itemRows ?? []).flatMap((item) => {
    const transfer = transferMap.get(item.stock_transfer_id);
    if (!transfer) return [];

    const affectsAsSource = transfer.from_stock_center_id === stockCenterId;
    const affectsAsTarget = transfer.to_stock_center_id === stockCenterId;
    if (!affectsAsSource && !affectsAsTarget) return [];

    const signedQuantity = affectsAsTarget ? Number(item.quantity ?? 0) : Number(item.quantity ?? 0) * -1;
    const reversalFromOriginal = reversalByOriginalMap.get(transfer.id) ?? null;
    const reversalFromReversal = originalByReversalMap.get(transfer.id) ?? null;
    const team = teamOperationMap.get(transfer.id) ?? null;
    const operationKind = resolveOperationKind(transfer.movement_type, transfer.id, transfer.to_stock_center_id, teamOperationMap);

    return [
      {
        id: item.id,
        transferId: transfer.id,
        movementType: transfer.movement_type,
        operationPurpose: normalizeOperationPurpose(transfer.operation_purpose),
        signedQuantity,
        quantity: Number(item.quantity ?? 0),
        entryDate: transfer.entry_date,
        balanceCorrectionReason: transfer.balance_correction_reason ?? null,
        changedAt: transfer.updated_at ?? transfer.created_at,
        operationKind,
        teamName: team?.teamName ?? null,
        foremanName: team?.foremanName ?? null,
        projectCode: projectMap.get(transfer.project_id) ?? "-",
        fromStockCenterName: stockCenterMap.get(transfer.from_stock_center_id) ?? "-",
        toStockCenterName: stockCenterMap.get(transfer.to_stock_center_id) ?? "-",
        updatedByName: userMap.get(transfer.updated_by ?? transfer.created_by ?? "") ?? "Nao informado",
        serialNumber: item.serial_number,
        lotCode: item.lot_code,
        notes: transfer.notes,
        isReversal: Boolean(reversalFromReversal),
        isReversed: Boolean(reversalFromOriginal),
        reversalReason: reversalFromOriginal?.reversalReason ?? reversalFromReversal?.reversalReason ?? null,
      },
    ];
  });

  const filteredEntries = allEntries.filter((entry) => {
    if (historyOperationKind && entry.operationKind !== historyOperationKind) {
      return false;
    }

    if (historyOrigin && !String(entry.fromStockCenterName ?? "").trim().toUpperCase().includes(historyOrigin)) {
      return false;
    }

    return true;
  });

  filteredEntries.sort((left, right) => new Date(right.changedAt).getTime() - new Date(left.changedAt).getTime());
  const from = (page - 1) * pageSize;
  const pagedEntries = filteredEntries.slice(from, from + pageSize);

  return NextResponse.json({
    history: pagedEntries,
    pagination: {
      page,
      pageSize,
      total: filteredEntries.length,
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    const mode = normalizeText(request.nextUrl.searchParams.get("mode")).toLowerCase();
    if (mode === "history") {
      return await loadStockHistory(request);
    }

    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para carregar o estoque atual.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;

    const isExportRequest = mode === "export";
    const { page, pageSize } = parsePagination(request.nextUrl.searchParams, { maxPageSize: 100 });
    const stockCenterId = normalizeText(request.nextUrl.searchParams.get("stockCenterId"));
    const materialCode = normalizeCode(request.nextUrl.searchParams.get("materialCode"));
    const description = normalizeText(request.nextUrl.searchParams.get("description"));
    const qtyMin = parseNonNegativeDecimal(request.nextUrl.searchParams.get("qtyMin"));
    const qtyMax = parseNonNegativeDecimal(request.nextUrl.searchParams.get("qtyMax"));
    const onlyPositive = normalizeOnlyPositive(request.nextUrl.searchParams.get("onlyPositive"));
    const includeTeamCenters = normalizeText(request.nextUrl.searchParams.get("includeTeamCenters")) === "1";
    const includeHistoricalZeros = normalizeText(request.nextUrl.searchParams.get("includeHistoricalZeros")) === "1";

    if (qtyMin !== null && qtyMax !== null && qtyMin > qtyMax) {
      return NextResponse.json(
        { message: "Saldo minimo nao pode ser maior que o saldo maximo." },
        { status: 400 },
      );
    }

    const teamCenterResult = includeTeamCenters
      ? ({ data: [], error: null } as { data: TeamStockCenterRow[]; error: null })
      : await supabase
          .from("teams")
          .select("stock_center_id")
          .eq("tenant_id", appUser.tenant_id)
          .returns<TeamStockCenterRow[]>();

    if (teamCenterResult.error) {
      return NextResponse.json({ message: "Falha ao carregar o estoque atual." }, { status: 500 });
    }

    const blockedCenterIds = Array.from(
      new Set(
        (teamCenterResult.data ?? [])
          .map((row) => String(row.stock_center_id ?? "").trim())
          .filter(Boolean),
      ),
    );

    const stockCentersResult = await supabase
      .from("stock_centers")
      .select("id, name, center_type, controls_balance, is_active")
      .eq("tenant_id", appUser.tenant_id)
      .eq("is_active", true)
      .eq("center_type", "OWN")
      .order("name", { ascending: true })
      .returns<CurrentStockCenterRow[]>();

    if (stockCentersResult.error) {
      return NextResponse.json({ message: "Falha ao carregar o estoque atual." }, { status: 500 });
    }

    const availableStockCenters = (stockCentersResult.data ?? []).filter((row) => {
      if (!includeTeamCenters && blockedCenterIds.includes(row.id)) {
        return false;
      }

      if (stockCenterId && row.id !== stockCenterId) {
        return false;
      }

      return true;
    });

    if (availableStockCenters.length === 0) {
      return NextResponse.json({
        items: [],
        pagination: {
          page,
          pageSize,
          total: 0,
        },
      });
    }

    const availableStockCenterIds = availableStockCenters.map((row) => row.id);
    const stockCenterMap = new Map(availableStockCenters.map((row) => [row.id, row.name]));
    const shouldHydrateHistoricalZeros = includeHistoricalZeros && !includeTeamCenters && onlyPositive !== "SIM" && (qtyMin === null || qtyMin <= 0);
    const from = (page - 1) * pageSize;

    if (!shouldHydrateHistoricalZeros) {
      const baseSelect = [
        "stock_center_id",
        "material_id",
        "quantity",
        "updated_at",
        "materials!inner(id, codigo, descricao, umb, tipo, is_active)",
      ].join(", ");

      const buildBalanceQuery = (withCount = false) => {
        let query = supabase
          .from("stock_center_balances")
          .select(baseSelect, withCount ? { count: "exact" } : undefined)
          .eq("tenant_id", appUser.tenant_id)
          .eq("materials.is_active", true)
          .in("stock_center_id", availableStockCenterIds);
        if (onlyPositive === "SIM") query = query.gt("quantity", 0);
        if (qtyMin !== null) query = query.gte("quantity", qtyMin);
        if (qtyMax !== null) query = query.lte("quantity", qtyMax);
        if (materialCode) query = query.ilike("materials.codigo", `%${materialCode}%`);
        if (description) query = query.ilike("materials.descricao", `%${description}%`);
        return query;
      };

      let summaryQuery = supabase
        .from("stock_center_balances")
        .select("quantity, materials!inner(umb)")
        .eq("tenant_id", appUser.tenant_id)
        .eq("materials.is_active", true)
        .in("stock_center_id", availableStockCenterIds);
      if (onlyPositive === "SIM") summaryQuery = summaryQuery.gt("quantity", 0);
      if (qtyMin !== null) summaryQuery = summaryQuery.gte("quantity", qtyMin);
      if (qtyMax !== null) summaryQuery = summaryQuery.lte("quantity", qtyMax);
      if (materialCode) summaryQuery = summaryQuery.ilike("materials.codigo", `%${materialCode}%`);
      if (description) summaryQuery = summaryQuery.ilike("materials.descricao", `%${description}%`);

      if (isExportRequest) {
        const exportRows: BalanceQueryRow[] = [];

        for (let exportFrom = 0; ; exportFrom += QUERY_PAGE_SIZE) {
          const { data, error } = await buildBalanceQuery()
            .order("updated_at", { ascending: false, nullsFirst: false })
            .order("material_id", { ascending: true })
            .range(exportFrom, exportFrom + QUERY_PAGE_SIZE - 1)
            .returns<BalanceQueryRow[]>();

          if (error) {
            return NextResponse.json({ message: "Falha ao carregar o estoque atual." }, { status: 500 });
          }

          exportRows.push(...(data ?? []));
          if ((data ?? []).length < QUERY_PAGE_SIZE) break;
        }

        const exportItems = (exportRows ?? []).flatMap((row) => {
          const material = unwrapRelation(row.materials);
          const stockCenterName = stockCenterMap.get(row.stock_center_id);
          if (!material || !stockCenterName) return [];
          return [{
            stockCenterId: row.stock_center_id,
            stockCenterName,
            materialId: row.material_id,
            materialCode: material.codigo,
            description: material.descricao,
            unit: String(material.umb ?? "").trim(),
            materialType: String(material.tipo ?? "").trim().toUpperCase(),
            balanceQuantity: Number(row.quantity ?? 0),
            lastMovementAt: row.updated_at,
          }];
        });

        const summaryByUnit = Array.from(
          exportItems.reduce((summary, item) => {
            const unit = item.unit.trim().toUpperCase() || "SEM UMB";
            summary.set(unit, (summary.get(unit) ?? 0) + item.balanceQuantity);
            return summary;
          }, new Map<string, number>()),
          ([unit, balanceQuantity]) => ({ unit, balanceQuantity }),
        ).sort((left, right) => left.unit.localeCompare(right.unit, "pt-BR"));

        return NextResponse.json({
          items: exportItems,
          summaryByUnit,
          pagination: { page: 1, pageSize: exportItems.length, total: exportItems.length },
        });
      }

      const [
        { data: pageData, count: pageCount, error: pageError },
        { data: summaryData, error: summaryError },
      ] = await Promise.all([
        buildBalanceQuery(true)
          .order("updated_at", { ascending: false, nullsFirst: false })
          .order("material_id", { ascending: true })
          .range(from, from + pageSize - 1)
          .returns<BalanceQueryRow[]>(),
        summaryQuery.returns<BalanceSummaryRow[]>(),
      ]);

      if (pageError || summaryError) {
        return NextResponse.json({ message: "Falha ao carregar o estoque atual." }, { status: 500 });
      }

      const pageItems = (pageData ?? []).flatMap((row) => {
        const material = unwrapRelation(row.materials);
        const stockCenterName = stockCenterMap.get(row.stock_center_id);
        if (!material || !stockCenterName) return [];
        return [{
          stockCenterId: row.stock_center_id,
          stockCenterName,
          materialId: row.material_id,
          materialCode: material.codigo,
          description: material.descricao,
          unit: String(material.umb ?? "").trim(),
          materialType: String(material.tipo ?? "").trim().toUpperCase(),
          balanceQuantity: Number(row.quantity ?? 0),
          lastMovementAt: row.updated_at,
        }];
      });

      const summaryByUnit = Array.from(
        (summaryData ?? []).reduce((acc, row) => {
          const mat = unwrapRelation(row.materials);
          const unit = String(mat?.umb ?? "").trim().toUpperCase() || "SEM UMB";
          acc.set(unit, (acc.get(unit) ?? 0) + Number(row.quantity ?? 0));
          return acc;
        }, new Map<string, number>()),
        ([unit, balanceQuantity]) => ({ unit, balanceQuantity }),
      ).sort((a, b) => a.unit.localeCompare(b.unit, "pt-BR"));

      return NextResponse.json({
        items: pageItems,
        summaryByUnit,
        pagination: { page, pageSize, total: pageCount ?? 0 },
      });
    }

    let balanceQuery = supabase
      .from("stock_center_balances")
      .select(
        [
          "stock_center_id",
          "material_id",
          "quantity",
          "updated_at",
          "materials!inner(id, codigo, descricao, umb, tipo, is_active)",
        ].join(", "),
      )
      .eq("tenant_id", appUser.tenant_id)
      .eq("materials.is_active", true)
      .in("stock_center_id", availableStockCenterIds);

    if (materialCode) {
      balanceQuery = balanceQuery.ilike("materials.codigo", `%${materialCode}%`);
    }

    if (description) {
      balanceQuery = balanceQuery.ilike("materials.descricao", `%${description}%`);
    }

    const { data: balanceRows, error: balanceError } = await balanceQuery.returns<BalanceQueryRow[]>();

    if (balanceError) {
      return NextResponse.json({ message: "Falha ao carregar o estoque atual." }, { status: 500 });
    }

    const itemMap = new Map<
      string,
      {
        stockCenterId: string;
        stockCenterName: string;
        materialId: string;
        materialCode: string;
        description: string;
        unit: string;
        materialType: string;
        balanceQuantity: number;
        lastMovementAt: string | null;
      }
    >();

    (balanceRows ?? []).forEach((row) => {
      const material = unwrapRelation(row.materials);
      const stockCenterName = stockCenterMap.get(row.stock_center_id);

      if (!material || !stockCenterName) {
        return;
      }

      const itemKey = `${row.stock_center_id}:${row.material_id}`;
      itemMap.set(itemKey, {
        stockCenterId: row.stock_center_id,
        stockCenterName,
        materialId: row.material_id,
        materialCode: material.codigo,
        description: material.descricao,
        unit: String(material.umb ?? "").trim(),
        materialType: String(material.tipo ?? "").trim().toUpperCase(),
        balanceQuantity: Number(row.quantity ?? 0),
        lastMovementAt: row.updated_at,
      });
    });

    if (shouldHydrateHistoricalZeros) {
      const transferFilter = availableStockCenterIds.length === 1
        ? `from_stock_center_id.eq.${availableStockCenterIds[0]},to_stock_center_id.eq.${availableStockCenterIds[0]}`
        : `from_stock_center_id.in.(${availableStockCenterIds.join(",")}),to_stock_center_id.in.(${availableStockCenterIds.join(",")})`;

      const { data: historicalTransfers, error: historicalTransfersError } = await supabase
        .from("stock_transfers")
        .select("id, from_stock_center_id, to_stock_center_id, created_at, updated_at")
        .eq("tenant_id", appUser.tenant_id)
        .or(transferFilter)
        .returns<HistoricalTransferSummaryRow[]>();

      if (historicalTransfersError) {
        return NextResponse.json({ message: "Falha ao carregar o estoque atual." }, { status: 500 });
      }

      const transferIds = Array.from(new Set((historicalTransfers ?? []).map((row) => row.id).filter(Boolean)));
      const historicalTransferMap = new Map((historicalTransfers ?? []).map((row) => [row.id, row]));

      if (transferIds.length > 0) {
        const { data: historicalItems, error: historicalItemsError } = await loadRowsInChunks<HistoricalTransferItemRow>(
          transferIds,
          (transferIdChunk, from, to) => {
            let query = supabase
              .from("stock_transfer_items")
              .select("stock_transfer_id, material_id, materials!inner(id, codigo, descricao, umb, tipo, is_active)")
              .eq("tenant_id", appUser.tenant_id)
              .in("stock_transfer_id", transferIdChunk)
              .eq("materials.is_active", true);

            if (materialCode) {
              query = query.ilike("materials.codigo", `%${materialCode}%`);
            }

            if (description) {
              query = query.ilike("materials.descricao", `%${description}%`);
            }

            return query
              .order("id", { ascending: true })
              .range(from, to)
              .returns<HistoricalTransferItemRow[]>();
          },
          { chunkSize: RELATION_QUERY_CHUNK_SIZE },
        );

        if (historicalItemsError) {
          return NextResponse.json({ message: "Falha ao carregar o estoque atual." }, { status: 500 });
        }

        (historicalItems ?? []).forEach((row) => {
          const transfer = historicalTransferMap.get(row.stock_transfer_id);
          const material = unwrapRelation(row.materials);
          const changedAt = transfer?.updated_at ?? transfer?.created_at ?? null;

          if (!transfer || !material) {
            return;
          }

          [transfer.from_stock_center_id, transfer.to_stock_center_id].forEach((centerId) => {
            if (!stockCenterMap.has(centerId)) {
              return;
            }

            const itemKey = `${centerId}:${row.material_id}`;
            const existingItem = itemMap.get(itemKey);

            if (existingItem) {
              existingItem.lastMovementAt = pickLatestDate(existingItem.lastMovementAt, changedAt);
              return;
            }

            itemMap.set(itemKey, {
              stockCenterId: centerId,
              stockCenterName: stockCenterMap.get(centerId) ?? "-",
              materialId: row.material_id,
              materialCode: material.codigo,
              description: material.descricao,
              unit: String(material.umb ?? "").trim(),
              materialType: String(material.tipo ?? "").trim().toUpperCase(),
              balanceQuantity: 0,
              lastMovementAt: changedAt,
            });
          });
        });
      }
    }

    const filteredItems = Array.from(itemMap.values())
      .filter((item) => {
        if (qtyMin !== null && item.balanceQuantity < qtyMin) {
          return false;
        }

        if (qtyMax !== null && item.balanceQuantity > qtyMax) {
          return false;
        }

        if (onlyPositive !== "TODOS" && item.balanceQuantity <= 0) {
          return false;
        }

        return true;
      })
      .sort((left, right) => {
        const timestampDiff = toTimestamp(right.lastMovementAt) - toTimestamp(left.lastMovementAt);
        if (timestampDiff !== 0) {
          return timestampDiff;
        }

        const centerDiff = left.stockCenterName.localeCompare(right.stockCenterName, "pt-BR");
        if (centerDiff !== 0) {
          return centerDiff;
        }

        return left.materialCode.localeCompare(right.materialCode, "pt-BR");
      });

    const summaryByUnit = Array.from(
      filteredItems.reduce((summary, item) => {
        const unit = item.unit.trim().toUpperCase() || "SEM UMB";
        summary.set(unit, (summary.get(unit) ?? 0) + item.balanceQuantity);
        return summary;
      }, new Map<string, number>()),
      ([unit, balanceQuantity]) => ({ unit, balanceQuantity }),
    ).sort((left, right) => left.unit.localeCompare(right.unit, "pt-BR"));

    return NextResponse.json({
      items: isExportRequest ? filteredItems : filteredItems.slice(from, from + pageSize),
      summaryByUnit,
      pagination: {
        page: isExportRequest ? 1 : page,
        pageSize: isExportRequest ? filteredItems.length : pageSize,
        total: filteredItems.length,
      },
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar o estoque atual." }, { status: 500 });
  }
}
