import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import {
  activatePiTemplate,
  listPiTemplates,
  uploadPiTemplate,
  type ActivatePiTemplatePayload,
} from "@/server/modules/permissao-intervencao";

// PizZip trabalha com `Buffer`, que nao existe no runtime Edge.
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
  return listPiTemplates(resolution);
}

export async function POST(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, AUTH_OPTIONS);
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }
  return uploadPiTemplate(resolution, request);
}

export async function PUT(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, AUTH_OPTIONS);
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as ActivatePiTemplatePayload | null;
  if (!payload) {
    return NextResponse.json({ message: "Corpo da requisicao invalido." }, { status: 400 });
  }
  return activatePiTemplate(resolution, payload);
}
