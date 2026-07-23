import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser, type AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { requirePageAction, type PageAction } from "@/lib/server/pageAuthorization";

import {
  addProgrammingTeamViaRpc,
  cancelProgrammingStageViaRpc,
  changeCompletedStageWorkStatusViaRpc,
  completeProgrammingStageViaRpc,
  postponeProgrammingStageViaRpc,
  reopenProgrammingStageViaRpc,
  removeProgrammingTeamViaRpc,
  correctProgrammingStageDateViaRpc,
  saveProgrammingStageViaRpc,
  setProgrammingPendenciaFlagViaRpc,
  setProgrammingWorkCompletionStatusViaRpc,
} from "./rpc";
import { fetchProgrammingHistory, fetchProgrammingStageById } from "./queries";
import {
  normalizeIsoDate,
  normalizeNonNegativeDecimal,
  normalizeNullableText,
  normalizeOptionalTime,
  normalizePeriod,
  normalizePositiveInteger,
  normalizeText,
  normalizeUniqueTextArray,
} from "./normalizers";
import type {
  AddTeamPayload,
  CancelStagePayload,
  CompleteStagePayload,
  PostponeStagePayload,
  RemoveTeamPayload,
  ReopenStagePayload,
  ChangeCompletedWorkStatusPayload,
  CorrectStageDatePayload,
  SaveProgrammingStagePayload,
  SetPendenciaFlagPayload,
  SetWorkCompletionStatusPayload,
} from "./types";

export const PROGRAMMING_NORMALIZADA_PAGE_KEY = "programacao-normalizada";

// Permissoes granulares por operacao (padrao CLAUDE.md: page_key propria checada
// DENTRO da operacao; as demais operacoes seguem sob a permissao da tela).
// Registradas na migration 328.
const PROGRAMMING_COMPLETE_PAGE_KEY = "programacao-concluir";
const PROGRAMMING_PENDENCIA_PAGE_KEY = "programacao-pendencia";
const PROGRAMMING_CORRECT_DATE_PAGE_KEY = "programacao-corrigir-data";

async function authorizeGranularAction(context: AuthenticatedAppUserContext, pageKey: string) {
  const authorization = await requirePageAction({ context, pageKey, action: "read" });
  if (authorization.allowed) return null;

  return NextResponse.json(
    { message: authorization.error.message, code: authorization.error.code },
    { status: authorization.error.status },
  );
}

function normalizeDocumentsPayload(documents: SaveProgrammingStagePayload["documents"] | undefined) {
  const normalized: Record<string, { number: string | null; includedAt: string | null; deliveredAt: string | null }> = {};

  for (const key of ["sgd", "pi", "pep"] as const) {
    const entry = documents?.[key];
    normalized[key] = {
      number: normalizeNullableText(entry?.number),
      includedAt: normalizeIsoDate(entry?.includedAt),
      deliveredAt: normalizeIsoDate(entry?.deliveredAt),
    };
  }

  return normalized;
}

function normalizeActivitiesPayload(activities: SaveProgrammingStagePayload["activities"] | undefined) {
  if (!Array.isArray(activities)) return [];

  return activities
    .map((item) => ({
      catalogId: normalizeText(item?.catalogId),
      quantity: normalizeNonNegativeDecimal(item?.quantity) ?? 0,
    }))
    .filter((item) => item.catalogId && item.quantity > 0);
}

export async function authorizeProgrammingNormalizadaAction(context: AuthenticatedAppUserContext, action: PageAction) {
  const authorization = await requirePageAction({ context, pageKey: PROGRAMMING_NORMALIZADA_PAGE_KEY, action });
  if (authorization.allowed) return null;

  return NextResponse.json(
    { message: authorization.error.message, code: authorization.error.code },
    { status: authorization.error.status },
  );
}

async function authenticate(request: NextRequest, message: string) {
  return resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: message,
    inactiveMessage: "Usuario inativo.",
  });
}

