import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type TeamTypeRow = {
  id: string;
  name: string;
};

function normalizeName(value: string | null | undefined) {
  return String(value ?? "").trim();
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para carregar metadados de atividades.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const { data, error } = await supabase
      .from("team_types")
      .select("id, name")
      .eq("tenant_id", appUser.tenant_id)
      .eq("ativo", true)
      .order("name", { ascending: true })
      .returns<TeamTypeRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao carregar metadados de atividades." }, { status: 500 });
    }

    return NextResponse.json({
      teamTypes: (data ?? [])
        .map((item) => ({ id: item.id, name: normalizeName(item.name) }))
        .filter((item) => Boolean(item.id) && Boolean(item.name)),
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar metadados de atividades." }, { status: 500 });
  }
}
