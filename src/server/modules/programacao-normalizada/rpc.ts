import { SupabaseClient } from "@supabase/supabase-js";

import { isMissingRpcFunctionError, normalizeText } from "./normalizers";
import { describeTeamScheduleConflict } from "./scheduleConflict";
import type { ProgrammingRpcResult } from "./types";

function missingRpcResult(rpcName: string) {
  return {
    ok: false as const,
    status: 409,
    reason: "RPC_NOT_AVAILABLE",
    message: `Seu ambiente ainda nao tem a funcao ${rpcName} aplicada. Aplique as migrations da Programacao Normalizada, incluindo a 400.`,
  };
}

// Rotulo por RPC para a mensagem de erro do usuario. Sem entrada aqui a operacao
// cai no texto generico — nunca no nome cru da funcao do banco.
const RPC_OPERATION_LABEL: Record<string, string> = {
  save_project_programming_stage: "salvar a etapa",
  add_project_programming_team: "adicionar a equipe",
  remove_project_programming_team: "remover a equipe",
  postpone_project_programming_stage: "adiar a etapa",
  set_project_programming_pendencia_flag: "alterar a Pendencia",
  cancel_project_programming_stage: "cancelar a etapa",
  mark_project_programming_completed_and_anticipate: "concluir a etapa",
  reopen_project_programming_completed: "reabrir a etapa",
  set_project_programming_work_completion_status: "alterar o Estado do trabalho",
  change_completed_stage_work_status: "alterar o Estado do trabalho",
  correct_project_programming_stage_date: "corrigir a data da etapa",
  cancel_project_programming_team: "cancelar a participacao da equipe",
  postpone_project_programming_team: "adiar a equipe",
};

// Erros de banco que tem traducao util para quem esta na tela. O resto vira
// mensagem generica + orientacao, porque texto cru do Postgres (ex.:
// `record "v_current" is not assigned yet`) nao ajuda o usuario e ainda expoe
// detalhe interno.
function describeDatabaseFailure(errorMessage: string) {
  const normalized = errorMessage.toLowerCase();

  if (normalized.includes("is not assigned yet") || normalized.includes("statement is too complex")) {
    return "Falha interna na rotina do banco desta operacao. Avise o suporte tecnico informando o horario — a operacao NAO foi gravada.";
  }

  if (normalized.includes("deadlock detected") || normalized.includes("lock timeout") || normalized.includes("canceling statement")) {
    return "A operacao demorou demais porque outro usuario estava alterando o mesmo projeto. Tente novamente em alguns segundos.";
  }

  if (normalized.includes("permission denied") || normalized.includes("row-level security")) {
    return "Sem permissao no banco para concluir esta operacao. Confirme suas permissoes com um administrador.";
  }

  return "Falha inesperada no banco de dados. A operacao NAO foi gravada. Tente novamente e, se persistir, avise o suporte tecnico.";
}

