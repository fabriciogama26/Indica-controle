import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { requirePageAction } from "@/lib/server/pageAuthorization";
import { normalizeDateInput, normalizeText } from "@/lib/server/stockTransfers";
import { reverseTeamStockOperationViaRpc } from "@/lib/server/teamStockOperations";

type ReversalPayload = {
  transferId?: unknown;
  transferItemId?: unknown;
  reversalReasonCode?: unknown;
  reversalReasonNotes?: unknown;
  reversalDate?: unknown;
  mode?: unknown;
};

const BLOCKED_REVERSAL_REASON_CODES = new Set(["OPERATION_CANCELED", "OTHER"]);

type TransferItemRow = {
  id: string;
  stock_transfer_id: string;
  material_id: string;
  quantity: number;
  serial_number: string | null;
  lot_code: string | null;
};

type MaterialRow = {
  id: string;
  codigo: string;
  descricao: string;
};

type ItemReversalRow = {
  original_stock_transfer_item_id: string;
  reversal_stock_transfer_id: string;
};

type TeamOperationGroupingRow = {
  transfer_id: string;
  operation_batch_id: string | null;
};

type FullReversalRow = {
  original_stock_transfer_id: string;
  reversal_stock_transfer_id: string;
};

async function resolveReversalContext(request: NextRequest, action: "read" | "reverse") {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para estornar operacao de equipe.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return {
      error: NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status }),
    } as const;
  }

  const authorization = await requirePageAction({
    context: resolution,
    pageKey: "saida",
    action,
  });

  if (!authorization.allowed) {
    return {
      error: NextResponse.json(
        { message: authorization.error.message, reason: authorization.error.code },
        { status: authorization.error.status },
      ),
    } as const;
  }

  return { resolution } as const;
}