export async function saveProgrammingStage(request: NextRequest, method: "POST" | "PUT") {
  const resolution = await authenticate(
    request,
    method === "POST" ? "Sessao invalida para registrar etapa da programacao." : "Sessao invalida para editar etapa da programacao.",
  );
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizeProgrammingNormalizadaAction(resolution, method === "POST" ? "create" : "update");
  if (authorizationError) return authorizationError;

  const payload = (await request.json().catch(() => null)) as SaveProgrammingStagePayload | null;
  const programmingId = method === "PUT" ? normalizeText(payload?.programmingId) : null;
  const projectId = normalizeText(payload?.projectId);
  const executionDate = normalizeIsoDate(payload?.executionDate);

  if (method === "PUT" && !programmingId) {
    return NextResponse.json({ message: "Informe a etapa a editar." }, { status: 400 });
  }

  if (!projectId || !executionDate) {
    return NextResponse.json({ message: "Projeto e data de execucao sao obrigatorios." }, { status: 400 });
  }

  if (method === "PUT" && !normalizeText(payload?.expectedUpdatedAt)) {
    return NextResponse.json({ message: "Atualize a etapa antes de salvar novamente." }, { status: 409 });
  }

  // Criar/salvar etapa marcada como Pendencia exige a permissao propria (a flag
  // libera a excecao da trava de projeto concluido) — padrao granular do CLAUDE.md.
  const isPendencia = payload?.isPendencia === true;
  if (isPendencia) {
    const pendenciaError = await authorizeGranularAction(resolution, PROGRAMMING_PENDENCIA_PAGE_KEY);
    if (pendenciaError) return pendenciaError;
  }

  const teamIds = payload?.teamIds === undefined ? null : normalizeUniqueTextArray(payload.teamIds);

  const result = await saveProgrammingStageViaRpc({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    actorUserId: resolution.appUser.id,
    projectId,
    executionDate,
    teamIds,
    programmingId,
    expectedUpdatedAt: normalizeNullableText(payload?.expectedUpdatedAt),
    serviceDescription: normalizeNullableText(payload?.serviceDescription),
    period: normalizePeriod(payload?.period),
    startTime: normalizeOptionalTime(payload?.startTime),
    endTime: normalizeOptionalTime(payload?.endTime),
    expectedMinutes: normalizePositiveInteger(payload?.expectedMinutes),
    outageStartTime: normalizeOptionalTime(payload?.outageStartTime),
    outageEndTime: normalizeOptionalTime(payload?.outageEndTime),
    feeder: normalizeNullableText(payload?.feeder),
    campoEletrico: normalizeNullableText(payload?.campoEletrico),
    affectedCustomers: normalizePositiveInteger(payload?.affectedCustomers),
    sgdTypeId: normalizeNullableText(payload?.sgdTypeId),
    electricalEqCatalogId: normalizeNullableText(payload?.electricalEqCatalogId),
    support: normalizeNullableText(payload?.support),
    supportItemId: normalizeNullableText(payload?.supportItemId),
    posteQty: normalizeNonNegativeDecimal(payload?.posteQty),
    estruturaQty: normalizeNonNegativeDecimal(payload?.estruturaQty),
    trafoQty: normalizeNonNegativeDecimal(payload?.trafoQty),
    redeQty: normalizeNonNegativeDecimal(payload?.redeQty),
    note: normalizeNullableText(payload?.note),
    historyReason: normalizeNullableText(payload?.historyReason),
    isPendencia,
    documents: normalizeDocumentsPayload(payload?.documents),
    activities: normalizeActivitiesPayload(payload?.activities),
  });

  if (!result.ok) {
    return NextResponse.json(
      { message: result.message, reason: result.reason ?? null, detail: "detail" in result ? result.detail ?? null : null },
      { status: result.status },
    );
  }

  const stage = await fetchProgrammingStageById({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    programmingId: result.programmingId,
  });

  return NextResponse.json({
    success: true,
    action: result.action,
    programmingId: result.programmingId,
    updatedAt: result.updatedAt,
    stage,
    message: result.message,
  });
}

export async function addProgrammingTeam(request: NextRequest) {
  const resolution = await authenticate(request, "Sessao invalida para adicionar equipe.");
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizeProgrammingNormalizadaAction(resolution, "update");
  if (authorizationError) return authorizationError;

  const payload = (await request.json().catch(() => null)) as AddTeamPayload | null;
  const programmingId = normalizeText(payload?.programmingId);
  const teamId = normalizeText(payload?.teamId);

  if (!programmingId || !teamId) {
    return NextResponse.json({ message: "Informe a etapa e a equipe a adicionar." }, { status: 400 });
  }

  const result = await addProgrammingTeamViaRpc({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    actorUserId: resolution.appUser.id,
    programmingId,
    teamId,
  });

  if (!result.ok) {
    return NextResponse.json({ message: result.message, reason: result.reason ?? null }, { status: result.status });
  }

  const stage = await fetchProgrammingStageById({ supabase: resolution.supabase, tenantId: resolution.appUser.tenant_id, programmingId });

  return NextResponse.json({ success: true, programmingTeamId: result.programmingTeamId, stage, message: result.message });
}

