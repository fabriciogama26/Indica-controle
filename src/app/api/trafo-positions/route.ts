import { NextRequest, NextResponse } from "next/server";

import { normalizeSerialTrackingType, SerialTrackingType } from "@/lib/materialSerialTracking";
import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type MaterialRelation = {
  id: string;
  codigo: string;
  descricao: string;
  tipo: string | null;
  is_transformer: boolean;
  serial_tracking_type: SerialTrackingType | null;
  is_active: boolean;
};

type StockCenterRelation = {
  id: string;
  name: string;
  center_type: "OWN" | "THIRD_PARTY";
  is_active: boolean;
};

type TrafoInstanceRow = {
  id: string;
  material_id: string;
  serial_number: string;
  lot_code: string;
  current_stock_center_id: string | null;
  last_stock_transfer_id: string | null;
  last_project_id: string | null;
  last_movement_type: "ENTRY" | "EXIT" | "TRANSFER";
  last_entry_date: string;
  updated_at: string | null;
  updated_by: string | null;
  materials: MaterialRelation | MaterialRelation[] | null;
  stock_centers: StockCenterRelation | StockCenterRelation[] | null;
};

type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

type TeamRow = {
  id: string;
  stock_center_id: string | null;
};

type TeamOperationRow = {
  transfer_id: string;
  team_id: string;
  operation_kind: "REQUISITION" | "RETURN" | "FIELD_RETURN" | null;
  technical_origin_stock_center_id: string | null;
  team_name_snapshot: string;
  foreman_name_snapshot: string;
};

type StockTransferHeaderRow = {
  id: string;
  movement_type: "ENTRY" | "EXIT" | "TRANSFER";
  from_stock_center_id: string;
  to_stock_center_id: string;
  project_id: string;
  entry_date: string;
  created_at: string;
  updated_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  notes: string | null;
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
  center_type: "OWN" | "THIRD_PARTY";
  is_active: boolean;
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

type TeamStockCenterState = {
  teamStockCenterId: string | null;
  operationKind: "REQUISITION" | "RETURN" | "FIELD_RETURN" | null;
  teamName: string | null;
  foremanName: string | null;
};

function parsePositiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function normalizeText(value: string | null) {
  return String(value ?? "").trim();
}

function normalizeCode(value: string | null) {
  return normalizeText(value).toUpperCase();
}

function normalizeCurrentStatus(value: string | null) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "EM_ESTOQUE" || normalized === "COM_EQUIPE" || normalized === "FORA_ESTOQUE") {
    return normalized as "EM_ESTOQUE" | "COM_EQUIPE" | "FORA_ESTOQUE";
  }
  return "TODOS" as const;
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

function isPhysicalStockCenter(
  stockCenterId: string | null,
  stockCenterMap: Map<string, StockCenterRow>,
  teamCenterIds: Set<string>,
) {
  if (!stockCenterId || teamCenterIds.has(stockCenterId)) {
    return false;
  }

  const stockCenter = stockCenterMap.get(stockCenterId);
  return Boolean(stockCenter && stockCenter.is_active && stockCenter.center_type === "OWN");
}

function resolvePhysicalReferenceCenterId(
  currentStockCenterId: string | null,
  lastTransfer: StockTransferHeaderRow | null,
  stockCenterMap: Map<string, StockCenterRow>,
  teamCenterIds: Set<string>,
) {
  if (isPhysicalStockCenter(currentStockCenterId, stockCenterMap, teamCenterIds)) {
    return currentStockCenterId;
  }

  const candidateIds = [
    lastTransfer?.from_stock_center_id ?? null,
    lastTransfer?.to_stock_center_id ?? null,
  ];

  return candidateIds.find((candidateId) => isPhysicalStockCenter(candidateId, stockCenterMap, teamCenterIds)) ?? null;
}

function resolveOperationKind(
  transfer: Pick<StockTransferHeaderRow, "movement_type" | "to_stock_center_id">,
  teamState: TeamStockCenterState | null,
) {
  if (!teamState) {
    return transfer.movement_type;
  }

  if (teamState.operationKind) {
    return teamState.operationKind;
  }

  if (!teamState.teamStockCenterId) {
    return transfer.movement_type;
  }

  return transfer.to_stock_center_id === teamState.teamStockCenterId ? "REQUISITION" : "RETURN";
}