export async function GET(request: NextRequest) {
  try {
    const context = await resolveReversalContext(request, "read");
    if ("error" in context) {
      return context.error;
    }

    const transferId = normalizeText(request.nextUrl.searchParams.get("transferId"));
    if (!transferId) {
      return NextResponse.json({ message: "transferId e obrigatorio." }, { status: 400 });
    }

    const { supabase, appUser } = context.resolution;
    const teamOperationResult = await supabase
      .from("stock_transfer_team_operations")
      .select("transfer_id, operation_batch_id")
      .eq("tenant_id", appUser.tenant_id)
      .eq("transfer_id", transferId)
      .maybeSingle<TeamOperationGroupingRow>();

    if (teamOperationResult.error) {
      return NextResponse.json({ message: "Falha ao identificar o lote da operacao." }, { status: 500 });
    }

    if (!teamOperationResult.data) {
      return NextResponse.json(
        { message: "Operacao de equipe nao encontrada para este tenant.", reason: "TEAM_OPERATION_NOT_FOUND" },
        { status: 404 },
      );
    }

    const operationBatchId = teamOperationResult.data.operation_batch_id;
    const groupedOperationsResult = operationBatchId
      ? await supabase
          .from("stock_transfer_team_operations")
          .select("transfer_id, operation_batch_id")
          .eq("tenant_id", appUser.tenant_id)
          .eq("operation_batch_id", operationBatchId)
          .returns<TeamOperationGroupingRow[]>()
      : { data: [teamOperationResult.data], error: null };

    if (groupedOperationsResult.error) {
      return NextResponse.json({ message: "Falha ao carregar as operacoes vinculadas ao lote." }, { status: 500 });
    }

    const transferIds = Array.from(new Set((groupedOperationsResult.data ?? []).map((row) => row.transfer_id)));
    const [itemsResult, fullReversalsResult, reversalTransfersResult, reversalItemsResult] = await Promise.all([
      supabase
        .from("stock_transfer_items")
        .select("id, stock_transfer_id, material_id, quantity, serial_number, lot_code")
        .eq("tenant_id", appUser.tenant_id)
        .in("stock_transfer_id", transferIds)
        .order("created_at", { ascending: true })
        .returns<TransferItemRow[]>(),
      supabase
        .from("stock_transfer_reversals")
        .select("original_stock_transfer_id, reversal_stock_transfer_id")
        .eq("tenant_id", appUser.tenant_id)
        .in("original_stock_transfer_id", transferIds)
        .returns<FullReversalRow[]>(),
      supabase
        .from("stock_transfer_reversals")
        .select("original_stock_transfer_id, reversal_stock_transfer_id")
        .eq("tenant_id", appUser.tenant_id)
        .in("reversal_stock_transfer_id", transferIds)
        .returns<FullReversalRow[]>(),
      supabase
        .from("stock_transfer_item_reversals")
        .select("original_stock_transfer_id")
        .eq("tenant_id", appUser.tenant_id)
        .in("reversal_stock_transfer_id", transferIds)
        .limit(1)
        .returns<Array<{ original_stock_transfer_id: string }>>(),
    ]);

    if (
      itemsResult.error
      || fullReversalsResult.error
      || reversalTransfersResult.error
      || reversalItemsResult.error
    ) {
      return NextResponse.json({ message: "Falha ao carregar os materiais da operacao." }, { status: 500 });
    }

    const itemRows = itemsResult.data ?? [];
    const itemIds = itemRows.map((item) => item.id);
    const materialIds = Array.from(new Set(itemRows.map((item) => item.material_id)));
    const [materialsResult, itemReversalsResult] = await Promise.all([
      materialIds.length
        ? supabase
            .from("materials")
            .select("id, codigo, descricao")
            .eq("tenant_id", appUser.tenant_id)
            .in("id", materialIds)
            .returns<MaterialRow[]>()
        : Promise.resolve({ data: [], error: null }),
      itemIds.length
        ? supabase
            .from("stock_transfer_item_reversals")
            .select("original_stock_transfer_item_id, reversal_stock_transfer_id")
            .eq("tenant_id", appUser.tenant_id)
            .in("original_stock_transfer_item_id", itemIds)
            .returns<ItemReversalRow[]>()
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (materialsResult.error || itemReversalsResult.error) {
      return NextResponse.json({ message: "Falha ao carregar o status dos materiais da operacao." }, { status: 500 });
    }

    const materialMap = new Map((materialsResult.data ?? []).map((material) => [material.id, material]));
    const reversalMap = new Map(
      (itemReversalsResult.data ?? []).map((reversal) => [
        reversal.original_stock_transfer_item_id,
        reversal.reversal_stock_transfer_id,
      ]),
    );
    const fullReversalMap = new Map(
      (fullReversalsResult.data ?? []).map((reversal) => [
        reversal.original_stock_transfer_id,
        reversal.reversal_stock_transfer_id,
      ]),
    );
    const items = itemRows.map((item) => {
      const material = materialMap.get(item.material_id);
      const reversalTransferId = fullReversalMap.get(item.stock_transfer_id) ?? reversalMap.get(item.id) ?? null;
      return {
        id: item.id,
        materialId: item.material_id,
        materialCode: material?.codigo ?? "Nao informado",
        description: material?.descricao ?? "Material nao encontrado",
        quantity: Number(item.quantity ?? 0),
        serialNumber: item.serial_number,
        lotCode: item.lot_code,
        isReversed: Boolean(reversalTransferId),
        reversalTransferId,
      };
    });

    const isReversal = Boolean((reversalTransfersResult.data ?? []).length || (reversalItemsResult.data ?? []).length);
    const reversedItemCount = items.filter((item) => item.isReversed).length;

    return NextResponse.json({
      transferId,
      transferIds,
      operationBatchId,
      isReversal,
      isFullyReversed: items.length > 0 && reversedItemCount === items.length,
      items,
      activeItemCount: items.length - reversedItemCount,
      reversedItemCount,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar os materiais da operacao." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await resolveReversalContext(request, "reverse");
    if ("error" in context) {
      return context.error;
    }

    const payload = (await request.json().catch(() => ({}))) as ReversalPayload;
    const transferId = normalizeText(payload.transferId);
    const transferItemId = normalizeText(payload.transferItemId);
    const reversalReasonCode = normalizeText(payload.reversalReasonCode).toUpperCase();
    const reversalReasonNotes = normalizeText(payload.reversalReasonNotes) || null;
    const reversalDateRaw = normalizeText(payload.reversalDate);
    const reversalDate = reversalDateRaw ? normalizeDateInput(reversalDateRaw) : null;
    const requestedMode = normalizeText(payload.mode).toUpperCase();
    const mode = requestedMode === "BATCH"
      ? "BATCH"
      : requestedMode === "ITEM" || transferItemId
        ? "ITEM"
        : "FULL";

    if ((!transferId && !transferItemId) || (mode === "BATCH" && !transferId)) {
      return NextResponse.json({ message: "transferId ou transferItemId e obrigatorio para estorno." }, { status: 400 });
    }

    if (!reversalReasonCode) {
      return NextResponse.json({ message: "Motivo padrao do estorno e obrigatorio." }, { status: 400 });
    }

    if (BLOCKED_REVERSAL_REASON_CODES.has(reversalReasonCode)) {
      return NextResponse.json(
        { message: "Motivo padrao do estorno invalido para este fluxo operacional." },
        { status: 400 },
      );
    }

    if (reversalDateRaw && !reversalDate) {
      return NextResponse.json({ message: "Data do estorno invalida." }, { status: 400 });
    }

    const { supabase, appUser } = context.resolution;
    if (mode === "ITEM" && transferItemId) {
      const [
        originalItemResult,
        originalItemReversalResult,
        reversalItemResult,
        fullReversalResult,
      ] = await Promise.all([
        supabase
          .from("stock_transfer_items")
          .select("stock_transfer_id")
          .eq("tenant_id", appUser.tenant_id)
          .eq("id", transferItemId)
          .maybeSingle<{ stock_transfer_id: string }>(),
        supabase
          .from("stock_transfer_item_reversals")
          .select("reversal_stock_transfer_id")
          .eq("tenant_id", appUser.tenant_id)
          .eq("original_stock_transfer_item_id", transferItemId)
          .maybeSingle<{ reversal_stock_transfer_id: string }>(),
        supabase
          .from("stock_transfer_item_reversals")
          .select("original_stock_transfer_id")
          .eq("tenant_id", appUser.tenant_id)
          .eq("reversal_stock_transfer_item_id", transferItemId)
          .maybeSingle<{ original_stock_transfer_id: string }>(),
        transferId
          ? supabase
              .from("stock_transfer_reversals")
              .select("reversal_stock_transfer_id")
              .eq("tenant_id", appUser.tenant_id)
              .eq("original_stock_transfer_id", transferId)
              .maybeSingle<{ reversal_stock_transfer_id: string }>()
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (
        originalItemResult.error
        || originalItemReversalResult.error
        || reversalItemResult.error
        || fullReversalResult.error
      ) {
        return NextResponse.json(
          { message: "Falha ao validar se o item da operacao ja foi estornado." },
          { status: 500 },
        );
      }

      if (!originalItemResult.data) {
        return NextResponse.json(
          {
            message: "Item da operacao de equipe original nao encontrado para este tenant.",
            reason: "ORIGINAL_ITEM_NOT_FOUND",
          },
          { status: 404 },
        );
      }

      if (transferId && originalItemResult.data.stock_transfer_id !== transferId) {
        return NextResponse.json(
          {
            message: "O item informado nao pertence a operacao de equipe selecionada.",
            reason: "TRANSFER_ITEM_MISMATCH",
          },
          { status: 400 },
        );
      }

      if (fullReversalResult.data) {
        return NextResponse.json(
          {
            message: "Esta operacao de equipe ja foi estornada integralmente.",
            reason: "FULL_TRANSFER_ALREADY_REVERSED",
          },
          { status: 409 },
        );
      }

      if (originalItemReversalResult.data) {
        return NextResponse.json(
          {
            message: "Este item da operacao de equipe ja foi estornado.",
            reason: "ITEM_ALREADY_REVERSED",
          },
          { status: 409 },
        );
      }

      if (reversalItemResult.data) {
        return NextResponse.json(
          {
            message: "Nao e permitido estornar um item que ja e estorno.",
            reason: "REVERSAL_OF_REVERSAL_NOT_ALLOWED",
          },
          { status: 409 },
        );
      }

      const teamOperationResult = await supabase
        .from("stock_transfer_team_operations")
        .select("transfer_id")
        .eq("tenant_id", appUser.tenant_id)
        .eq("transfer_id", originalItemResult.data.stock_transfer_id)
        .maybeSingle<{ transfer_id: string }>();

      if (teamOperationResult.error) {
        return NextResponse.json(
          { message: "Falha ao validar a origem da operacao de equipe." },
          { status: 500 },
        );
      }

      if (!teamOperationResult.data) {
        return NextResponse.json(
          {
            message: "A movimentacao informada nao pertence ao fluxo de Operacoes de Equipe.",
            reason: "TEAM_OPERATION_NOT_FOUND",
          },
          { status: 409 },
        );
      }
    }

    const reversalResult = await reverseTeamStockOperationViaRpc(supabase, {
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      originalTransferId: transferId,
      originalTransferItemId: mode === "ITEM" ? transferItemId : null,
      reverseBatch: mode === "BATCH",
      reversalReasonCode,
      reversalReasonNotes,
      reversalDate,
    });

    if (!reversalResult.ok) {
      return NextResponse.json(
        {
          message: reversalResult.message,
          reason: reversalResult.reason,
          details: reversalResult.details,
        },
        { status: reversalResult.status },
      );
    }

    return NextResponse.json({
      success: true,
      transferId: reversalResult.transferId,
      reversedItemCount: reversalResult.reversedItemCount,
      results: reversalResult.results,
      message: reversalResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao estornar operacao de equipe." }, { status: 500 });
  }
}
