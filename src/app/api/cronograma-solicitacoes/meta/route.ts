import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { getMeta } from "@/server/modules/cronograma-solicitacoes/handlers";

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para acessar o Cronograma de Solicitacoes.",
    inactiveMessage: "Usuario inativo.",
  });
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }
  return getMeta(resolution);
}
