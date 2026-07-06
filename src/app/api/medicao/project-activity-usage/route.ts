import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";

type ActivityIndicatorRow = {
  id: string;
  activity_code: string;
  sort_order: number | null;
};

type ServiceActivityRow = {
  id: string;
  code: string;
};

type MeasurementUsageRow = {
  service_activity_id: string;
  activity_code: string;
  measurement_order_id: string;
  project_measurement_orders?: {
    id: string;
    order_number: string;
    execution_date: string;
    status: string;
    updated_at: string;
  } | null;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeUuid(value: unknown) {
  const normalized = normalizeText(value);
  return /^[0-9a-f-]{36}$/i.test(normalized) ? normalized : null;
}

async function loadUsageForCode(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projectId: string;
  code: string;
  activityIds: string[];
}) {
  if (!params.activityIds.length) {
    return {
      code: params.code,
      used: false,
      catalogFound: false,
      lastOrder: null,
    };
  }

  const { data, error } = await params.supabase
    .from("project_measurement_order_items")
    .select(`
      service_activity_id,
      activity_code,
      measurement_order_id,
      project_measurement_orders!inner(
        id,
        order_number,
        execution_date,
        status,
        updated_at
      )
    `)
    .eq("tenant_id", params.tenantId)
    .eq("is_active", true)
    .in("service_activity_id", params.activityIds)
    .eq("project_measurement_orders.tenant_id", params.tenantId)
    .eq("project_measurement_orders.project_id", params.projectId)
    .eq("project_measurement_orders.is_active", true)
    .neq("project_measurement_orders.status", "CANCELADA")
    .limit(1)
    .returns<MeasurementUsageRow[]>();

  if (error) {
    throw new Error("Falha ao consultar uso da atividade na medicao.");
  }

  const order = data?.[0]?.project_measurement_orders ?? null;

  return {
    code: params.code,
    used: Boolean(order),
    catalogFound: true,
    lastOrder: order
      ? {
        id: order.id,
        orderNumber: normalizeText(order.order_number),
        executionDate: order.execution_date,
        status: normalizeText(order.status),
        updatedAt: order.updated_at,
      }
      : null,
  };
}

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para consultar uso de atividades da medicao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const projectId = normalizeUuid(request.nextUrl.searchParams.get("projectId"));
  if (!projectId) {
    return NextResponse.json({ message: "projectId invalido para consultar uso de atividades." }, { status: 400 });
  }

  const projectResult = await resolution.supabase
    .from("project")
    .select("id")
    .eq("tenant_id", resolution.appUser.tenant_id)
    .eq("id", projectId)
    .maybeSingle<{ id: string }>();

  if (projectResult.error) {
    return NextResponse.json({ message: "Falha ao validar projeto da medicao." }, { status: 500 });
  }

  if (!projectResult.data) {
    return NextResponse.json({ message: "Projeto nao encontrado para este tenant." }, { status: 404 });
  }

  try {
    const indicatorsResult = await resolution.supabase
      .from("measurement_project_activity_indicators")
      .select("id, activity_code, sort_order")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("activity_code", { ascending: true })
      .returns<ActivityIndicatorRow[]>();

    if (indicatorsResult.error) {
      return NextResponse.json({ message: "Falha ao carregar codigos indicadores da medicao." }, { status: 500 });
    }

    const activityCodes = Array.from(
      new Set((indicatorsResult.data ?? []).map((item) => normalizeText(item.activity_code).toUpperCase()).filter(Boolean)),
    );

    if (!activityCodes.length) {
      return NextResponse.json({ projectId, items: [] });
    }

    const activitiesResult = await resolution.supabase
      .from("service_activities")
      .select("id, code")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .in("code", activityCodes)
      .returns<ServiceActivityRow[]>();

    if (activitiesResult.error) {
      return NextResponse.json({ message: "Falha ao carregar catalogo de atividades da medicao." }, { status: 500 });
    }

    const activityIdsByCode = new Map<string, string[]>(
      activityCodes.map((code) => [code, []]),
    );

    for (const activity of activitiesResult.data ?? []) {
      const code = normalizeText(activity.code).toUpperCase();
      if (activityIdsByCode.has(code)) {
        activityIdsByCode.get(code)?.push(activity.id);
      }
    }

    const items = await Promise.all(
      activityCodes.map((code) =>
        loadUsageForCode({
          supabase: resolution.supabase,
          tenantId: resolution.appUser.tenant_id,
          projectId,
          code,
          activityIds: activityIdsByCode.get(code) ?? [],
        }),
      ),
    );

    return NextResponse.json({ projectId, items });
  } catch {
    return NextResponse.json({ message: "Falha ao consultar uso das atividades da medicao." }, { status: 500 });
  }
}
