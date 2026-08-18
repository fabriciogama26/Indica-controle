import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { requirePageAction } from "@/lib/server/pageAuthorization";
import { fetchDayForemen } from "@/server/modules/composicao-equipe";

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// Dado operacional (muda por acao do usuario ao longo do dia), entao fica fora do
// /meta, que serve catalogo. Autorizado pela pagina consumidora: quem opera a Saida
// nao precisa de acesso a tela de Composicao de Equipe para usar o atalho.
export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para consultar encarregados do dia.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const pageAuth = await requirePageAction({ context: resolution, pageKey: "saida", action: "read" });
    if (!pageAuth.allowed) {
      return NextResponse.json({ message: pageAuth.error.message }, { status: pageAuth.error.status });
    }

    const compositionDate = request.nextUrl.searchParams.get("date")?.trim() ?? "";
    if (!isIsoDate(compositionDate)) {
      return NextResponse.json({ message: "Data invalida para consultar encarregados do dia." }, { status: 400 });
    }

    const foremen = await fetchDayForemen(resolution.supabase, resolution.appUser.tenant_id, compositionDate);
    if (!foremen) {
      return NextResponse.json({ message: "Falha ao carregar encarregados do dia." }, { status: 500 });
    }

    return NextResponse.json({ compositionDate, foremen });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar encarregados do dia." }, { status: 500 });
  }
}