export async function removeProgrammingTeam(request: NextRequest, payload: RemoveTeamPayload) {
  const resolution = await authenticate(request, "Sessao invalida para remover equipe.");
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizeProgrammingNormalizadaAction(resolution, "update");
  if (authorizationError) return authorizationError;

  const programmingTeamId = normalizeText(payload?.programmingTeamId);
  if (!programmingTeamId) {
    return NextResponse.json({ message: "Informe a alocacao de equipe a remover." }, { status: 400 });
  }

  const result = await removeProgrammingTeamViaRpc({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    actorUserId: resolution.appUser.id,
    programmingTeamId,
    expectedUpdatedAt: normalizeNullableText(payload?.expectedUpdatedAt),
  });

  if (!result.ok) {
    return NextResponse.json(
      { message: result.message, reason: result.reason ?? null, currentUpdatedAt: "currentUpdatedAt" in result ? result.currentUpdatedAt ?? null : null },
      { status: result.status },
    );
  }

  return NextResponse.json({ success: true, programmingTeamId: result.programmingTeamId, updatedAt: result.updatedAt, message: result.message });
}

export async function postponeProgrammingStage(request: NextRequest, payload: PostponeStagePayload) {
  const resolution = await authenticate(request, "Sessao invalida para adiar etapa.");
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizeProgrammingNormalizadaAction(resolution, "update");
  if (authorizationError) return authorizationError;

  const programmingId = normalizeText(payload?.programmingId);
  // Ausente/null = "deixar em espera" (ADIADA sem data); com data = remarcar.
  const newExecutionDate = normalizeIsoDate(payload?.newExecutionDate);
  const reason = normalizeNullableText(payload?.reason);
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt);

  if (!programmingId || !reason) {
    return NextResponse.json({ message: "Informe a etapa e o motivo do adiamento." }, { status: 400 });
  }

  if (!expectedUpdatedAt) {
    return NextResponse.json({ message: "Atualize a etapa antes de adiar." }, { status: 409 });
  }

  const result = await postponeProgrammingStageViaRpc({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    actorUserId: resolution.appUser.id,
    programmingId,
    newExecutionDate,
    reason,
    expectedUpdatedAt,
  });

  if (!result.ok) {
    return NextResponse.json(
      { message: result.message, reason: result.reason ?? null, currentUpdatedAt: "currentUpdatedAt" in result ? result.currentUpdatedAt ?? null : null },
      { status: result.status },
    );
  }

  return NextResponse.json({
    success: true,
    programmingId: result.programmingId,
    updatedAt: result.updatedAt,
    message: result.message,
  });
}

export async function setProgrammingPendenciaFlag(request: NextRequest, payload: SetPendenciaFlagPayload) {
  const resolution = await authenticate(request, "Sessao invalida para alterar pendencia.");
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizeProgrammingNormalizadaAction(resolution, "update");
  if (authorizationError) return authorizationError;

  const pendenciaError = await authorizeGranularAction(resolution, PROGRAMMING_PENDENCIA_PAGE_KEY);
  if (pendenciaError) return pendenciaError;

  const programmingId = normalizeText(payload?.programmingId);
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt);
  const reason = normalizeNullableText(payload?.reason);

  if (!programmingId) {
    return NextResponse.json({ message: "Informe a etapa a alterar." }, { status: 400 });
  }

  if (!reason) {
    return NextResponse.json({ message: "Informe o motivo para marcar/desmarcar a pendencia." }, { status: 400 });
  }

  if (!expectedUpdatedAt) {
    return NextResponse.json({ message: "Atualize a etapa antes de alterar a pendencia." }, { status: 409 });
  }

  const result = await setProgrammingPendenciaFlagViaRpc({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    actorUserId: resolution.appUser.id,
    programmingId,
    isPendencia: payload?.isPendencia === true,
    reason,
    description: normalizeNullableText(payload?.description),
    resolvePendenciaDeId: normalizeNullableText(payload?.resolvePendenciaDeId),
    expectedUpdatedAt,
  });

  if (!result.ok) {
    return NextResponse.json(
      { message: result.message, reason: result.reason ?? null, currentUpdatedAt: "currentUpdatedAt" in result ? result.currentUpdatedAt ?? null : null },
      { status: result.status },
    );
  }

  return NextResponse.json({
    success: true,
    programmingId: result.programmingId,
    updatedAt: result.updatedAt,
    message: result.message,
  });
}

