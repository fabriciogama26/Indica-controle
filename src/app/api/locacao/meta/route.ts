import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type ProjectMetaRow = {
  id: string;
  sob: string;
  city_text: string | null;
  is_active: boolean;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para carregar metadados de locacao.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const { data, error } = await supabase
      .from("project_with_labels")
      .select("id, sob, city_text, is_active")
      .eq("tenant_id", appUser.tenant_id)
      .eq("is_active", true)
      .order("sob", { ascending: true })
      .limit(5000)
      .returns<ProjectMetaRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao carregar metadados de locacao." }, { status: 500 });
    }

    const projects = (data ?? [])
      .map((item) => ({
        id: item.id,
        sob: normalizeText(item.sob),
        city: normalizeText(item.city_text),
        isActive: Boolean(item.is_active),
      }))
      .filter((item) => item.id && item.sob);

    const cities = Array.from(new Set(projects.map((item) => item.city).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, "pt-BR"),
    );

    return NextResponse.json({
      cities,
      projects,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar metadados de locacao." }, { status: 500 });
  }
}
