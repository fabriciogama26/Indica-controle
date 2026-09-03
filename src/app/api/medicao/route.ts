import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { authorizePageAction } from "@/lib/server/routeAuthorization";
import { parsePagination } from "@/lib/server/apiHelpers";

import type { MeasurementOrderStatus, SaveMeasurementBatchPayload, SaveMeasurementBatchRpcResult, SaveMeasurementPayload, SaveMeasurementRpcResult, SetMeasurementStatusRpcResult, UpdateStatusPayload } from "@/server/modules/medicao/types";
import { parseMeasurementOrderListFilters, findDuplicateMeasurementActivityId, normalizeIsoDate, normalizeMeasurementItems, normalizeMeasurementKind, normalizePositiveIntegerArray, normalizePositiveNumber, normalizeText, normalizeUuid } from "@/server/modules/medicao/normalizers";
import { fetchMeasurementOrderDetail, loadHistory, measurementModuleMigrationHint } from "@/server/modules/medicao/queries";
import { listMeasurementOrdersPage } from "@/server/modules/medicao/list";
export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para consultar ordens de medicao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const historyOrderId = normalizeUuid(request.nextUrl.searchParams.get("historyOrderId"));
  if (historyOrderId) {
    const history = await loadHistory({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      orderId: historyOrderId,
    });

    if (history === null) {
      return NextResponse.json({ message: "Falha ao carregar historico da ordem de medicao." }, { status: 500 });
    }

    return NextResponse.json({ history });
  }

  const orderId = normalizeUuid(request.nextUrl.searchParams.get("orderId"));
  if (orderId) {
    const detailWindowEndDate = normalizeIsoDate(request.nextUrl.searchParams.get("endDate"));
    const detail = await fetchMeasurementOrderDetail({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      orderId,
      windowEndDate: detailWindowEndDate,
    });

    if (!detail) {
      return NextResponse.json({ message: "Ordem de medicao nao encontrada." }, { status: 404 });
    }

    return NextResponse.json({ order: detail });
  }
  const parsed = parseMeasurementOrderListFilters(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ message: parsed.message }, { status: 400 });
  }
  const { page, pageSize } = parsePagination(request.nextUrl.searchParams, {
    defaultPageSize: 20,
    maxPageSize: 500,
    maxPage: 10_000,
  });

  const listResult = await listMeasurementOrdersPage({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    ...parsed.filters,
    page,
    pageSize,
  });

  if (!listResult.ok) {
    return NextResponse.json({ message: listResult.message }, { status: 500 });
  }

  return NextResponse.json({
    orders: listResult.orders,
    pagination: {
      page: page ?? 1,
      pageSize: pageSize ?? 20,
      total: listResult.total,
    },
  });
}

// Chamada quando a RPC de save/status devolve 409 (CONCURRENT_MODIFICATION /
// MEASUREMENT_ORDER_LOCKED): devolve o estado atual da ordem (ja reconsultado pelo
// chamador) para o cliente saber quem alterou e o que estava tentando mudar, em vez
// de so uma mensagem generica.
function buildMeasurementConflictResponse(params: {
  detail: Awaited<ReturnType<typeof fetchMeasurementOrderDetail>>;
  message: string;
  reason: string | null;
  status: number;
  changedFields?: Record<string, { from: unknown; to: unknown }>;
}) {
  const { detail } = params;
  return NextResponse.json(
    {
      message: params.message,
      reason: params.reason,
      currentRecord: detail,
      currentUpdatedAt: detail?.updatedAt ?? null,
      updatedBy: detail?.updatedByName ?? null,
      ...(params.changedFields ? { changedFields: params.changedFields } : {}),
    },
    { status: params.status },
  );
}

