import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { requirePageAction } from "@/lib/server/pageAuthorization";
import { fulfillStockRequisitionViaRpc, StockRequisitionDecisionInput } from "@/lib/server/stockRequisitions";

const ATENDIMENTO_PAGE = "requisicao-atendimento";

const VALID_DECISIONS = new Set(["ACCEPT", "REDUCE", "REJECT"]);

export async function POST(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para atender a requisicao.",
      inactiveMessage: "Usuario inativo.",
    });
    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorization = await requirePageAction({ context: resolution, pageKey: ATENDIMENTO_PAGE, action: "update" });
    if (!authorization.allowed) {
      return NextResponse.json({ message: authorization.error.message }, { status: authorization.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const requestId = String(body?.requestId ?? "").trim();
    const rawDecisions = Array.isArray(body?.decisions) ? body!.decisions : [];

    if (!requestId || rawDecisions.length === 0) {
      return NextResponse.json({ message: "Pedido e decisoes sao obrigatorios." }, { status: 400 });
    }

    const decisions: StockRequisitionDecisionInput[] = rawDecisions.map((raw) => {
      const record = raw as Record<string, unknown>;
      const decision = String(record.decision ?? "").trim().toUpperCase();
      return {
        itemId: String(record.itemId ?? "").trim(),
        decision: (VALID_DECISIONS.has(decision) ? decision : "REJECT") as StockRequisitionDecisionInput["decision"],
        quantity: record.quantity === undefined || record.quantity === null ? null : Number(record.quantity),
        reasonCode: record.reasonCode ? String(record.reasonCode).trim() : null,
        serialNumber: record.serialNumber ? String(record.serialNumber).trim() : null,
        lotCode: record.lotCode ? String(record.lotCode).trim() : null,
        entryType: record.entryType ? String(record.entryType).trim().toUpperCase() : "NOVO",
        notes: record.notes ? String(record.notes) : null,
      };
    });

    const result = await fulfillStockRequisitionViaRpc(supabase, {
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      requestId,
      decisions,
    });

    if (!result.ok) {
      return NextResponse.json({ message: result.message, reason: result.reason, details: result.details }, { status: result.status });
    }

    return NextResponse.json({
      requestId: result.requestId,
      resultado: result.resultado,
      accepted: result.accepted,
      reduced: result.reduced,
      rejected: result.rejected,
      message: result.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao atender a requisicao." }, { status: 500 });
  }
}
