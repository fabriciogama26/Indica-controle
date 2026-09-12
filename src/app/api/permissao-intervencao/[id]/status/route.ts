import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import {
  changePermissionInterventionStatus,
  type ChangePiStatusPayload,
} from "@/server/modules/permissao-intervencao";

export const runtime = "nodejs";

/** Transicoes de status: READY, REOPEN, ISSUE e CANCEL. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para acessar a Permissao de Intervencao.",
    inactiveMessage: "Usuario inativo.",
  });
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as ChangePiStatusPayload | null;
  if (!payload) return NextResponse.json({ message: "Corpo da requisicao invalido." }, { status: 400 });

  const { id } = await context.params;
  return changePermissionInterventionStatus(resolution, id, payload);
}
