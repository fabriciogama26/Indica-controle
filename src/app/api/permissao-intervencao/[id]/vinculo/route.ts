import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import {
  linkPermissionInterventionToProgramming,
  type LinkPiPayload,
} from "@/server/modules/permissao-intervencao";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para acessar a Permissao de Intervencao.",
    inactiveMessage: "Usuario inativo.",
  });
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = ((await request.json().catch(() => null)) ?? {}) as LinkPiPayload;
  const { id } = await context.params;
  return linkPermissionInterventionToProgramming(resolution, id, payload);
}
