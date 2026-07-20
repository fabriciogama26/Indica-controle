import { SupabaseClient } from "@supabase/supabase-js";

import type {
  PersonRow,
  ProgrammingEqCatalogRow,
  ProgrammingReasonCatalogRow,
  ProgrammingSgdTypeRow,
  ProgrammingSupportItemRow,
  ProgrammingWorkCompletionCatalogRow,
  ProjectRow,
  ServiceActivityRow,
  ServiceCenterRow,
  TeamRow,
  TeamTypeRow,
} from "./types";
import { normalizeText } from "./normalizers";

// Dados de catalogo (raramente alterados) usam TTL de 5 min por tenant (guia_backend regra 33).
export const CATALOG_TTL_MS = 5 * 60 * 1000;
type CacheEntry<T> = { data: T; expiresAt: number };

const _projectsCache = new Map<string, CacheEntry<ProjectRow[]>>();
const _teamsCache = new Map<string, CacheEntry<BoardTeamEntry[]>>();
const _sgdTypesCache = new Map<string, CacheEntry<ProgrammingSgdTypeRow[]>>();
const _eqCatalogCache = new Map<string, CacheEntry<ProgrammingEqCatalogRow[]>>();
const _workCompletionCatalogCache = new Map<string, CacheEntry<ProgrammingWorkCompletionCatalogRow[]>>();
const _reasonCatalogCache = new Map<string, CacheEntry<ProgrammingReasonCatalogRow[]>>();
const _supportItemsCache = new Map<string, CacheEntry<ProgrammingSupportItemRow[]>>();

export type BoardTeamEntry = {
  id: string;
  name: string;
  vehiclePlate: string;
  teamTypeName: string;
  foremanName: string;
  serviceCenterName: string;
};

// project.city/service_center/etc. sao FK uuid (migration 038) — o texto exibivel
// vem da view project_with_labels (mesma fonte que o modulo programacao legado usa).
export async function fetchProjects(supabase: SupabaseClient, tenantId: string) {
  const cached = _projectsCache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const { data, error } = await supabase
    .from("project_with_labels")
    .select(
      "id, sob, execution_deadline, city_text, service_center_text, service_type_text, priority_text, partner_text, "
      + "utility_responsible_text, utility_field_manager_text, street, neighborhood, service_description",
    )
    .eq("tenant_id", tenantId)
    .order("sob", { ascending: true })
    .returns<ProjectRow[]>();

  if (error) return [] as ProjectRow[];

  const result = data ?? [];
  _projectsCache.set(tenantId, { data: result, expiresAt: Date.now() + CATALOG_TTL_MS });
  return result;
}

export async function fetchTeams(supabase: SupabaseClient, tenantId: string) {
  const cached = _teamsCache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const { data: teams, error } = await supabase
    .from("teams")
    .select("id, name, vehicle_plate, team_type_id, foreman_person_id, service_center_id, ativo")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .order("name", { ascending: true })
    .returns<TeamRow[]>();

  if (error || !teams?.length) return [] as BoardTeamEntry[];

  const teamTypeIds = Array.from(new Set(teams.map((item) => item.team_type_id).filter(Boolean)));
  const foremanIds = Array.from(new Set(teams.map((item) => item.foreman_person_id).filter(Boolean)));
  const serviceCenterIds = Array.from(new Set(teams.map((item) => item.service_center_id).filter((id): id is string => Boolean(id))));

  const [{ data: teamTypes }, { data: people }, { data: serviceCenters }] = await Promise.all([
    teamTypeIds.length
      ? supabase.from("team_types").select("id, name").eq("tenant_id", tenantId).in("id", teamTypeIds).returns<TeamTypeRow[]>()
      : Promise.resolve({ data: [] as TeamTypeRow[] }),
    foremanIds.length
      ? supabase.from("people").select("id, nome").eq("tenant_id", tenantId).in("id", foremanIds).returns<PersonRow[]>()
      : Promise.resolve({ data: [] as PersonRow[] }),
    serviceCenterIds.length
      ? supabase.from("project_service_centers").select("id, name").eq("tenant_id", tenantId).in("id", serviceCenterIds).returns<ServiceCenterRow[]>()
      : Promise.resolve({ data: [] as ServiceCenterRow[] }),
  ]);

  const teamTypeMap = new Map((teamTypes ?? []).map((item) => [item.id, normalizeText(item.name)]));
  const foremanMap = new Map((people ?? []).map((item) => [item.id, normalizeText(item.nome)]));
  const serviceCenterMap = new Map((serviceCenters ?? []).map((item) => [item.id, normalizeText(item.name)]));

  const result = teams.map((team) => ({
    id: team.id,
    name: normalizeText(team.name),
    vehiclePlate: normalizeText(team.vehicle_plate),
    teamTypeName: teamTypeMap.get(team.team_type_id) ?? "Sem tipo",
    foremanName: foremanMap.get(team.foreman_person_id) ?? "Sem encarregado",
    serviceCenterName: team.service_center_id ? serviceCenterMap.get(team.service_center_id) ?? "Sem base" : "Sem base",
  }));

  _teamsCache.set(tenantId, { data: result, expiresAt: Date.now() + CATALOG_TTL_MS });
  return result;
}

