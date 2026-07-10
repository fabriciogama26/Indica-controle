import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { createSolicitacao, listSolicitacoes, updateSolicitacao } from "@/server/modules/cronograma-solicitacoes/handlers";
import type { CreatePayload, UpdatePayload } from "@/server/modules/cronograma-solicitacoes/types";

const AUTH_OPTIONS = {
  invalidSessionMessage: "Sessao invalida para acessar o Cronograma de Solicitacoes.",
  inactiveMessage: "Usuario inativo.",
};

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, AUTH_OPTIONS);
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }
  return listSolicitacoes(resolution, request.nextUrl.searchParams);
}

export async function POST(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, AUTH_OPTIONS);
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as CreatePayload | null;
  if (!payload) {
    return NextResponse.json({ message: "Corpo da requisicao invalido." }, { status: 400 });
  }
  return createSolicitacao(resolution, payload);
}

export async function PUT(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, AUTH_OPTIONS);
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as UpdatePayload | null;
  if (!payload || !payload.id) {
    return NextResponse.json({ message: "Corpo da requisicao invalido." }, { status: 400 });
  }
  return updateSolicitacao(resolution, payload);
}
