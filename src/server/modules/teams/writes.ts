// Escritas transacionais do modulo Equipes: salvar, ativar/cancelar e permutar
// encarregado. Toda a comunicacao com o banco passa pelas RPCs correspondentes.
//
// Extraido de `src/app/api/teams/route.ts` quando a rota passou do teto de 1.500
// linhas de `route.ts` (CLAUDE.md secao 5).
import { SupabaseClient } from "@supabase/supabase-js";

import { normalizeText } from "@/lib/server/apiHelpers";

import { isMissingFunctionError, mapTeamDbError } from "./errors";
import { fetchExistingTeamByForeman, fetchTeamById } from "./lookups";
import type { HistoryChange, TeamForemanSwapRpcResult, TeamSaveRpcResult } from "./types";

export async function saveTeamViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  teamId: string | null;
  name: string;
  vehiclePlate: string;
  serviceCenterId: string;
  stockCenterId: string | null;
  teamTypeId: string;
  teamCategoryId: string;
  foremanId: string | null;
  supervisorId: string | null;
  changes?: Record<string, HistoryChange>;
  expectedUpdatedAt?: string | null;
}) {
  async function saveTeamDirectFallback() {
    async function createAutomaticStockCenter() {
      const baseName = normalizeText(params.name) || "Equipe";
      const nameCandidates = [
        `EQUIPE - ${baseName}`,
        `EQUIPE - ${baseName} [${Math.random().toString(36).slice(2, 8).toUpperCase()}]`,
      ];

      for (const candidate of nameCandidates) {
        const { data, error } = await params.supabase
          .from("stock_centers")
          .insert({
            tenant_id: params.tenantId,
            name: candidate,
            description: `Centro de estoque proprio da equipe ${baseName}.`,
            is_active: true,
            center_type: "OWN",
            controls_balance: true,
            created_by: params.actorUserId,
            updated_by: params.actorUserId,
          })
          .select("id")
          .maybeSingle<{ id: string }>();

        if (!error && data?.id) {
          return { id: data.id } as const;
        }

        const mappedError = mapTeamDbError(error, "Falha ao criar centro de estoque proprio da equipe.");
        if (mappedError.reason !== "DUPLICATE_TEAM_COMBINATION") {
          if (!String(error?.message ?? "").toLowerCase().includes("duplicate key")) {
            return {
              error: {
                status: mappedError.status,
                message: mappedError.message,
                reason: mappedError.reason,
              },
            } as const;
          }
        }
      }

      return {
        error: {
          status: 500,
          message: "Falha ao criar centro de estoque proprio da equipe.",
          reason: "TEAM_STOCK_CENTER_CREATE_FAILED",
        },
      } as const;
    }

    if (!params.teamId) {
      const { data: createdTeam, error: createError } = await params.supabase
        .from("teams")
        .insert({
          tenant_id: params.tenantId,
          name: params.name,
          vehicle_plate: params.vehiclePlate,
          service_center_id: params.serviceCenterId,
          stock_center_id: params.stockCenterId,
          team_type_id: params.teamTypeId,
          team_category_id: params.teamCategoryId,
          foreman_person_id: params.foremanId,
          supervisor_person_id: params.supervisorId,
          ativo: true,
          cancellation_reason: null,
          canceled_at: null,
          canceled_by: null,
          created_by: params.actorUserId,
          updated_by: params.actorUserId,
        })
        .select("id, updated_at, stock_center_id")
        .maybeSingle<{ id: string; updated_at: string | null; stock_center_id: string | null }>();

      if (createError || !createdTeam?.id) {
        const mappedError = mapTeamDbError(createError, "Falha ao salvar equipe.");
        return {
          ok: false,
          status: mappedError.status,
          message: mappedError.message,
          reason: mappedError.reason,
        } as const;
      }

      let effectiveStockCenterId = createdTeam.stock_center_id;
      if (!effectiveStockCenterId) {
        const stockCenterResult = await createAutomaticStockCenter();
        const stockCenterError = "error" in stockCenterResult ? stockCenterResult.error : null;
        if (stockCenterError) {
          return {
            ok: false,
            status: stockCenterError.status,
            message: stockCenterError.message,
            reason: stockCenterError.reason,
          } as const;
        }

        effectiveStockCenterId = "id" in stockCenterResult ? stockCenterResult.id ?? null : null;
        if (!effectiveStockCenterId) {
          return {
            ok: false,
            status: 500,
            message: "Falha ao criar centro de estoque proprio da equipe.",
            reason: "TEAM_STOCK_CENTER_CREATE_FAILED",
          } as const;
        }

        const { data: updatedTeam, error: updateError } = await params.supabase
          .from("teams")
          .update({
            stock_center_id: effectiveStockCenterId,
            updated_by: params.actorUserId,
          })
          .eq("tenant_id", params.tenantId)
          .eq("id", createdTeam.id)
          .select("updated_at")
          .maybeSingle<{ updated_at: string | null }>();

        if (updateError) {
          const mappedError = mapTeamDbError(updateError, "Falha ao vincular centro de estoque proprio da equipe.");
          return {
            ok: false,
            status: mappedError.status,
            message: mappedError.message,
            reason: mappedError.reason,
          } as const;
        }

        return { ok: true, updatedAt: updatedTeam?.updated_at ?? null } as const;
      }

      return { ok: true, updatedAt: createdTeam.updated_at ?? null } as const;
    }

    let effectiveStockCenterId = params.stockCenterId;
    if (!effectiveStockCenterId) {
      const currentTeam = await fetchTeamById(params.supabase, params.tenantId, params.teamId);
      effectiveStockCenterId = currentTeam?.stock_center_id ?? null;

      if (!effectiveStockCenterId) {
        const stockCenterResult = await createAutomaticStockCenter();
        const stockCenterError = "error" in stockCenterResult ? stockCenterResult.error : null;
        if (stockCenterError) {
          return {
            ok: false,
            status: stockCenterError.status,
            message: stockCenterError.message,
            reason: stockCenterError.reason,
          } as const;
        }

        effectiveStockCenterId = "id" in stockCenterResult ? stockCenterResult.id ?? null : null;
        if (!effectiveStockCenterId) {
          return {
            ok: false,
            status: 500,
            message: "Falha ao criar centro de estoque proprio da equipe.",
            reason: "TEAM_STOCK_CENTER_CREATE_FAILED",
          } as const;
        }
      }
    }

    const { data: updatedTeam, error: updateError } = await params.supabase
      .from("teams")
      .update({
        name: params.name,
        vehicle_plate: params.vehiclePlate,
        service_center_id: params.serviceCenterId,
        stock_center_id: effectiveStockCenterId,
        team_type_id: params.teamTypeId,
        team_category_id: params.teamCategoryId,
        foreman_person_id: params.foremanId,
        supervisor_person_id: params.supervisorId,
        updated_by: params.actorUserId,
      })
      .eq("tenant_id", params.tenantId)
      .eq("id", params.teamId)
      .select("updated_at")
      .maybeSingle<{ updated_at: string | null }>();

    if (updateError) {
      const mappedError = mapTeamDbError(updateError, "Falha ao salvar equipe.");
      return {
        ok: false,
        status: mappedError.status,
        message: mappedError.message,
        reason: mappedError.reason,
      } as const;
    }

    return { ok: true, updatedAt: updatedTeam?.updated_at ?? null } as const;
  }

  const { data, error } = await params.supabase.rpc("save_team_record", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_team_id: params.teamId,
    p_name: params.name,
    p_vehicle_plate: params.vehiclePlate,
    p_service_center_id: params.serviceCenterId,
    p_team_type_id: params.teamTypeId,
    p_team_category_id: params.teamCategoryId,
    p_foreman_person_id: params.foremanId,
    p_stock_center_id: params.stockCenterId,
    p_changes: params.changes ?? {},
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
    p_supervisor_person_id: params.supervisorId,
  });

  if (error) {
    if (isMissingFunctionError(error, "save_team_record")) {
      return saveTeamDirectFallback();
    }

    const mappedError = mapTeamDbError(error, "Falha ao salvar equipe.");
    return {
      ok: false,
      status: mappedError.status,
      message: mappedError.message,
      reason: mappedError.reason,
    } as const;
  }

  const result = (data ?? {}) as TeamSaveRpcResult;
  if (result.success !== true) {
    if (isMissingFunctionError({ message: result.message }, "save_team_record")) {
      return saveTeamDirectFallback();
    }

    return {
      ok: false,
      status: Number(result.status ?? 500),
      message: result.message ?? "Falha ao salvar equipe.",
      reason: result.reason ?? null,
    } as const;
  }

  return { ok: true, updatedAt: result.updated_at ?? null } as const;
}

