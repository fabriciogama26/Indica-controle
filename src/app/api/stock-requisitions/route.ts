import { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { requirePageAction } from "@/lib/server/pageAuthorization";
import { createStockRequisitionViaRpc, StockRequisitionItemInput } from "@/lib/server/stockRequisitions";

const SOLICITACAO_PAGE = "requisicao-solicitacao";
const ATENDIMENTO_PAGE = "requisicao-atendimento";
const DEFAULT_PAGE_SIZE = 20;

type RequestRow = {
  id: string;
  stock_center_id: string;
  team_id: string;
  project_id: string;
  request_date: string;
  requested_by: string | null;
  requested_by_name_snapshot: string | null;
  status: string;
  resultado_atendimento: string | null;
  claimed_by: string | null;
  claimed_by_name_snapshot: string | null;
  claim_expires_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type ItemRow = {
  id: string;
  request_id: string;
  material_id: string;
  quantity_requested: number;
  quantity_fulfilled: number | null;
  item_status: string;
  unfulfilled_reason_code: string | null;
  serial_number: string | null;
  lot_code: string | null;
  notes: string | null;
  resulting_transfer_item_id: string | null;
};

function parsePageSize(value: string | null) {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(parsed, 100);
}

function parsePage(value: string | null) {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed <= 0) return 1;
  return parsed;
}

async function loadDetail(
  supabase: SupabaseClient,
  tenantId: string,
  requestId: string,
) {
  const requestResult = await supabase
    .from("stock_requisition_requests")
    .select(
      "id, stock_center_id, team_id, project_id, request_date, requested_by, requested_by_name_snapshot, status, resultado_atendimento, claimed_by, claimed_by_name_snapshot, claim_expires_at, notes, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("id", requestId)
    .maybeSingle<RequestRow>();

  if (requestResult.error || !requestResult.data) {
    return { error: true as const };
  }

  const requestRow = requestResult.data;

  const itemsResult = await supabase
    .from("stock_requisition_request_items")
    .select(
      "id, request_id, material_id, quantity_requested, quantity_fulfilled, item_status, unfulfilled_reason_code, serial_number, lot_code, notes, resulting_transfer_item_id",
    )
    .eq("tenant_id", tenantId)
    .eq("request_id", requestId)
    .returns<ItemRow[]>();

  const items = itemsResult.data ?? [];
  const materialIds = Array.from(new Set(items.map((row) => row.material_id)));
  const resultingItemIds = items
    .map((row) => String(row.resulting_transfer_item_id ?? "").trim())
    .filter(Boolean);

  const [materialsResult, centerResult, teamResult, projectResult, balancesResult, reversalsResult] = await Promise.all([
    materialIds.length
      ? supabase
          .from("materials")
          .select("id, codigo, descricao, umb, tipo, serial_tracking_type, is_transformer")
          .eq("tenant_id", tenantId)
          .in("id", materialIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("stock_centers").select("id, name").eq("tenant_id", tenantId).eq("id", requestRow.stock_center_id).maybeSingle<{ id: string; name: string }>(),
    supabase.from("teams").select("id, name").eq("tenant_id", tenantId).eq("id", requestRow.team_id).maybeSingle<{ id: string; name: string }>(),
    supabase.from("project").select("id, sob").eq("tenant_id", tenantId).eq("id", requestRow.project_id).maybeSingle<{ id: string; sob: string }>(),
    materialIds.length
      ? supabase
          .from("stock_center_balances")
          .select("material_id, quantity")
          .eq("tenant_id", tenantId)
          .eq("stock_center_id", requestRow.stock_center_id)
          .in("material_id", materialIds)
      : Promise.resolve({ data: [], error: null }),
    resultingItemIds.length
      ? supabase
          .from("stock_transfer_item_reversals")
          .select("original_stock_transfer_item_id")
          .eq("tenant_id", tenantId)
          .in("original_stock_transfer_item_id", resultingItemIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const materialMap = new Map(
    (materialsResult.data ?? []).map((row: Record<string, unknown>) => [String(row.id), row]),
  );
  const balanceMap = new Map(
    (balancesResult.data ?? []).map((row: Record<string, unknown>) => [String(row.material_id), Number(row.quantity ?? 0)]),
  );
  const reversedItemIds = new Set(
    (reversalsResult.data ?? []).map((row: Record<string, unknown>) => String(row.original_stock_transfer_item_id)),
  );

  return {
    error: false as const,
    request: {
      id: requestRow.id,
      stockCenterId: requestRow.stock_center_id,
      stockCenterName: centerResult.data?.name ?? "Nao informado",
      teamId: requestRow.team_id,
      teamName: teamResult.data?.name ?? "Nao informado",
      projectId: requestRow.project_id,
      projectCode: projectResult.data?.sob ?? "Nao informado",
      requestDate: requestRow.request_date,
      requestedByName: requestRow.requested_by_name_snapshot,
      status: requestRow.status,
      resultado: requestRow.resultado_atendimento,
      claimedBy: requestRow.claimed_by,
      claimedByName: requestRow.claimed_by_name_snapshot,
      claimExpiresAt: requestRow.claim_expires_at,
      notes: requestRow.notes,
      createdAt: requestRow.created_at,
      updatedAt: requestRow.updated_at,
    },
    items: items.map((row) => {
      const material = materialMap.get(row.material_id) as Record<string, unknown> | undefined;
      const serialTracking = String(material?.serial_tracking_type ?? (material?.is_transformer ? "TRAFO" : "NONE"));
      return {
        id: row.id,
        materialId: row.material_id,
        materialCode: String(material?.codigo ?? ""),
        description: String(material?.descricao ?? ""),
        umb: String(material?.umb ?? ""),
        tipo: String(material?.tipo ?? ""),
        serialTrackingType: serialTracking,
        quantityRequested: Number(row.quantity_requested),
        quantityFulfilled: row.quantity_fulfilled === null ? null : Number(row.quantity_fulfilled),
        itemStatus: row.item_status,
        unfulfilledReasonCode: row.unfulfilled_reason_code,
        serialNumber: row.serial_number,
        lotCode: row.lot_code,
        notes: row.notes,
        currentBalance: balanceMap.get(row.material_id) ?? 0,
        resultingTransferItemId: row.resulting_transfer_item_id,
        isReversed: row.resulting_transfer_item_id ? reversedItemIds.has(row.resulting_transfer_item_id) : false,
      };
    }),
  };
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para carregar requisicoes.",
      inactiveMessage: "Usuario inativo.",
    });
    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const params = request.nextUrl.searchParams;
    const pageParam = params.get("page") === "solicitacao" ? SOLICITACAO_PAGE : ATENDIMENTO_PAGE;

    const authorization = await requirePageAction({ context: resolution, pageKey: pageParam, action: "read" });
    if (!authorization.allowed) {
      return NextResponse.json({ message: authorization.error.message }, { status: authorization.error.status });
    }

    const requestId = String(params.get("id") ?? "").trim();
    if (requestId) {
      const detail = await loadDetail(supabase, appUser.tenant_id, requestId);
      if (detail.error) {
        return NextResponse.json({ message: "Pedido nao encontrado." }, { status: 404 });
      }
      return NextResponse.json(detail);
    }

    const pageSize = parsePageSize(params.get("pageSize"));
    const pageNumber = parsePage(params.get("pageNumber"));
    const statusFilter = String(params.get("status") ?? "").trim().toUpperCase();
    const teamFilter = String(params.get("teamId") ?? "").trim();
    const projectFilter = String(params.get("projectId") ?? "").trim();
    const dateFrom = String(params.get("dateFrom") ?? "").trim();
    const dateTo = String(params.get("dateTo") ?? "").trim();
    const onlyMine = params.get("scope") === "mine";

    let query = supabase
      .from("stock_requisition_requests")
      .select(
        "id, stock_center_id, team_id, project_id, request_date, requested_by, requested_by_name_snapshot, status, resultado_atendimento, claimed_by, claimed_by_name_snapshot, claim_expires_at, notes, created_at, updated_at",
        { count: "exact" },
      )
      .eq("tenant_id", appUser.tenant_id);

    if (statusFilter && ["PENDING", "EM_ATENDIMENTO", "ENCERRADO", "CANCELADO"].includes(statusFilter)) {
      query = query.eq("status", statusFilter);
    }
    if (teamFilter) query = query.eq("team_id", teamFilter);
    if (projectFilter) query = query.eq("project_id", projectFilter);
    if (dateFrom) query = query.gte("request_date", dateFrom);
    if (dateTo) query = query.lte("request_date", dateTo);
    if (onlyMine) query = query.eq("requested_by", appUser.id);

    const from = (pageNumber - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count } = await query
      .order("request_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to)
      .returns<RequestRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao carregar requisicoes." }, { status: 500 });
    }

    const rows = data ?? [];
    const requestIds = rows.map((row) => row.id);
    const teamIds = Array.from(new Set(rows.map((row) => row.team_id)));
    const projectIds = Array.from(new Set(rows.map((row) => row.project_id)));
    const centerIds = Array.from(new Set(rows.map((row) => row.stock_center_id)));

    const [itemCountsResult, teamsResult, projectsResult, centersResult] = await Promise.all([
      requestIds.length
        ? supabase.from("stock_requisition_request_items").select("request_id").eq("tenant_id", appUser.tenant_id).in("request_id", requestIds)
        : Promise.resolve({ data: [], error: null }),
      teamIds.length ? supabase.from("teams").select("id, name").eq("tenant_id", appUser.tenant_id).in("id", teamIds) : Promise.resolve({ data: [], error: null }),
      projectIds.length ? supabase.from("project").select("id, sob").eq("tenant_id", appUser.tenant_id).in("id", projectIds) : Promise.resolve({ data: [], error: null }),
      centerIds.length ? supabase.from("stock_centers").select("id, name").eq("tenant_id", appUser.tenant_id).in("id", centerIds) : Promise.resolve({ data: [], error: null }),
    ]);

    const itemCountMap = new Map<string, number>();
    for (const row of (itemCountsResult.data ?? []) as Array<{ request_id: string }>) {
      itemCountMap.set(row.request_id, (itemCountMap.get(row.request_id) ?? 0) + 1);
    }
    const teamMap = new Map((teamsResult.data ?? []).map((row: Record<string, unknown>) => [String(row.id), String(row.name)]));
    const projectMap = new Map((projectsResult.data ?? []).map((row: Record<string, unknown>) => [String(row.id), String(row.sob)]));
    const centerMap = new Map((centersResult.data ?? []).map((row: Record<string, unknown>) => [String(row.id), String(row.name)]));

    return NextResponse.json({
      items: rows.map((row) => ({
        id: row.id,
        stockCenterId: row.stock_center_id,
        stockCenterName: centerMap.get(row.stock_center_id) ?? "Nao informado",
        teamId: row.team_id,
        teamName: teamMap.get(row.team_id) ?? "Nao informado",
        projectId: row.project_id,
        projectCode: projectMap.get(row.project_id) ?? "Nao informado",
        requestDate: row.request_date,
        requestedByName: row.requested_by_name_snapshot,
        status: row.status,
        resultado: row.resultado_atendimento,
        claimedBy: row.claimed_by,
        claimedByName: row.claimed_by_name_snapshot,
        claimExpiresAt: row.claim_expires_at,
        itemCount: itemCountMap.get(row.id) ?? 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      pagination: {
        page: pageNumber,
        pageSize,
        total: count ?? 0,
        totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
      },
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar requisicoes." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para registrar requisicao.",
      inactiveMessage: "Usuario inativo.",
    });
    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorization = await requirePageAction({ context: resolution, pageKey: SOLICITACAO_PAGE, action: "create" });
    if (!authorization.allowed) {
      return NextResponse.json({ message: authorization.error.message }, { status: authorization.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ message: "Payload invalido." }, { status: 400 });
    }

    const rawItems = Array.isArray(body.items) ? body.items : [];
    const items: StockRequisitionItemInput[] = rawItems.map((item) => {
      const record = item as Record<string, unknown>;
      return {
        materialId: String(record.materialId ?? "").trim(),
        quantity: Number(record.quantity ?? 0),
      };
    });

    const result = await createStockRequisitionViaRpc(supabase, {
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      requestedByName: appUser.display ?? appUser.login_name ?? null,
      stockCenterId: String(body.stockCenterId ?? "").trim(),
      teamId: String(body.teamId ?? "").trim(),
      projectId: String(body.projectId ?? "").trim(),
      requestDate: String(body.requestDate ?? "").trim(),
      notes: body.notes ? String(body.notes) : null,
      items,
    });

    if (!result.ok) {
      return NextResponse.json({ message: result.message, reason: result.reason, details: result.details }, { status: result.status });
    }

    return NextResponse.json({ requestId: result.requestId, message: result.message }, { status: 201 });
  } catch {
    return NextResponse.json({ message: "Falha ao registrar requisicao." }, { status: 500 });
  }
}

export async function PUT() {
  return NextResponse.json({ message: "Edicao direta de pedido nao permitida. Cancele e crie um novo pedido." }, { status: 409 });
}
