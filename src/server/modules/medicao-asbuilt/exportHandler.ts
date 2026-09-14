// Exportacao do Detalhamento (CSV) da Medicao Asbuilt.
//
// Antes: o navegador listava as ordens e disparava UMA requisicao `?orderId=` por
// ordem, todas ao mesmo tempo (`Promise.allSettled`), ate 500. Cada requisicao
// refazia sessao, permissao, ordem, itens e nomes de usuario — cerca de 8 acessos
// ao banco por ordem. Em 2026-09-14 uma exportacao assim gerou 412+ requisicoes em
// 1,7s contra o banco Nano de producao, antes da queda do mesmo dia.
//
// Agora: uma requisicao, uma resolucao de sessao, e ordens + itens + centro de
// servico lidos em lote. O CSV continua sendo montado no cliente, com a mesma
// formatacao de antes.
import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { loadAllRows, loadRowsInChunks } from "@/lib/server/apiHelpers";
import { authorizePageAction } from "@/lib/server/routeAuthorization";
import { fetchProjectServiceCenterMap, PROJECT_SERVICE_CENTER_FALLBACK } from "@/server/modules/projects/serviceCenters";

import {
  asbuiltMeasurementListFilterConditions,
  parseAsbuiltMeasurementListFilters,
  type AsbuiltMeasurementKindFilter,
  type AsbuiltMeasurementListFilters,
} from "./filters";

const ASBUILT_MEASUREMENT_PAGE_KEY = "medicao-asbuilt";

/** Teto intencional de ordens por exportacao; acima dele a resposta sai marcada como parcial. */
const MAX_EXPORT_ORDERS = 20000;

/**
 * IDs por consulta `.in(...)`. Limita o tamanho da URL (~37 bytes por UUID), nao o numero
 * de linhas — as linhas de cada lote sao paginadas por `loadRowsInChunks`.
 */
const EXPORT_ID_CHUNK_SIZE = 200;

const EXPORT_ORDER_SELECT = "id, asbuilt_number, project_id, project_code_snapshot, service_coverage_end_date, asbuilt_kind, no_production_reason_name_snapshot, status, notes, updated_at";

type ExportOrderRow = {
  id: string;
  asbuilt_number: string;
  project_id: string;
  project_code_snapshot: string;
  service_coverage_end_date: string | null;
  asbuilt_kind: AsbuiltMeasurementKindFilter;
  no_production_reason_name_snapshot: string | null;
  status: string;
  notes: string | null;
  updated_at: string;
};

type ExportOrderItemRow = {
  id: string;
  asbuilt_measurement_order_id: string;
  service_activity_id: string;
  activity_code: string;
  activity_description: string;
  activity_unit: string;
  voice_point: number | string;
  quantity: number | string;
  rate: number | string;
  unit_value: number | string;
  activity_active_snapshot: boolean | null;
  total_value: number | string;
  observation: string | null;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeItem(item: ExportOrderItemRow) {
  return {
    id: item.id,
    activityId: item.service_activity_id,
    code: normalizeText(item.activity_code),
    description: normalizeText(item.activity_description),
    unit: normalizeText(item.activity_unit),
    voicePoint: Number(item.voice_point ?? 0),
    unitValue: Number(item.unit_value ?? 0),
    activityIsActive: item.activity_active_snapshot !== false,
    quantity: Number(item.quantity ?? 0),
    rate: Number(item.rate ?? 0),
    totalValue: Number(item.total_value ?? 0),
    observation: normalizeText(item.observation),
  };
}

async function loadExportOrders(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  filters: AsbuiltMeasurementListFilters;
}) {
  return loadAllRows<ExportOrderRow>(
    (from, to) => {
      let query = params.supabase
        .from("project_asbuilt_measurement_orders")
        .select(EXPORT_ORDER_SELECT)
        .eq("tenant_id", params.tenantId);

      for (const [column, value] of asbuiltMeasurementListFilterConditions(params.filters)) {
        query = query.eq(column, value);
      }

      return query
        // Mesma ordem da listagem, com `id` como desempate para a paginacao ser estavel.
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)
        .returns<ExportOrderRow[]>();
    },
    { maxRows: MAX_EXPORT_ORDERS },
  );
}

