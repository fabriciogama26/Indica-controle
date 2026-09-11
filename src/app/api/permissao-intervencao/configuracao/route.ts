import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import {
  getPiConfiguration,
  savePiConfiguration,
  type SavePiConfigurationPayload,
} from "@/server/modules/permissao-intervencao";

export const runtime = "nodejs";

const AUTH_OPTIONS = {
  invalidSessionMessage: "Sessao invalida para acessar a configuracao da PI.",
  inactiveMessage: "Usuario inativo.",
};

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, AUTH_OPTIONS);
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }
  return getPiConfiguration(resolution);
}

export async function PUT(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, AUTH_OPTIONS);
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as SavePiConfigurationPayload | null;
  if (!payload) return NextResponse.json({ message: "Corpo da requisicao invalido." }, { status: 400 });
  return savePiConfiguration(resolution, payload);
}
