import { SupabaseClient } from "@supabase/supabase-js";

import { isMissingRpcFunctionError, normalizeText } from "./normalizers";
import type { ProgrammingRpcResult } from "./types";

function missingRpcResult(rpcName: string) {
  return {
    ok: false as const,
    status: 409,
    reason: "RPC_NOT_AVAILABLE",
    message: `Seu ambiente ainda nao tem a funcao ${rpcName} aplicada. Aplique as migrations 310/311.`,
  };
}

function failedRpcResult(rpcName: string, errorMessage: string | undefined) {
  return {
    ok: false as const,
    status: 500,
    reason: "RPC_FAILED",
    message: errorMessage ? `Falha ao chamar ${rpcName}: ${errorMessage}` : `Falha ao chamar ${rpcName}.`,
  };
}

function failedResultFromPayload(result: ProgrammingRpcResult) {
  return {
    ok: false as const,
    status: Number(result.status ?? 400),
    reason: result.reason ?? null,
    detail: result.detail ?? null,
    message: result.message ?? "Falha ao processar a operacao.",
    currentUpdatedAt: result.currentUpdatedAt ?? null,
  };
}

export async function saveProgrammingStageViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  projectId: string;
  executionDate: string;
  teamIds: string[] | null;
  programmingId?: string | null;
  expectedUpdatedAt?: string | null;
  serviceDescription?: string | null;
  period?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  expectedMinutes?: number | null;
  outageStartTime?: string | null;
  outageEndTime?: string | null;
  feeder?: string | null;
  campoEletrico?: string | null;
  affectedCustomers?: number | null;
  sgdTypeId?: string | null;
  electricalEqCatalogId?: string | null;
  support?: string | null;
  supportItemId?: string | null;
  posteQty?: number | null;
  estruturaQty?: number | null;
  trafoQty?: number | null;
  redeQty?: number | null;
  note?: string | null;
  historyReason?: string | null;
  documents?: Record<string, { number?: string | null; includedAt?: string | null; deliveredAt?: string | null }> | null;
  activities?: Array<{ catalogId: string; quantity: number }> | null;
}) {
  const rpcName = "save_project_programming_stage";
  const { data, error } = await params.supabase.rpc(rpcName, {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_project_id: params.projectId,
    p_execution_date: params.executionDate,
    p_team_ids: params.teamIds,
    p_programming_id: params.programmingId ?? null,
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
    p_service_description: params.serviceDescription ?? null,
    p_period: params.period ?? null,
    p_start_time: params.startTime ?? null,
    p_end_time: params.endTime ?? null,
    p_expected_minutes: params.expectedMinutes ?? null,
    p_outage_start_time: params.outageStartTime ?? null,
    p_outage_end_time: params.outageEndTime ?? null,
    p_feeder: params.feeder ?? null,
    p_campo_eletrico: params.campoEletrico ?? null,
    p_affected_customers: params.affectedCustomers ?? null,
    p_sgd_type_id: params.sgdTypeId ?? null,
    p_electrical_eq_catalog_id: params.electricalEqCatalogId ?? null,
    p_support: params.support ?? null,
    p_support_item_id: params.supportItemId ?? null,
    p_poste_qty: params.posteQty ?? null,
    p_estrutura_qty: params.estruturaQty ?? null,
    p_trafo_qty: params.trafoQty ?? null,
    p_rede_qty: params.redeQty ?? null,
    p_note: params.note ?? null,
    p_history_reason: params.historyReason ?? null,
    p_documents: params.documents ?? {},
    p_activities: params.activities ?? [],
  });

  if (error) {
    if (isMissingRpcFunctionError(error.message, rpcName)) return missingRpcResult(rpcName);
    return failedRpcResult(rpcName, error.message);
  }

  const result = (data ?? {}) as ProgrammingRpcResult;
  if (result.success !== true || !result.programming_id) return failedResultFromPayload(result);

  return {
    ok: true as const,
    action: result.action ?? "INSERT",
    programmingId: result.programming_id,
    updatedAt: normalizeText(result.updated_at),
    message: result.message ?? "Etapa salva com sucesso.",
  };
}

export async function addProgrammingTeamViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  teamId: string;
}) {
  const rpcName = "add_project_programming_team";
  const { data, error } = await params.supabase.rpc(rpcName, {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_team_id: params.teamId,
  });

  if (error) {
    if (isMissingRpcFunctionError(error.message, rpcName)) return missingRpcResult(rpcName);
    return failedRpcResult(rpcName, error.message);
  }

  const result = (data ?? {}) as ProgrammingRpcResult;
  if (result.success !== true) return failedResultFromPayload(result);

  return {
    ok: true as const,
    programmingTeamId: result.programming_team_id ?? "",
    message: result.message ?? "Equipe adicionada com sucesso.",
  };
}

