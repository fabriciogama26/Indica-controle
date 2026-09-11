import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { getPermissionInterventionHistory } from "@/server/modules/permissao-intervencao";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para acessar a Permissao de Intervencao.",
    inactiveMessage: "Usuario inativo.",
  });
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const { id } = await context.params;
  return getPermissionInterventionHistory(resolution, id);
}
