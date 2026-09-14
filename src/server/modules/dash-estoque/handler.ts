// Handler do `GET /api/dash-estoque`.
//
// Ate 2026-09-14 a rota carregava ate 20.000 movimentacoes e agregava em JavaScript, com
// centenas de consultas em chunks (itens, operacoes de equipe, materiais, projetos, equipes
// e estornos) e HTTP 422 acima do teto. Agora uma RPC (migration 439) devolve as agregacoes
// e este handler so monta a resposta, com o mesmo contrato consumido pela tela.
import { NextRequest, NextResponse } from "next/server";

import { AUTH_UNAVAILABLE_MESSAGE } from "@/lib/auth/authErrors";
import { normalizeText } from "@/lib/server/apiHelpers";
import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { checkPageReadAccess } from "@/lib/server/pageAuthorization";

import { loadStockDashboardAggregates, StockDashboardAggregatesError } from "./aggregates";
import {
  buildAbcRows,
  buildCriticalRows,
  buildIdleBuckets,
  buildMaterialAggregates,
  buildScatterRows,
  buildSummaryByUnit,
  buildTopBalanceRows,
  sortOptions,
  sortScatterSummaryByUnit,
} from "./presentation";

const DASH_ESTOQUE_PAGE_KEY = "dash-estoque";

function normalizeCode(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function normalizeUuid(value: unknown) {
  const normalized = normalizeText(value);
  return /^[0-9a-f-]{36}$/i.test(normalized) ? normalized : null;
}

function normalizeIsoDate(value: unknown) {
  const normalized = normalizeText(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeMaterialType(value: unknown) {
  const normalized = normalizeCode(value);
  return normalized === "NOVO" || normalized === "SUCATA" ? normalized : "";
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function currentYearPeriod() {
  const year = new Date().getFullYear();
  return {
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
  };
}

async function resolveDashContext(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar Dashboard Estoque.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) return resolution;

  const access = await checkPageReadAccess(resolution, DASH_ESTOQUE_PAGE_KEY);
  if (access === "unavailable") {
    return { error: { status: 503, message: AUTH_UNAVAILABLE_MESSAGE } };
  }
  if (access === "denied") {
    return {
      error: {
        status: 403,
        message: "Acesso negado para carregar Dashboard Estoque.",
      },
    };
  }

  return resolution;
}

export async function handleStockDashboardGet(request: NextRequest) {
  const context = await resolveDashContext(request);
  if ("error" in context) {
    return NextResponse.json({ message: context.error.message }, { status: context.error.status });
  }

  const params = request.nextUrl.searchParams;
  const defaultPeriod = currentYearPeriod();
  const startDate = normalizeIsoDate(params.get("startDate")) ?? defaultPeriod.startDate;
  const endDate = normalizeIsoDate(params.get("endDate")) ?? defaultPeriod.endDate;
  const stockCenterId = normalizeUuid(params.get("stockCenterId"));
  const teamId = normalizeUuid(params.get("teamId"));
  const projectId = normalizeUuid(params.get("projectId"));
  const materialCode = normalizeCode(params.get("materialCode"));
  const materialType = normalizeMaterialType(params.get("materialType"));
  const criticalQty = Math.max(0, Math.min(numberValue(params.get("criticalQty")) || 5, 999999));

  if (startDate > endDate) {
    return NextResponse.json({ message: "Data inicial nao pode ser maior que a data final." }, { status: 400 });
  }

  try {
    const aggregates = await loadStockDashboardAggregates(context, {
      startDate,
      endDate,
      stockCenterId,
      teamId,
      projectId,
      materialCode,
      materialType,
    });

    const materials = buildMaterialAggregates(aggregates.materials);
    const totalBalanceQuantity = materials.reduce((sum, item) => sum + item.balanceQuantity, 0);
    const totalEstimatedValue = materials.reduce((sum, item) => sum + item.estimatedValue, 0);

    const body = JSON.stringify({
      filters: {
        stockCenters: aggregates.stockCenters,
        teams: sortOptions(aggregates.teams),
        projects: sortOptions(aggregates.projects),
      },
      appliedFilters: {
        startDate,
        endDate,
        stockCenterId,
        teamId,
        projectId,
        materialCode,
        materialType,
        criticalQty,
      },
      summary: {
        materialCount: materials.length,
        totalBalanceQuantity,
        totalEstimatedValue,
        criticalCount: materials.filter((item) => item.balanceQuantity <= criticalQty).length,
        zeroCount: materials.filter((item) => item.balanceQuantity <= 0).length,
        movementCount: aggregates.movementCount,
        totalMovementQuantity: aggregates.totalMovementQuantity,
      },
      summaryByUnit: buildSummaryByUnit(materials),
      criticalMaterials: buildCriticalRows(materials, criticalQty),
      topBalanceMaterials: buildTopBalanceRows(materials),
      idleBuckets: buildIdleBuckets(materials),
      abcRows: buildAbcRows(materials),
      abcQuantityRows: buildAbcRows(materials, "quantity"),
      movementEvolution: aggregates.movementEvolution,
      scatterSummaryByUnit: sortScatterSummaryByUnit(aggregates.scatterSummaryByUnit),
      scatter: buildScatterRows(aggregates.scatterMaterials),
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
    if (error instanceof StockDashboardAggregatesError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    console.error("[dash-estoque] Falha inesperada ao montar Dashboard Estoque", {
      tenantId: context.appUser.tenant_id,
      userId: context.appUser.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ message: "Falha ao carregar Dashboard Estoque." }, { status: 500 });
  }
}