function buildMeasurementChangedFields(
  payload: SaveMeasurementPayload | null,
  current: Awaited<ReturnType<typeof fetchMeasurementOrderDetail>>,
): Record<string, { from: unknown; to: unknown }> {
  if (!payload || !current) return {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const add = (field: string, currentValue: unknown, attemptedValue: unknown) => {
    if (attemptedValue === undefined) return;
    if (String(currentValue ?? "") === String(attemptedValue ?? "")) return;
    changes[field] = { from: currentValue, to: attemptedValue };
  };
  add("projectId", current.projectId, normalizeUuid(payload.projectId));
  add("teamId", current.teamId, normalizeUuid(payload.teamId));
  add("executionDate", current.executionDate, normalizeIsoDate(payload.executionDate));
  add("measurementDate", current.measurementDate, normalizeIsoDate(payload.measurementDate));
  add("notes", current.notes, normalizeText(payload.notes) || null);
  return changes;
}

async function saveMeasurementOrder(request: NextRequest, method: "POST" | "PUT") {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para salvar ordem de medicao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizePageAction(resolution, "medicao", method === "POST" ? "create" : "update");
  if (authorizationError) {
    return authorizationError;
  }

  const payload = (await request.json().catch(() => null)) as SaveMeasurementPayload | null;
  const orderId = normalizeUuid(payload?.id);
  const programmingId = normalizeUuid(payload?.programmingId);
  const projectId = normalizeUuid(payload?.projectId);
  const teamId = normalizeUuid(payload?.teamId);
  const executionDate = normalizeIsoDate(payload?.executionDate);
  const measurementDate = normalizeIsoDate(payload?.measurementDate);
  const voicePoint = normalizePositiveNumber(payload?.voicePoint);
  const manualRate = normalizePositiveNumber(payload?.manualRate);
  const measurementKind = normalizeMeasurementKind(payload?.measurementKind);
  const noProductionReasonId = normalizeUuid(payload?.noProductionReasonId);
  const notes = normalizeText(payload?.notes) || null;
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt) || null;

  if (method === "PUT" && !orderId) {
    return NextResponse.json({ message: "Ordem de medicao invalida para edicao." }, { status: 400 });
  }

  if (method === "PUT" && (!teamId || !executionDate)) {
    return NextResponse.json({ message: "Na edicao, Equipe e Data de execucao sao obrigatorios." }, { status: 400 });
  }

  if (method === "POST" && !programmingId && (!teamId || !executionDate)) {
    return NextResponse.json({ message: "Informe Equipe e Data de execucao para cadastrar a medicao sem programacao." }, { status: 400 });
  }

  if (!measurementDate) {
    return NextResponse.json({ message: "Data da medicao e obrigatoria." }, { status: 400 });
  }

  const items = normalizeMeasurementItems(payload?.items);

  if (measurementKind === "COM_PRODUCAO") {
    if (!projectId) {
      return NextResponse.json({ message: "Projeto e obrigatorio para medicao com producao." }, { status: 400 });
    }

    if (noProductionReasonId) {
      return NextResponse.json({ message: "Motivo sem producao so pode ser informado para tipo Sem producao." }, { status: 400 });
    }

    if (voicePoint === null || manualRate === null) {
      return NextResponse.json({ message: "Para medicao com producao, pontos e taxa manual sao obrigatorios." }, { status: 400 });
    }

    if (!items.length) {
      return NextResponse.json({ message: "Informe ao menos uma atividade valida na ordem de medicao." }, { status: 400 });
    }
  }

  if (measurementKind === "SEM_PRODUCAO") {
    if (!noProductionReasonId) {
      return NextResponse.json({ message: "Selecione o motivo de sem producao." }, { status: 400 });
    }

    if (items.length) {
      return NextResponse.json({ message: "Medicao sem producao nao pode conter atividades." }, { status: 400 });
    }
  }

  if (findDuplicateMeasurementActivityId(items)) {
    return NextResponse.json(
      { message: "A mesma atividade nao pode ser repetida na ordem de medicao.", reason: "DUPLICATE_MEASUREMENT_ACTIVITY" },
      { status: 400 },
    );
  }

  const { data, error } = await resolution.supabase.rpc("save_project_measurement_order", {
    p_tenant_id: resolution.appUser.tenant_id,
    p_actor_user_id: resolution.appUser.id,
    p_measurement_order_id: method === "PUT" ? orderId : null,
    p_programming_id: programmingId,
    p_project_id: projectId,
    p_team_id: teamId,
    p_execution_date: executionDate,
    p_measurement_date: measurementDate,
    p_voice_point: voicePoint ?? 1,
    p_manual_rate: manualRate ?? 1,
    p_notes: notes,
    p_measurement_kind: measurementKind,
    p_no_production_reason_id: measurementKind === "SEM_PRODUCAO" ? noProductionReasonId : null,
    p_items: items,
    p_expected_updated_at: expectedUpdatedAt,
  });

  if (error) {
    const hint = measurementModuleMigrationHint(error.message);
    return NextResponse.json({ message: `Falha ao salvar ordem de medicao.${hint}`.trim() }, { status: 500 });
  }

  const result = (data ?? {}) as SaveMeasurementRpcResult;
  if (result.success !== true) {
    const status = Number(result.status ?? 400);
    if (status === 409 && orderId) {
      const detail = await fetchMeasurementOrderDetail({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        orderId,
      });
      return buildMeasurementConflictResponse({
        detail,
        message: result.message ?? "Falha ao salvar ordem de medicao.",
        reason: result.reason ?? null,
        status,
        changedFields: buildMeasurementChangedFields(payload, detail),
      });
    }
    return NextResponse.json({ message: result.message ?? "Falha ao salvar ordem de medicao.", reason: result.reason ?? null }, { status });
  }

  const persistedOrderId = normalizeUuid(result.measurement_order_id ?? "");
  if (!persistedOrderId) {
    return NextResponse.json({ message: "Ordem salva, mas nao foi possivel retornar o identificador." }, { status: 500 });
  }

  const detail = await fetchMeasurementOrderDetail({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    orderId: persistedOrderId,
  });

  return NextResponse.json({
    success: true,
    id: persistedOrderId,
    updatedAt: result.updated_at ?? null,
    order: detail,
    message: result.message ?? "Ordem de medicao salva com sucesso.",
  });
}

