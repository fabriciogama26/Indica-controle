import { SupabaseClient } from "@supabase/supabase-js";

import type {
  BatchCreateProgrammingPayload,
  BatchProgrammingRpcResult,
  CancelProgrammingGroupRpcResult,
  CancelProgrammingRpcResult,
  CopyProgrammingToDatesRpcResult,
  PostponeProgrammingGroupRpcResult,
  PostponeProgrammingRpcResult,
  ProgrammingEqCatalogRow,
  ProgrammingSgdTypeRow,
  SaveProgrammingPayload,
  SaveProgrammingRpcResult,
  TransferTeamProgrammingRpcResult,
} from "./types";
import { isMissingRpcFunctionError, normalizeText } from "./normalizers";

export async function copyProgrammingToDatesViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  sourceProgrammingId: string;
  expectedUpdatedAt: string;
  targets: Array<{ date: string; etapaNumber: number; teamIds: string[] }>;
}) {
  const rpcName = "copy_project_programming_to_dates";
  const { data, error } = await params.supabase.rpc(rpcName, {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_source_programming_id: params.sourceProgrammingId,
    p_expected_updated_at: params.expectedUpdatedAt,
    p_targets: params.targets.map((target) => ({
      date: target.date,
      etapaNumber: target.etapaNumber,
      teamIds: target.teamIds,
    })),
  });

  if (error) {
    if (isMissingRpcFunctionError(error.message, rpcName)) {
      return {
        ok: false,
        status: 409,
        reason: "COPY_TO_DATES_RPC_NOT_AVAILABLE",
        message: "Seu ambiente ainda nao suporta copia transacional para multiplas datas/equipes. Aplique a migration 274.",
      } as const;
    }

    return {
      ok: false,
      status: 500,
      reason: "COPY_TO_DATES_RPC_FAILED",
      message: error.message
        ? `Falha ao copiar programacao via RPC transacional: ${error.message}`
        : "Falha ao copiar programacao via RPC transacional.",
    } as const;
  }

  const result = (data ?? {}) as CopyProgrammingToDatesRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      reason: result.reason ?? null,
      detail: result.detail ?? null,
      message: result.message ?? "Falha ao copiar programacao para as datas selecionadas.",
      enteredEtapaNumber: result.enteredEtapaNumber,
      hasConflict: result.hasConflict,
      highestStage: result.highestStage,
      teams: result.teams,
    } as const;
  }

  return {
    ok: true,
    copiedCount: Number(result.copied_count ?? 0),
    copyBatchId: normalizeText(result.copy_batch_id) || null,
    copiedProgrammingIds: Array.isArray(result.copied_programming_ids)
      ? result.copied_programming_ids.map((item) => normalizeText(item)).filter(Boolean)
      : [],
    sourceCount: Number(result.source_count ?? 0),
    message: result.message ?? "Programacao copiada com sucesso.",
  } as const;
}

export async function transferTeamProgrammingViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  sourceProgrammingId: string;
  destinationProgrammingId: string;
  expectedUpdatedAt: string;
  destinationExpectedUpdatedAt: string;
  reason: string;
}) {
  const rpcName = "transfer_project_programming_team";
  const { data, error } = await params.supabase.rpc(rpcName, {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_source_programming_id: params.sourceProgrammingId,
    p_destination_programming_id: params.destinationProgrammingId,
    p_expected_updated_at: params.expectedUpdatedAt,
    p_destination_expected_updated_at: params.destinationExpectedUpdatedAt,
    p_reason: params.reason,
  });

  if (error) {
    if (isMissingRpcFunctionError(error.message, rpcName)) {
      return {
        ok: false,
        status: 409,
        reason: "TRANSFER_TEAM_RPC_NOT_AVAILABLE",
        message: "Seu ambiente ainda nao suporta transferencia de equipe na Programacao. Aplique a migration 286.",
      } as const;
    }

    return {
      ok: false,
      status: 500,
      reason: "TRANSFER_TEAM_RPC_FAILED",
      message: error.message
        ? `Falha ao transferir equipe via RPC: ${error.message}`
        : "Falha ao transferir equipe via RPC.",
    } as const;
  }

  const result = (data ?? {}) as TransferTeamProgrammingRpcResult;
  if (result.success !== true || !result.new_programming_id) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      reason: result.reason ?? null,
      detail: result.detail ?? null,
      message: result.message ?? "Falha ao transferir equipe.",
    } as const;
  }

  return {
    ok: true,
    sourceProgrammingId: normalizeText(result.source_programming_id) || params.sourceProgrammingId,
    destinationProgrammingId: normalizeText(result.destination_programming_id) || params.destinationProgrammingId,
    newProgrammingId: normalizeText(result.new_programming_id),
    updatedAt: normalizeText(result.updated_at),
    message: result.message ?? "Equipe transferida com sucesso.",
  } as const;
}

