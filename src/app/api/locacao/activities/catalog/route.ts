import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type ActivityCatalogRow = {
  id: string;
  code: string;
  description: string;
  unit: string;
  unit_value: number | string;
  group_name: string | null;
  scope: string | null;
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
      invalidSessionMessage: "Sessao invalida para pesquisar atividades da locacao.",
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
      .from("service_activities")
      .select("id, code, description, unit, unit_value, group_name, scope, team_types(name)")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("ativo", true)
      .or(`code.ilike.%${search}%,description.ilike.%${search}%`)
      .order("code", { ascending: true })
      .limit(20)
      .returns<ActivityCatalogRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao pesquisar atividades da locacao." }, { status: 500 });
    }

    return NextResponse.json({
      items: (data ?? []).map((item) => ({
        id: item.id,
        code: normalizeText(item.code),
        description: normalizeText(item.description),
        unit: normalizeText(item.unit),
        unitValue: Number(item.unit_value ?? 0),
        group: item.group_name ? normalizeText(item.group_name) : "",
        scope: item.scope ? normalizeText(item.scope) : "",
        teamTypeName: normalizeText(item.team_types?.name),
      })),
    });
  } catch {
    return NextResponse.json({ message: "Falha ao pesquisar atividades da locacao." }, { status: 500 });
  }
}
