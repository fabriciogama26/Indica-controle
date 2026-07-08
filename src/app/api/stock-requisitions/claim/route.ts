import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { requirePageAction } from "@/lib/server/pageAuthorization";
import { claimStockRequisitionViaRpc, releaseStockRequisitionClaimViaRpc } from "@/lib/server/stockRequisitions";

const ATENDIMENTO_PAGE = "requisicao-atendimento";

// POST: assume o pedido (claim). Concorrencia por EM_ATENDIMENTO + expiracao.
export async function POST(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para assumir o pedido.",
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
    if (!requestId) {
      return NextResponse.json({ message: "Pedido nao informado." }, { status: 400 });
    }

    const result = await claimStockRequisitionViaRpc(supabase, {
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      actorName: appUser.display ?? appUser.login_name ?? null,
      requestId,
    });

    if (!result.ok) {
      return NextResponse.json({ message: result.message, reason: result.reason }, { status: result.status });
    }

    return NextResponse.json({ requestId: result.requestId, claimExpiresAt: result.claimExpiresAt, message: result.message });
  } catch {
    return NextResponse.json({ message: "Falha ao assumir o pedido." }, { status: 500 });
  }
}

// DELETE: libera a claim (proprio ator, claim expirada ou supervisor=admin).
export async function DELETE(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para liberar o atendimento.",
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
    const requestId = String(request.nextUrl.searchParams.get("requestId") ?? "").trim();
    if (!requestId) {
      return NextResponse.json({ message: "Pedido nao informado." }, { status: 400 });
    }

    const result = await releaseStockRequisitionClaimViaRpc(supabase, {
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      requestId,
      isSupervisor: resolution.role.isAdmin,
    });

    if (!result.ok) {
      return NextResponse.json({ message: result.message, reason: result.reason }, { status: result.status });
    }

    return NextResponse.json({ requestId: result.requestId, message: result.message });
  } catch {
    return NextResponse.json({ message: "Falha ao liberar o atendimento." }, { status: 500 });
  }
}
