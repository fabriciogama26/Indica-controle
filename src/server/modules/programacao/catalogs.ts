import { SupabaseClient } from "@supabase/supabase-js";

import {
  BOARD_PROJECT_SELECT_LEGACY,
  BOARD_PROJECT_SELECT_WITH_TEST,
} from "./selects";
import type {
  BoardProjectBaseRow,
  BoardProjectRow,
  LocationPlanSupportRow,
  PersonRow,
  ProgrammingEqCatalogRow,
  ProgrammingReasonCatalogRow,
  ProgrammingSgdTypeRow,
  ProgrammingWorkCompletionCatalogRow,
  ServiceCenterRow,
  SupportOptionRow,
  TeamRow,
  TeamTypeRow,
} from "./types";
import {
  isMissingProjectTestColumn,
  normalizeQuestionnaireAnswers,
  normalizeStringArray,
  normalizeText,
} from "./normalizers";

export const CATALOG_TTL_MS = 5 * 60 * 1000;
export type CatalogCacheEntry<T> = { data: T; expiresAt: number };

export type BoardTeamEntry = {
  id: string;
  name: string;
  vehiclePlate: string;
  serviceCenterId: string | null;
  serviceCenterName: string;
  teamTypeName: string;
  foremanName: string;
};

const _sgdTypesCache = new Map<string, CatalogCacheEntry<ProgrammingSgdTypeRow[]>>();
const _eqCatalogCache = new Map<string, CatalogCacheEntry<ProgrammingEqCatalogRow[]>>();
const _reasonCatalogCache = new Map<string, CatalogCacheEntry<ProgrammingReasonCatalogRow[]>>();
const _workCompletionCatalogCache = new Map<string, CatalogCacheEntry<ProgrammingWorkCompletionCatalogRow[]>>();
const _boardTeamsCache = new Map<string, CatalogCacheEntry<BoardTeamEntry[]>>();
const _boardProjectsCache = new Map<string, CatalogCacheEntry<BoardProjectRow[]>>();

export async function fetchProjects(supabase: SupabaseClient, tenantId: string) {
  const cached = _boardProjectsCache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const primary = await supabase
    .from("project_with_labels")
    .select(BOARD_PROJECT_SELECT_WITH_TEST)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("is_test", false)
    .order("execution_deadline", { ascending: true })
    .returns<BoardProjectBaseRow[]>();

  if (!primary.error) {
    const result = (primary.data ?? []).map((item) => ({
      ...item,
      is_test: Boolean(item.is_test),
    })) as BoardProjectRow[];
    _boardProjectsCache.set(tenantId, { data: result, expiresAt: Date.now() + CATALOG_TTL_MS });
    return result;
  }

  if (!isMissingProjectTestColumn(primary.error.message ?? "")) {
    return [] as BoardProjectRow[];
  }

  const fallback = await supabase
    .from("project_with_labels")
    .select(BOARD_PROJECT_SELECT_LEGACY)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("execution_deadline", { ascending: true })
    .returns<BoardProjectBaseRow[]>();

  if (fallback.error) {
    return [] as BoardProjectRow[];
  }

  const result = (fallback.data ?? []).map((item) => ({
    ...item,
    is_test: false,
  })) as BoardProjectRow[];
  _boardProjectsCache.set(tenantId, { data: result, expiresAt: Date.now() + CATALOG_TTL_MS });
  return result;
}

