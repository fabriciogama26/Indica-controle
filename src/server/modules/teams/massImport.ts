// Importacao em massa de equipes (cadastro em lote da tela Equipes).
//
// Extraido de `src/app/api/teams/route.ts` quando a rota passou do teto de 1.500
// linhas de `route.ts` (CLAUDE.md secao 5).
import { SupabaseClient } from "@supabase/supabase-js";

import { normalizeText } from "@/lib/server/apiHelpers";

import {
  fetchExistingTeamByForeman,
  fetchForemanById,
  fetchServiceCenterById,
  fetchSupervisorById,
  fetchTeamCategoryById,
  fetchTeamTypeById,
  type TeamCategoryRow,
} from "./lookups";
import {
  isCommercialTeamCategory,
  isTechnicalTeamCategory,
  normalizePlate,
  type CreateTeamPayload,
} from "./types";
import { saveTeamViaRpc } from "./writes";

export type TeamBatchImportRow = Partial<CreateTeamPayload> & { rowNumber?: number };

export type TeamBatchImportPayload = {
  action?: "BATCH_IMPORT";
  rows?: TeamBatchImportRow[];
};

export async function importTeamBatch(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  rows: TeamBatchImportRow[];
}) {
  const results: Array<{ rowNumber: number; success: boolean; message: string; code?: string }> = [];
  const validServiceCenterIds = new Map<string, boolean>();
  const validTeamTypeIds = new Map<string, boolean>();
  const validTeamCategoryIds = new Map<string, TeamCategoryRow | null>();
  let savedCount = 0;

  for (const [index, row] of params.rows.entries()) {
    const rowNumber = Number.isInteger(Number(row.rowNumber)) && Number(row.rowNumber) > 0 ? Number(row.rowNumber) : index + 2;
    const input = {
      name: normalizeText(row.name),
      vehiclePlate: normalizePlate(row.vehiclePlate),
      serviceCenterId: normalizeText(row.serviceCenterId),
      teamTypeId: normalizeText(row.teamTypeId),
      teamCategoryId: normalizeText(row.teamCategoryId),
      foremanId: normalizeText(row.foremanId) || null,
      supervisorId: normalizeText(row.supervisorId) || null,
    };

    if (!input.name || !input.vehiclePlate || !input.serviceCenterId || !input.teamTypeId || !input.teamCategoryId) {
      results.push({
        rowNumber,
        success: false,
        message: "Preencha todos os campos obrigatorios da equipe.",
        code: "MISSING_REQUIRED_FIELDS",
      });
      continue;
    }

    if (!validServiceCenterIds.has(input.serviceCenterId)) {
      validServiceCenterIds.set(
        input.serviceCenterId,
        Boolean(await fetchServiceCenterById(params.supabase, params.tenantId, input.serviceCenterId)),
      );
    }

    if (!validServiceCenterIds.get(input.serviceCenterId)) {
      results.push({ rowNumber, success: false, message: "Base invalida para o tenant atual.", code: "INVALID_SERVICE_CENTER" });
      continue;
    }

    if (!validTeamTypeIds.has(input.teamTypeId)) {
      validTeamTypeIds.set(
        input.teamTypeId,
        Boolean(await fetchTeamTypeById(params.supabase, params.tenantId, input.teamTypeId)),
      );
    }

    if (!validTeamTypeIds.get(input.teamTypeId)) {
      results.push({ rowNumber, success: false, message: "Tipo de equipe invalido para o tenant atual.", code: "INVALID_TEAM_TYPE" });
      continue;
    }

    if (!validTeamCategoryIds.has(input.teamCategoryId)) {
      validTeamCategoryIds.set(
        input.teamCategoryId,
        await fetchTeamCategoryById(params.supabase, params.tenantId, input.teamCategoryId),
      );
    }

    const teamCategory = validTeamCategoryIds.get(input.teamCategoryId) ?? null;
    if (!teamCategory) {
      results.push({ rowNumber, success: false, message: "Tipo de equipe invalido para o tenant atual.", code: "INVALID_TEAM_CATEGORY" });
      continue;
    }

    if (isTechnicalTeamCategory(teamCategory) && !input.foremanId) {
      results.push({ rowNumber, success: false, message: "Encarregado e obrigatorio para equipe tecnica.", code: "MISSING_FOREMAN" });
      continue;
    }

    if (isCommercialTeamCategory(teamCategory) && !input.supervisorId) {
      results.push({ rowNumber, success: false, message: "Supervisor e obrigatorio para equipe comercial.", code: "MISSING_SUPERVISOR" });
      continue;
    }

    if (input.foremanId && !(await fetchForemanById(params.supabase, params.tenantId, input.foremanId))) {
      results.push({ rowNumber, success: false, message: "Encarregado invalido para o tenant atual.", code: "INVALID_FOREMAN" });
      continue;
    }

    if (input.supervisorId && !(await fetchSupervisorById(params.supabase, params.tenantId, input.supervisorId))) {
      results.push({ rowNumber, success: false, message: "Supervisor invalido para o tenant atual.", code: "INVALID_SUPERVISOR" });
      continue;
    }

    const existingTeamByForeman = input.foremanId
      ? await fetchExistingTeamByForeman({
          supabase: params.supabase,
          tenantId: params.tenantId,
          foremanId: input.foremanId,
          excludeTeamId: null,
        })
      : null;

    if (existingTeamByForeman) {
      results.push({
        rowNumber,
        success: false,
        message: "Ja existe equipe ativa cadastrada para este encarregado. Selecione outro encarregado.",
        code: "FOREMAN_ALREADY_LINKED",
      });
      continue;
    }

    const saveResult = await saveTeamViaRpc({
      supabase: params.supabase,
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      teamId: null,
      name: input.name,
      vehiclePlate: input.vehiclePlate,
      serviceCenterId: input.serviceCenterId,
      stockCenterId: null,
      teamTypeId: input.teamTypeId,
      teamCategoryId: input.teamCategoryId,
      foremanId: input.foremanId,
      supervisorId: input.supervisorId,
    });

    if (!saveResult.ok) {
      results.push({ rowNumber, success: false, message: saveResult.message, code: saveResult.reason ?? undefined });
      continue;
    }

    savedCount += 1;
    results.push({ rowNumber, success: true, message: `Equipe ${input.name} cadastrada com sucesso.` });
  }

  return {
    success: true,
    savedCount,
    errorCount: results.filter((result) => !result.success).length,
    results,
  };
}
