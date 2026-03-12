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

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
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

export async function POST() {
  return NextResponse.json(
    {
      message: "Importacao de materiais previstos deve ser feita pela Edge Function import_project_forecast.",
    },
    { status: 405 },
  );
}
