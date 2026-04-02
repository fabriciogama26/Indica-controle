import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import {
  normalizeDateInput,
  normalizeText,
  reverseStockTransferViaRpc,
} from "@/lib/server/stockTransfers";

type ReversalPayload = {
  transferId?: unknown;
  reversalReason?: unknown;
  reversalDate?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para estornar movimentacao de estoque.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    if (!resolution.role.isAdmin) {
      return NextResponse.json(
        { message: "Apenas usuarios administrativos podem estornar movimentacoes de estoque." },
        { status: 403 },
      );
    }

    const payload = (await request.json().catch(() => ({}))) as ReversalPayload;
    const transferId = normalizeText(payload.transferId);
    const reversalReason = normalizeText(payload.reversalReason);
    const reversalDateRaw = normalizeText(payload.reversalDate);
    const reversalDate = reversalDateRaw ? normalizeDateInput(reversalDateRaw) : null;

    if (!transferId) {
      return NextResponse.json({ message: "transferId e obrigatorio para estorno." }, { status: 400 });
    }

    if (!reversalReason) {
      return NextResponse.json({ message: "Motivo do estorno e obrigatorio." }, { status: 400 });
    }

    if (reversalDateRaw && !reversalDate) {
      return NextResponse.json({ message: "Data do estorno invalida." }, { status: 400 });
    }

    const { supabase, appUser } = resolution;
    const reversalResult = await reverseStockTransferViaRpc(supabase, {
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      originalTransferId: transferId,
      reversalReason,
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
    return NextResponse.json({ message: "Falha ao estornar movimentacao de estoque." }, { status: 500 });
  }
}
