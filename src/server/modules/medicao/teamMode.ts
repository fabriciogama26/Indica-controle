import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";

import { fetchPagedSupabaseRows } from "./queries";
import { normalizeText } from "./normalizers";

type MeasurementTeamCategoryCode = "TECNICA" | "COMERCIAL";

type TeamModeTeamRow = {
  id: string;
  team_category_id: string | null;
};

type TeamModeCategoryRow = {
  id: string;
  code: string | null;
};

function normalizeCategoryCode(value: string | null | undefined) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

/**
 * Unica fonte da natureza da equipe: `teams.team_category_id`.
 *
 * Ate a 419 valiam tres fontes para a mesma pergunta ("esta equipe e comercial?"):
 * `team_types.name = 'COMERCIAL'`, `team_types.team_category_id` e
 * `teams.team_category_id`. A 420 fechou isso -- `teams.team_category_id` virou
 * NOT NULL, o trigger recusa divergencia com a classificacao do tipo operacional
 * e o atalho por nome saiu da RPC. Mesma regra de `isCommercialTeamCategory` em
 * `src/server/modules/teams/types.ts`.
 *
 * O recorte e POSITIVO nos dois lados: TECNICA e a equipe cuja categoria e
 * TECNICA, nao "tudo que nao e comercial". Equipe sem categoria resolvivel nao
 * entra em nenhuma das duas telas em vez de cair na tecnica por omissao.
 *
 * A leitura do catalogo NAO filtra por `ativo`: aqui ele serve para classificar
 * equipe que ja existe, e desativar a linha do catalogo tiraria a equipe das duas
 * telas de Medicao em vez de move-la de lado.
 */
async function fetchTeamCategoryCodesById(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
}) {
  const { data, error } = await params.supabase
    .from("team_categories")
    .select("id, code")
    .eq("tenant_id", params.tenantId)
    .returns<TeamModeCategoryRow[]>();

  if (error) {
    return { ok: false as const, message: "Falha ao carregar os tipos de equipe (TECNICA/COMERCIAL) do tenant." };
  }

  const codes = new Map<string, MeasurementTeamCategoryCode>();
  for (const item of data ?? []) {
    const code = normalizeCategoryCode(item.code);
    if (code === "TECNICA" || code === "COMERCIAL") {
      codes.set(item.id, code);
    }
  }

  return { ok: true as const, codes };
}

export async function resolveTeamMeasurementMode(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  teamId: string;
}): Promise<MeasurementTeamCategoryCode | null> {
  const [teamResult, categoryResult] = await Promise.all([
    params.supabase
      .from("teams")
      .select("team_category_id")
      .eq("tenant_id", params.tenantId)
      .eq("id", params.teamId)
      .maybeSingle<{ team_category_id: string | null }>(),
    fetchTeamCategoryCodesById(params),
  ]);

  if (teamResult.error || !teamResult.data || !categoryResult.ok) {
    return null;
  }

  const teamCategoryId = teamResult.data.team_category_id;
  if (!teamCategoryId) {
    return null;
  }

  return categoryResult.codes.get(teamCategoryId) ?? null;
}

export async function fetchTeamIdsByMeasurementMode(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  mode: MeasurementTeamCategoryCode;
  activeOnly?: boolean;
}) {
  const [categoryResult, teamsResult] = await Promise.all([
    fetchTeamCategoryCodesById(params),
    fetchPagedSupabaseRows<TeamModeTeamRow>((from, to) => {
      let query = params.supabase
        .from("teams")
        .select("id, team_category_id")
        .eq("tenant_id", params.tenantId)
        .order("id", { ascending: true })
        .range(from, to);

      if (params.activeOnly) {
        query = query.eq("ativo", true);
      }

      return query.returns<TeamModeTeamRow[]>();
    }),
  ]);

  if (!categoryResult.ok) {
    return { ok: false as const, message: categoryResult.message };
  }

  if (teamsResult.error) {
    return { ok: false as const, message: "Falha ao filtrar equipes por tipo de equipe (TECNICA/COMERCIAL)." };
  }

  const ids = teamsResult.data
    .filter((team) => (team.team_category_id ? categoryResult.codes.get(team.team_category_id) === params.mode : false))
    .map((team) => team.id);

  return { ok: true as const, ids };
}
