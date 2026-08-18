import type { SupabaseClient } from "@supabase/supabase-js";

export type DayForeman = {
  foremanPersonId: string;
  foremanName: string;
  teamId: string;
  teamName: string;
};

type DayCompositionRow = {
  team_id: string;
  team_name_snapshot: string | null;
  foreman_person_id: string | null;
  foreman_name_snapshot: string | null;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Quem respondeu por qual equipe numa data, segundo a Composicao de Equipe.
 *
 * Contrato para telas de outros dominios (ex.: Saida) resolverem a equipe a
 * partir do encarregado do dia sem reimplementar a regra da Composicao. So
 * considera composicao ativa e `WORKING`: equipe que nao atuou nao ocupa o dia
 * do encarregado (migration 374).
 *
 * A unicidade e garantida no banco pelas constraints
 * `team_compositions_foreman_single_team_per_date` e
 * `team_compositions_team_single_foreman_per_date`, entao cada encarregado
 * aparece no maximo uma vez no resultado.
 */
export async function fetchDayForemen(
  supabase: SupabaseClient,
  tenantId: string,
  compositionDate: string,
): Promise<DayForeman[] | null> {
  const { data, error } = await supabase
    .from("team_compositions")
    .select("team_id, team_name_snapshot, foreman_person_id, foreman_name_snapshot")
    .eq("tenant_id", tenantId)
    .eq("composition_date", compositionDate)
    .eq("is_active", true)
    .eq("work_status", "WORKING")
    .not("foreman_person_id", "is", null)
    .order("team_name_snapshot", { ascending: true })
    .returns<DayCompositionRow[]>();

  if (error) {
    return null;
  }

  const seen = new Set<string>();
  const foremen: DayForeman[] = [];

  for (const row of data ?? []) {
    const foremanPersonId = normalizeText(row.foreman_person_id);
    const teamId = normalizeText(row.team_id);
    const foremanName = normalizeText(row.foreman_name_snapshot);

    // Uma equipe pode ter mais de uma composicao ativa na data (projeto principal
    // distinto); o encarregado e o mesmo nas duas por constraint, entao a primeira
    // ocorrencia basta.
    if (!foremanPersonId || !teamId || !foremanName || seen.has(foremanPersonId)) {
      continue;
    }

    seen.add(foremanPersonId);
    foremen.push({
      foremanPersonId,
      foremanName,
      teamId,
      teamName: normalizeText(row.team_name_snapshot),
    });
  }

  return foremen;
}
