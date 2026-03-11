import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type ProjectMetaRow = {
  sob: string;
  service_center: string;
  partner: string;
  priority: string;
  city: string;
  contractor_responsible: string;
  utility_responsible: string;
  utility_field_manager: string;
};

type PersonRow = {
  nome: string;
};

function normalizeArray(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((item) => String(item ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para carregar metadados de projetos.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;

    const { data: projects, error: projectsError } = await supabase
      .from("project")
      .select(
        "sob, service_center, partner, priority, city, contractor_responsible, utility_responsible, utility_field_manager",
      )
      .eq("tenant_id", appUser.tenant_id)
      .order("updated_at", { ascending: false })
      .limit(5000)
      .returns<ProjectMetaRow[]>();

    if (projectsError) {
      return NextResponse.json({ message: "Falha ao carregar opcoes de projetos." }, { status: 500 });
    }

    const { data: people } = await supabase
      .from("people")
      .select("nome")
      .eq("tenant_id", appUser.tenant_id)
      .eq("ativo", true)
      .order("nome", { ascending: true })
      .returns<PersonRow[]>();

    const sobSeen = new Set<string>();
    const sobCatalog = (projects ?? [])
      .map((item) => ({
        sob: String(item.sob ?? "").trim(),
        serviceCenter: String(item.service_center ?? "").trim(),
        partner: String(item.partner ?? "").trim(),
      }))
      .filter((item) => {
        const key = item.sob.toLowerCase();
        if (!item.sob || sobSeen.has(key)) {
          return false;
        }

        sobSeen.add(key);
        return true;
      })
      .sort((a, b) => a.sob.localeCompare(b.sob, "pt-BR"));

    const priorities = normalizeArray((projects ?? []).map((item) => item.priority));
    const cities = normalizeArray((projects ?? []).map((item) => item.city));
    const responsibles = normalizeArray([
      ...(projects ?? []).map((item) => item.contractor_responsible),
      ...(projects ?? []).map((item) => item.utility_responsible),
      ...(projects ?? []).map((item) => item.utility_field_manager),
      ...((people ?? []).map((item) => item.nome) ?? []),
    ]);

    return NextResponse.json({
      priorities,
      cities,
      responsibles,
      sobCatalog,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar opcoes de projetos." }, { status: 500 });
  }
}
