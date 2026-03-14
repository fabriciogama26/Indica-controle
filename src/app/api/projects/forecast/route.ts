import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type ProjectRow = {
  id: string;
  sob: string;
};

type ForecastItemRow = {
  id: string;
  material_id: string;
  qty_planned: number;
  observation: string | null;
  source: string;
  imported_at: string;
  updated_at: string;
  materials: {
    codigo: string;
    descricao: string;
    umb: string | null;
    tipo: string | null;
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

async function saveProjectMaterialForecast(params: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  actorUserId: string;
  quantity: number;
  itemId?: string | null;
  materialId?: string | null;
  observation?: string | null;
}) {
  const { data, error } = await params.supabase.rpc("save_project_material_forecast", {
    p_tenant_id: params.tenantId,
    p_project_id: params.projectId,
    p_actor_user_id: params.actorUserId,
    p_quantity: params.quantity,
    p_item_id: params.itemId ?? null,
    p_material_id: params.materialId ?? null,
    p_observation: params.observation ?? null,
    p_source: params.itemId ? null : "MANUAL",
  });

  if (error) {
    return {
      ok: false,
      status: 500,
      message: "Falha ao salvar materiais previstos do projeto.",
    } as const;
  }

  const result = (data ?? {}) as SaveForecastRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar materiais previstos do projeto.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    action: result.action ?? null,
    itemId: result.item_id ?? null,
    entityCode: result.entity_code ?? null,
    message: result.message ?? "Material previsto do projeto atualizado com sucesso.",
  } as const;
}

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para consultar materiais previstos.",
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

  const { data, error } = await resolution.supabase
    .from("project_material_forecast")
    .select("id, material_id, qty_planned, observation, source, imported_at, updated_at, materials!inner(codigo, descricao, umb, tipo)")
    .eq("tenant_id", resolution.appUser.tenant_id)
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .returns<ForecastItemRow[]>();

  if (error) {
    return NextResponse.json({ message: "Falha ao listar materiais previstos do projeto." }, { status: 500 });
  }

  return NextResponse.json({
    project: {
      id: project.id,
      sob: project.sob,
    },
    items: (data ?? []).map((item) => ({
      id: item.id,
      materialId: item.material_id,
      code: item.materials?.codigo ?? "",
      description: item.materials?.descricao ?? "",
      umb: item.materials?.umb ?? null,
      type: item.materials?.tipo ?? null,
      qtyPlanned: item.qty_planned,
      observation: item.observation,
      source: item.source,
      importedAt: item.imported_at,
      updatedAt: item.updated_at,
    })),
  });
}

export async function POST(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para adicionar material previsto.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const payload = (await request.json().catch(() => null)) as {
      projectId?: string;
      materialId?: string;
      quantity?: string | number;
      observation?: string;
    } | null;

    const projectId = normalizeText(payload?.projectId);
    const materialId = normalizeText(payload?.materialId);
    const quantity = normalizePositiveNumber(payload?.quantity);
    const observation = normalizeText(payload?.observation);

    if (!projectId || !materialId || quantity === null) {
      return NextResponse.json({ message: "Projeto, material e quantidade sao obrigatorios." }, { status: 400 });
    }

    const result = await saveProjectMaterialForecast({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      projectId,
      actorUserId: resolution.appUser.id,
      materialId,
      quantity,
      observation,
    });

    if (!result.ok) {
      return NextResponse.json({ message: result.message }, { status: result.status });
    }

    const data = await GET(
      new NextRequest(`${request.nextUrl.origin}/api/projects/forecast?projectId=${projectId}`, {
        headers: request.headers,
      }),
    );

    const body = await data.json();
    return NextResponse.json(
      {
        ...body,
        message: result.message,
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json({ message: "Falha ao adicionar material previsto do projeto." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para editar material previsto.",
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
    } | null;

    const projectId = normalizeText(payload?.projectId);
    const itemId = normalizeText(payload?.id);
    const quantity = normalizePositiveNumber(payload?.quantity);
    const observation = normalizeText(payload?.observation);

    if (!projectId || !itemId || quantity === null) {
      return NextResponse.json({ message: "Projeto, item e quantidade sao obrigatorios." }, { status: 400 });
    }

    const result = await saveProjectMaterialForecast({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      projectId,
      actorUserId: resolution.appUser.id,
      itemId,
      quantity,
      observation,
    });

    if (!result.ok) {
      return NextResponse.json({ message: result.message }, { status: result.status });
    }

    const data = await GET(
      new NextRequest(`${request.nextUrl.origin}/api/projects/forecast?projectId=${projectId}`, {
        headers: request.headers,
      }),
    );

    const body = await data.json();
    return NextResponse.json(
      {
        ...body,
        message: result.message,
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json({ message: "Falha ao editar material previsto do projeto." }, { status: 500 });
  }
}
