// Tipos e helpers compartilhados do modulo Equipes.
//
// Extraidos de `src/app/api/teams/route.ts` quando a rota passou de 1.500 linhas
// (teto de `route.ts` no CLAUDE.md secao 5) ao ganhar o Tipo de Equipe.
import { buildNameMap, normalizeText } from "@/lib/server/apiHelpers";

import type { TeamCategoryRow, TeamTypeRow } from "./lookups";

export type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

export type PersonRow = {
  id: string;
  nome: string;
};

export type TeamHistoryRow = {
  id: string;
  change_type: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason: string | null;
  changes: unknown;
  created_at: string;
  created_by: string | null;
};

export type HistoryChange = {
  from: string | null;
  to: string | null;
};

export type CreateTeamPayload = {
  name: string;
  vehiclePlate: string;
  serviceCenterId: string;
  stockCenterId?: string | null;
  teamTypeId: string;
  teamCategoryId: string;
  foremanId?: string | null;
  supervisorId?: string | null;
};

export type UpdateTeamPayload = CreateTeamPayload & {
  id: string;
  expectedUpdatedAt?: string | null;
};

export type UpdateTeamStatusPayload = {
  id: string;
  reason: string;
  action?: "cancel" | "activate" | "swapForeman";
  foremanId?: string;
  targetTeamId?: string;
  expectedUpdatedAt?: string | null;
  targetExpectedUpdatedAt?: string | null;
};

export type TeamSaveRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  team_id?: string;
  updated_at?: string;
};

export type TeamForemanSwapRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  source_team_id?: string;
  target_team_id?: string;
  source_updated_at?: string;
  target_updated_at?: string;
};

export function normalizePlate(value: unknown) {
  return normalizeText(value).toUpperCase();
}

export function buildForemanMap(people: PersonRow[]) {
  return new Map(people.map((person) => [person.id, String(person.nome ?? "").trim() || "Nao identificado"]));
}

export function buildTeamTypeMap(teamTypes: TeamTypeRow[]) {
  return buildNameMap(teamTypes);
}

export function buildTeamCategoryMap(teamCategories: TeamCategoryRow[]) {
  return new Map(
    teamCategories.map((category) => [
      category.id,
      {
        code: normalizeText(category.code).toUpperCase(),
        name: normalizeText(category.name),
      },
    ]),
  );
}

/**
 * Unica fonte da natureza da equipe (migration 420).
 *
 * Ate a 419 valia tambem `team_types.name = 'COMERCIAL'`. Com o Tipo de equipe
 * obrigatorio, esse atalho so criava o caminho em que a tela pedia encarregado
 * (porque olhava a categoria) e o banco apagava o valor (porque olhava o nome
 * do tipo operacional).
 */
export function isCommercialTeamCategory(category: { code: string } | null) {
  return normalizeText(category?.code).toUpperCase() === "COMERCIAL";
}

/**
 * `team_types.team_category_id` e anulavel desde a 416. Quando esta preenchido,
 * o Tipo de equipe da equipe tem que ser o mesmo \u2014 senao a mesma equipe teria
 * duas classificacoes contraditorias.
 */
export function hasTeamTypeCategoryMismatch(
  teamType: { team_category_id?: string | null } | null,
  teamCategory: { id: string } | null,
) {
  const teamTypeCategoryId = normalizeText(teamType?.team_category_id);
  return Boolean(teamTypeCategoryId) && teamTypeCategoryId !== normalizeText(teamCategory?.id);
}

export function isTechnicalTeamCategory(category: { code: string } | null) {
  return normalizeText(category?.code).toUpperCase() === "TECNICA";
}
