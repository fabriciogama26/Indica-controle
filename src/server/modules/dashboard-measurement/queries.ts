// Leitores Supabase do Dashboard Medicao / Dashboard Equipes.
//
// Sairam de `controller.ts` para o arquivo caber no teto de 1.500 linhas de
// `controller.ts`. Aqui nao ha `NextRequest`/`NextResponse`: cada funcao recebe o
// client ja autenticado e o `tenant_id` resolvido pela sessao, e devolve dado bruto.
//
// Toda leitura em lote e fatiada por `MEASUREMENT_ORDER_ITEMS_CHUNK_SIZE`: o
// PostgREST entrega no maximo 1.000 linhas por resposta e NAO sinaliza o corte,
// entao um `in (...)` com muitos ids devolveria resultado incompleto com status 200.
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { fetchWorkCompletionTimelineByProject } from "@/server/modules/programacao-normalizada";

import {
  isCanceledProgrammingStatus,
  normalizeCompletionStatus,
  normalizeIsoDate,
  normalizeText,
} from "./normalizers";
import type {
  MeasurementCommercialMemberRow,
  MeasurementOrderItemRow,
  ProgrammingCompletionRow,
  ProgrammingCompletionTimelineItem,
  ProjectMeta,
  ProjectTestRow,
  TeamCategoryLookupRow,
} from "./types";

export const MEASUREMENT_ORDER_ITEMS_CHUNK_SIZE = 200;

function chunkIds(ids: string[]) {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += MEASUREMENT_ORDER_ITEMS_CHUNK_SIZE) {
    chunks.push(unique.slice(index, index + MEASUREMENT_ORDER_ITEMS_CHUNK_SIZE));
  }
  return chunks;
}

// Ordem comercial nao tem encarregado: quem executou sao os DOIS eletricistas
// gravados por ordem em `project_commercial_measurement_order_members`, com
// `sort_order` 1 e 2 (migration 415). Devolve os nomes na ordem dos slots.
export async function fetchCommercialMemberNamesByOrder(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  orderIds: string[];
}) {
  const chunks = chunkIds(params.orderIds);
  if (!chunks.length) {
    return { data: new Map<string, string[]>(), error: null };
  }

  const results = await Promise.all(chunks.map((chunk) => (
    params.supabase
      .from("project_commercial_measurement_order_members")
      .select("measurement_order_id, person_name_snapshot, sort_order")
      .eq("tenant_id", params.tenantId)
      .in("measurement_order_id", chunk)
      .order("sort_order", { ascending: true })
      .returns<MeasurementCommercialMemberRow[]>()
  )));

  const failedResult = results.find((result) => result.error);
  if (failedResult?.error) {
    return { data: new Map<string, string[]>(), error: failedResult.error };
  }

  const byOrder = new Map<string, MeasurementCommercialMemberRow[]>();
  for (const row of results.flatMap((result) => result.data ?? [])) {
    const rows = byOrder.get(row.measurement_order_id) ?? [];
    rows.push(row);
    byOrder.set(row.measurement_order_id, rows);
  }

  const data = new Map<string, string[]>();
  for (const [orderId, rows] of byOrder) {
    const names = rows
      .sort((left, right) => Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0))
      .map((row) => normalizeText(row.person_name_snapshot))
      .filter(Boolean);
    if (names.length) data.set(orderId, names);
  }

  return { data, error: null };
}

export async function fetchProjectMetaMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projectIds: string[];
}) {
  const projectIds = Array.from(new Set(params.projectIds.filter(Boolean)));
  if (!projectIds.length) return new Map<string, ProjectMeta>();

  const { data, error } = await params.supabase
    .from("project_with_labels")
    .select("id, is_test, is_third_party, service_center, service_center_text, service_type_text")
    .eq("tenant_id", params.tenantId)
    .in("id", projectIds)
    .returns<ProjectTestRow[]>();

  if (error) return new Map<string, ProjectMeta>();

  return new Map((data ?? []).map((item) => [
    item.id,
    {
      isTest: Boolean(item.is_test),
      isThirdParty: Boolean(item.is_third_party),
      serviceCenterId: item.service_center,
      serviceCenterName: normalizeText(item.service_center_text) || (item.service_center ? "Centro nao identificado" : "Centro nao informado"),
      serviceTypeText: normalizeText(item.service_type_text),
    },
  ]));
}