export async function saveProgrammingFullViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId?: string | null;
  projectId: string;
  teamId: string;
  executionDate: string;
  period: "INTEGRAL" | "PARCIAL";
  startTime: string;
  endTime: string;
  expectedMinutes: number;
  outageStartTime?: string | null;
  outageEndTime?: string | null;
  feeder?: string | null;
  support?: string | null;
  supportItemId?: string | null;
  note?: string | null;
  electricalField: string | null;
  serviceDescription?: string | null;
  posteQty: number;
  estruturaQty: number;
  trafoQty: number;
  redeQty: number;
  etapaNumber: number | null;
  etapaUnica: boolean;
  etapaFinal: boolean;
  workCompletionStatus: string | null;
  affectedCustomers: number;
  sgdTypeId: string | null;
  electricalEqCatalogId: string | null;
  documents: NonNullable<SaveProgrammingPayload["documents"]>;
  activities: Array<{ catalogId: string; quantity: number }>;
  expectedUpdatedAt?: string | null;
  historyActionOverride?: string | null;
  historyReason?: string | null;
  historyMetadata?: Record<string, unknown> | null;
  copiedFromProgrammingId?: string | null;
  copyBatchId?: string | null;
}) {
  const rpcName = "save_project_programming_full_decimal_with_electrical_and_eq";
  const rpcPayload = {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_project_id: params.projectId,
    p_team_id: params.teamId,
    p_execution_date: params.executionDate,
    p_period: params.period,
    p_start_time: params.startTime,
    p_end_time: params.endTime,
    p_expected_minutes: params.expectedMinutes,
    p_feeder: params.feeder ?? null,
    p_support: params.support ?? null,
    p_note: params.note ?? null,
    p_documents: params.documents,
    p_activities: params.activities.map((item) => ({
      catalogId: item.catalogId,
      quantity: item.quantity,
    })),
    p_programming_id: params.programmingId ?? null,
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
    p_support_item_id: params.supportItemId ?? null,
    p_poste_qty: params.posteQty,
    p_estrutura_qty: params.estruturaQty,
    p_trafo_qty: params.trafoQty,
    p_rede_qty: params.redeQty,
    p_etapa_number: params.etapaNumber,
    p_work_completion_status: params.workCompletionStatus,
    p_affected_customers: params.affectedCustomers,
    p_sgd_type_id: params.sgdTypeId,
    p_outage_start_time: params.outageStartTime ?? null,
    p_outage_end_time: params.outageEndTime ?? null,
    p_service_description: params.serviceDescription ?? null,
    p_history_action_override: params.historyActionOverride ?? null,
    p_history_reason: params.historyReason ?? null,
    p_history_metadata: params.historyMetadata ?? {},
    p_campo_eletrico: params.electricalField ?? null,
    p_electrical_eq_catalog_id: params.electricalEqCatalogId ?? null,
    p_etapa_unica: params.etapaUnica,
    p_etapa_final: params.etapaFinal,
    ...(params.copiedFromProgrammingId
      ? { p_copied_from_programming_id: params.copiedFromProgrammingId }
      : {}),
    ...(params.copyBatchId ? { p_copy_batch_id: params.copyBatchId } : {}),
  };

  const { data, error } = await params.supabase.rpc(rpcName, rpcPayload);

  if (error) {
    if (isMissingRpcFunctionError(error.message, rpcName)) {
      return {
        ok: false,
        status: 409,
        reason: "FULL_RPC_NOT_AVAILABLE",
        message: params.copiedFromProgrammingId || params.copyBatchId
          ? "RPC transacional decimal da Programacao ainda nao suporta rastreio estruturado de copia. Aplique a migration 249."
          : "RPC transacional decimal da Programacao indisponivel no ambiente atual. Aplique a migration 228.",
      } as const;
    }

    return {
      ok: false,
      status: 500,
      message: error.message
        ? `Falha ao salvar programacao via RPC full: ${error.message}`
        : "Falha ao salvar programacao via RPC full.",
    } as const;
  }

  const result = (data ?? {}) as SaveProgrammingRpcResult;
  if (result.success !== true || !result.programming_id) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar programacao.",
      reason: result.reason ?? null,
      detail: result.detail ?? null,
    } as const;
  }

  return {
    ok: true,
    action: result.action ?? null,
    programmingId: result.programming_id,
    projectCode: normalizeText(result.project_code),
    updatedAt: normalizeText(result.updated_at),
    message: result.message ?? "Programacao salva com sucesso.",
  } as const;
}

export async function saveProgrammingBatchFullViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  projectId: string;
  teamIds: string[];
  executionDate: string;
  period: "INTEGRAL" | "PARCIAL";
  startTime: string;
  endTime: string;
  expectedMinutes: number;
  outageStartTime?: string | null;
  outageEndTime?: string | null;
  feeder?: string | null;
  support?: string | null;
  supportItemId?: string | null;
  note?: string | null;
  electricalField: string | null;
  serviceDescription?: string | null;
  posteQty: number;
  estruturaQty: number;
  trafoQty: number;
  redeQty: number;
  etapaNumber: number | null;
  etapaUnica: boolean;
  etapaFinal: boolean;
  workCompletionStatus: string | null;
  affectedCustomers: number;
  sgdTypeId: string;
  electricalEqCatalogId: string | null;
  documents: NonNullable<BatchCreateProgrammingPayload["documents"]>;
  activities: Array<{ catalogId: string; quantity: number }>;
}) {
  const rpcName = "save_project_programming_batch_full_decimal";
  const rpcPayload = {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_project_id: params.projectId,
    p_team_ids: params.teamIds,
    p_execution_date: params.executionDate,
    p_period: params.period,
    p_start_time: params.startTime,
    p_end_time: params.endTime,
    p_expected_minutes: params.expectedMinutes,
    p_feeder: params.feeder ?? null,
    p_support: params.support ?? null,
    p_note: params.note ?? null,
    p_documents: params.documents,
    p_activities: params.activities.map((item) => ({
      catalogId: item.catalogId,
      quantity: item.quantity,
    })),
    p_support_item_id: params.supportItemId ?? null,
    p_poste_qty: params.posteQty,
    p_estrutura_qty: params.estruturaQty,
    p_trafo_qty: params.trafoQty,
    p_rede_qty: params.redeQty,
    p_etapa_number: params.etapaNumber,
    p_work_completion_status: params.workCompletionStatus,
    p_affected_customers: params.affectedCustomers,
    p_sgd_type_id: params.sgdTypeId,
    p_outage_start_time: params.outageStartTime ?? null,
    p_outage_end_time: params.outageEndTime ?? null,
    p_service_description: params.serviceDescription ?? null,
    p_campo_eletrico: params.electricalField ?? null,
    p_electrical_eq_catalog_id: params.electricalEqCatalogId ?? null,
    p_etapa_unica: params.etapaUnica,
    p_etapa_final: params.etapaFinal,
  };

  let rpcResponse = await params.supabase.rpc(rpcName, rpcPayload);
  if (rpcResponse.error && isMissingRpcFunctionError(rpcResponse.error.message, rpcName)) {
    const truncatedRpcName = "save_project_programming_batch_full_decimal_with_electrical_and";
    rpcResponse = await params.supabase.rpc(truncatedRpcName, rpcPayload);
  }

  const { data, error } = rpcResponse;

  if (error) {
    if (
      isMissingRpcFunctionError(error.message, rpcName)
      || isMissingRpcFunctionError(
        error.message,
        "save_project_programming_batch_full_decimal_with_electrical_and",
      )
    ) {
      return {
        ok: false,
        status: 409,
        reason: "FULL_RPC_NOT_AVAILABLE",
        message:
          "RPC transacional decimal de lote da Programacao indisponivel no ambiente atual. Aplique as migrations 228 e 235.",
      } as const;
    }

    return {
      ok: false,
      status: 500,
      message: error.message
        ? `Falha ao salvar programacao em lote via RPC full: ${error.message}`
        : "Falha ao salvar programacao em lote via RPC full.",
    } as const;
  }

  const result = (data ?? {}) as BatchProgrammingRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar programacao em lote.",
      reason: result.reason ?? null,
      detail: result.detail ?? null,
    } as const;
  }

  const items = Array.isArray(result.items)
    ? result.items
        .map((item) => ({
          teamId: normalizeText(item.teamId),
          programmingId: normalizeText(item.programmingId),
        }))
        .filter((item) => item.teamId && item.programmingId)
    : [];

  return {
    ok: true,
    insertedCount: Number(result.inserted_count ?? items.length),
    projectCode: normalizeText(result.project_code),
    message: result.message ?? "Programacao em lote salva com sucesso.",
    items,
  } as const;
}

