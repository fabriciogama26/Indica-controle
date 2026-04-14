import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";

type RateSuggestionSource = "ELECTRICAL_FIELD" | "PREVIOUS_MEASUREMENT" | "MANUAL";

type MeasurementRateRow = {
  manual_rate: number | string;
  measurement_date: string;
  updated_at: string;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeUuid(value: unknown) {
  const normalized = normalizeText(value);
  return /^[0-9a-f-]{36}$/i.test(normalized) ? normalized : null;
}

function isMissingMeasurementKindColumn(message: string | undefined) {
  return normalizeText(message).toLowerCase().includes("measurement_kind");
}

function normalizeRate(value: unknown) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Number(parsed.toFixed(6));
}

async function resolveElectricalFieldRateSuggestion() {
  // Placeholder para a prioridade futura por ponto eletrico.
  return null as null | { rate: number; source: Extract<RateSuggestionSource, "ELECTRICAL_FIELD"> };
}

async function resolvePreviousMeasurementRate(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projectId: string;
}) {
  const primary = await params.supabase
    .from("project_measurement_orders")
    .select("manual_rate, measurement_date, updated_at")
    .eq("tenant_id", params.tenantId)
    .eq("project_id", params.projectId)
    .eq("measurement_kind", "COM_PRODUCAO")
    .neq("status", "CANCELADA")
    .order("measurement_date", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .returns<MeasurementRateRow[]>();

  if (!primary.error) {
    const rate = normalizeRate(primary.data?.[0]?.manual_rate);
    return rate;
  }

  if (!isMissingMeasurementKindColumn(primary.error.message)) {
    throw new Error("Falha ao consultar historico da taxa da medicao.");
  }

  const fallback = await params.supabase
    .from("project_measurement_orders")
    .select("manual_rate, measurement_date, updated_at")
    .eq("tenant_id", params.tenantId)
    .eq("project_id", params.projectId)
    .neq("status", "CANCELADA")
    .order("measurement_date", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .returns<MeasurementRateRow[]>();

  if (fallback.error) {
    throw new Error("Falha ao consultar historico da taxa da medicao.");
  }

  return normalizeRate(fallback.data?.[0]?.manual_rate);
}

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para sugerir taxa da medicao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const projectId = normalizeUuid(request.nextUrl.searchParams.get("projectId"));
  if (!projectId) {
    return NextResponse.json({ message: "projectId invalido para sugestao de taxa." }, { status: 400 });
  }

  try {
    const electricalFieldSuggestion = await resolveElectricalFieldRateSuggestion();
    if (electricalFieldSuggestion) {
      return NextResponse.json({
        projectId,
        rate: electricalFieldSuggestion.rate,
        source: "ELECTRICAL_FIELD" as RateSuggestionSource,
      });
    }

    const previousRate = await resolvePreviousMeasurementRate({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      projectId,
    });

    if (previousRate !== null) {
      return NextResponse.json({
        projectId,
        rate: previousRate,
        source: "PREVIOUS_MEASUREMENT" as RateSuggestionSource,
      });
    }

    return NextResponse.json({
      projectId,
      rate: null,
      source: "MANUAL" as RateSuggestionSource,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao sugerir taxa da medicao." }, { status: 500 });
  }
}
