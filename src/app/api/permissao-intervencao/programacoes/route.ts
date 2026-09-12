import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { getProgrammingStageOptions } from "@/server/modules/permissao-intervencao";

export const runtime = "nodejs";

/** Etapas do projeto oferecidas no fluxo `Criar a partir da Programacao`. */
export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para acessar a Permissao de Intervencao.",
    inactiveMessage: "Usuario inativo.",
  });
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }
  return getProgrammingStageOptions(resolution, request.nextUrl.searchParams.get("projectId") ?? "");
}