export async function resolveProgrammingSgdType(params: {
  supabase: SupabaseClient;
  tenantId: string;
  sgdTypeId: string;
}) {
  const { data, error } = await params.supabase
    .from("programming_sgd_types")
    .select("id, description, export_column, is_active")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.sgdTypeId)
    .eq("is_active", true)
    .maybeSingle<ProgrammingSgdTypeRow>();

  if (error || !data) {
    return null;
  }

  return data;
}

export async function resolveProgrammingWorkCompletionStatus(params: {
  supabase: SupabaseClient;
  tenantId: string;
  workCompletionStatus: string;
}) {
  const { data, error } = await params.supabase
    .from("programming_work_completion_catalog")
    .select("code, label_pt, is_active")
    .eq("tenant_id", params.tenantId)
    .eq("code", params.workCompletionStatus)
    .eq("is_active", true)
    .maybeSingle<{ code: string; label_pt: string; is_active: boolean }>();

  if (error || !data) {
    return null;
  }

  return data;
}

export async function resolveProgrammingEqCatalog(params: {
  supabase: SupabaseClient;
  tenantId: string;
  electricalEqCatalogId: string;
}) {
  const { data, error } = await params.supabase
    .from("programming_eq_catalog")
    .select("id, code, label_pt, is_active, sort_order")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.electricalEqCatalogId)
    .eq("is_active", true)
    .maybeSingle<ProgrammingEqCatalogRow>();

  if (error || !data) {
    return null;
  }

  return data;
}

export async function markFutureProgrammingStagesAnticipatedViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  sourceProgrammingId: string;
  sourceEtapaNumber: number;
}) {
  const rpcName = "mark_project_programming_future_stages_anticipated";
  const { data, error } = await params.supabase.rpc(rpcName, {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_source_programming_id: params.sourceProgrammingId,
    p_source_etapa_number: params.sourceEtapaNumber,
  });

  if (error) {
    if (isMissingRpcFunctionError(error.message, rpcName)) {
      return {
        ok: false,
        status: 409,
        reason: "ANTICIPATED_STAGES_RPC_NOT_AVAILABLE",
        message:
          "Seu ambiente ainda nao suporta atualizacao de etapas futuras para ANTECIPADO. Aplique a migration 255.",
      } as const;
    }

    return {
      ok: false,
      status: 500,
      reason: "ANTICIPATED_STAGES_RPC_FAILED",
      message: error.message
        ? `Falha ao atualizar etapas futuras para ANTECIPADO: ${error.message}`
        : "Falha ao atualizar etapas futuras para ANTECIPADO.",
    } as const;
  }

  const result = (data ?? {}) as {
    success?: boolean;
    status?: number;
    message?: string;
    reason?: string | null;
    detail?: string | null;
    affected_count?: number;
    updated_programming_ids?: string[];
  };

  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      reason: result.reason ?? null,
      detail: result.detail ?? null,
      message: result.message ?? "Falha ao atualizar etapas futuras para ANTECIPADO.",
    } as const;
  }

  return {
    ok: true,
    affectedCount: Number(result.affected_count ?? 0),
    updatedProgrammingIds: Array.isArray(result.updated_programming_ids)
      ? result.updated_programming_ids.map((item) => normalizeText(item)).filter(Boolean)
      : [],
    message: result.message ?? "Etapas futuras atualizadas como ANTECIPADO.",
  } as const;
}

export async function markProgrammingStageAnticipatedViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  targetProgrammingId: string;
  sourceProgrammingId: string;
}) {
  const rpcName = "mark_project_programming_stage_anticipated";
  const { data, error } = await params.supabase.rpc(rpcName, {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_target_programming_id: params.targetProgrammingId,
    p_source_programming_id: params.sourceProgrammingId,
  });

  if (error) {
    if (isMissingRpcFunctionError(error.message, rpcName)) {
      return {
        ok: false,
        status: 409,
        reason: "ANTICIPATED_STAGE_RPC_NOT_AVAILABLE",
        message:
          "Seu ambiente ainda nao suporta rastreio de ANTECIPADO em copia. Aplique a migration 272.",
      } as const;
    }

    return {
      ok: false,
      status: 500,
      reason: "ANTICIPATED_STAGE_RPC_FAILED",
      message: error.message
        ? `Falha ao marcar programacao como ANTECIPADO: ${error.message}`
        : "Falha ao marcar programacao como ANTECIPADO.",
    } as const;
  }

  const result = (data ?? {}) as {
    success?: boolean;
    status?: number;
    message?: string;
    reason?: string | null;
    detail?: string | null;
    programming_id?: string;
    updated_at?: string;
  };

  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      reason: result.reason ?? null,
      detail: result.detail ?? null,
      message: result.message ?? "Falha ao marcar programacao como ANTECIPADO.",
    } as const;
  }

  return {
    ok: true,
    programmingId: normalizeText(result.programming_id),
    updatedAt: normalizeText(result.updated_at),
    message: result.message ?? "Programacao marcada como ANTECIPADO.",
  } as const;
}

// Legacy compatibility helper kept for staged rollback support in partially migrated environments.
export async function setProgrammingEnelFieldsViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  affectedCustomers: number;
  sgdTypeId: string;
}) {
  const { data, error } = await params.supabase.rpc("set_project_programming_enel_fields", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_affected_customers: params.affectedCustomers,
    p_sgd_type_id: params.sgdTypeId,
  });

  if (error) {
    const isMissingRpc = isMissingRpcFunctionError(error.message, "set_project_programming_enel_fields");

    if (isMissingRpc) {
      return {
        ok: false,
        status: 409,
        message:
          "Seu ambiente ainda nao suporta os campos ENEL obrigatorios (Tipo de SGD e NÂº Clientes Afetados). Aplique a migration 089 e tente novamente.",
      } as const;
    }

    return {
      ok: false,
      status: 500,
      message: error.message
        ? `Falha ao salvar campos ENEL da programacao: ${error.message}`
        : "Falha ao salvar campos ENEL da programacao.",
    } as const;
  }

  const result = (data ?? {}) as { success?: boolean; status?: number; message?: string };
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar campos ENEL da programacao.",
    } as const;
  }

  return { ok: true } as const;
}

// Legacy compatibility helper kept for staged rollback support in partially migrated environments.
export async function setProgrammingExecutionResultViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  etapaNumber: number | null;
  workCompletionStatus: string | null;
  force?: boolean;
}) {
  const shouldPersist = Boolean(params.force)
    || params.etapaNumber !== null
    || params.workCompletionStatus !== null;

  if (!shouldPersist) {
    return { ok: true } as const;
  }

  const { data, error } = await params.supabase.rpc("set_project_programming_execution_result", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_etapa_number: params.etapaNumber,
    p_work_completion_status: params.workCompletionStatus,
  });

  if (error) {
    const isMissingRpc = isMissingRpcFunctionError(error.message, "set_project_programming_execution_result");

    if (isMissingRpc) {
      return {
        ok: false,
        status: 409,
        message:
          "Seu ambiente ainda nao suporta os campos ETAPA/Estado Trabalho da programacao. Aplique a migration 094 e tente novamente.",
      } as const;
    }

    return {
      ok: false,
      status: 500,
      message: error.message
        ? `Falha ao salvar ETAPA/Estado Trabalho da programacao: ${error.message}`
        : "Falha ao salvar ETAPA/Estado Trabalho da programacao.",
    } as const;
  }

  const result = (data ?? {}) as { success?: boolean; status?: number; message?: string };
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar ETAPA/Estado Trabalho da programacao.",
    } as const;
  }

  return { ok: true } as const;
}

