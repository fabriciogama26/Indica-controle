import { SupabaseClient } from "@supabase/supabase-js";

import { normalizeText } from "@/lib/server/apiHelpers";

export type TeamRow = {
  id: string;
  name: string;
  vehicle_plate: string;
  service_center_id: string | null;
  stock_center_id: string | null;
  team_type_id: string;
  team_category_id: string | null;
  foreman_person_id: string | null;
  supervisor_person_id: string | null;
  ativo: boolean;
  cancellation_reason: string | null;
  canceled_at: string | null;
  canceled_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type ForemanRow = {
  id: string;
  nome: string;
  job_title_id: string;
};

type SupervisorRow = ForemanRow;

type JobTitleIdRow = {
  id: string;
};

export type TeamTypeRow = {
  id: string;
  name: string;
  team_category_id?: string | null;
};

export type TeamCategoryRow = {
  id: string;
  code: "TECNICA" | "COMERCIAL" | string;
  name: string;
};

export type ServiceCenterRow = {
  id: string;
  name: string;
};

export type StockCenterRow = {
  id: string;
  name: string;
  center_type?: string | null;
};

type ExistingTeamByForemanRow = {
  id: string;
  name: string;
  foreman_person_id: string;
};

const FOREMAN_JOB_TITLE_FILTER = "code.ilike.%ENCARREGADO%,name.ilike.%ENCARREGADO%";
const SUPERVISOR_JOB_TITLE_FILTER = "code.ilike.%SUPERVISOR%,name.ilike.%SUPERVISOR%";

async function fetchForemanJobTitleIds(supabase: SupabaseClient, tenantId: string) {
  const { data, error } = await supabase
    .from("job_titles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .or(FOREMAN_JOB_TITLE_FILTER)
    .returns<JobTitleIdRow[]>();

  if (error) {
    return [] as string[];
  }

  return (data ?? []).map((item) => item.id).filter(Boolean);
}

async function fetchSupervisorJobTitleIds(supabase: SupabaseClient, tenantId: string) {
  const { data, error } = await supabase
    .from("job_titles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .or(SUPERVISOR_JOB_TITLE_FILTER)
    .returns<JobTitleIdRow[]>();

  if (error) {
    return [] as string[];
  }

  return (data ?? []).map((item) => item.id).filter(Boolean);
}

export async function fetchForemanById(
  supabase: SupabaseClient,
  tenantId: string,
  foremanId: string,
) {
  const jobTitleIds = await fetchForemanJobTitleIds(supabase, tenantId);
  if (jobTitleIds.length === 0) {
    return null;
  }

  const { data, error } = await supabase
    .from("people")
    .select("id, nome, job_title_id")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .eq("id", foremanId)
    .in("job_title_id", jobTitleIds)
    .maybeSingle<ForemanRow>();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    name: normalizeText(data.nome),
  };
}

export async function fetchSupervisorById(
  supabase: SupabaseClient,
  tenantId: string,
  supervisorId: string | null,
) {
  const normalizedSupervisorId = normalizeText(supervisorId);
  if (!normalizedSupervisorId) {
    return null;
  }

  const jobTitleIds = await fetchSupervisorJobTitleIds(supabase, tenantId);
  if (jobTitleIds.length === 0) {
    return null;
  }

  const { data, error } = await supabase
    .from("people")
    .select("id, nome, job_title_id")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .eq("id", normalizedSupervisorId)
    .in("job_title_id", jobTitleIds)
    .maybeSingle<SupervisorRow>();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    name: normalizeText(data.nome),
  };
}

export async function fetchTeamTypeById(
  supabase: SupabaseClient,
  tenantId: string,
  teamTypeId: string,
) {
  const { data, error } = await supabase
    .from("team_types")
    .select("id, name, team_category_id")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .eq("id", teamTypeId)
    .maybeSingle<TeamTypeRow>();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    name: normalizeText(data.name),
    team_category_id: data.team_category_id ?? null,
  };
}

export async function fetchTeamCategoryById(
  supabase: SupabaseClient,
  tenantId: string,
  teamCategoryId: string,
) {
  const { data, error } = await supabase
    .from("team_categories")
    .select("id, code, name")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .eq("id", teamCategoryId)
    .maybeSingle<TeamCategoryRow>();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    code: normalizeText(data.code).toUpperCase(),
    name: normalizeText(data.name),
  };
}

export async function fetchServiceCenterById(
  supabase: SupabaseClient,
  tenantId: string,
  serviceCenterId: string,
) {
  const { data, error } = await supabase
    .from("project_service_centers")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .eq("id", serviceCenterId)
    .maybeSingle<ServiceCenterRow>();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    name: normalizeText(data.name),
  };
}

export async function fetchStockCenterById(
  supabase: SupabaseClient,
  tenantId: string,
  stockCenterId: string,
) {
  const { data, error } = await supabase
    .from("stock_centers")
    .select("id, name, center_type")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("id", stockCenterId)
    .maybeSingle<StockCenterRow>();

  if (error || !data) {
    return null;
  }

  if (String(data.center_type ?? "").trim().toUpperCase() !== "OWN") {
    return null;
  }

  return {
    id: data.id,
    name: normalizeText(data.name),
  };
}

export async function fetchTeamById(
  supabase: SupabaseClient,
  tenantId: string,
  teamId: string,
) {
  const { data, error } = await supabase
    .from("teams")
    .select(
      "id, name, vehicle_plate, service_center_id, stock_center_id, team_type_id, team_category_id, foreman_person_id, supervisor_person_id, ativo, cancellation_reason, canceled_at, canceled_by, created_by, updated_by, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("id", teamId)
    .maybeSingle<TeamRow>();

  if (error || !data) {
    return null;
  }

  return data;
}

export async function fetchExistingTeamByForeman(params: {
  supabase: SupabaseClient;
  tenantId: string;
  foremanId: string;
  excludeTeamId?: string | null;
}) {
  if (!normalizeText(params.foremanId)) {
    return null;
  }

  let query = params.supabase
    .from("teams")
    .select("id, name, foreman_person_id")
    .eq("tenant_id", params.tenantId)
    .eq("foreman_person_id", params.foremanId)
    .eq("ativo", true)
    .limit(1);

  if (params.excludeTeamId) {
    query = query.neq("id", params.excludeTeamId);
  }

  const { data, error } = await query.returns<ExistingTeamByForemanRow[]>();
  if (error || !data || data.length === 0) {
    return null;
  }

  return data[0];
}
