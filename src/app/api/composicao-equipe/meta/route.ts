import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type ProjectRow = {
  id: string;
  sob: string;
  service_center_text: string | null;
};

type TeamRow = {
  id: string;
  name: string;
  vehicle_plate: string | null;
  service_center_id: string | null;
  foreman_person_id: string;
};

type PersonRow = {
  id: string;
  nome: string;
  matriculation: string | null;
  cpf: string | null;
  phone: string | null;
  job_title_id: string;
  job_title_type_id: string | null;
  job_level: string | null;
};

type JobTitleRow = {
  id: string;
  name: string;
};

type JobTitleTypeRow = {
  id: string;
  name: string;
};

type ServiceCenterRow = {
  id: string;
  name: string;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function formatPersonName(value: unknown) {
  return normalizeText(value) || "Nao identificado";
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para carregar metadados da composicao de equipe.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const [
      projectsResult,
      teamsResult,
      peopleResult,
      jobTitlesResult,
      jobTitleTypesResult,
      serviceCentersResult,
    ] = await Promise.all([
      supabase
        .from("project_with_labels")
        .select("id, sob, service_center_text")
        .eq("tenant_id", appUser.tenant_id)
        .eq("is_active", true)
        .order("sob", { ascending: true })
        .limit(5000)
        .returns<ProjectRow[]>(),
      supabase
        .from("teams")
        .select("id, name, vehicle_plate, service_center_id, foreman_person_id")
        .eq("tenant_id", appUser.tenant_id)
        .eq("ativo", true)
        .order("name", { ascending: true })
        .returns<TeamRow[]>(),
      supabase
        .from("people")
        .select("id, nome, matriculation, cpf, phone, job_title_id, job_title_type_id, job_level")
        .eq("tenant_id", appUser.tenant_id)
        .eq("ativo", true)
        .order("nome", { ascending: true })
        .limit(5000)
        .returns<PersonRow[]>(),
      supabase
        .from("job_titles")
        .select("id, name")
        .eq("tenant_id", appUser.tenant_id)
        .eq("ativo", true)
        .returns<JobTitleRow[]>(),
      supabase
        .from("job_title_types")
        .select("id, name")
        .eq("tenant_id", appUser.tenant_id)
        .eq("ativo", true)
        .returns<JobTitleTypeRow[]>(),
      supabase
        .from("project_service_centers")
        .select("id, name")
        .eq("tenant_id", appUser.tenant_id)
        .eq("ativo", true)
        .returns<ServiceCenterRow[]>(),
    ]);

    if (projectsResult.error || teamsResult.error || peopleResult.error) {
      return NextResponse.json({ message: "Falha ao carregar metadados da composicao de equipe." }, { status: 500 });
    }

    const jobTitleMap = new Map((jobTitlesResult.data ?? []).map((item) => [item.id, normalizeText(item.name)]));
    const jobTitleTypeMap = new Map((jobTitleTypesResult.data ?? []).map((item) => [item.id, normalizeText(item.name)]));
    const serviceCenterMap = new Map((serviceCentersResult.data ?? []).map((item) => [item.id, normalizeText(item.name)]));
    const people = (peopleResult.data ?? []).map((person) => {
      const jobTitle = jobTitleMap.get(person.job_title_id) ?? "Nao identificado";
      const jobTitleType = person.job_title_type_id ? jobTitleTypeMap.get(person.job_title_type_id) ?? "" : "";
      const jobParts = [jobTitle, jobTitleType, normalizeText(person.job_level)].filter(Boolean);
      return {
        id: person.id,
        name: formatPersonName(person.nome),
        matriculation: person.matriculation,
        cpf: person.cpf,
        phone: person.phone,
        jobTitleName: jobParts.join(" - "),
      };
    });

    const personMap = new Map(people.map((person) => [person.id, person]));

    return NextResponse.json({
      projects: (projectsResult.data ?? [])
        .map((project) => ({
          id: project.id,
          code: normalizeText(project.sob),
          serviceCenter: normalizeText(project.service_center_text),
        }))
        .filter((project) => project.id && project.code),
      teams: (teamsResult.data ?? [])
        .map((team) => {
          const foreman = personMap.get(team.foreman_person_id) ?? null;
          return {
            id: team.id,
            name: normalizeText(team.name),
            vehiclePlate: normalizeText(team.vehicle_plate),
            serviceCenterId: team.service_center_id,
            serviceCenterName: team.service_center_id ? serviceCenterMap.get(team.service_center_id) ?? "" : "",
            foremanId: team.foreman_person_id,
            foremanName: foreman?.name ?? "Nao identificado",
          };
        })
        .filter((team) => team.id && team.name),
      people,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar metadados da composicao de equipe." }, { status: 500 });
  }
}