// Legacy compatibility helper kept for staged rollback support in partially migrated environments.
export async function setProgrammingElectricalFieldViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  electricalField: string;
  historyAction?: string | null;
  historyReason?: string | null;
  historyMetadata?: Record<string, unknown> | null;
}) {
  const { data, error } = await params.supabase.rpc("set_project_programming_campo_eletrico", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_campo_eletrico: params.electricalField,
    p_history_action: params.historyAction ?? null,
    p_history_reason: params.historyReason ?? null,
    p_history_metadata: params.historyMetadata ?? {},
  });

  if (error) {
    const isMissingRpc = isMissingRpcFunctionError(error.message, "set_project_programming_campo_eletrico");

    if (isMissingRpc) {
      return {
        ok: false,
        status: 409,
        reason: "ELECTRICAL_FIELD_RPC_NOT_AVAILABLE",
        message:
          "Seu ambiente ainda nao suporta o campo Ponto eletrico da Programacao. Aplique a migration 110 e tente novamente.",
      } as const;
    }

    return {
      ok: false,
      status: 500,
      reason: "ELECTRICAL_FIELD_RPC_FAILED",
      message: error.message
        ? `Falha ao salvar Ponto eletrico da programacao: ${error.message}`
        : "Falha ao salvar Ponto eletrico da programacao.",
    } as const;
  }

  const result = (data ?? {}) as { success?: boolean; status?: number; message?: string; reason?: string };
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      reason: result.reason ?? "ELECTRICAL_FIELD_SAVE_FAILED",
      message: result.message ?? "Falha ao salvar Ponto eletrico da programacao.",
    } as const;
  }

  return { ok: true } as const;
}

export async function cancelProgrammingViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  action: "ADIADA" | "CANCELADA";
  reason: string;
  expectedUpdatedAt?: string | null;
}) {
  const { data, error } = await params.supabase.rpc("set_project_programming_status", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_status: params.action,
    p_reason: params.reason,
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
  });

  if (error) {
    return {
      ok: false,
      status: 500,
      message: "Falha ao cancelar programacao via RPC.",
    } as const;
  }

  const result = (data ?? {}) as CancelProgrammingRpcResult;
  if (result.success !== true || !result.programming_id) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao cancelar programacao.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    programmingId: result.programming_id,
    projectCode: normalizeText(result.project_code),
    updatedAt: normalizeText(result.updated_at),
    programmingStatus: result.programming_status ?? params.action,
    message: result.message ?? (params.action === "ADIADA" ? "Programacao adiada com sucesso." : "Programacao cancelada com sucesso."),
  } as const;
}

export async function cancelProgrammingGroupViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  reason: string;
  expectedUpdatedAt?: string | null;
}) {
  const rpcName = "cancel_project_programming_group";
  const { data, error } = await params.supabase.rpc(rpcName, {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_reason: params.reason,
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
  });

  if (error) {
    const isMissingRpc = isMissingRpcFunctionError(error.message, rpcName);

    if (isMissingRpc) {
      return {
        ok: false,
        status: 409,
        reason: "CANCEL_GROUP_RPC_NOT_AVAILABLE",
        message:
          "Seu ambiente ainda nao suporta cancelamento por grupo operacional. Aplique a migration 273 e tente novamente.",
      } as const;
    }

    return {
      ok: false,
      status: 500,
      reason: "CANCEL_GROUP_RPC_FAILED",
      message: error.message
        ? `Falha ao cancelar programacoes por grupo operacional via RPC: ${error.message}`
        : "Falha ao cancelar programacoes por grupo operacional via RPC.",
    } as const;
  }

  const result = (data ?? {}) as CancelProgrammingGroupRpcResult;
  if (result.success !== true || !result.programming_id) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao cancelar programacoes por grupo operacional.",
      reason: result.reason ?? null,
      detail: result.detail ?? null,
      programmingId: result.programming_id ?? null,
    } as const;
  }

  const cancelledProgrammingIds = Array.isArray(result.cancelled_programming_ids)
    ? result.cancelled_programming_ids.map((item) => normalizeText(item)).filter(Boolean)
    : [];

  return {
    ok: true,
    programmingId: result.programming_id,
    projectCode: normalizeText(result.project_code),
    updatedAt: normalizeText(result.updated_at),
    programmingStatus: result.programming_status ?? "CANCELADA",
    affectedCount: Number(result.affected_count ?? cancelledProgrammingIds.length),
    cancelledProgrammingIds,
    message: result.message ?? "Programacoes canceladas com sucesso.",
  } as const;
}

