import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { authorizePageAction } from "@/lib/server/routeAuthorization";

type JobTitleIdRow = {
  id: string;
};

type PersonRow = {
  id: string;
  nome: string;
};

type TeamTypeRow = {
  id: string;
  name: string;
  team_category_id: string | null;
};

type TeamCategoryRow = {
  id: string;
  code: string;
  name: string;
};

type ServiceCenterRow = {
  id: string;
  name: string;
};

function normalizeName(value: string | null | undefined) {
  return String(value ?? "").trim();
}

const FOREMAN_JOB_TITLE_FILTER = "code.ilike.%ENCARREGADO%,name.ilike.%ENCARREGADO%";
const SUPERVISOR_JOB_TITLE_FILTER = "code.ilike.%SUPERVISOR%,name.ilike.%SUPERVISOR%";

async function fetchForemen(supabase: SupabaseClient, tenantId: string) {
  const { data: jobTitles, error: jobTitleError } = await supabase
    .from("job_titles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .or(FOREMAN_JOB_TITLE_FILTER)
    .returns<JobTitleIdRow[]>();

  if (jobTitleError || !jobTitles || jobTitles.length === 0) {
    return [] as Array<{ id: string; name: string }>;
  }

  const jobTitleIds = jobTitles.map((item) => item.id).filter(Boolean);
  if (jobTitleIds.length === 0) {
    return [] as Array<{ id: string; name: string }>;
  }

  const { data: peopleRows, error: peopleError } = await supabase
    .from("people")
    .select("id, nome")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .in("job_title_id", jobTitleIds)
    .order("nome", { ascending: true })
    .returns<PersonRow[]>();

  if (peopleError) {
    return [] as Array<{ id: string; name: string }>;
  }

  return (peopleRows ?? [])
    .map((item) => ({ id: item.id, name: normalizeName(item.nome) }))
    .filter((item) => Boolean(item.id) && Boolean(item.name));
}

// O tipo operacional pertence a uma categoria desde a 416: a tela precisa do
// vinculo para so oferecer os tipos da categoria escolhida na equipe.
async function fetchTeamTypes(supabase: SupabaseClient, tenantId: string) {
  const { data, error } = await supabase
    .from("team_types")
    .select("id, name, team_category_id")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .order("name", { ascending: true })
    .returns<TeamTypeRow[]>();

  if (error) {
    return [] as Array<{ id: string; name: string; teamCategoryId: string | null }>;
  }

  return (data ?? [])
    .map((item) => ({ id: item.id, name: normalizeName(item.name), teamCategoryId: item.team_category_id }))
    .filter((item) => Boolean(item.id) && Boolean(item.name));
}

async function fetchTeamCategories(supabase: SupabaseClient, tenantId: string) {
  const { data, error } = await supabase
    .from("team_categories")
    .select("id, code, name")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<TeamCategoryRow[]>();

  if (error) {
    return [] as Array<{ id: string; code: string; name: string }>;
  }

  return (data ?? [])
    .map((item) => ({
      id: item.id,
      code: normalizeName(item.code).toUpperCase(),
      name: normalizeName(item.name),
    }))
    .filter((item) => Boolean(item.id) && Boolean(item.code) && Boolean(item.name));
}

async function fetchServiceCenters(supabase: SupabaseClient, tenantId: string) {
  const { data, error } = await supabase
    .from("project_service_centers")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .order("name", { ascending: true })
    .returns<ServiceCenterRow[]>();

  if (error) {
    return [] as Array<{ id: string; name: string }>;
  }

  return (data ?? [])
    .map((item) => ({ id: item.id, name: normalizeName(item.name) }))
    .filter((item) => Boolean(item.id) && Boolean(item.name));
}

async function fetchSupervisors(supabase: SupabaseClient, tenantId: string) {
  const { data: jobTitles, error: jobTitleError } = await supabase
    .from("job_titles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .or(SUPERVISOR_JOB_TITLE_FILTER)
    .returns<JobTitleIdRow[]>();

  if (jobTitleError || !jobTitles || jobTitles.length === 0) {
    return [] as Array<{ id: string; name: string }>;
  }

  const jobTitleIds = jobTitles.map((item) => item.id).filter(Boolean);
  if (jobTitleIds.length === 0) {
    return [] as Array<{ id: string; name: string }>;
  }

  const { data: peopleRows, error: peopleError } = await supabase
    .from("people")
    .select("id, nome")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .in("job_title_id", jobTitleIds)
    .order("nome", { ascending: true })
    .returns<PersonRow[]>();

  if (peopleError) {
    return [] as Array<{ id: string; name: string }>;
  }

  return (peopleRows ?? [])
    .map((item) => ({ id: item.id, name: normalizeName(item.nome) }))
    .filter((item) => Boolean(item.id) && Boolean(item.name));
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para carregar metadados de equipes.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorizationError = await authorizePageAction(resolution, "equipes", "read");
    if (authorizationError) {
      return authorizationError;
    }

    const { supabase, appUser } = resolution;
    const [foremen, supervisors, teamTypes, teamCategories, serviceCenters] = await Promise.all([
      fetchForemen(supabase, appUser.tenant_id),
      fetchSupervisors(supabase, appUser.tenant_id),
      fetchTeamTypes(supabase, appUser.tenant_id),
      fetchTeamCategories(supabase, appUser.tenant_id),
      fetchServiceCenters(supabase, appUser.tenant_id),
    ]);

    return NextResponse.json({
      foremen,
      supervisors,
      teamTypes,
      teamCategories,
      serviceCenters,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar metadados de equipes." }, { status: 500 });
  }
}
