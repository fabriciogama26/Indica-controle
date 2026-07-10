import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { listTipoDefaults, setTipoDefault } from "@/server/modules/cronograma-solicitacoes/handlers";

const AUTH_OPTIONS = {
  invalidSessionMessage: "Sessao invalida para acessar o Cronograma de Solicitacoes.",
  inactiveMessage: "Usuario inativo.",
};

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, AUTH_OPTIONS);
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }
  return listTipoDefaults(resolution);
}

export async function PUT(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, AUTH_OPTIONS);
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as { userId?: string; tipo?: string } | null;
  if (!payload || !payload.userId) {
    return NextResponse.json({ message: "Corpo da requisicao invalido." }, { status: 400 });
  }
  return setTipoDefault(resolution, { userId: payload.userId, tipo: payload.tipo ?? "" });
}
