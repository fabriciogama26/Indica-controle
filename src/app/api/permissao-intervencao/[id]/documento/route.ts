import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { generatePiDocument } from "@/server/modules/permissao-intervencao";

// PizZip trabalha com `Buffer`, que nao existe no runtime Edge.
export const runtime = "nodejs";

/** Gera e devolve o DOCX oficial de uma PI emitida. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para acessar a Permissao de Intervencao.",
    inactiveMessage: "Usuario inativo.",
  });
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const { id } = await context.params;
  return generatePiDocument(resolution, id);
}
