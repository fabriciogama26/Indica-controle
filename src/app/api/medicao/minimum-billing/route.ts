import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type MinimumBillingRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  amount?: number | string;
  teamTypeId?: string | null;
  teamTypeName?: string | null;
  scoreTargetId?: string | null;
  targetPoints?: number | string | null;
  unitValueSourceActivityId?: string | null;
  unitValueGroup?: string | null;
  unitValue?: number | string | null;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeUuid(value: unknown) {
  const normalized = normalizeText(value);
  return /^[0-9a-f-]{36}$/i.test(normalized) ? normalized : null;
}

function normalizeIsoDate(value: unknown) {
  const normalized = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para calcular garantia minima da medicao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const teamId = normalizeUuid(request.nextUrl.searchParams.get("teamId"));
  const executionDate = normalizeIsoDate(request.nextUrl.searchParams.get("executionDate"));
  const noProductionReasonId = normalizeUuid(request.nextUrl.searchParams.get("noProductionReasonId"));

  if (!teamId || !executionDate || !noProductionReasonId) {
    return NextResponse.json({ message: "Equipe, data de execucao e motivo sao obrigatorios para calcular garantia minima." }, { status: 400 });
  }

  const { data, error } = await resolution.supabase.rpc("calculate_measurement_minimum_billing_guarantee", {
    p_tenant_id: resolution.appUser.tenant_id,
    p_team_id: teamId,
    p_execution_date: executionDate,
    p_no_production_reason_id: noProductionReasonId,
  });

  if (error) {
    return NextResponse.json({ message: "Falha ao calcular garantia minima da medicao. Verifique se a migration 212_measurement_minimum_billing_guarantee.sql foi aplicada." }, { status: 500 });
  }

  const result = (data ?? {}) as MinimumBillingRpcResult;
  if (result.reason === "NOT_MINIMUM_BILLING_REASON") {
    return NextResponse.json({
      applies: false,
      amount: 0,
      targetPoints: 0,
      unitValue: 0,
      unitValueGroup: "",
    });
  }

  if (result.success !== true) {
    return NextResponse.json(
      { message: result.message ?? "Falha ao calcular garantia minima da medicao.", reason: result.reason ?? null },
      { status: Number(result.status ?? 400) },
    );
  }

  return NextResponse.json({
    applies: true,
    amount: Number(result.amount ?? 0),
    teamTypeId: result.teamTypeId ?? null,
    teamTypeName: normalizeText(result.teamTypeName),
    scoreTargetId: result.scoreTargetId ?? null,
    targetPoints: Number(result.targetPoints ?? 0),
    unitValueSourceActivityId: result.unitValueSourceActivityId ?? null,
    unitValueGroup: normalizeText(result.unitValueGroup),
    unitValue: Number(result.unitValue ?? 0),
  });
}