export async function postponeProgrammingViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  newExecutionDate: string;
  reason: string;
  expectedUpdatedAt?: string | null;
}) {
  const { data, error } = await params.supabase.rpc("postpone_project_programming", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_new_execution_date: params.newExecutionDate,
    p_reason: params.reason,
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
  });

  if (error) {
    const isMissingRpc = isMissingRpcFunctionError(error.message, "postpone_project_programming");

    if (isMissingRpc) {
      return {
        ok: false,
        status: 409,
        message:
          "Seu ambiente ainda nao suporta adiamento com nova data. Aplique a migration 088 e tente novamente.",
      } as const;
    }

    return {
      ok: false,
      status: 500,
      message: error.message
        ? `Falha ao adiar programacao via RPC: ${error.message}`
        : "Falha ao adiar programacao via RPC.",
    } as const;
  }

  const result = (data ?? {}) as PostponeProgrammingRpcResult;
  if (result.success !== true || !result.programming_id || !result.new_programming_id) {
    const fallbackMessage = result.detail
      ? `Falha ao adiar programacao: ${result.detail}`
      : result.message ?? "Falha ao adiar programacao.";

    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: fallbackMessage,
      reason: result.reason ?? null,
      detail: result.detail ?? null,
    } as const;
  }

  return {
    ok: true,
    programmingId: result.programming_id,
    newProgrammingId: result.new_programming_id,
    projectCode: normalizeText(result.project_code),
    updatedAt: normalizeText(result.updated_at),
    message: result.message ?? "Programacao adiada com sucesso.",
  } as const;
}

export async function postponeProgrammingGroupViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  newExecutionDate?: string | null;
  reason: string;
  expectedUpdatedAt?: string | null;
}) {
  const rpcName = "postpone_project_programming_group";
  const { data, error } = await params.supabase.rpc(rpcName, {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_new_execution_date: params.newExecutionDate ?? null,
    p_reason: params.reason,
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
  });

  if (error) {
    const isMissingRpc = isMissingRpcFunctionError(error.message, rpcName);

    if (isMissingRpc) {
      return {
        ok: false,
        status: 409,
        reason: "POSTPONE_GROUP_RPC_NOT_AVAILABLE",
        message:
          "Seu ambiente ainda nao suporta adiamento por grupo operacional. Aplique a migration 273 e tente novamente.",
      } as const;
    }

    return {
      ok: false,
      status: 500,
      reason: "POSTPONE_GROUP_RPC_FAILED",
      message: error.message
        ? `Falha ao adiar programacoes por grupo operacional via RPC: ${error.message}`
        : "Falha ao adiar programacoes por grupo operacional via RPC.",
    } as const;
  }

  const result = (data ?? {}) as PostponeProgrammingGroupRpcResult;
  if (result.success !== true || !result.programming_id) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao adiar programacoes por grupo operacional.",
      reason: result.reason ?? null,
      detail: result.detail ?? null,
      programmingId: result.programming_id ?? null,
    } as const;
  }

  const updatedProgrammingIds = Array.isArray(result.updated_programming_ids)
    ? result.updated_programming_ids.map((item) => normalizeText(item)).filter(Boolean)
    : [];
  const newProgrammingIds = Array.isArray(result.new_programming_ids)
    ? result.new_programming_ids.map((item) => normalizeText(item)).filter(Boolean)
    : [];

  return {
    ok: true,
    programmingId: result.programming_id,
    projectCode: normalizeText(result.project_code),
    updatedAt: normalizeText(result.updated_at),
    affectedCount: Number(result.affected_count ?? updatedProgrammingIds.length),
    updatedProgrammingIds,
    newProgrammingIds,
    message: result.message ?? "Programacoes adiadas com sucesso.",
  } as const;
}
