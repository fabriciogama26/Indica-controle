import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import {
  listPermissionInterventions,
  savePermissionIntervention,
  type SavePiPayload,
} from "@/server/modules/permissao-intervencao";

export const runtime = "nodejs";

const AUTH_OPTIONS = {
  invalidSessionMessage: "Sessao invalida para acessar a Permissao de Intervencao.",
  inactiveMessage: "Usuario inativo.",
};

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, AUTH_OPTIONS);
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }
  return listPermissionInterventions(resolution, request.nextUrl.searchParams);
}

/** Cria (sem `piId`) ou edita (com `piId`) — a mesma RPC cobre os dois casos. */
export async function POST(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, AUTH_OPTIONS);
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as SavePiPayload | null;
  if (!payload) return NextResponse.json({ message: "Corpo da requisicao invalido." }, { status: 400 });
  return savePermissionIntervention(resolution, payload);
}