async function saveMeasurementOrderBatchPartial(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para importar medicao em lote.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizePageAction(resolution, "medicao", "import");
  if (authorizationError) {
    return authorizationError;
  }

  const payload = (await request.json().catch(() => null)) as SaveMeasurementBatchPayload | null;
  const rowsInput = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!rowsInput.length) {
    return NextResponse.json({ message: "Nenhuma linha valida enviada para importacao em massa." }, { status: 400 });
  }

  const rows = rowsInput.map((row, index) => {
    const executionDate = normalizeIsoDate(row.executionDate);
    const measurementDate = normalizeIsoDate(row.measurementDate) ?? executionDate;
    const rowNumbers = normalizePositiveIntegerArray(row.rowNumbers);
    return {
      rowNumbers: rowNumbers.length ? rowNumbers : [index + 2],
      programmingId: normalizeUuid(row.programmingId),
      projectId: normalizeUuid(row.projectId),
      teamId: normalizeUuid(row.teamId),
      executionDate,
      measurementDate,
      voicePoint: normalizePositiveNumber(row.voicePoint) ?? 1,
      manualRate: normalizePositiveNumber(row.manualRate) ?? null,
      measurementKind: normalizeMeasurementKind(row.measurementKind),
      noProductionReasonId: normalizeUuid(row.noProductionReasonId),
      notes: normalizeText(row.notes) || null,
      items: normalizeMeasurementItems(row.items),
    };
  });

  const { data, error } = await resolution.supabase.rpc("save_project_measurement_order_batch_partial", {
    p_tenant_id: resolution.appUser.tenant_id,
    p_actor_user_id: resolution.appUser.id,
    p_rows: rows,
  });

  if (error) {
    const hint = measurementModuleMigrationHint(error.message);
    return NextResponse.json({ message: `Falha ao importar medicao em lote.${hint}`.trim() }, { status: 500 });
  }

  const result = (data ?? {}) as SaveMeasurementBatchRpcResult;
  if (result.success !== true) {
    return NextResponse.json(
      { message: result.message ?? "Falha ao importar medicao em lote.", reason: result.reason ?? null },
      { status: Number(result.status ?? 400) },
    );
  }

  const normalizedResults = (Array.isArray(result.results) ? result.results : []).map((item) => ({
    rowIndex: Number(item.rowIndex ?? 0) || null,
    rowNumbers: normalizePositiveIntegerArray(item.rowNumbers),
    success: item.success === true,
    alreadyRegistered: item.alreadyRegistered === true,
    reason: normalizeText(item.reason) || null,
    message: normalizeText(item.message) || "Falha ao processar linha do lote.",
    measurementOrderId: normalizeUuid(item.measurementOrderId ?? "") ?? null,
  }));

  return NextResponse.json({
    success: true,
    status: Number(result.status ?? 200),
    savedCount: Number(result.savedCount ?? 0),
    errorCount: Number(result.errorCount ?? 0),
    alreadyRegisteredCount: Number(result.alreadyRegisteredCount ?? 0),
    alreadyRegisteredRows: Number(result.alreadyRegisteredRows ?? 0),
    results: normalizedResults,
    message: normalizeText(result.message) || "Importacao parcial da medicao concluida.",
  });
}

