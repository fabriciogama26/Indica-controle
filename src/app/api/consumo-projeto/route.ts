import { NextRequest, NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";

type ProjectRow = {
  id: string;
  sob: string | null;
  is_active: boolean | null;
  is_test?: boolean | null;
  is_withdrawn?: boolean | null;
};

type MaterialRow = {
  id: string;
  codigo: string | null;
  descricao: string | null;
  umb: string | null;
  tipo: string | null;
};

type ForecastRow = {
  material_id: string;
  qty_planned: number | string | null;
  materials: MaterialRow | MaterialRow[] | null;
};

type TransferRow = {
  id: string;
  from_stock_center_id: string;
  to_stock_center_id: string;
  project_id: string;
  entry_date: string;
  updated_at: string | null;
  created_at: string;
};

type TransferItemRow = {
  id: string;
  stock_transfer_id: string;
  material_id: string;
  quantity: number | string | null;
  materials: MaterialRow | MaterialRow[] | null;
};

type TeamOperationRow = {
  transfer_id: string;
  team_id: string;
  operation_kind: "REQUISITION" | "RETURN" | "FIELD_RETURN" | null;
};

type LegacyTeamOperationRow = {
  transfer_id: string;
  team_id: string;
};

type TeamRow = {
  id: string;
  stock_center_id: string | null;
};

type TransferReversalRow = {
  original_stock_transfer_id: string;
  reversal_stock_transfer_id: string;
};

type ItemReversalRow = {
  original_stock_transfer_item_id: string;
  reversal_stock_transfer_item_id: string | null;
};

type TeamStockCenterRow = {
  stock_center_id: string | null;
};

type StockCenterRow = {
  id: string;
  center_type: "OWN" | "THIRD_PARTY" | string | null;
  controls_balance: boolean | null;
  is_active: boolean | null;
};

type StockBalanceRow = {
  material_id: string;
  quantity: number | string | null;
};

type SituationCode =
  | "CONFERIDO"
  | "ABAIXO_COM_ESTOQUE"
  | "ABAIXO_SEM_ESTOQUE"
  | "ACIMA_PREVISTO"
  | "FORA_PREVISTO"
  | "PREVISTO_SEM_REQUISICAO";

type ConsumptionAggregate = {
  materialId: string;
  materialCode: string;
  description: string;
  unit: string;
  materialType: string;
  plannedQuantity: number;
  requisitionQuantity: number;
  returnQuantity: number;
  netQuantity: number;
  deviationQuantity: number;
  stockQuantity: number;
  requiredQuantity: number;
  stockShortageQuantity: number;
  situationCode: SituationCode;
  situationLabel: string;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeCode(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function normalizeUuid(value: unknown) {
  const normalized = normalizeText(value);
  return /^[0-9a-f-]{36}$/i.test(normalized) ? normalized : null;
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function unwrapRelation<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function shouldFallbackToLegacyTeamOperationSelect(error: PostgrestError | null) {
  if (!error) return false;

  const normalized = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return normalized.includes("operation_kind") || error.code === "42703" || error.code === "PGRST204";
}

async function ensureProjectConsumptionPageAccess(context: AuthenticatedAppUserContext) {
  if (context.role.isAdmin) return true;

  const userPermission = await context.supabase
    .from("app_user_page_permissions")
    .select("can_access")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("user_id", context.appUser.id)
    .eq("page_key", "consumo-projeto")
    .maybeSingle<{ can_access: boolean }>();

  if (!userPermission.error && userPermission.data) {
    return Boolean(userPermission.data.can_access);
  }

  if (!context.appUser.role_id) return false;

  const rolePermission = await context.supabase
    .from("role_page_permissions")
    .select("can_access")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("role_id", context.appUser.role_id)
    .eq("page_key", "consumo-projeto")
    .maybeSingle<{ can_access: boolean }>();

  return !rolePermission.error && Boolean(rolePermission.data?.can_access);
}

async function resolveProjectConsumptionContext(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar Consumo por Projeto.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) return resolution;

  const canAccess = await ensureProjectConsumptionPageAccess(resolution);
  if (!canAccess) {
    return {
      error: {
        status: 403,
        message: "Acesso negado para carregar Consumo por Projeto.",
      },
    };
  }

  return resolution;
}

async function loadProjects(context: AuthenticatedAppUserContext) {
  const { data, error } = await context.supabase
    .from("project")
    .select("id, sob, is_active, is_test, is_withdrawn")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("is_active", true)
    .order("sob", { ascending: true })
    .returns<ProjectRow[]>();

  if (error) {
    throw new Error("Falha ao carregar projetos para Consumo por Projeto.");
  }

  return (data ?? [])
    .filter((project) => !project.is_test && !project.is_withdrawn)
    .map((project) => ({
      id: project.id,
      label: normalizeText(project.sob) || project.id,
    }));
}

async function loadForecast(context: AuthenticatedAppUserContext, projectId: string) {
  const { data, error } = await context.supabase
    .from("project_material_forecast")
    .select("material_id, qty_planned, materials!inner(id, codigo, descricao, umb, tipo)")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("project_id", projectId)
    .returns<ForecastRow[]>();

  if (error) {
    throw new Error("Falha ao carregar materiais previstos do projeto.");
  }

  return data ?? [];
}

async function loadProjectTransfers(context: AuthenticatedAppUserContext, projectId: string) {
  const { data, error } = await context.supabase
    .from("stock_transfers")
    .select("id, from_stock_center_id, to_stock_center_id, project_id, entry_date, updated_at, created_at")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("project_id", projectId)
    .limit(50000)
    .returns<TransferRow[]>();

  if (error) {
    throw new Error("Falha ao carregar movimentacoes do projeto.");
  }

  return data ?? [];
}

async function loadTeamOperations(context: AuthenticatedAppUserContext, transferIds: string[]) {
  const rows: TeamOperationRow[] = [];

  for (const ids of chunk(transferIds, 500)) {
    const fullResult = await context.supabase
      .from("stock_transfer_team_operations")
      .select("transfer_id, team_id, operation_kind")
      .eq("tenant_id", context.appUser.tenant_id)
      .in("transfer_id", ids)
      .returns<TeamOperationRow[]>();

    if (!fullResult.error) {
      rows.push(...(fullResult.data ?? []));
      continue;
    }

    if (!shouldFallbackToLegacyTeamOperationSelect(fullResult.error)) {
      throw new Error("Falha ao carregar operacoes de equipe do projeto.");
    }

    const legacyResult = await context.supabase
      .from("stock_transfer_team_operations")
      .select("transfer_id, team_id")
      .eq("tenant_id", context.appUser.tenant_id)
      .in("transfer_id", ids)
      .returns<LegacyTeamOperationRow[]>();

    if (legacyResult.error) {
      throw new Error("Falha ao carregar operacoes de equipe do projeto.");
    }

    rows.push(
      ...(legacyResult.data ?? []).map((row) => ({
        transfer_id: row.transfer_id,
        team_id: row.team_id,
        operation_kind: null,
      })),
    );
  }

  return rows;
}

async function loadTransferItems(context: AuthenticatedAppUserContext, transferIds: string[]) {
  const rows: TransferItemRow[] = [];

  for (const ids of chunk(transferIds, 500)) {
    const { data, error } = await context.supabase
      .from("stock_transfer_items")
      .select("id, stock_transfer_id, material_id, quantity, materials!inner(id, codigo, descricao, umb, tipo)")
      .eq("tenant_id", context.appUser.tenant_id)
      .in("stock_transfer_id", ids)
      .returns<TransferItemRow[]>();

    if (error) {
      throw new Error("Falha ao carregar itens das operacoes do projeto.");
    }

    rows.push(...(data ?? []));
  }

  return rows;
}

async function loadTeams(context: AuthenticatedAppUserContext, teamIds: string[]) {
  const result = new Map<string, TeamRow>();

  for (const ids of chunk(Array.from(new Set(teamIds.filter(Boolean))), 500)) {
    const { data, error } = await context.supabase
      .from("teams")
      .select("id, stock_center_id")
      .eq("tenant_id", context.appUser.tenant_id)
      .in("id", ids)
      .returns<TeamRow[]>();

    if (error) {
      throw new Error("Falha ao carregar equipes do projeto.");
    }

    for (const row of data ?? []) {
      result.set(row.id, row);
    }
  }

  return result;
}

async function loadReversalSets(context: AuthenticatedAppUserContext, transferIds: string[], itemIds: string[]) {
  const reversedTransferIds = new Set<string>();
  const reversalTransferIds = new Set<string>();
  const reversedItemIds = new Set<string>();
  const reversalItemIds = new Set<string>();

  for (const ids of chunk(transferIds, 500)) {
    const [fromOriginal, fromReversal] = await Promise.all([
      context.supabase
        .from("stock_transfer_reversals")
        .select("original_stock_transfer_id, reversal_stock_transfer_id")
        .eq("tenant_id", context.appUser.tenant_id)
        .in("original_stock_transfer_id", ids)
        .returns<TransferReversalRow[]>(),
      context.supabase
        .from("stock_transfer_reversals")
        .select("original_stock_transfer_id, reversal_stock_transfer_id")
        .eq("tenant_id", context.appUser.tenant_id)
        .in("reversal_stock_transfer_id", ids)
        .returns<TransferReversalRow[]>(),
    ]);

    if (!fromOriginal.error) {
      for (const row of fromOriginal.data ?? []) {
        reversedTransferIds.add(row.original_stock_transfer_id);
        reversalTransferIds.add(row.reversal_stock_transfer_id);
      }
    }

    if (!fromReversal.error) {
      for (const row of fromReversal.data ?? []) {
        reversedTransferIds.add(row.original_stock_transfer_id);
        reversalTransferIds.add(row.reversal_stock_transfer_id);
      }
    }
  }

  for (const ids of chunk(itemIds, 500)) {
    const [fromOriginal, fromReversal] = await Promise.all([
      context.supabase
        .from("stock_transfer_item_reversals")
        .select("original_stock_transfer_item_id, reversal_stock_transfer_item_id")
        .eq("tenant_id", context.appUser.tenant_id)
        .in("original_stock_transfer_item_id", ids)
        .returns<ItemReversalRow[]>(),
      context.supabase
        .from("stock_transfer_item_reversals")
        .select("original_stock_transfer_item_id, reversal_stock_transfer_item_id")
        .eq("tenant_id", context.appUser.tenant_id)
        .in("reversal_stock_transfer_item_id", ids)
        .returns<ItemReversalRow[]>(),
    ]);

    if (!fromOriginal.error) {
      for (const row of fromOriginal.data ?? []) {
        reversedItemIds.add(row.original_stock_transfer_item_id);
        if (row.reversal_stock_transfer_item_id) reversalItemIds.add(row.reversal_stock_transfer_item_id);
      }
    }

    if (!fromReversal.error) {
      for (const row of fromReversal.data ?? []) {
        reversedItemIds.add(row.original_stock_transfer_item_id);
        if (row.reversal_stock_transfer_item_id) reversalItemIds.add(row.reversal_stock_transfer_item_id);
      }
    }
  }

  return { reversedTransferIds, reversalTransferIds, reversedItemIds, reversalItemIds };
}

async function loadAvailableStockByMaterial(context: AuthenticatedAppUserContext) {
  const [stockCentersResult, teamCentersResult] = await Promise.all([
    context.supabase
      .from("stock_centers")
      .select("id, center_type, controls_balance, is_active")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("is_active", true)
      .eq("center_type", "OWN")
      .returns<StockCenterRow[]>(),
    context.supabase
      .from("teams")
      .select("stock_center_id")
      .eq("tenant_id", context.appUser.tenant_id)
      .returns<TeamStockCenterRow[]>(),
  ]);

  if (stockCentersResult.error || teamCentersResult.error) {
    throw new Error("Falha ao carregar saldo em estoque.");
  }

  const teamCenterIds = new Set(
    (teamCentersResult.data ?? [])
      .map((team) => normalizeText(team.stock_center_id))
      .filter(Boolean),
  );
  const stockCenterIds = (stockCentersResult.data ?? [])
    .map((center) => center.id)
    .filter((id) => !teamCenterIds.has(id));

  const balanceByMaterial = new Map<string, number>();
  for (const ids of chunk(stockCenterIds, 500)) {
    const { data, error } = await context.supabase
      .from("stock_center_balances")
      .select("material_id, quantity")
      .eq("tenant_id", context.appUser.tenant_id)
      .in("stock_center_id", ids)
      .returns<StockBalanceRow[]>();

    if (error) {
      throw new Error("Falha ao carregar saldo em estoque.");
    }

    for (const row of data ?? []) {
      balanceByMaterial.set(row.material_id, (balanceByMaterial.get(row.material_id) ?? 0) + numberValue(row.quantity));
    }
  }

  return balanceByMaterial;
}

function resolveOperationKind(transfer: TransferRow, team: TeamRow | null, operationKind: TeamOperationRow["operation_kind"]) {
  if (operationKind) return operationKind;
  if (team?.stock_center_id && transfer.to_stock_center_id === team.stock_center_id) return "REQUISITION";
  return "RETURN";
}

function resolveSituation(params: {
  plannedQuantity: number;
  netQuantity: number;
  stockQuantity: number;
  requiredQuantity: number;
}): { code: SituationCode; label: string } {
  if (params.plannedQuantity <= 0 && params.netQuantity > 0) {
    return { code: "FORA_PREVISTO", label: "Requisitado fora do previsto" };
  }

  if (params.plannedQuantity > 0 && params.netQuantity === 0) {
    return { code: "PREVISTO_SEM_REQUISICAO", label: "Previsto sem requisicao" };
  }

  if (params.netQuantity > params.plannedQuantity) {
    return { code: "ACIMA_PREVISTO", label: "Acima do previsto" };
  }

  if (params.netQuantity < params.plannedQuantity) {
    if (params.stockQuantity >= params.requiredQuantity) {
      return { code: "ABAIXO_COM_ESTOQUE", label: "Abaixo do previsto com estoque" };
    }

    return { code: "ABAIXO_SEM_ESTOQUE", label: "Abaixo do previsto sem estoque" };
  }

  return { code: "CONFERIDO", label: "Conferido" };
}

function createAggregate(materialId: string, material: MaterialRow | null): ConsumptionAggregate {
  return {
    materialId,
    materialCode: normalizeCode(material?.codigo) || "-",
    description: normalizeText(material?.descricao) || "-",
    unit: normalizeCode(material?.umb) || "SEM UMB",
    materialType: normalizeCode(material?.tipo) || "NAO INFORMADO",
    plannedQuantity: 0,
    requisitionQuantity: 0,
    returnQuantity: 0,
    netQuantity: 0,
    deviationQuantity: 0,
    stockQuantity: 0,
    requiredQuantity: 0,
    stockShortageQuantity: 0,
    situationCode: "CONFERIDO",
    situationLabel: "Conferido",
  };
}

function finalizeRows(rows: ConsumptionAggregate[], stockByMaterial: Map<string, number>) {
  return rows
    .map((row) => ({
      ...row,
      netQuantity: row.requisitionQuantity - row.returnQuantity,
      deviationQuantity: row.requisitionQuantity - row.returnQuantity - row.plannedQuantity,
      stockQuantity: stockByMaterial.get(row.materialId) ?? 0,
    }))
    .map((row) => {
      const requiredQuantity = Math.max(row.plannedQuantity - row.netQuantity, 0);
      const stockShortageQuantity = Math.max(requiredQuantity - row.stockQuantity, 0);
      const situation = resolveSituation({
        plannedQuantity: row.plannedQuantity,
        netQuantity: row.netQuantity,
        stockQuantity: row.stockQuantity,
        requiredQuantity,
      });

      return {
        ...row,
        requiredQuantity,
        stockShortageQuantity,
        situationCode: situation.code,
        situationLabel: situation.label,
      };
    })
    .sort((left, right) => left.materialCode.localeCompare(right.materialCode, "pt-BR"));
}

export async function GET(request: NextRequest) {
  const context = await resolveProjectConsumptionContext(request);
  if ("error" in context) {
    return NextResponse.json({ message: context.error.message }, { status: context.error.status });
  }

  const projectId = normalizeUuid(request.nextUrl.searchParams.get("projectId"));
  const materialCode = normalizeCode(request.nextUrl.searchParams.get("materialCode"));

  try {
    const projects = await loadProjects(context);
    const selectedProject = projectId ? projects.find((project) => project.id === projectId) ?? null : null;

    if (!projectId) {
      return NextResponse.json({
        filters: { projects },
        selectedProject: null,
        rows: [],
        chartRows: [],
        summary: null,
      });
    }

    if (!selectedProject) {
      return NextResponse.json({ message: "Projeto nao encontrado para o tenant atual." }, { status: 404 });
    }

    const [forecastRows, transfers, stockByMaterial] = await Promise.all([
      loadForecast(context, projectId),
      loadProjectTransfers(context, projectId),
      loadAvailableStockByMaterial(context),
    ]);

    const aggregate = new Map<string, ConsumptionAggregate>();

    for (const forecast of forecastRows) {
      const material = unwrapRelation(forecast.materials);
      const current = aggregate.get(forecast.material_id) ?? createAggregate(forecast.material_id, material);
      current.plannedQuantity += numberValue(forecast.qty_planned);
      aggregate.set(forecast.material_id, current);
    }

    const transferIds = transfers.map((transfer) => transfer.id);
    if (transferIds.length > 0) {
      const [teamOperations, items] = await Promise.all([
        loadTeamOperations(context, transferIds),
        loadTransferItems(context, transferIds),
      ]);
      const teams = await loadTeams(context, teamOperations.map((operation) => operation.team_id));
      const reversals = await loadReversalSets(context, transferIds, items.map((item) => item.id));
      const transferMap = new Map(transfers.map((transfer) => [transfer.id, transfer]));
      const teamOperationMap = new Map(teamOperations.map((operation) => [operation.transfer_id, operation]));

      for (const item of items) {
        const transfer = transferMap.get(item.stock_transfer_id);
        const teamOperation = teamOperationMap.get(item.stock_transfer_id);
        if (!transfer || !teamOperation) continue;
        if (reversals.reversedTransferIds.has(transfer.id) || reversals.reversalTransferIds.has(transfer.id)) continue;
        if (reversals.reversedItemIds.has(item.id) || reversals.reversalItemIds.has(item.id)) continue;

        const team = teams.get(teamOperation.team_id) ?? null;
        const operationKind = resolveOperationKind(transfer, team, teamOperation.operation_kind);
        if (operationKind !== "REQUISITION" && operationKind !== "RETURN") continue;

        const material = unwrapRelation(item.materials);
        const current = aggregate.get(item.material_id) ?? createAggregate(item.material_id, material);
        if (operationKind === "REQUISITION") {
          current.requisitionQuantity += numberValue(item.quantity);
        } else {
          current.returnQuantity += numberValue(item.quantity);
        }
        aggregate.set(item.material_id, current);
      }
    }

    const allRows = finalizeRows(Array.from(aggregate.values()), stockByMaterial);
    const materialOptions = allRows.map((row) => ({
      id: row.materialId,
      code: row.materialCode,
      description: row.description,
    }));
    const rows = materialCode
      ? allRows.filter((row) => row.materialCode.includes(materialCode))
      : allRows;

    const summary = rows.reduce(
      (accumulator, row) => ({
        materialCount: accumulator.materialCount + 1,
        requisitionMaterialCount: accumulator.requisitionMaterialCount + (row.requisitionQuantity > 0 ? 1 : 0),
        returnMaterialCount: accumulator.returnMaterialCount + (row.returnQuantity > 0 ? 1 : 0),
        stockMaterialCount: accumulator.stockMaterialCount + (row.stockQuantity > 0 ? 1 : 0),
        stockShortageMaterialCount: accumulator.stockShortageMaterialCount + (row.stockShortageQuantity > 0 ? 1 : 0),
      }),
      {
        materialCount: 0,
        requisitionMaterialCount: 0,
        returnMaterialCount: 0,
        stockMaterialCount: 0,
        stockShortageMaterialCount: 0,
      },
    );

    const chartRows = [...rows]
      .sort((left, right) => Math.abs(right.deviationQuantity) - Math.abs(left.deviationQuantity))
      .slice(0, 12);

    return NextResponse.json({
      filters: { projects },
      selectedProject,
      materialOptions,
      rows,
      chartRows,
      summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar Consumo por Projeto.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