export async function cancelProgrammingStage(request: NextRequest, payload: CancelStagePayload) {
  const resolution = await authenticate(request, "Sessao invalida para cancelar etapa.");
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizeProgrammingNormalizadaAction(resolution, "cancel");
  if (authorizationError) return authorizationError;

  const programmingId = normalizeText(payload?.programmingId);
  const reason = normalizeNullableText(payload?.reason);
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt);

  if (!programmingId || !reason) {
    return NextResponse.json({ message: "Informe a etapa e o motivo do cancelamento." }, { status: 400 });
  }

  if (!expectedUpdatedAt) {
    return NextResponse.json({ message: "Atualize a etapa antes de cancelar." }, { status: 409 });
  }

  const result = await cancelProgrammingStageViaRpc({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    actorUserId: resolution.appUser.id,
    programmingId,
    reason,
    expectedUpdatedAt,
  });

  if (!result.ok) {
    return NextResponse.json(
      { message: result.message, reason: result.reason ?? null, currentUpdatedAt: "currentUpdatedAt" in result ? result.currentUpdatedAt ?? null : null },
      { status: result.status },
    );
  }

  return NextResponse.json({ success: true, programmingId: result.programmingId, updatedAt: result.updatedAt, message: result.message });
}

export async function completeProgrammingStage(request: NextRequest, payload: CompleteStagePayload) {
  const resolution = await authenticate(request, "Sessao invalida para concluir etapa.");
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizeProgrammingNormalizadaAction(resolution, "update");
  if (authorizationError) return authorizationError;

  const completeError = await authorizeGranularAction(resolution, PROGRAMMING_COMPLETE_PAGE_KEY);
  if (completeError) return completeError;

  const programmingId = normalizeText(payload?.programmingId);
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt);

  if (!programmingId) {
    return NextResponse.json({ message: "Informe a etapa a concluir." }, { status: 400 });
  }

  if (!expectedUpdatedAt) {
    return NextResponse.json({ message: "Atualize a etapa antes de concluir." }, { status: 409 });
  }

  const result = await completeProgrammingStageViaRpc({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    actorUserId: resolution.appUser.id,
    programmingId,
    expectedUpdatedAt,
  });

  if (!result.ok) {
    return NextResponse.json(
      { message: result.message, reason: result.reason ?? null, currentUpdatedAt: "currentUpdatedAt" in result ? result.currentUpdatedAt ?? null : null },
      { status: result.status },
    );
  }

  return NextResponse.json({
    success: true,
    programmingId: result.programmingId,
    updatedAt: result.updatedAt,
    anticipatedCount: result.anticipatedCount,
    message: result.message,
  });
}

export async function reopenProgrammingStage(request: NextRequest, payload: ReopenStagePayload) {
  const resolution = await authenticate(request, "Sessao invalida para reabrir etapa.");
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizeProgrammingNormalizadaAction(resolution, "update");
  if (authorizationError) return authorizationError;

  const completeError = await authorizeGranularAction(resolution, PROGRAMMING_COMPLETE_PAGE_KEY);
  if (completeError) return completeError;

  const programmingId = normalizeText(payload?.programmingId);
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt);

  if (!programmingId) {
    return NextResponse.json({ message: "Informe a etapa a reabrir." }, { status: 400 });
  }

  if (!expectedUpdatedAt) {
    return NextResponse.json({ message: "Atualize a etapa antes de reabrir." }, { status: 409 });
  }

  const result = await reopenProgrammingStageViaRpc({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    actorUserId: resolution.appUser.id,
    programmingId,
    expectedUpdatedAt,
  });

  if (!result.ok) {
    return NextResponse.json(
      { message: result.message, reason: result.reason ?? null, currentUpdatedAt: "currentUpdatedAt" in result ? result.currentUpdatedAt ?? null : null },
      { status: result.status },
    );
  }

  return NextResponse.json({
    success: true,
    programmingId: result.programmingId,
    updatedAt: result.updatedAt,
    restoredCount: result.restoredCount,
    message: result.message,
  });
}

export async function setProgrammingWorkCompletionStatus(request: NextRequest, payload: SetWorkCompletionStatusPayload) {
  const resolution = await authenticate(request, "Sessao invalida para alterar Estado do trabalho.");
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizeProgrammingNormalizadaAction(resolution, "update");
  if (authorizationError) return authorizationError;

  const programmingId = normalizeText(payload?.programmingId);
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt);
  const workCompletionStatus = normalizeNullableText(payload?.workCompletionStatus);

  if (!programmingId) {
    return NextResponse.json({ message: "Informe a etapa a alterar." }, { status: 400 });
  }

  if (!expectedUpdatedAt) {
    return NextResponse.json({ message: "Atualize a etapa antes de mudar o Estado do trabalho." }, { status: 409 });
  }

  const result = await setProgrammingWorkCompletionStatusViaRpc({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    actorUserId: resolution.appUser.id,
    programmingId,
    workCompletionStatus,
    expectedUpdatedAt,
  });

  if (!result.ok) {
    return NextResponse.json(
      { message: result.message, reason: result.reason ?? null, currentUpdatedAt: "currentUpdatedAt" in result ? result.currentUpdatedAt ?? null : null },
      { status: result.status },
    );
  }

  return NextResponse.json({
    success: true,
    programmingId: result.programmingId,
    updatedAt: result.updatedAt,
    message: result.message,
  });
}

