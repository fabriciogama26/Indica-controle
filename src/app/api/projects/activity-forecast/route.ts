import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type ProjectRow = {
  id: string;
  sob: string;
};

type ForecastItemRow = {
  id: string;
  service_activity_id: string;
  qty_planned: number;
  observation: string | null;
  source: string;
  created_at: string;
  updated_at: string;
  service_activities: {
    code: string;
    description: string;
    unit: string;
    unit_value: number;
    voice_point: number;
    team_types: {
      name: string | null;
    } | null;
  } | null;
};

type SaveForecastRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  action?: "INSERT" | "UPDATE";
  item_id?: string;
  entity_code?: string;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizePositiveNumber(value: unknown) {
  const raw = String(value ?? "").trim().replace(",", ".");
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return Number(numeric.toFixed(2));
}

async function resolveProject(projectId: string, tenantId: string, supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("project")
    .select("id, sob")
    .eq("tenant_id", tenantId)
    .eq("id", projectId)
    .maybeSingle<ProjectRow>();

  if (error || !data) {
    return null;
  }

  return data;
}

async function saveProjectActivityForecast(params: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  actorUserId: string;
  quantity: number;
  itemId?: string | null;
  activityId?: string | null;
  observation?: string | null;
  expectedUpdatedAt?: string | null;
}) {
  const { data, error } = await params.supabase.rpc("save_project_activity_forecast", {
    p_tenant_id: params.tenantId,
    p_project_id: params.projectId,
    p_actor_user_id: params.actorUserId,
    p_quantity: params.quantity,
    p_item_id: params.itemId ?? null,
    p_activity_id: params.activityId ?? null,
    p_observation: params.observation ?? null,
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
  });

  if (error) {
    return {
      ok: false,
      status: 500,
      message: "Falha ao salvar atividades previstas do projeto.",
    } as const;
  }

  const result = (data ?? {}) as SaveForecastRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar atividades previstas do projeto.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    action: result.action ?? null,
    itemId: result.item_id ?? null,
    entityCode: result.entity_code ?? null,
    message: result.message ?? "Atividade prevista do projeto atualizada com sucesso.",
  } as const;
}

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para consultar atividades previstas.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const projectId = normalizeText(request.nextUrl.searchParams.get("projectId"));
  if (!projectId) {
    return NextResponse.json({ message: "projectId obrigatorio." }, { status: 400 });
  }

  const project = await resolveProject(projectId, resolution.appUser.tenant_id, resolution.supabase);
  if (!project) {
    return NextResponse.json({ message: "Projeto nao encontrado no tenant informado." }, { status: 404 });
  }

  let data: ForecastItemRow[] | null = null;
  let error: { message?: string } | null = null;

  const withVoicePoint = await resolution.supabase
    .from("project_activity_forecast")
    .select("id, service_activity_id, qty_planned, observation, source, created_at, updated_at, service_activities!inner(code, description, unit, unit_value, voice_point, team_types(name))")
    .eq("tenant_id", resolution.appUser.tenant_id)
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false });

  data = (withVoicePoint.data ?? null) as ForecastItemRow[] | null;
  error = withVoicePoint.error ? { message: withVoicePoint.error.message } : null;

  if (error?.message?.toLowerCase().includes("voice_point")) {
    const fallback = await resolution.supabase
      .from("project_activity_forecast")
      .select("id, service_activity_id, qty_planned, observation, source, created_at, updated_at, service_activities!inner(code, description, unit, unit_value, team_types(name))")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("project_id", project.id)
      .order("updated_at", { ascending: false });

    data = (fallback.data ?? null) as ForecastItemRow[] | null;
    error = fallback.error ? { message: fallback.error.message } : null;
  }

  if (error) {
    return NextResponse.json({ message: "Falha ao listar atividades previstas do projeto." }, { status: 500 });
  }

  return NextResponse.json({
    project: {
      id: project.id,
      sob: project.sob,
    },
    items: (data ?? []).map((item) => ({
      id: item.id,
      activityId: item.service_activity_id,
      code: item.service_activities?.code ?? "",
      description: item.service_activities?.description ?? "",
      type: item.service_activities?.team_types?.name ?? null,
      unit: item.service_activities?.unit ?? "",
      unitValue: Number(item.service_activities?.unit_value ?? 0),
      voicePoint: Number(item.service_activities?.voice_point ?? 1),
      qtyPlanned: Number(item.qty_planned ?? 0),
      observation: item.observation,
      source: item.source,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    })),
  });
}

export async function POST(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para adicionar atividade prevista.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const payload = (await request.json().catch(() => null)) as {
      projectId?: string;
      activityId?: string;
      quantity?: string | number;
      observation?: string;
    } | null;

    const projectId = normalizeText(payload?.projectId);
    const activityId = normalizeText(payload?.activityId);
    const quantity = normalizePositiveNumber(payload?.quantity);
    const observation = normalizeText(payload?.observation);

    if (!projectId || !activityId || quantity === null) {
      return NextResponse.json({ message: "Projeto, atividade e quantidade sao obrigatorios." }, { status: 400 });
    }

    const result = await saveProjectActivityForecast({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      projectId,
      actorUserId: resolution.appUser.id,
      activityId,
      quantity,
      observation,
    });

    if (!result.ok) {
      return NextResponse.json({ message: result.message }, { status: result.status });
    }

    const data = await GET(new NextRequest(`${request.nextUrl.origin}/api/projects/activity-forecast?projectId=${projectId}`, {
      headers: request.headers,
    }));

    const body = await data.json();
    return NextResponse.json({
      ...body,
      message: result.message,
    }, { status: 200 });
  } catch {
    return NextResponse.json({ message: "Falha ao adicionar atividade prevista do projeto." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para editar atividade prevista.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const payload = (await request.json().catch(() => null)) as {
      projectId?: string;
      id?: string;
      quantity?: string | number;
      observation?: string;
      expectedUpdatedAt?: string;
    } | null;

    const projectId = normalizeText(payload?.projectId);
    const itemId = normalizeText(payload?.id);
    const quantity = normalizePositiveNumber(payload?.quantity);
    const observation = normalizeText(payload?.observation);

    if (!projectId || !itemId || quantity === null) {
      return NextResponse.json({ message: "Projeto, item e quantidade sao obrigatorios." }, { status: 400 });
    }

    const result = await saveProjectActivityForecast({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      projectId,
      actorUserId: resolution.appUser.id,
      itemId,
      quantity,
      observation,
      expectedUpdatedAt: normalizeText(payload?.expectedUpdatedAt) || null,
    });

    if (!result.ok) {
      return NextResponse.json({ message: result.message }, { status: result.status });
    }

    const data = await GET(new NextRequest(`${request.nextUrl.origin}/api/projects/activity-forecast?projectId=${projectId}`, {
      headers: request.headers,
    }));

    const body = await data.json();
    return NextResponse.json({
      ...body,
      message: result.message,
    }, { status: 200 });
  } catch {
    return NextResponse.json({ message: "Falha ao editar atividade prevista do projeto." }, { status: 500 });
  }
}
