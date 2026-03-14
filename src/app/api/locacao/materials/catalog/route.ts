import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type MaterialCatalogRow = {
  id: string;
  codigo: string;
  descricao: string;
  umb: string | null;
  tipo: string | null;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para pesquisar materiais da locacao.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const search = normalizeText(request.nextUrl.searchParams.get("q"));
    if (search.length < 2) {
      return NextResponse.json({ items: [] });
    }

    const { data, error } = await resolution.supabase
      .from("materials")
      .select("id, codigo, descricao, umb, tipo")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("is_active", true)
      .or(`codigo.ilike.%${search}%,descricao.ilike.%${search}%`)
      .order("codigo", { ascending: true })
      .limit(20)
      .returns<MaterialCatalogRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao pesquisar materiais da locacao." }, { status: 500 });
    }

    return NextResponse.json({
      items: (data ?? []).map((item) => ({
        id: item.id,
        code: normalizeText(item.codigo),
        description: normalizeText(item.descricao),
        umb: item.umb ? normalizeText(item.umb) : null,
        type: item.tipo ? normalizeText(item.tipo) : null,
      })),
    });
  } catch {
    return NextResponse.json({ message: "Falha ao pesquisar materiais da locacao." }, { status: 500 });
  }
}