export async function fetchProjectCompletionTimeline(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projectIds: string[];
  endDate: string;
}) {
  const projectIds = Array.from(new Set(params.projectIds.filter(Boolean)));
  if (!projectIds.length) return new Map<string, ProgrammingCompletionTimelineItem[]>();

  // Fonte: `programming` (modelo normalizado), via a fachada da Programacao. A
  // mesma query existia duplicada aqui e no Dashboard Carteira Operacional.
  const { rows, error } = await fetchWorkCompletionTimelineByProject({
    supabase: params.supabase,
    tenantId: params.tenantId,
    projectIds,
    endDate: params.endDate,
  });

  if (error) return new Map<string, ProgrammingCompletionTimelineItem[]>();

  const result = new Map<string, ProgrammingCompletionTimelineItem[]>();
  for (const row of rows as ProgrammingCompletionRow[]) {
    if (isCanceledProgrammingStatus(row.status)) continue;

    const status = normalizeCompletionStatus(row.work_completion_status);
    const hasPendingFlag = row.is_pendencia === true;
    const executionDate = normalizeIsoDate(row.execution_date);
    if ((status === "NAO_INFORMADO" && !hasPendingFlag) || !executionDate) continue;

    const current = result.get(row.project_id) ?? [];
    current.push({
      executionDate,
      status,
      hasPendingFlag,
      updatedAt: row.updated_at,
    });
    result.set(row.project_id, current);
  }

  for (const items of result.values()) {
    items.sort((left, right) => {
      const byExecutionDate = right.executionDate.localeCompare(left.executionDate);
      if (byExecutionDate !== 0) {
        return byExecutionDate;
      }

      return right.updatedAt.localeCompare(left.updatedAt);
    });
  }

  return result;
}

// O catalogo e fechado a TECNICA/COMERCIAL pelo CHECK `team_categories_code_allowed_check`
// (migration 415), entao a lista inteira pode alimentar o seletor da tela sem risco de
// aparecer opcao que `fetchTeamIdsByMeasurementMode` nao saberia recortar. O `name` e por
// tenant: quem renomeia a operacao ve o nome dele, nao o codigo.
export async function fetchTeamCategories(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
}) {
  const { data, error } = await params.supabase
    .from("team_categories")
    .select("id, code, name, sort_order")
    .eq("tenant_id", params.tenantId)
    .eq("ativo", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<TeamCategoryLookupRow[]>();

  if (error) return null;
  return data ?? [];
}

export async function fetchMeasurementOrderItems(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  orderIds: string[];
}) {
  const orderIds = Array.from(new Set(params.orderIds.filter(Boolean)));
  if (!orderIds.length) {
    return { data: [] as MeasurementOrderItemRow[], error: null };
  }

  const chunks: string[][] = [];
  for (let index = 0; index < orderIds.length; index += MEASUREMENT_ORDER_ITEMS_CHUNK_SIZE) {
    chunks.push(orderIds.slice(index, index + MEASUREMENT_ORDER_ITEMS_CHUNK_SIZE));
  }

  const results = await Promise.all(chunks.map((chunk) => (
    params.supabase
      .from("project_measurement_order_items")
      .select("measurement_order_id, total_value")
      .eq("tenant_id", params.tenantId)
      .eq("is_active", true)
      .in("measurement_order_id", chunk)
      .returns<MeasurementOrderItemRow[]>()
  )));

  const failedResult = results.find((result) => result.error);
  if (failedResult?.error) {
    return { data: [] as MeasurementOrderItemRow[], error: failedResult.error };
  }

  return {
    data: results.flatMap((result) => result.data ?? []),
    error: null,
  };
}
