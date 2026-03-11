import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type ProjectMetaRow = {
  sob: string;
  service_center_text: string | null;
  priority_text: string | null;
  service_type_text: string | null;
  voltage_level_text: string | null;
  project_size_text: string | null;
  city_text: string | null;
  contractor_responsible_text: string | null;
  utility_responsible_text: string | null;
  utility_field_manager_text: string | null;
};

type LookupNameRow = {
  name: string;
};

type JobTitleIdRow = {
  id: string;
};

type PersonNameRow = {
  id: string;
  name: string;
};

function normalizeNames(values: string[]) {
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

    const [
      projectsResult,
      prioritiesResult,
      serviceCentersResult,
      serviceTypesResult,
      voltageLevelsResult,
      projectSizesResult,
      municipalitiesResult,
      supervisorJobTitlesResult,
      utilityResponsiblesResult,
      utilityFieldManagersResult,
    ] = await Promise.all([
      supabase
        .from("project_with_labels")
        .select(
          "sob, service_center_text, priority_text, service_type_text, voltage_level_text, project_size_text, city_text, contractor_responsible_text, utility_responsible_text, utility_field_manager_text",
        )
        .eq("tenant_id", appUser.tenant_id)
        .order("updated_at", { ascending: false })
        .limit(5000)
        .returns<ProjectMetaRow[]>(),
      supabase
        .from("project_priorities")
        .select("name")
        .eq("tenant_id", appUser.tenant_id)
        .eq("ativo", true)
        .order("name", { ascending: true })
        .returns<LookupNameRow[]>(),
      supabase
        .from("project_service_centers")
        .select("name")
        .eq("tenant_id", appUser.tenant_id)
        .eq("ativo", true)
        .order("name", { ascending: true })
        .returns<LookupNameRow[]>(),
      supabase
        .from("project_service_types")
        .select("name")
        .eq("tenant_id", appUser.tenant_id)
        .eq("ativo", true)
        .order("name", { ascending: true })
        .returns<LookupNameRow[]>(),
      supabase
        .from("project_voltage_levels")
        .select("name")
        .eq("tenant_id", appUser.tenant_id)
        .eq("ativo", true)
        .order("name", { ascending: true })
        .returns<LookupNameRow[]>(),
      supabase
        .from("project_sizes")
        .select("name")
        .eq("tenant_id", appUser.tenant_id)
        .eq("ativo", true)
        .order("name", { ascending: true })
        .returns<LookupNameRow[]>(),
      supabase
        .from("project_municipalities")
        .select("name")
        .eq("tenant_id", appUser.tenant_id)
        .eq("ativo", true)
        .order("name", { ascending: true })
        .returns<LookupNameRow[]>(),
      supabase
        .from("job_titles")
        .select("id")
        .eq("tenant_id", appUser.tenant_id)
        .eq("ativo", true)
        .ilike("code", "SUPERVISOR")
        .returns<JobTitleIdRow[]>(),
      supabase
        .from("project_utility_responsibles")
        .select("name")
        .eq("tenant_id", appUser.tenant_id)
        .eq("ativo", true)
        .order("name", { ascending: true })
        .returns<LookupNameRow[]>(),
      supabase
        .from("project_utility_field_managers")
        .select("name")
        .eq("tenant_id", appUser.tenant_id)
        .eq("ativo", true)
        .order("name", { ascending: true })
        .returns<LookupNameRow[]>(),
    ]);

    if (projectsResult.error) {
      return NextResponse.json({ message: "Falha ao carregar opcoes de projetos." }, { status: 500 });
    }

    const projectRows = projectsResult.data ?? [];
    const supervisorJobTitleIds = supervisorJobTitlesResult.error
      ? []
      : (supervisorJobTitlesResult.data ?? []).map((item) => item.id).filter(Boolean);
    let contractorResponsibles: string[] = [];

    if (supervisorJobTitleIds.length > 0) {
      const contractorPeopleResult = await supabase
        .from("people")
        .select("id, name:nome")
        .eq("tenant_id", appUser.tenant_id)
        .eq("ativo", true)
        .in("job_title_id", supervisorJobTitleIds)
        .order("nome", { ascending: true })
        .returns<PersonNameRow[]>();

      if (contractorPeopleResult.error) {
        contractorResponsibles = [];
      } else {
        contractorResponsibles = normalizeNames((contractorPeopleResult.data ?? []).map((item) => item.name));
      }
    }

    if (contractorResponsibles.length === 0) {
      contractorResponsibles = normalizeNames(projectRows.map((item) => String(item.contractor_responsible_text ?? "")));
    }

    const sobSeen = new Set<string>();
    const sobCatalog = projectRows
      .map((item) => ({
        sob: String(item.sob ?? "").trim(),
        serviceCenter: String(item.service_center_text ?? "").trim(),
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

    return NextResponse.json({
      priorities: prioritiesResult.error
        ? normalizeNames(projectRows.map((item) => String(item.priority_text ?? "")))
        : normalizeNames((prioritiesResult.data ?? []).map((item) => item.name)),
      serviceCenters: serviceCentersResult.error
        ? normalizeNames(projectRows.map((item) => String(item.service_center_text ?? "")))
        : normalizeNames((serviceCentersResult.data ?? []).map((item) => item.name)),
      serviceTypes: serviceTypesResult.error
        ? normalizeNames(projectRows.map((item) => String(item.service_type_text ?? "")))
        : normalizeNames((serviceTypesResult.data ?? []).map((item) => item.name)),
      voltageLevels: voltageLevelsResult.error
        ? normalizeNames(projectRows.map((item) => String(item.voltage_level_text ?? "")))
        : normalizeNames((voltageLevelsResult.data ?? []).map((item) => item.name)),
      projectSizes: projectSizesResult.error
        ? normalizeNames(projectRows.map((item) => String(item.project_size_text ?? "")))
        : normalizeNames((projectSizesResult.data ?? []).map((item) => item.name)),
      cities: municipalitiesResult.error
        ? normalizeNames(projectRows.map((item) => String(item.city_text ?? "")))
        : normalizeNames((municipalitiesResult.data ?? []).map((item) => item.name)),
      contractorResponsibles,
      utilityResponsibles: utilityResponsiblesResult.error
        ? normalizeNames(projectRows.map((item) => String(item.utility_responsible_text ?? "")))
        : normalizeNames((utilityResponsiblesResult.data ?? []).map((item) => item.name)),
      utilityFieldManagers: utilityFieldManagersResult.error
        ? normalizeNames(projectRows.map((item) => String(item.utility_field_manager_text ?? "")))
        : normalizeNames((utilityFieldManagersResult.data ?? []).map((item) => item.name)),
      sobCatalog,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar opcoes de projetos." }, { status: 500 });
  }
}