export async function fetchTeams(supabase: SupabaseClient, tenantId: string) {
  const cached = _boardTeamsCache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const { data: teams, error } = await supabase
    .from("teams")
    .select("id, name, vehicle_plate, service_center_id, team_type_id, foreman_person_id, ativo")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .order("name", { ascending: true })
    .returns<TeamRow[]>();

  if (error || !teams?.length) {
    return [] as BoardTeamEntry[];
  }

  const teamTypeIds = Array.from(new Set(teams.map((item) => item.team_type_id).filter(Boolean)));
  const foremanIds = Array.from(new Set(teams.map((item) => item.foreman_person_id).filter(Boolean)));
  const serviceCenterIds = Array.from(new Set(teams.map((item) => item.service_center_id).filter(Boolean)));

  const [{ data: teamTypes }, { data: people }, { data: serviceCenters }] = await Promise.all([
    teamTypeIds.length
      ? supabase
          .from("team_types")
          .select("id, name")
          .eq("tenant_id", tenantId)
          .in("id", teamTypeIds)
          .returns<TeamTypeRow[]>()
      : Promise.resolve({ data: [] as TeamTypeRow[] }),
    foremanIds.length
      ? supabase
          .from("people")
          .select("id, nome")
          .eq("tenant_id", tenantId)
          .in("id", foremanIds)
          .returns<PersonRow[]>()
      : Promise.resolve({ data: [] as PersonRow[] }),
    serviceCenterIds.length
      ? supabase
          .from("project_service_centers")
          .select("id, name")
          .eq("tenant_id", tenantId)
          .in("id", serviceCenterIds)
          .returns<ServiceCenterRow[]>()
      : Promise.resolve({ data: [] as ServiceCenterRow[] }),
  ]);

  const teamTypeMap = new Map((teamTypes ?? []).map((item) => [item.id, normalizeText(item.name)]));
  const foremanMap = new Map((people ?? []).map((item) => [item.id, normalizeText(item.nome)]));
  const serviceCenterMap = new Map((serviceCenters ?? []).map((item) => [item.id, normalizeText(item.name)]));

  const result = teams.map((team) => ({
    id: team.id,
    name: normalizeText(team.name),
    vehiclePlate: normalizeText(team.vehicle_plate),
    serviceCenterId: team.service_center_id,
    serviceCenterName: team.service_center_id ? serviceCenterMap.get(team.service_center_id) ?? "Sem base" : "Sem base",
    teamTypeName: teamTypeMap.get(team.team_type_id) ?? "Sem tipo",
    foremanName: foremanMap.get(team.foreman_person_id) ?? "Sem encarregado",
  }));

  _boardTeamsCache.set(tenantId, { data: result, expiresAt: Date.now() + CATALOG_TTL_MS });
  return result;
}

export async function fetchTeamsByIds(supabase: SupabaseClient, tenantId: string, teamIds: string[]) {
  if (!teamIds.length) {
    return [] as BoardTeamEntry[];
  }

  const { data: teams, error } = await supabase
    .from("teams")
    .select("id, name, vehicle_plate, service_center_id, team_type_id, foreman_person_id, ativo")
    .eq("tenant_id", tenantId)
    .in("id", teamIds)
    .returns<TeamRow[]>();

  if (error || !teams?.length) {
    return [] as BoardTeamEntry[];
  }

  const teamTypeIds = Array.from(new Set(teams.map((item) => item.team_type_id).filter(Boolean)));
  const foremanIds = Array.from(new Set(teams.map((item) => item.foreman_person_id).filter(Boolean)));
  const serviceCenterIds = Array.from(new Set(teams.map((item) => item.service_center_id).filter(Boolean)));

  const [{ data: teamTypes }, { data: people }, { data: serviceCenters }] = await Promise.all([
    teamTypeIds.length
      ? supabase
          .from("team_types")
          .select("id, name")
          .eq("tenant_id", tenantId)
          .in("id", teamTypeIds)
          .returns<TeamTypeRow[]>()
      : Promise.resolve({ data: [] as TeamTypeRow[] }),
    foremanIds.length
      ? supabase
          .from("people")
          .select("id, nome")
          .eq("tenant_id", tenantId)
          .in("id", foremanIds)
          .returns<PersonRow[]>()
      : Promise.resolve({ data: [] as PersonRow[] }),
    serviceCenterIds.length
      ? supabase
          .from("project_service_centers")
          .select("id, name")
          .eq("tenant_id", tenantId)
          .in("id", serviceCenterIds)
          .returns<ServiceCenterRow[]>()
      : Promise.resolve({ data: [] as ServiceCenterRow[] }),
  ]);

  const teamTypeMap = new Map((teamTypes ?? []).map((item) => [item.id, normalizeText(item.name)]));
  const foremanMap = new Map((people ?? []).map((item) => [item.id, normalizeText(item.nome)]));
  const serviceCenterMap = new Map((serviceCenters ?? []).map((item) => [item.id, normalizeText(item.name)]));

  return teams.map((team) => ({
    id: team.id,
    name: normalizeText(team.name),
    vehiclePlate: normalizeText(team.vehicle_plate),
    serviceCenterId: team.service_center_id,
    serviceCenterName: team.service_center_id ? serviceCenterMap.get(team.service_center_id) ?? "Sem base" : "Sem base",
    teamTypeName: teamTypeMap.get(team.team_type_id) ?? "Sem tipo",
    foremanName: foremanMap.get(team.foreman_person_id) ?? "Sem encarregado",
  }));
}

