import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type StockCenterRelation = {
  id: string;
  name: string;
  center_type: "OWN" | "THIRD_PARTY";
  controls_balance: boolean;
  is_active: boolean;
};

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
  stock_centers: StockCenterRelation | StockCenterRelation[] | null;
  materials: MaterialRelation | MaterialRelation[] | null;
};

type StockTransferHeaderRow = {
  id: string;
  movement_type: "ENTRY" | "EXIT" | "TRANSFER";
  from_stock_center_id: string;
  to_stock_center_id: string;
  project_id: string;
  entry_date: string;
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

type StockTransferReversalRow = {
  original_stock_transfer_id: string;
  reversal_stock_transfer_id: string;
  reversal_reason: string;
  created_at: string;
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

function normalizeOnlyPositive(value: string | null) {
  return String(value ?? "").trim().toUpperCase() === "TODOS" ? "TODOS" : "SIM";
}

function parseNonNegativeInteger(value: string | null) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.trunc(parsed);
}

function unwrapRelation<T>(value: T | T[] | null) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
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
  const page = parsePositiveInteger(request.nextUrl.searchParams.get("page"), 1);
  const pageSize = Math.min(parsePositiveInteger(request.nextUrl.searchParams.get("pageSize"), 5), 50);

  if (!stockCenterId || !materialId) {
    return NextResponse.json(
      { message: "stockCenterId e materialId sao obrigatorios para carregar o historico." },
      { status: 400 },
    );
  }

  const { data: transferHeaders, error: transfersError } = await supabase
    .from("stock_transfers")
    .select(
      "id, movement_type, from_stock_center_id, to_stock_center_id, project_id, entry_date, notes, created_at, updated_at, created_by, updated_by",
    )
    .eq("tenant_id", appUser.tenant_id)
    .or(`from_stock_center_id.eq.${stockCenterId},to_stock_center_id.eq.${stockCenterId}`)
    .returns<StockTransferHeaderRow[]>();

  if (transfersError) {
    return NextResponse.json({ message: "Falha ao carregar o historico do estoque atual." }, { status: 500 });
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
    .eq("material_id", materialId)
    .in("stock_transfer_id", transferIds)
    .returns<StockTransferItemRow[]>();

  if (itemsError) {
    return NextResponse.json({ message: "Falha ao carregar os itens do historico do estoque atual." }, { status: 500 });
  }

  if (!itemRows?.length) {
    return NextResponse.json({
      history: [],
      pagination: {
        page,
        pageSize,
        total: 0,
      },
    });
  }

  const stockCenterIds = Array.from(
    new Set(
      transferHeaders.flatMap((row) => [row.from_stock_center_id, row.to_stock_center_id]).filter(Boolean),
    ),
  );
  const projectIds = Array.from(new Set(transferHeaders.map((row) => row.project_id).filter(Boolean)));
  const userIds = Array.from(
    new Set(
      transferHeaders.flatMap((row) => [row.updated_by, row.created_by]).filter((value): value is string => Boolean(value)),
    ),
  );

  const [
    stockCentersResult,
    projectsResult,
    usersResult,
    reversalsFromOriginalResult,
    reversalsByReversalResult,
  ] = await Promise.all([
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

  if (
    stockCentersResult.error
    || projectsResult.error
    || usersResult.error
    || reversalsFromOriginalResult.error
    || reversalsByReversalResult.error
  ) {
    return NextResponse.json({ message: "Falha ao carregar detalhes do historico do estoque atual." }, { status: 500 });
  }

  const transferMap = new Map(transferHeaders.map((row) => [row.id, row]));
  const stockCenterMap = new Map((stockCentersResult.data ?? []).map((row) => [row.id, row.name]));
  const projectMap = new Map((projectsResult.data ?? []).map((row) => [row.id, row.sob]));
  const userMap = new Map(
    (usersResult.data ?? []).map((row) => [row.id, String(row.display ?? row.login_name ?? "").trim() || "Nao informado"]),
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

    return [
      {
        id: item.id,
        transferId: transfer.id,
        movementType: transfer.movement_type,
        signedQuantity,
        quantity: Number(item.quantity ?? 0),
        entryDate: transfer.entry_date,
        changedAt: transfer.updated_at ?? transfer.created_at,
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

  allEntries.sort((left, right) => new Date(right.changedAt).getTime() - new Date(left.changedAt).getTime());
  const from = (page - 1) * pageSize;
  const pagedEntries = allEntries.slice(from, from + pageSize);

  return NextResponse.json({
    history: pagedEntries,
    pagination: {
      page,
      pageSize,
      total: allEntries.length,
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

    const page = parsePositiveInteger(request.nextUrl.searchParams.get("page"), 1);
    const pageSize = Math.min(parsePositiveInteger(request.nextUrl.searchParams.get("pageSize"), 20), 100);
    const stockCenterId = normalizeText(request.nextUrl.searchParams.get("stockCenterId"));
    const materialCode = normalizeCode(request.nextUrl.searchParams.get("materialCode"));
    const description = normalizeText(request.nextUrl.searchParams.get("description"));
    const qtyMin = parseNonNegativeInteger(request.nextUrl.searchParams.get("qtyMin"));
    const qtyMax = parseNonNegativeInteger(request.nextUrl.searchParams.get("qtyMax"));
    const onlyPositive = normalizeOnlyPositive(request.nextUrl.searchParams.get("onlyPositive"));

    if (qtyMin !== null && qtyMax !== null && qtyMin > qtyMax) {
      return NextResponse.json(
        { message: "Saldo minimo nao pode ser maior que o saldo maximo." },
        { status: 400 },
      );
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("stock_center_balances")
      .select(
        [
          "stock_center_id",
          "material_id",
          "quantity",
          "updated_at",
          "stock_centers!inner(id, name, center_type, controls_balance, is_active)",
          "materials!inner(id, codigo, descricao, umb, tipo, is_active)",
        ].join(", "),
        { count: "exact" },
      )
      .eq("tenant_id", appUser.tenant_id)
      .eq("stock_centers.is_active", true)
      .eq("stock_centers.center_type", "OWN")
      .eq("materials.is_active", true)
      .order("updated_at", { ascending: false })
      .range(from, to);

    if (stockCenterId) {
      query = query.eq("stock_center_id", stockCenterId);
    }

    if (materialCode) {
      query = query.ilike("materials.codigo", `%${materialCode}%`);
    }

    if (description) {
      query = query.ilike("materials.descricao", `%${description}%`);
    }

    if (qtyMin !== null) {
      query = query.gte("quantity", qtyMin);
    }

    if (qtyMax !== null) {
      query = query.lte("quantity", qtyMax);
    }

    if (onlyPositive === "SIM") {
      query = query.gt("quantity", 0);
    }

    const { data, error, count } = await query.returns<BalanceQueryRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao carregar o estoque atual." }, { status: 500 });
    }

    return NextResponse.json({
      items: (data ?? []).flatMap((row) => {
        const stockCenter = unwrapRelation(row.stock_centers);
        const material = unwrapRelation(row.materials);

        if (!stockCenter || !material) {
          return [];
        }

        return [
          {
            stockCenterId: row.stock_center_id,
            stockCenterName: stockCenter.name,
            materialId: row.material_id,
            materialCode: material.codigo,
            description: material.descricao,
            unit: String(material.umb ?? "").trim(),
            materialType: String(material.tipo ?? "").trim().toUpperCase(),
            balanceQuantity: Math.round(Number(row.quantity ?? 0)),
            lastMovementAt: row.updated_at,
          },
        ];
      }),
      pagination: {
        page,
        pageSize,
        total: count ?? 0,
      },
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar o estoque atual." }, { status: 500 });
  }
}
