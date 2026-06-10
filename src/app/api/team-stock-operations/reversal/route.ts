import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { normalizeDateInput, normalizeText } from "@/lib/server/stockTransfers";
import { reverseTeamStockOperationViaRpc } from "@/lib/server/teamStockOperations";

type ReversalPayload = {
  transferId?: unknown;
  transferItemId?: unknown;
  reversalReasonCode?: unknown;
  reversalReasonNotes?: unknown;
  reversalDate?: unknown;
};

const BLOCKED_REVERSAL_REASON_CODES = new Set(["OPERATION_CANCELED", "OTHER"]);

export async function POST(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para estornar operacao de equipe.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const normalizedRoleKey = String(resolution.role.roleKey ?? "").trim().toLowerCase();
    const canReverse = resolution.role.isAdmin || normalizedRoleKey === "user";
    if (!canReverse) {
      return NextResponse.json(
        { message: "Perfil sem permissao para estornar operacoes de equipe." },
        { status: 403 },
      );
    }

    const payload = (await request.json().catch(() => ({}))) as ReversalPayload;
    const transferId = normalizeText(payload.transferId);
    const transferItemId = normalizeText(payload.transferItemId);
    const reversalReasonCode = normalizeText(payload.reversalReasonCode).toUpperCase();
    const reversalReasonNotes = normalizeText(payload.reversalReasonNotes) || null;
    const reversalDateRaw = normalizeText(payload.reversalDate);
    const reversalDate = reversalDateRaw ? normalizeDateInput(reversalDateRaw) : null;

    if (!transferId && !transferItemId) {
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

    const { supabase, appUser } = resolution;
    if (transferItemId) {
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
      originalTransferItemId: transferItemId || null,
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
      message: reversalResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao estornar operacao de equipe." }, { status: 500 });
  }
}