export async function fetchProgrammingSgdTypes(supabase: SupabaseClient, tenantId: string) {
  const cached = _sgdTypesCache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const { data, error } = await supabase
    .from("programming_sgd_types")
    .select("id, description, export_column, is_active")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("description", { ascending: true })
    .returns<ProgrammingSgdTypeRow[]>();

  if (error) return [] as ProgrammingSgdTypeRow[];

  const result = data ?? [];
  _sgdTypesCache.set(tenantId, { data: result, expiresAt: Date.now() + CATALOG_TTL_MS });
  return result;
}

export async function fetchProgrammingEqCatalog(supabase: SupabaseClient, tenantId: string) {
  const cached = _eqCatalogCache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const { data, error } = await supabase
    .from("programming_eq_catalog")
    .select("id, code, label_pt, is_active, sort_order")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .returns<ProgrammingEqCatalogRow[]>();

  if (error) return [] as ProgrammingEqCatalogRow[];

  const result = data ?? [];
  _eqCatalogCache.set(tenantId, { data: result, expiresAt: Date.now() + CATALOG_TTL_MS });
  return result;
}

export async function fetchProgrammingWorkCompletionCatalog(supabase: SupabaseClient, tenantId: string) {
  const cached = _workCompletionCatalogCache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const { data, error } = await supabase
    .from("programming_work_completion_catalog")
    .select("id, code, label_pt, is_active, sort_order")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .returns<ProgrammingWorkCompletionCatalogRow[]>();

  if (error) return [] as ProgrammingWorkCompletionCatalogRow[];

  const result = data ?? [];
  _workCompletionCatalogCache.set(tenantId, { data: result, expiresAt: Date.now() + CATALOG_TTL_MS });
  return result;
}

export async function fetchProgrammingReasonCatalog(supabase: SupabaseClient, tenantId: string) {
  const cached = _reasonCatalogCache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const { data, error } = await supabase
    .from("programming_reason_catalog")
    .select("code, label_pt, requires_notes, is_active, sort_order")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .returns<ProgrammingReasonCatalogRow[]>();

  if (error) return [] as ProgrammingReasonCatalogRow[];

  const result = data ?? [];
  _reasonCatalogCache.set(tenantId, { data: result, expiresAt: Date.now() + CATALOG_TTL_MS });
  return result;
}

export async function fetchProgrammingSupportItems(supabase: SupabaseClient, tenantId: string) {
  const cached = _supportItemsCache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const { data, error } = await supabase
    .from("programming_support_items")
    .select("id, description, is_active")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("description", { ascending: true })
    .returns<ProgrammingSupportItemRow[]>();

  if (error) return [] as ProgrammingSupportItemRow[];

  const result = data ?? [];
  _supportItemsCache.set(tenantId, { data: result, expiresAt: Date.now() + CATALOG_TTL_MS });
  return result;
}

export async function fetchServiceActivitiesByIds(supabase: SupabaseClient, tenantId: string, ids: string[]) {
  if (!ids.length) return [] as ServiceActivityRow[];

  const { data, error } = await supabase
    .from("service_activities")
    .select("id, code, description, unit, ativo")
    .eq("tenant_id", tenantId)
    .in("id", ids)
    .returns<ServiceActivityRow[]>();

  if (error) return [] as ServiceActivityRow[];

  return data ?? [];
}
