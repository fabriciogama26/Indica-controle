import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { requirePageAction } from "@/lib/server/pageAuthorization";
import { cancelStockRequisitionViaRpc } from "@/lib/server/stockRequisitions";

const SOLICITACAO_PAGE = "requisicao-solicitacao";
const ATENDIMENTO_PAGE = "requisicao-atendimento";

// Cancelamento permitido ao solicitante (tela de solicitacao) e ao almoxarife (tela de atendimento).
export async function POST(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para cancelar o pedido.",
      inactiveMessage: "Usuario inativo.",
    });
    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const requestId = String(body?.requestId ?? "").trim();
    const pageKey = String(body?.page ?? "") === "atendimento" ? ATENDIMENTO_PAGE : SOLICITACAO_PAGE;

    if (!requestId) {
      return NextResponse.json({ message: "Pedido nao informado." }, { status: 400 });
    }

    const authorization = await requirePageAction({ context: resolution, pageKey, action: "cancel" });
    if (!authorization.allowed) {
      return NextResponse.json({ message: authorization.error.message }, { status: authorization.error.status });
    }

    const result = await cancelStockRequisitionViaRpc(supabase, {
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      requestId,
    });

    if (!result.ok) {
      return NextResponse.json({ message: result.message, reason: result.reason }, { status: result.status });
    }

    return NextResponse.json({ requestId: result.requestId, message: result.message });
  } catch {
    return NextResponse.json({ message: "Falha ao cancelar o pedido." }, { status: 500 });
  }
}