export async function fetchSupportOptions(supabase: SupabaseClient, tenantId: string) {
  const { data, error } = await supabase
    .from("programming_support_items")
    .select("id, description, location_support_item_id, is_active")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("description", { ascending: true })
    .returns<SupportOptionRow[]>();

  if (error) {
    return [] as SupportOptionRow[];
  }

  return data ?? [];
}

export async function fetchProjectSupportDefaults(params: {
  supabase: SupabaseClient;
  tenantId: string;
  projectIds: string[];
  supportOptions: SupportOptionRow[];
}) {
  if (!params.projectIds.length || !params.supportOptions.length) {
    return new Map<string, { supportItemId: string; supportLabel: string }>();
  }

  const linkedTransitOption =
    params.supportOptions.find((item) => item.location_support_item_id === "90e570df-732f-43dd-9851-8fd8178ce1fc") ?? null;

  if (!linkedTransitOption) {
    return new Map<string, { supportItemId: string; supportLabel: string }>();
  }

  const { data, error } = await params.supabase
    .from("project_location_plans")
    .select("project_id, questionnaire_answers")
    .eq("tenant_id", params.tenantId)
    .in("project_id", params.projectIds)
    .returns<LocationPlanSupportRow[]>();

  if (error) {
    return new Map<string, { supportItemId: string; supportLabel: string }>();
  }

  const defaults = new Map<string, { supportItemId: string; supportLabel: string }>();
  for (const plan of data ?? []) {
    const questionnaireAnswers = normalizeQuestionnaireAnswers(plan.questionnaire_answers);
    const executionForecast = normalizeQuestionnaireAnswers(questionnaireAnswers.executionForecast);
    const removedSupportItemIds = new Set(normalizeStringArray(executionForecast.removedSupportItemIds));

    if (!removedSupportItemIds.has("90e570df-732f-43dd-9851-8fd8178ce1fc")) {
      defaults.set(plan.project_id, {
        supportItemId: linkedTransitOption.id,
        supportLabel: normalizeText(linkedTransitOption.description),
      });
    }
  }

  return defaults;
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

  if (error) {
    return [] as ProgrammingSgdTypeRow[];
  }

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
    .order("label_pt", { ascending: true })
    .returns<ProgrammingEqCatalogRow[]>();

  if (error) {
    return [] as ProgrammingEqCatalogRow[];
  }

  const result = data ?? [];
  _eqCatalogCache.set(tenantId, { data: result, expiresAt: Date.now() + CATALOG_TTL_MS });
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
    .order("label_pt", { ascending: true })
    .returns<ProgrammingReasonCatalogRow[]>();

  if (error) {
    return [] as ProgrammingReasonCatalogRow[];
  }

  const result = data ?? [];
  _reasonCatalogCache.set(tenantId, { data: result, expiresAt: Date.now() + CATALOG_TTL_MS });
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
    .order("label_pt", { ascending: true })
    .returns<ProgrammingWorkCompletionCatalogRow[]>();

  if (error) {
    return [] as ProgrammingWorkCompletionCatalogRow[];
  }

  const result = data ?? [];
  _workCompletionCatalogCache.set(tenantId, { data: result, expiresAt: Date.now() + CATALOG_TTL_MS });
  return result;
}