export async function setTeamStatusViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  teamId: string;
  action: "ACTIVATE" | "CANCEL";
  reason: string;
  foremanId?: string | null;
  expectedUpdatedAt: string | null;
}) {
  async function setTeamStatusDirectFallback() {
    let activateForemanId: string | null = null;

    if (params.action === "ACTIVATE") {
      const currentTeam = await fetchTeamById(params.supabase, params.tenantId, params.teamId);
      if (!currentTeam) {
        return {
          ok: false,
          status: 404,
          message: "Equipe nao encontrada.",
          reason: "TEAM_NOT_FOUND",
        } as const;
      }

      activateForemanId = normalizeText(params.foremanId) || currentTeam.foreman_person_id;

      const existingTeamByForeman = activateForemanId
        ? await fetchExistingTeamByForeman({
            supabase: params.supabase,
            tenantId: params.tenantId,
            foremanId: activateForemanId,
            excludeTeamId: params.teamId,
          })
        : null;

      if (existingTeamByForeman) {
        return {
          ok: false,
          status: 409,
          message: "Ja existe equipe ativa cadastrada para este encarregado. Escolha outro encarregado ou cancele a equipe ativa antes de reativar esta equipe.",
          reason: "DUPLICATE_TEAM_FOREMAN",
        } as const;
      }
    }

    const nowIso = new Date().toISOString();
    const payload = params.action === "ACTIVATE"
      ? {
        ativo: true,
        foreman_person_id: activateForemanId ?? undefined,
        cancellation_reason: null as string | null,
        canceled_at: null as string | null,
        canceled_by: null as string | null,
        updated_by: params.actorUserId,
      }
      : {
        ativo: false,
        cancellation_reason: params.reason,
        canceled_at: nowIso,
        canceled_by: params.actorUserId,
        updated_by: params.actorUserId,
      };

    const { error } = await params.supabase
      .from("teams")
      .update(payload)
      .eq("tenant_id", params.tenantId)
      .eq("id", params.teamId);

    if (error) {
      const mappedError = mapTeamDbError(error, "Falha ao atualizar status da equipe.");
      return {
        ok: false,
        status: mappedError.status,
        message: mappedError.message,
        reason: mappedError.reason,
      } as const;
    }

    return { ok: true, updatedAt: null } as const;
  }

  const { data, error } = await params.supabase.rpc("set_team_record_status", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_team_id: params.teamId,
    p_action: params.action,
    p_reason: params.reason,
    p_expected_updated_at: params.expectedUpdatedAt,
    p_foreman_person_id: params.action === "ACTIVATE" ? (params.foremanId ?? null) : null,
  });

  if (error) {
    if (isMissingFunctionError(error, "set_team_record_status")) {
      return setTeamStatusDirectFallback();
    }

    const mappedError = mapTeamDbError(error, "Falha ao atualizar status da equipe.");
    return {
      ok: false,
      status: mappedError.status,
      message: mappedError.message,
      reason: mappedError.reason,
    } as const;
  }

  const result = (data ?? {}) as TeamSaveRpcResult;
  if (result.success !== true) {
    if (isMissingFunctionError({ message: result.message }, "set_team_record_status")) {
      return setTeamStatusDirectFallback();
    }

    return {
      ok: false,
      status: Number(result.status ?? 500),
      message: result.message ?? "Falha ao atualizar status da equipe.",
      reason: result.reason ?? null,
    } as const;
  }

  return { ok: true, updatedAt: result.updated_at ?? null } as const;
}

