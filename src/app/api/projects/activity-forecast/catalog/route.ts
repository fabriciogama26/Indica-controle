import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type CatalogRow = {
  id: string;
  code: string;
  description: string;
  unit: string;
  unit_value: number | string;
  voice_point: number | string;
  team_types: {
    name: string | null;
  } | null;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para pesquisar atividades previstas do projeto.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const query = normalizeText(request.nextUrl.searchParams.get("q"));
    if (query.length < 2) {
      return NextResponse.json({ items: [] });
    }

    let data: CatalogRow[] | null = null;
    let error: { message?: string } | null = null;

    const withVoicePoint = await resolution.supabase
      .from("service_activities")
      .select("id, code, description, unit, unit_value, voice_point, team_types(name)")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("ativo", true)
      .or(`code.ilike.%${query}%,description.ilike.%${query}%`)
      .order("code", { ascending: true })
      .limit(30);

    data = (withVoicePoint.data ?? null) as CatalogRow[] | null;
    error = withVoicePoint.error ? { message: withVoicePoint.error.message } : null;

    if (error?.message?.toLowerCase().includes("voice_point")) {
      const fallback = await resolution.supabase
        .from("service_activities")
        .select("id, code, description, unit, unit_value, team_types(name)")
        .eq("tenant_id", resolution.appUser.tenant_id)
        .eq("ativo", true)
        .or(`code.ilike.%${query}%,description.ilike.%${query}%`)
        .order("code", { ascending: true })
        .limit(30);

      data = (fallback.data ?? null) as CatalogRow[] | null;
      error = fallback.error ? { message: fallback.error.message } : null;
    }

    if (error) {
      return NextResponse.json({ message: "Falha ao pesquisar atividades previstas do projeto." }, { status: 500 });
    }

    return NextResponse.json({
      items: (data ?? []).map((item) => ({
        id: item.id,
        code: item.code,
        description: item.description,
        unit: item.unit,
        unitValue: Number(item.unit_value ?? 0),
        voicePoint: Number(item.voice_point ?? 1),
        type: item.team_types?.name ?? null,
      })),
    });
  } catch {
    return NextResponse.json({ message: "Falha ao pesquisar atividades previstas do projeto." }, { status: 500 });
  }
}