function failedRpcResult(rpcName: string, errorMessage: string | undefined) {
  const technicalDetail = normalizeText(errorMessage);
  const operationLabel = RPC_OPERATION_LABEL[rpcName] ?? "concluir a operacao";

  // O detalhe tecnico fica no log do servidor (mesmo padrao de
  // `console.error` ja usado em src/server/modules), nunca na tela.
  console.error(`[programacao-normalizada] RPC ${rpcName} falhou.`, { rpcName, technicalDetail });

  return {
    ok: false as const,
    status: 500,
    reason: "RPC_FAILED",
    message: `Nao foi possivel ${operationLabel}. ${
      technicalDetail ? describeDatabaseFailure(technicalDetail) : "Falha inesperada no banco de dados. A operacao NAO foi gravada."
    }`,
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

// TEAM_TIME_CONFLICT: a RPC so informa QUE houve sobreposicao. Aqui trocamos o
// texto generico por "com quem conflitou + janelas livres" (migration 341).
// Falha ao detalhar mantem a mensagem original — o detalhe e um extra.
async function failedResultWithScheduleDetail(
  result: ProgrammingRpcResult,
  agenda: Parameters<typeof describeTeamScheduleConflict>[0],
) {
  const base = failedResultFromPayload(result);
  if (base.reason !== "TEAM_TIME_CONFLICT") return base;

  const detail = await describeTeamScheduleConflict(agenda);
  return detail ? { ...base, message: detail } : base;
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
  isPendencia?: boolean;
  teamForemanIds?: Record<string, string> | null;
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
    p_is_pendencia: params.isPendencia ?? false,
    p_team_foremen: params.teamForemanIds ?? {},
  });

  if (error) {
    if (isMissingRpcFunctionError(error.message, rpcName)) return missingRpcResult(rpcName);
    return failedRpcResult(rpcName, error.message);
  }

  const result = (data ?? {}) as ProgrammingRpcResult;
  if (result.success !== true || !result.programming_id) {
    return failedResultWithScheduleDetail(result, {
      supabase: params.supabase,
      tenantId: params.tenantId,
      teamIds: params.teamIds,
      executionDate: params.executionDate,
      startTime: params.startTime ?? null,
      endTime: params.endTime ?? null,
      excludeProgrammingId: params.programmingId ?? null,
    });
  }

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
  programmedForemanPersonId?: string | null;
}) {
  const rpcName = "add_project_programming_team";
  const { data, error } = await params.supabase.rpc(rpcName, {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_team_id: params.teamId,
    p_programmed_foreman_person_id: params.programmedForemanPersonId ?? null,
  });

  if (error) {
    if (isMissingRpcFunctionError(error.message, rpcName)) return missingRpcResult(rpcName);
    return failedRpcResult(rpcName, error.message);
  }

  const result = (data ?? {}) as ProgrammingRpcResult;
  if (result.success !== true) {
    // A etapa ja existe e define a janela pretendida; a funcao de agenda resolve
    // data/horario a partir de p_programming_id.
    return failedResultWithScheduleDetail(result, {
      supabase: params.supabase,
      tenantId: params.tenantId,
      teamIds: [params.teamId],
      programmingId: params.programmingId,
    });
  }

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

// newExecutionDate null = "deixar em espera" (ADIADA sem data); com data = remarcar.
export async function postponeProgrammingStageViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  newExecutionDate: string | null;
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
  if (result.success !== true || !result.programming_id) {
    // Conflito aqui e sempre na NOVA data (rota "em espera" nao tem data e nao
    // chega a checar agenda); as equipes vem da propria etapa.
    return failedResultWithScheduleDetail(result, {
      supabase: params.supabase,
      tenantId: params.tenantId,
      programmingId: params.programmingId,
      executionDate: params.newExecutionDate,
    });
  }

  return {
    ok: true as const,
    programmingId: result.programming_id,
    updatedAt: normalizeText(result.updated_at),
    message: result.message ?? "Etapa adiada com sucesso.",
  };
}