async function loadTrafoHistory(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar o historico do rastreio de serial.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const { supabase, appUser } = resolution;
  const trafoInstanceId = normalizeText(request.nextUrl.searchParams.get("trafoInstanceId"));
  const page = parsePositiveInteger(request.nextUrl.searchParams.get("page"), 1);
  const pageSize = Math.min(parsePositiveInteger(request.nextUrl.searchParams.get("pageSize"), 5), 50);

  if (!trafoInstanceId) {
    return NextResponse.json({ message: "trafoInstanceId e obrigatorio para carregar o historico." }, { status: 400 });
  }

  const { data: trafoInstance, error: trafoInstanceError } = await supabase
    .from("trafo_instances")
    .select("id, material_id, serial_number, lot_code")
    .eq("tenant_id", appUser.tenant_id)
    .eq("id", trafoInstanceId)
    .maybeSingle<Pick<TrafoInstanceRow, "id" | "material_id" | "serial_number" | "lot_code">>();

  if (trafoInstanceError || !trafoInstance) {
    return NextResponse.json({ message: "Unidade por serial nao encontrada para carregar o historico." }, { status: 404 });
  }

  const { data: itemRows, error: itemsError } = await supabase
    .from("stock_transfer_items")
    .select("id, stock_transfer_id, material_id, quantity, serial_number, lot_code")
    .eq("tenant_id", appUser.tenant_id)
    .eq("material_id", trafoInstance.material_id)
    .eq("serial_number", trafoInstance.serial_number)
    .eq("lot_code", trafoInstance.lot_code)
    .returns<StockTransferItemRow[]>();

  if (itemsError) {
    return NextResponse.json({ message: "Falha ao carregar o historico do rastreio de serial." }, { status: 500 });
  }

  if (!itemRows?.length) {
    return NextResponse.json({
      history: [],
      pagination: { page, pageSize, total: 0 },
    });
  }

  const transferIds = Array.from(new Set(itemRows.map((row) => row.stock_transfer_id).filter(Boolean)));

  const { data: transferHeaders, error: transfersError } = await supabase
    .from("stock_transfers")
    .select("id, movement_type, from_stock_center_id, to_stock_center_id, project_id, entry_date, created_at, updated_at, created_by, updated_by, notes")
    .eq("tenant_id", appUser.tenant_id)
    .in("id", transferIds)
    .returns<StockTransferHeaderRow[]>();

  if (transfersError) {
    return NextResponse.json({ message: "Falha ao carregar o historico do rastreio de serial." }, { status: 500 });
  }

  if (!transferHeaders?.length) {
    return NextResponse.json({
      history: [],
      pagination: { page, pageSize, total: 0 },
    });
  }

  const transferMap = new Map(transferHeaders.map((row) => [row.id, row]));
  const stockCenterIds = Array.from(
    new Set(transferHeaders.flatMap((row) => [row.from_stock_center_id, row.to_stock_center_id]).filter(Boolean)),
  );
  const projectIds = Array.from(new Set(transferHeaders.map((row) => row.project_id).filter(Boolean)));
  const userIds = Array.from(
    new Set(transferHeaders.flatMap((row) => [row.updated_by, row.created_by]).filter((value): value is string => Boolean(value))),
  );

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
      ? supabase
          .from("stock_centers")
          .select("id, name, center_type, is_active")
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
          .from("stock_transfer_team_operations")
          .select("transfer_id, team_id, operation_kind, technical_origin_stock_center_id, team_name_snapshot, foreman_name_snapshot")
          .eq("tenant_id", appUser.tenant_id)
          .in("transfer_id", transferIds)
          .returns<TeamOperationRow[]>()
      : Promise.resolve({ data: [], error: null } as { data: TeamOperationRow[]; error: null }),
    transferIds.length
      ? supabase
          .from("teams")
          .select("id, stock_center_id")
          .eq("tenant_id", appUser.tenant_id)
          .returns<TeamRow[]>()
      : Promise.resolve({ data: [], error: null } as { data: TeamRow[]; error: null }),
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

  if (
    stockCentersResult.error
    || projectsResult.error
    || usersResult.error
    || teamOperationsResult.error
    || teamsResult.error
    || reversalsFromOriginalResult.error
    || reversalsByReversalResult.error
  ) {
    return NextResponse.json({ message: "Falha ao carregar detalhes do historico do rastreio de serial." }, { status: 500 });
  }

  const stockCenterMap = new Map((stockCentersResult.data ?? []).map((row) => [row.id, row.name]));
  const projectMap = new Map((projectsResult.data ?? []).map((row) => [row.id, row.sob]));
  const userMap = new Map(
    (usersResult.data ?? []).map((row) => [row.id, String(row.display ?? row.login_name ?? "").trim() || "Nao informado"]),
  );
  const teamById = new Map((teamsResult.data ?? []).map((row) => [row.id, row]));
    const teamOperationMap = new Map(
      (teamOperationsResult.data ?? []).map((row) => [
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

  const historyEntries = itemRows
    .flatMap((item) => {
      const transfer = transferMap.get(item.stock_transfer_id);
      if (!transfer) {
        return [];
      }

      const teamState = teamOperationMap.get(transfer.id) ?? null;
      const reversalFromOriginal = reversalByOriginalMap.get(transfer.id) ?? null;
      const reversalFromReversal = originalByReversalMap.get(transfer.id) ?? null;

      return [
        {
          id: item.id,
          transferId: transfer.id,
          operationKind: resolveOperationKind(transfer, teamState),
          movementType: transfer.movement_type,
          quantity: Number(item.quantity ?? 0),
          entryDate: transfer.entry_date,
          changedAt: transfer.updated_at ?? transfer.created_at,
          projectCode: projectMap.get(transfer.project_id) ?? "-",
          fromStockCenterName: stockCenterMap.get(transfer.from_stock_center_id) ?? "-",
          toStockCenterName: stockCenterMap.get(transfer.to_stock_center_id) ?? "-",
          updatedByName: userMap.get(transfer.updated_by ?? transfer.created_by ?? "") ?? "Nao informado",
          teamName: teamState?.teamName ?? null,
          foremanName: teamState?.foremanName ?? null,
          notes: transfer.notes,
          isReversal: Boolean(reversalFromReversal),
          isReversed: Boolean(reversalFromOriginal),
          reversalReason: reversalFromOriginal?.reversalReason ?? reversalFromReversal?.reversalReason ?? null,
        },
      ];
    })
    .sort((left, right) => toTimestamp(right.changedAt) - toTimestamp(left.changedAt));

  const from = (page - 1) * pageSize;

  return NextResponse.json({
    history: historyEntries.slice(from, from + pageSize),
    pagination: {
      page,
      pageSize,
      total: historyEntries.length,
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    const mode = normalizeText(request.nextUrl.searchParams.get("mode")).toLowerCase();
    if (mode === "history") {
      return await loadTrafoHistory(request);
    }

    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para carregar o rastreio de serial.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const page = parsePositiveInteger(request.nextUrl.searchParams.get("page"), 1);
    const pageSize = Math.min(parsePositiveInteger(request.nextUrl.searchParams.get("pageSize"), 20), 100);
    const stockCenterId = normalizeText(request.nextUrl.searchParams.get("stockCenterId"));
    const materialCode = normalizeCode(request.nextUrl.searchParams.get("materialCode"));
    const serialNumber = normalizeText(request.nextUrl.searchParams.get("serialNumber"));
    const lotCode = normalizeText(request.nextUrl.searchParams.get("lotCode"));
    const currentStatus = normalizeCurrentStatus(request.nextUrl.searchParams.get("currentStatus"));

    let query = supabase
      .from("trafo_instances")
      .select(
        [
          "id",
          "material_id",
          "serial_number",
          "lot_code",
          "current_stock_center_id",
          "last_stock_transfer_id",
          "last_project_id",
          "last_movement_type",
          "last_entry_date",
          "updated_at",
          "updated_by",
          "materials!inner(id, codigo, descricao, tipo, is_transformer, serial_tracking_type, is_active)",
          "stock_centers(id, name, center_type, is_active)",
        ].join(", "),
      )
      .eq("tenant_id", appUser.tenant_id)
      .neq("materials.serial_tracking_type", "NONE")
      .eq("materials.is_active", true)
      .order("updated_at", { ascending: false });

    if (materialCode) {
      query = query.ilike("materials.codigo", `%${materialCode}%`);
    }

    if (serialNumber) {
      query = query.ilike("serial_number", `%${serialNumber}%`);
    }

    if (lotCode) {
      query = query.ilike("lot_code", `%${lotCode}%`);
    }

    const { data, error } = await query.returns<TrafoInstanceRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao carregar o rastreio de serial." }, { status: 500 });
    }

    const teamResult = await supabase
      .from("teams")
      .select("id, stock_center_id")
      .eq("tenant_id", appUser.tenant_id)
      .returns<TeamRow[]>();

    if (teamResult.error) {
      return NextResponse.json({ message: "Falha ao carregar o rastreio de serial." }, { status: 500 });
    }

    const teamCenterIds = new Set(
      (teamResult.data ?? [])
        .map((row) => String(row.stock_center_id ?? "").trim())
        .filter(Boolean),
    );
    const teamById = new Map((teamResult.data ?? []).map((row) => [row.id, row]));
    const lastTransferIds = Array.from(new Set((data ?? []).map((row) => row.last_stock_transfer_id).filter((value): value is string => Boolean(value))));
    const userIds = Array.from(new Set((data ?? []).map((row) => row.updated_by).filter((value): value is string => Boolean(value))));
    const projectIds = Array.from(new Set((data ?? []).map((row) => row.last_project_id).filter((value): value is string => Boolean(value))));

    const [lastTransfersResult, usersResult, projectsResult, teamOperationsResult] = await Promise.all([
      lastTransferIds.length
        ? supabase
            .from("stock_transfers")
            .select("id, movement_type, from_stock_center_id, to_stock_center_id, project_id, entry_date, created_at, updated_at, created_by, updated_by, notes")
            .eq("tenant_id", appUser.tenant_id)
            .in("id", lastTransferIds)
            .returns<StockTransferHeaderRow[]>()
        : Promise.resolve({ data: [], error: null } as { data: StockTransferHeaderRow[]; error: null }),
      userIds.length
        ? supabase
            .from("app_users")
            .select("id, display, login_name")
            .eq("tenant_id", appUser.tenant_id)
            .in("id", userIds)
            .returns<AppUserRow[]>()
        : Promise.resolve({ data: [], error: null } as { data: AppUserRow[]; error: null }),
      projectIds.length
        ? supabase
            .from("project")
            .select("id, sob")
            .eq("tenant_id", appUser.tenant_id)
            .in("id", projectIds)
            .returns<ProjectRow[]>()
        : Promise.resolve({ data: [], error: null } as { data: ProjectRow[]; error: null }),
      lastTransferIds.length
        ? supabase
            .from("stock_transfer_team_operations")
            .select("transfer_id, team_id, operation_kind, technical_origin_stock_center_id, team_name_snapshot, foreman_name_snapshot")
            .eq("tenant_id", appUser.tenant_id)
            .in("transfer_id", lastTransferIds)
            .returns<TeamOperationRow[]>()
        : Promise.resolve({ data: [], error: null } as { data: TeamOperationRow[]; error: null }),
    ]);

    if (lastTransfersResult.error || usersResult.error || projectsResult.error || teamOperationsResult.error) {
      return NextResponse.json({ message: "Falha ao carregar o rastreio de serial." }, { status: 500 });
    }

    const transferRows = lastTransfersResult.data ?? [];
    const extraStockCenterIds = Array.from(
      new Set(transferRows.flatMap((row) => [row.from_stock_center_id, row.to_stock_center_id]).filter(Boolean)),
    );
    const stockCenterIds = Array.from(
      new Set(
        [
          ...(data ?? []).map((row) => row.current_stock_center_id).filter((value): value is string => Boolean(value)),
          ...extraStockCenterIds,
        ],
      ),
    );

    const extraStockCentersResult = stockCenterIds.length
      ? await supabase
          .from("stock_centers")
          .select("id, name, center_type, is_active")
          .eq("tenant_id", appUser.tenant_id)
          .in("id", stockCenterIds)
          .returns<StockCenterRow[]>()
      : ({ data: [], error: null } as { data: StockCenterRow[]; error: null });

    if (extraStockCentersResult.error) {
      return NextResponse.json({ message: "Falha ao carregar o rastreio de serial." }, { status: 500 });
    }

    const currentStockCenterRows = (data ?? [])
      .map((row) => unwrapRelation(row.stock_centers))
      .filter((row): row is StockCenterRelation => Boolean(row));
    const stockCenterMap = new Map<string, StockCenterRow>();

    currentStockCenterRows.forEach((row) => {
      stockCenterMap.set(row.id, row);
    });
    (extraStockCentersResult.data ?? []).forEach((row) => {
      stockCenterMap.set(row.id, row);
    });

    const transferMap = new Map(transferRows.map((row) => [row.id, row]));
    const userMap = new Map(
      (usersResult.data ?? []).map((row) => [row.id, String(row.display ?? row.login_name ?? "").trim() || "Nao informado"]),
    );
    const projectMap = new Map((projectsResult.data ?? []).map((row) => [row.id, row.sob]));
    const teamOperationMap = new Map(
      (teamOperationsResult.data ?? []).map((row) => [
        row.transfer_id,
        {
          teamStockCenterId: teamById.get(row.team_id)?.stock_center_id ?? null,
          operationKind: row.operation_kind,
          teamName: row.team_name_snapshot,
          foremanName: row.foreman_name_snapshot,
        },
      ] as const),
    );

    const transformedItems = (data ?? []).flatMap((row) => {
      const material = unwrapRelation(row.materials);
      if (!material) {
        return [];
      }

      const lastTransfer = row.last_stock_transfer_id ? transferMap.get(row.last_stock_transfer_id) ?? null : null;
      const actualCurrentStockCenterId = row.current_stock_center_id;
      const isWithTeam = Boolean(actualCurrentStockCenterId && teamCenterIds.has(actualCurrentStockCenterId));
      const physicalReferenceCenterId = resolvePhysicalReferenceCenterId(
        actualCurrentStockCenterId,
        lastTransfer,
        stockCenterMap,
        teamCenterIds,
      );
      const physicalReferenceCenterName = physicalReferenceCenterId
        ? stockCenterMap.get(physicalReferenceCenterId)?.name ?? null
        : null;
      const teamState = row.last_stock_transfer_id ? teamOperationMap.get(row.last_stock_transfer_id) ?? null : null;
      const resolvedCurrentStatus = actualCurrentStockCenterId
        ? isWithTeam
          ? "COM_EQUIPE"
          : "EM_ESTOQUE"
        : "FORA_ESTOQUE";
      const operationKind = lastTransfer
        ? resolveOperationKind(lastTransfer, teamState)
        : row.last_movement_type;

      return [
        {
          id: row.id,
          materialId: row.material_id,
          materialCode: material.codigo,
          description: material.descricao,
          materialType: String(material.tipo ?? "").trim().toUpperCase(),
          serialTrackingType: normalizeSerialTrackingType(material.serial_tracking_type ?? (material.is_transformer ? "TRAFO" : "NONE")),
          serialNumber: row.serial_number,
          lotCode: row.lot_code,
          currentStockCenterId: physicalReferenceCenterId,
          currentStockCenterName: physicalReferenceCenterName,
          currentStatus: resolvedCurrentStatus,
          currentTeamName: resolvedCurrentStatus === "COM_EQUIPE" ? teamState?.teamName ?? null : null,
          currentForemanName: resolvedCurrentStatus === "COM_EQUIPE" ? teamState?.foremanName ?? null : null,
          canMove: resolvedCurrentStatus === "EM_ESTOQUE" && Boolean(physicalReferenceCenterId),
          lastTransferId: row.last_stock_transfer_id,
          lastProjectId: row.last_project_id,
          lastProjectCode: projectMap.get(row.last_project_id ?? "") ?? null,
          lastOperationKind: operationKind,
          lastEntryDate: row.last_entry_date,
          updatedAt: row.updated_at,
          updatedByName: userMap.get(row.updated_by ?? "") ?? "Nao informado",
        },
      ];
    }).filter((item) => {
      if (stockCenterId && item.currentStockCenterId !== stockCenterId) {
        return false;
      }

      if (currentStatus !== "TODOS" && item.currentStatus !== currentStatus) {
        return false;
      }

      return true;
    });

    transformedItems.sort((left, right) => toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt));

    const from = (page - 1) * pageSize;

    return NextResponse.json({
      items: transformedItems.slice(from, from + pageSize),
      pagination: {
        page,
        pageSize,
        total: transformedItems.length,
      },
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar o rastreio de serial." }, { status: 500 });
  }
}