async function loadExportItems(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  orderIds: string[];
}) {
  return loadRowsInChunks<ExportOrderItemRow>(
    params.orderIds,
    (chunk, from, to) =>
      params.supabase
        .from("project_asbuilt_measurement_order_items")
        .select("id, asbuilt_measurement_order_id, service_activity_id, activity_code, activity_description, activity_unit, voice_point, quantity, rate, unit_value, activity_active_snapshot, total_value, observation")
        .eq("tenant_id", params.tenantId)
        .eq("is_active", true)
        .in("asbuilt_measurement_order_id", chunk)
        .order("id", { ascending: true })
        .range(from, to)
        .returns<ExportOrderItemRow[]>(),
    { chunkSize: EXPORT_ID_CHUNK_SIZE },
  );
}

// `fetchProjectServiceCenterMap` manda todos os IDs numa unica URL; aqui a lista pode
// ter milhares de projetos, entao a chamada e fatiada para nao estourar a URL.
async function loadExportServiceCenterMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projectIds: string[];
}) {
  const projectIds = Array.from(new Set(params.projectIds.filter(Boolean)));
  const serviceCenterMap = new Map<string, string>();

  for (let index = 0; index < projectIds.length; index += EXPORT_ID_CHUNK_SIZE) {
    const chunkMap = await fetchProjectServiceCenterMap({
      supabase: params.supabase,
      tenantId: params.tenantId,
      projectIds: projectIds.slice(index, index + EXPORT_ID_CHUNK_SIZE),
    });
    for (const [projectId, serviceCenter] of chunkMap) {
      serviceCenterMap.set(projectId, serviceCenter);
    }
  }

  return serviceCenterMap;
}

export async function handleAsbuiltMeasurementExportGet(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para exportar medicao-asbuilt.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizePageAction(resolution, ASBUILT_MEASUREMENT_PAGE_KEY, "export");
  if (authorizationError) {
    return authorizationError;
  }

  const tenantId = resolution.appUser.tenant_id;
  const filters = parseAsbuiltMeasurementListFilters(request.nextUrl.searchParams);

  try {
    const { data: orderRows, error: ordersError } = await loadExportOrders({
      supabase: resolution.supabase,
      tenantId,
      filters,
    });
    if (ordersError) {
      throw ordersError;
    }

    const orders = orderRows ?? [];
    const [{ data: itemRows, error: itemsError }, serviceCenterMap] = await Promise.all([
      loadExportItems({
        supabase: resolution.supabase,
        tenantId,
        orderIds: orders.map((order) => order.id),
      }),
      loadExportServiceCenterMap({
        supabase: resolution.supabase,
        tenantId,
        projectIds: orders.map((order) => order.project_id),
      }),
    ]);
    if (itemsError) {
      throw itemsError;
    }

    const itemsByOrderId = new Map<string, ExportOrderItemRow[]>();
    for (const item of itemRows ?? []) {
      const current = itemsByOrderId.get(item.asbuilt_measurement_order_id);
      if (current) current.push(item);
      else itemsByOrderId.set(item.asbuilt_measurement_order_id, [item]);
    }

    const exportOrders = orders.map((order) => ({
      id: order.id,
      asbuiltMeasurementNumber: normalizeText(order.asbuilt_number),
      projectCode: normalizeText(order.project_code_snapshot),
      projectServiceCenter: serviceCenterMap.get(order.project_id) ?? PROJECT_SERVICE_CENTER_FALLBACK,
      serviceCoverageEndDate: order.service_coverage_end_date,
      asbuiltMeasurementKind: order.asbuilt_kind === "SEM_PRODUCAO" ? "SEM_PRODUCAO" : "COM_PRODUCAO",
      noProductionReasonName: normalizeText(order.no_production_reason_name_snapshot),
      status: order.status,
      notes: normalizeText(order.notes),
      updatedAt: order.updated_at,
      // Mesma ordem do endpoint de detalhe (`activity_code` ascendente).
      items: (itemsByOrderId.get(order.id) ?? [])
        .sort((left, right) => normalizeText(left.activity_code).localeCompare(normalizeText(right.activity_code)))
        .map(normalizeItem),
    }));

    const body = JSON.stringify({
      orders: exportOrders,
      truncated: orders.length >= MAX_EXPORT_ORDERS,
      limit: MAX_EXPORT_ORDERS,
    });
    const size = Buffer.byteLength(body);
    if (size > 102_400) {
      console.warn(`[EGRESS] ${request.nextUrl.pathname} -> ${(size / 1024).toFixed(1)}KB`);
    }

    return new NextResponse(body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    console.error("[medicao-asbuilt] Falha ao exportar detalhamento", {
      tenantId,
      userId: resolution.appUser.id,
      operation: "export-details",
      message: error instanceof Error ? error.message : (error as { message?: string } | null)?.message,
    });
    return NextResponse.json({ message: "Falha ao exportar detalhamento das medicoes asbuilt." }, { status: 500 });
  }
}
