import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { cancelSolicitacao } from "@/server/modules/cronograma-solicitacoes/handlers";

export async function POST(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para acessar o Cronograma de Solicitacoes.",
    inactiveMessage: "Usuario inativo.",
  });
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as
    | { id?: string; motivo?: string; expectedUpdatedAt?: string | null }
    | null;
  if (!payload || !payload.id) {
    return NextResponse.json({ message: "Corpo da requisicao invalido." }, { status: 400 });
  }

  return cancelSolicitacao(resolution, {
    id: payload.id,
    motivo: payload.motivo ?? "",
    expectedUpdatedAt: payload.expectedUpdatedAt ?? null,
  });
}
