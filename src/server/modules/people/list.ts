import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import {
  buildNameMap,
  buildUserDisplayMap,
  buildUserLoginNameMap,
  fetchTenantLinkedAppUsers,
  type AppUserAuditLookupRow,
} from "@/lib/server/apiHelpers";

export type PeopleRow = {
  id: string;
  nome: string;
  matriculation: string | null;
  cpf: string | null;
  phone: string | null;
  job_title_id: string;
  job_title_type_id: string | null;
  job_level: string | null;
  ativo: boolean;
  cancellation_reason: string | null;
  canceled_at: string | null;
  canceled_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PersonListItem = {
  id: string;
  name: string;
  matriculation: string | null;
  cpf: string | null;
  phone: string | null;
  jobTitleId: string;
  jobTitleName: string;
  jobTitleTypeId: string | null;
  jobTitleTypeName: string | null;
  jobLevel: string | null;
  isActive: boolean;
  cancellationReason: string | null;
  canceledAt: string | null;
  canceledByName: string | null;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

type JobTitleRow = { id: string; code: string; name: string };
type JobTitleTypeRow = { id: string; job_title_id: string; name: string };

export type PeopleListFilters = {
  tenantId: string;
  name: string;
  matriculation: string;
  cpf: string;
  phone: string;
  jobTitleId: string;
  jobTitleTypeId: string;
  jobLevel: string;
  status: string;
  matriculationMatchMode?: "contains" | "exact";
};

const PEOPLE_SELECT_COLUMNS =
  "id, nome, matriculation, cpf, phone, job_title_id, job_title_type_id, job_level, ativo, cancellation_reason, canceled_at, canceled_by, created_by, updated_by, created_at, updated_at";

export function listPeopleRows(params: {
  supabase: SupabaseClient;
  filters: PeopleListFilters;
  from: number;
  to: number;
  withCount?: boolean;
}): PromiseLike<{ data: PeopleRow[] | null; error: PostgrestError | null; count?: number | null }> {
  const { supabase, filters, from, to, withCount } = params;
  const matriculationMatchMode = filters.matriculationMatchMode ?? "contains";

  let query = supabase
    .from("people")
    .select(PEOPLE_SELECT_COLUMNS, withCount ? { count: "exact" } : undefined)
    .eq("tenant_id", filters.tenantId);

  if (filters.name) {
    query = query.ilike("nome", `%${filters.name}%`);
  }

  if (filters.matriculation) {
    query = matriculationMatchMode === "exact"
      ? query.eq("matriculation", filters.matriculation)
      : query.ilike("matriculation", `%${filters.matriculation}%`);
  }

  if (filters.cpf) {
    query = query.ilike("cpf", `%${filters.cpf}%`);
  }

  if (filters.phone) {
    query = query.ilike("phone", `%${filters.phone}%`);
  }

  if (filters.jobTitleId) {
    query = query.eq("job_title_id", filters.jobTitleId);
  }

  if (filters.jobTitleTypeId) {
    query = query.eq("job_title_type_id", filters.jobTitleTypeId);
  }

  if (filters.jobLevel) {
    query = query.eq("job_level", filters.jobLevel);
  }

  if (filters.status === "ativo") {
    query = query.eq("ativo", true);
  } else if (filters.status === "inativo") {
    query = query.eq("ativo", false);
  }

  return query
    .order("ativo", { ascending: false })
    .order("nome", { ascending: true })
    .range(from, to)
    .returns<PeopleRow[]>();
}

/**
 * Resolve nomes de cargo/tipo/usuario para as linhas ja carregadas, em lote
 * (uma consulta por catalogo para o conjunto inteiro, nao uma por linha).
 */
export async function enrichPeopleRows(params: {
  supabase: SupabaseClient;
  tenantId: string;
  rows: PeopleRow[];
}): Promise<PersonListItem[]> {
  const { supabase, tenantId, rows } = params;

  const userIds = Array.from(
    new Set(
      rows
        .flatMap((item) => [item.created_by, item.updated_by, item.canceled_by])
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const jobTitleIds = Array.from(
    new Set(rows.map((item) => item.job_title_id).filter((value): value is string => Boolean(value))),
  );
  const jobTitleTypeIds = Array.from(
    new Set(rows.map((item) => item.job_title_type_id).filter((value): value is string => Boolean(value))),
  );

  const users = await fetchTenantLinkedAppUsers<AppUserAuditLookupRow>(supabase, tenantId, userIds);

  let jobTitles: JobTitleRow[] = [];
  if (jobTitleIds.length > 0) {
    const jobTitlesResult = await supabase
      .from("job_titles")
      .select("id, code, name")
      .eq("tenant_id", tenantId)
      .in("id", jobTitleIds)
      .returns<JobTitleRow[]>();

    if (!jobTitlesResult.error) {
      jobTitles = jobTitlesResult.data ?? [];
    }
  }

  let jobTitleTypes: JobTitleTypeRow[] = [];
  if (jobTitleTypeIds.length > 0) {
    const jobTitleTypesResult = await supabase
      .from("job_title_types")
      .select("id, name, job_title_id")
      .eq("tenant_id", tenantId)
      .in("id", jobTitleTypeIds)
      .returns<JobTitleTypeRow[]>();

    if (!jobTitleTypesResult.error) {
      jobTitleTypes = jobTitleTypesResult.data ?? [];
    }
  }

  const userDisplayMap = buildUserDisplayMap(users);
  const userLoginNameMap = buildUserLoginNameMap(users);
  const jobTitleMap = buildNameMap(jobTitles);
  const jobTitleTypeMap = buildNameMap(jobTitleTypes);

  return rows.map((row) => ({
    id: row.id,
    name: row.nome,
    matriculation: row.matriculation,
    cpf: row.cpf,
    phone: row.phone,
    jobTitleId: row.job_title_id,
    jobTitleName: jobTitleMap.get(row.job_title_id) ?? "Nao identificado",
    jobTitleTypeId: row.job_title_type_id,
    jobTitleTypeName: row.job_title_type_id
      ? jobTitleTypeMap.get(row.job_title_type_id) ?? "Nao identificado"
      : null,
    jobLevel: row.job_level,
    isActive: Boolean(row.ativo),
    cancellationReason: row.cancellation_reason,
    canceledAt: row.canceled_at,
    canceledByName: row.canceled_by ? userDisplayMap.get(row.canceled_by) ?? "Nao identificado" : null,
    createdByName: row.created_by ? userLoginNameMap.get(row.created_by) ?? "Nao identificado" : "Nao identificado",
    updatedByName: row.updated_by ? userDisplayMap.get(row.updated_by) ?? "Nao identificado" : "Nao identificado",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