export async function POST(request: NextRequest) {
  const preview = (await request.clone().json().catch(() => null)) as { action?: string } | null;
  const action = normalizeText(preview?.action).toUpperCase();
  if (action === "BATCH_IMPORT_PARTIAL") {
    return saveMeasurementOrderBatchPartial(request);
  }
  return saveMeasurementOrder(request, "POST");
}

export async function PUT(request: NextRequest) {
  return saveMeasurementOrder(request, "PUT");
}

export async function PATCH(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para alterar status da ordem de medicao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as UpdateStatusPayload | null;
  const orderId = normalizeUuid(payload?.id);
  const action = normalizeText(payload?.action).toUpperCase();
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt) || null;
  const reason = normalizeText(payload?.reason) || null;

  const authorizationError = await authorizePageAction(resolution, "medicao", action === "CANCELAR" ? "cancel" : "update");
  if (authorizationError) {
    return authorizationError;
  }


  if (!orderId || (action !== "FECHAR" && action !== "CANCELAR" && action !== "ABRIR")) {
    return NextResponse.json({ message: "Informe ordem e acao valida para atualizar o status." }, { status: 400 });
  }

  if (!expectedUpdatedAt) {
    return NextResponse.json({ message: "Atualize a lista antes de alterar o status da ordem." }, { status: 409 });
  }

  if ((action === "CANCELAR" || action === "ABRIR") && (!reason || reason.length < 10)) {
    return NextResponse.json({ message: action === "ABRIR" ? "Informe motivo da abertura ou descancelamento com no minimo 10 caracteres." : "Informe motivo do cancelamento com no minimo 10 caracteres." }, { status: 400 });
  }

  const { data, error } = await resolution.supabase.rpc("set_project_measurement_order_status", {
    p_tenant_id: resolution.appUser.tenant_id,
    p_actor_user_id: resolution.appUser.id,
    p_measurement_order_id: orderId,
    p_action: action,
    p_reason: reason,
    p_expected_updated_at: expectedUpdatedAt,
  });

  if (error) {
    return NextResponse.json({ message: "Falha ao alterar status da ordem de medicao." }, { status: 500 });
  }

  const result = (data ?? {}) as SetMeasurementStatusRpcResult;
  if (result.success !== true) {
    const status = Number(result.status ?? 400);
    if (status === 409) {
      const detail = await fetchMeasurementOrderDetail({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        orderId,
      });
      const targetStatus: MeasurementOrderStatus = action === "FECHAR" ? "FECHADA" : action === "CANCELAR" ? "CANCELADA" : "ABERTA";
      return buildMeasurementConflictResponse({
        detail,
        message: result.message ?? "Falha ao alterar status da ordem de medicao.",
        reason: result.reason ?? null,
        status,
        changedFields: { status: { from: detail?.status ?? null, to: targetStatus } },
      });
    }
    return NextResponse.json({ message: result.message ?? "Falha ao alterar status da ordem de medicao.", reason: result.reason ?? null }, { status });
  }

  const detail = await fetchMeasurementOrderDetail({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    orderId,
  });

  return NextResponse.json({
    success: true,
    id: orderId,
    updatedAt: result.updated_at ?? null,
    status: result.measurement_status ?? null,
    order: detail,
    message: result.message ?? "Status da ordem de medicao atualizado com sucesso.",
  });
}