export async function removeProgrammingTeamViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingTeamId: string;
  expectedUpdatedAt?: string | null;
}) {
  const rpcName = "remove_project_programming_team";
  const { data, error } = await params.supabase.rpc(rpcName, {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_team_id: params.programmingTeamId,
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
  });

  if (error) {
    if (isMissingRpcFunctionError(error.message, rpcName)) return missingRpcResult(rpcName);
    return failedRpcResult(rpcName, error.message);
  }

  const result = (data ?? {}) as ProgrammingRpcResult;
  if (result.success !== true) return failedResultFromPayload(result);

  return {
    ok: true as const,
    programmingTeamId: result.programming_team_id ?? params.programmingTeamId,
    updatedAt: normalizeText(result.updated_at),
    message: result.message ?? "Equipe removida com sucesso.",
  };
}

export async function postponeProgrammingStageViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  newExecutionDate: string;
  reason: string;
  expectedUpdatedAt?: string | null;
}) {
  const rpcName = "postpone_project_programming_stage";
  const { data, error } = await params.supabase.rpc(rpcName, {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_new_execution_date: params.newExecutionDate,
    p_reason: params.reason,
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
  });

  if (error) {
    if (isMissingRpcFunctionError(error.message, rpcName)) return missingRpcResult(rpcName);
    return failedRpcResult(rpcName, error.message);
  }

  const result = (data ?? {}) as ProgrammingRpcResult;
  if (result.success !== true || !result.programming_id) return failedResultFromPayload(result);

  return {
    ok: true as const,
    programmingId: result.programming_id,
    newProgrammingId: normalizeText(result.new_programming_id),
    updatedAt: normalizeText(result.updated_at),
    message: result.message ?? "Etapa adiada com sucesso.",
  };
}

export async function cancelProgrammingStageViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  reason: string;
  expectedUpdatedAt?: string | null;
}) {
  const rpcName = "cancel_project_programming_stage";
  const { data, error } = await params.supabase.rpc(rpcName, {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_reason: params.reason,
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
  });

  if (error) {
    if (isMissingRpcFunctionError(error.message, rpcName)) return missingRpcResult(rpcName);
    return failedRpcResult(rpcName, error.message);
  }

  const result = (data ?? {}) as ProgrammingRpcResult;
  if (result.success !== true || !result.programming_id) return failedResultFromPayload(result);

  return {
    ok: true as const,
    programmingId: result.programming_id,
    updatedAt: normalizeText(result.updated_at),
    message: result.message ?? "Etapa cancelada com sucesso.",
  };
}

export async function completeProgrammingStageViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  expectedUpdatedAt?: string | null;
}) {
  const rpcName = "mark_project_programming_completed_and_anticipate";
  const { data, error } = await params.supabase.rpc(rpcName, {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
  });

  if (error) {
    if (isMissingRpcFunctionError(error.message, rpcName)) return missingRpcResult(rpcName);
    return failedRpcResult(rpcName, error.message);
  }

  const result = (data ?? {}) as ProgrammingRpcResult;
  if (result.success !== true || !result.programming_id) return failedResultFromPayload(result);

  return {
    ok: true as const,
    programmingId: result.programming_id,
    updatedAt: normalizeText(result.updated_at),
    anticipatedCount: Number(result.anticipated_count ?? 0),
    message: result.message ?? "Etapa concluida com sucesso.",
  };
}

export async function reopenProgrammingStageViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  expectedUpdatedAt?: string | null;
}) {
  const rpcName = "reopen_project_programming_completed";
  const { data, error } = await params.supabase.rpc(rpcName, {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
  });

  if (error) {
    if (isMissingRpcFunctionError(error.message, rpcName)) return missingRpcResult(rpcName);
    return failedRpcResult(rpcName, error.message);
  }

  const result = (data ?? {}) as ProgrammingRpcResult;
  if (result.success !== true || !result.programming_id) return failedResultFromPayload(result);

  return {
    ok: true as const,
    programmingId: result.programming_id,
    updatedAt: normalizeText(result.updated_at),
    restoredCount: Number(result.restored_count ?? 0),
    message: result.message ?? "Etapa reaberta com sucesso.",
  };
}

// Cobre em branco/PARCIAL_PLANEJADO/PARCIAL_NAO_PLANEJADO/BENEFICIO_ATINGIDO/PENDENCIA
// (edicao manual). CONCLUIDO/ANTECIPADO continuam so via complete/reopen acima.
export async function setProgrammingWorkCompletionStatusViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  workCompletionStatus: string | null;
  expectedUpdatedAt?: string | null;
}) {
  const rpcName = "set_project_programming_work_completion_status";
  const { data, error } = await params.supabase.rpc(rpcName, {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_work_completion_status: params.workCompletionStatus,
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
  });

  if (error) {
    if (isMissingRpcFunctionError(error.message, rpcName)) return missingRpcResult(rpcName);
    return failedRpcResult(rpcName, error.message);
  }

  const result = (data ?? {}) as ProgrammingRpcResult;
  if (result.success !== true || !result.programming_id) return failedResultFromPayload(result);

  return {
    ok: true as const,
    programmingId: result.programming_id,
    updatedAt: normalizeText(result.updated_at),
    message: result.message ?? "Estado do trabalho atualizado com sucesso.",
  };
}