// Cancela so a participacao de UMA equipe (etapa continua ativa). Distinto de
// remover (correcao de cadastro) — grava motivo/quem/quando. p_confirm_last_team
// so vira true quando o front ja avisou o usuario que e a ultima equipe ativa
// da etapa e ele confirmou manter a etapa sem equipe.
export async function cancelProgrammingTeamViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingTeamId: string;
  reason: string;
  expectedUpdatedAt?: string | null;
  confirmLastTeam?: boolean;
}) {
  const rpcName = "cancel_project_programming_team";
  const { data, error } = await params.supabase.rpc(rpcName, {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_team_id: params.programmingTeamId,
    p_reason: params.reason,
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
    p_confirm_last_team: params.confirmLastTeam ?? false,
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
    message: result.message ?? "Participacao da equipe cancelada com sucesso.",
  };
}

// Adia so UMA equipe: transferencia atomica pra etapa de destino (reusa a
// ativa da nova data ou cria uma nova herdando o cadastro da etapa de
// origem). p_confirm_last_team mesmo contrato do cancelamento acima.
export async function postponeProgrammingTeamViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingTeamId: string;
  teamId: string;
  newExecutionDate: string;
  reason: string;
  expectedUpdatedAt?: string | null;
  confirmLastTeam?: boolean;
}) {
  const rpcName = "postpone_project_programming_team";
  const { data, error } = await params.supabase.rpc(rpcName, {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_team_id: params.programmingTeamId,
    p_new_execution_date: params.newExecutionDate,
    p_reason: params.reason,
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
    p_confirm_last_team: params.confirmLastTeam ?? false,
  });

  if (error) {
    if (isMissingRpcFunctionError(error.message, rpcName)) return missingRpcResult(rpcName);
    return failedRpcResult(rpcName, error.message);
  }

  const result = (data ?? {}) as ProgrammingRpcResult;
  if (result.success !== true) {
    return failedResultWithScheduleDetail(result, {
      supabase: params.supabase,
      tenantId: params.tenantId,
      teamIds: [params.teamId],
      executionDate: params.newExecutionDate,
    });
  }

  return {
    ok: true as const,
    programmingTeamId: result.programming_team_id ?? params.programmingTeamId,
    updatedAt: normalizeText(result.updated_at),
    newProgrammingTeamId: result.new_programming_team_id ?? null,
    newProgrammingId: result.new_programming_id ?? null,
    newExecutionDate: result.new_execution_date ?? params.newExecutionDate,
    message: result.message ?? "Equipe adiada com sucesso.",
  };
}

// Sair de CONCLUIDO atomicamente (reabre + restaura antecipadas + aplica novo
// estado num so commit). Substitui o par reopen+set do front (achado 4).
export async function changeCompletedStageWorkStatusViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  newWorkCompletionStatus: string | null;
  expectedUpdatedAt?: string | null;
}) {
  const rpcName = "change_completed_stage_work_status";
  const { data, error } = await params.supabase.rpc(rpcName, {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_new_work_completion_status: params.newWorkCompletionStatus,
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

// Corrige a data da etapa mantendo o mesmo registro e PRESERVANDO o status
// (correcao de cadastro, nao remarcacao — remarcar continua no Adiar).
export async function correctProgrammingStageDateViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  newExecutionDate: string;
  reason: string;
  expectedUpdatedAt?: string | null;
}) {
  const rpcName = "correct_project_programming_stage_date";
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
  if (result.success !== true || !result.programming_id) {
    return failedResultWithScheduleDetail(result, {
      supabase: params.supabase,
      tenantId: params.tenantId,
      programmingId: params.programmingId,
      executionDate: params.newExecutionDate,
    });
  }

  return {
    ok: true as const,
    programmingId: result.programming_id,
    updatedAt: normalizeText(result.updated_at),
    message: result.message ?? "Data corrigida com sucesso.",
  };
}

// Motivo obrigatorio; resolvePendenciaDeId opcional (etapa de origem da sobra).
export async function setProgrammingPendenciaFlagViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  isPendencia: boolean;
  reason: string;
  description?: string | null;
  resolvePendenciaDeId?: string | null;
  expectedUpdatedAt?: string | null;
}) {
  const rpcName = "set_project_programming_pendencia_flag";
  const { data, error } = await params.supabase.rpc(rpcName, {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_is_pendencia: params.isPendencia,
    p_reason: params.reason,
    p_description: params.description ?? null,
    p_resolve_pendencia_de_id: params.resolvePendenciaDeId ?? null,
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
    message: result.message ?? "Pendencia atualizada com sucesso.",
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

// Cobre em branco/PARCIAL_PLANEJADO/PARCIAL_NAO_PLANEJADO/BENEFICIO_ATINGIDO (edicao
// manual). CONCLUIDO/ANTECIPADO continuam so via complete/reopen acima; PENDENCIA virou
// flag (set_project_programming_pendencia_flag).
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
