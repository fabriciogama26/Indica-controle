import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { generatePiTemplatePreview, type PiTemplatePreviewPayload } from "@/server/modules/permissao-intervencao";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para acessar a Permissao de Intervencao.",
    inactiveMessage: "Usuario inativo.",
  });
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = ((await request.json().catch(() => null)) ?? {}) as PiTemplatePreviewPayload;
  return generatePiTemplatePreview(resolution, payload);
}