export async function changeCompletedStageWorkStatus(request: NextRequest, payload: ChangeCompletedWorkStatusPayload) {
  const resolution = await authenticate(request, "Sessao invalida para alterar Estado do trabalho.");
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizeProgrammingNormalizadaAction(resolution, "update");
  if (authorizationError) return authorizationError;

  const completeError = await authorizeGranularAction(resolution, PROGRAMMING_COMPLETE_PAGE_KEY);
  if (completeError) return completeError;

  const programmingId = normalizeText(payload?.programmingId);
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt);
  const newWorkCompletionStatus = normalizeNullableText(payload?.newWorkCompletionStatus);

  if (!programmingId) {
    return NextResponse.json({ message: "Informe a etapa a alterar." }, { status: 400 });
  }

  if (!expectedUpdatedAt) {
    return NextResponse.json({ message: "Atualize a etapa antes de mudar o Estado do trabalho." }, { status: 409 });
  }

  const result = await changeCompletedStageWorkStatusViaRpc({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    actorUserId: resolution.appUser.id,
    programmingId,
    newWorkCompletionStatus,
    expectedUpdatedAt,
  });

  if (!result.ok) {
    return NextResponse.json(
      { message: result.message, reason: result.reason ?? null, currentUpdatedAt: "currentUpdatedAt" in result ? result.currentUpdatedAt ?? null : null },
      { status: result.status },
    );
  }

  return NextResponse.json({
    success: true,
    programmingId: result.programmingId,
    updatedAt: result.updatedAt,
    message: result.message,
  });
}

// Corrigir data (achado 10): permissao PROPRIA (programacao-corrigir-data), pois
// aceita data para tras. Mantem o registro e o status; remarcar continua no Adiar.
export async function correctProgrammingStageDate(request: NextRequest, payload: CorrectStageDatePayload) {
  const resolution = await authenticate(request, "Sessao invalida para corrigir a data da etapa.");
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizeProgrammingNormalizadaAction(resolution, "update");
  if (authorizationError) return authorizationError;

  const correctDateError = await authorizeGranularAction(resolution, PROGRAMMING_CORRECT_DATE_PAGE_KEY);
  if (correctDateError) return correctDateError;

  const programmingId = normalizeText(payload?.programmingId);
  const newExecutionDate = normalizeIsoDate(payload?.newExecutionDate);
  const reason = normalizeNullableText(payload?.reason);
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt);

  if (!programmingId || !newExecutionDate) {
    return NextResponse.json({ message: "Informe a etapa e a data correta." }, { status: 400 });
  }

  if (!reason) {
    return NextResponse.json({ message: "Informe o motivo da correcao de data." }, { status: 400 });
  }

  if (!expectedUpdatedAt) {
    return NextResponse.json({ message: "Atualize a etapa antes de corrigir a data." }, { status: 409 });
  }

  const result = await correctProgrammingStageDateViaRpc({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    actorUserId: resolution.appUser.id,
    programmingId,
    newExecutionDate,
    reason,
    expectedUpdatedAt,
  });

  if (!result.ok) {
    return NextResponse.json(
      { message: result.message, reason: result.reason ?? null, currentUpdatedAt: "currentUpdatedAt" in result ? result.currentUpdatedAt ?? null : null },
      { status: result.status },
    );
  }

  return NextResponse.json({
    success: true,
    programmingId: result.programmingId,
    updatedAt: result.updatedAt,
    message: result.message,
  });
}

export async function getProgrammingHistoryResponse(request: NextRequest, programmingId: string) {
  const resolution = await authenticate(request, "Sessao invalida para consultar historico.");
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizeProgrammingNormalizadaAction(resolution, "read");
  if (authorizationError) return authorizationError;

  const history = await fetchProgrammingHistory({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    programmingId,
  });

  return NextResponse.json({
    history: history.map((item) => ({
      id: item.id,
      changedAt: item.created_at,
      actionType: item.action_type,
      changedByName: item.changed_by_name,
      reason: normalizeText(item.reason),
      changes: item.changes ?? {},
      metadata: item.metadata ?? {},
      programmingTeamId: item.programming_team_id,
    })),
  });
}