export async function swapTeamForemenViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  sourceTeamId: string;
  targetTeamId: string;
  reason: string;
  sourceExpectedUpdatedAt: string | null;
  targetExpectedUpdatedAt: string | null;
}) {
  const { data, error } = await params.supabase.rpc("swap_active_team_foremen", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_source_team_id: params.sourceTeamId,
    p_target_team_id: params.targetTeamId,
    p_reason: params.reason,
    p_source_expected_updated_at: params.sourceExpectedUpdatedAt,
    p_target_expected_updated_at: params.targetExpectedUpdatedAt,
  });

  if (error) {
    if (isMissingFunctionError(error, "swap_active_team_foremen")) {
      return {
        ok: false,
        status: 500,
        message: "RPC swap_active_team_foremen indisponivel no banco. Aplique a migration 205_swap_active_team_foremen.sql.",
        reason: "RPC_MISSING",
      } as const;
    }

    const mappedError = mapTeamDbError(error, "Falha ao permutar encarregados.");
    return {
      ok: false,
      status: mappedError.status,
      message: mappedError.message,
      reason: mappedError.reason,
    } as const;
  }

  const result = (data ?? {}) as TeamForemanSwapRpcResult;
  if (result.success !== true) {
    if (isMissingFunctionError({ message: result.message }, "swap_active_team_foremen")) {
      return {
        ok: false,
        status: 500,
        message: "RPC swap_active_team_foremen indisponivel no banco. Aplique a migration 205_swap_active_team_foremen.sql.",
        reason: "RPC_MISSING",
      } as const;
    }

    return {
      ok: false,
      status: Number(result.status ?? 500),
      message: result.message ?? "Falha ao permutar encarregados.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    sourceUpdatedAt: result.source_updated_at ?? null,
    targetUpdatedAt: result.target_updated_at ?? null,
  } as const;
}
