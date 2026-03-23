import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type ProjectMetaRow = {
  id: string;
  sob: string;
  city_text: string | null;
  is_active: boolean;
  updated_at: string;
  has_locacao?: boolean | null;
};

type LocationPlanListRow = {
  id: string;
  project_id: string;
  updated_at: string;
  updated_by: string | null;
};

type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

type ProgrammingSgdTypeRow = {
  id: string;
  description: string | null;
  is_active: boolean | null;
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
      .select("id, sob, city_text, is_active, updated_at, has_locacao")
      .eq("tenant_id", appUser.tenant_id)
      .order("updated_at", { ascending: false })
      .limit(5000)
      .returns<ProjectMetaRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao carregar metadados de locacao." }, { status: 500 });
    }

    const locationProjectsBase = (data ?? [])
      .map((item) => ({
        id: item.id,
        sob: normalizeText(item.sob),
        city: normalizeText(item.city_text),
        isActive: Boolean(item.is_active),
        hasLocacao: Boolean(item.has_locacao),
      }))
      .filter((item) => item.id && item.sob)
      .sort((a, b) => a.sob.localeCompare(b.sob, "pt-BR"));

    const projects = locationProjectsBase.filter((item) => item.isActive);

    const cities = Array.from(new Set(locationProjectsBase.map((item) => item.city).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, "pt-BR"),
    );

    const projectIds = locationProjectsBase.map((item) => item.id);
    const { data: plans, error: plansError } = projectIds.length
      ? await supabase
          .from("project_location_plans")
          .select("id, project_id, updated_at, updated_by")
          .eq("tenant_id", appUser.tenant_id)
          .in("project_id", projectIds)
          .returns<LocationPlanListRow[]>()
      : { data: [], error: null };

    if (plansError) {
      return NextResponse.json({ message: "Falha ao carregar listagem de locacao." }, { status: 500 });
    }

    const updatedByIds = Array.from(
      new Set((plans ?? []).map((item) => normalizeText(item.updated_by)).filter(Boolean)),
    );

    const { data: appUsers, error: appUsersError } = updatedByIds.length
      ? await supabase
          .from("app_users")
          .select("id, display, login_name")
          .eq("tenant_id", appUser.tenant_id)
          .in("id", updatedByIds)
          .returns<AppUserRow[]>()
      : { data: [], error: null };

    if (appUsersError) {
      return NextResponse.json({ message: "Falha ao carregar responsaveis da locacao." }, { status: 500 });
    }

    const appUsersById = new Map(
      (appUsers ?? []).map((item) => [item.id, normalizeText(item.display) || normalizeText(item.login_name)]),
    );
    const plansByProjectId = new Map((plans ?? []).map((item) => [item.project_id, item]));

    const { data: sgdTypesData, error: sgdTypesError } = await supabase
      .from("programming_sgd_types")
      .select("id, description, is_active")
      .eq("tenant_id", appUser.tenant_id)
      .eq("is_active", true)
      .order("description", { ascending: true })
      .returns<ProgrammingSgdTypeRow[]>();

    const sgdTypes = sgdTypesError
      ? []
      : (sgdTypesData ?? [])
          .map((item) => ({
            id: item.id,
            description: normalizeText(item.description),
          }))
          .filter((item) => item.id && item.description);

    const locationProjects = locationProjectsBase.map((item) => {
      const plan = plansByProjectId.get(item.id);
      const isInactive = !item.isActive;
      const status = isInactive ? "INATIVO" : item.hasLocacao ? "LOCADO" : "NAO_LOCADO";

      return {
        id: item.id,
        sob: item.sob,
        city: item.city,
        isActive: item.isActive,
        hasLocacao: item.hasLocacao,
        status,
        planId: plan?.id ?? null,
        recordedAt: item.hasLocacao ? plan?.updated_at ?? null : null,
        recordedByName: item.hasLocacao ? appUsersById.get(normalizeText(plan?.updated_by)) ?? null : null,
      };
    });

    return NextResponse.json({
      cities,
      projects,
      locationProjects,
      sgdTypes,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar metadados de locacao." }, { status: 500 });
  }
}
