import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";

import { fetchPagedSupabaseRows } from "./queries";
import { normalizeText } from "./normalizers";

type MeasurementTeamCategoryCode = "TECNICA" | "COMERCIAL";

type TeamModeTeamRow = {
  id: string;
  team_type_id: string | null;
  team_category_id: string | null;
};

type TeamModeTypeRow = {
  id: string;
  name: string | null;
};

type TeamModeCategoryRow = {
  id: string;
  code: string | null;
  name: string | null;
};

function normalizeModeToken(value: string | null | undefined) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function isCommercialName(value: string | null | undefined) {
  return normalizeModeToken(value) === "COMERCIAL";
}

function isCommercialTeamReference(params: {
  teamTypeId: string | null;
  teamCategoryId: string | null;
  commercialTeamTypeIds: Set<string>;
  commercialTeamCategoryIds: Set<string>;
}) {
  return (
    Boolean(params.teamTypeId && params.commercialTeamTypeIds.has(params.teamTypeId))
    || Boolean(params.teamCategoryId && params.commercialTeamCategoryIds.has(params.teamCategoryId))
  );
}

async function fetchCommercialTeamTypeIds(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
}) {
  const { data, error } = await params.supabase
    .from("team_types")
    .select("id, name")
    .eq("tenant_id", params.tenantId)
    .eq("ativo", true)
    .returns<TeamModeTypeRow[]>();

  if (error) {
    return new Set<string>();
  }

  return new Set((data ?? []).filter((item) => isCommercialName(item.name)).map((item) => item.id));
}

async function fetchCommercialTeamCategoryIds(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
}) {
  const { data, error } = await params.supabase
    .from("team_categories")
    .select("id, code, name")
    .eq("tenant_id", params.tenantId)
    .eq("ativo", true)
    .returns<TeamModeCategoryRow[]>();

  if (error) {
    return new Set<string>();
  }

  return new Set(
    (data ?? [])
      .filter((item) => isCommercialName(item.code) || isCommercialName(item.name))
      .map((item) => item.id),
  );
}

export async function resolveTeamMeasurementMode(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  teamId: string;
}): Promise<MeasurementTeamCategoryCode | null> {
  const [teamResult, commercialTeamTypeIds, commercialTeamCategoryIds] = await Promise.all([
    params.supabase
      .from("teams")
      .select("team_type_id, team_category_id")
      .eq("tenant_id", params.tenantId)
      .eq("id", params.teamId)
      .maybeSingle<{ team_type_id: string | null; team_category_id: string | null }>(),
    fetchCommercialTeamTypeIds(params),
    fetchCommercialTeamCategoryIds(params),
  ]);

  if (teamResult.error || !teamResult.data) {
    return null;
  }

  return isCommercialTeamReference({
    teamTypeId: teamResult.data.team_type_id,
    teamCategoryId: teamResult.data.team_category_id,
    commercialTeamTypeIds,
    commercialTeamCategoryIds,
  })
    ? "COMERCIAL"
    : "TECNICA";
}

export async function fetchTeamIdsByMeasurementMode(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  mode: MeasurementTeamCategoryCode;
  activeOnly?: boolean;
}) {
  const [commercialTeamTypeIds, commercialTeamCategoryIds, teamsResult] = await Promise.all([
    fetchCommercialTeamTypeIds(params),
    fetchCommercialTeamCategoryIds(params),
    fetchPagedSupabaseRows<TeamModeTeamRow>((from, to) => {
      let query = params.supabase
        .from("teams")
        .select("id, team_type_id, team_category_id")
        .eq("tenant_id", params.tenantId)
        .range(from, to);

      if (params.activeOnly) {
        query = query.eq("ativo", true);
      }

      return query.returns<TeamModeTeamRow[]>();
    }),
  ]);

  if (teamsResult.error) {
    return { ok: false as const, message: "Falha ao filtrar equipes por tipo operacional." };
  }

  const ids = teamsResult.data
    .filter((team) => {
      const commercial = isCommercialTeamReference({
        teamTypeId: team.team_type_id,
        teamCategoryId: team.team_category_id,
        commercialTeamTypeIds,
        commercialTeamCategoryIds,
      });
      return params.mode === "COMERCIAL" ? commercial : !commercial;
    })
    .map((team) => team.id);

  return { ok: true as const, ids };
}
