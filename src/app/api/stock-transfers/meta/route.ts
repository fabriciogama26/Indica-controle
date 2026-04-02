import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type StockCenterRow = {
  id: string;
  name: string;
  center_type: "OWN" | "THIRD_PARTY";
  controls_balance: boolean;
};

type ProjectRow = {
  id: string;
  sob: string;
  is_active: boolean;
};

type MaterialRow = {
  id: string;
  codigo: string;
  descricao: string;
  tipo: string;
  is_transformer: boolean;
  is_active: boolean;
};

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para carregar metadados da movimentacao de estoque.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;

    const [stockCentersResult, projectsResult, materialsResult] = await Promise.all([
      supabase
        .from("stock_centers")
        .select("id, name, center_type, controls_balance")
        .eq("tenant_id", appUser.tenant_id)
        .eq("is_active", true)
        .order("name", { ascending: true })
        .returns<StockCenterRow[]>(),
      supabase
        .from("project")
        .select("id, sob, is_active")
        .eq("tenant_id", appUser.tenant_id)
        .eq("is_active", true)
        .order("sob", { ascending: true })
        .returns<ProjectRow[]>(),
      supabase
        .from("materials")
        .select("id, codigo, descricao, tipo, is_transformer, is_active")
        .eq("tenant_id", appUser.tenant_id)
        .eq("is_active", true)
        .order("codigo", { ascending: true })
        .returns<MaterialRow[]>(),
    ]);

    if (stockCentersResult.error || projectsResult.error || materialsResult.error) {
      return NextResponse.json({ message: "Falha ao carregar metadados da movimentacao de estoque." }, { status: 500 });
    }

    return NextResponse.json({
      stockCenters: (stockCentersResult.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        centerType: row.center_type,
        controlsBalance: Boolean(row.controls_balance),
      })),
      projects: (projectsResult.data ?? []).map((row) => ({
        id: row.id,
        projectCode: row.sob,
      })),
      materials: (materialsResult.data ?? []).map((row) => ({
        id: row.id,
        materialCode: row.codigo,
        description: row.descricao,
        materialType: String(row.tipo ?? "").trim().toUpperCase(),
        isTransformer: Boolean(row.is_transformer),
      })),
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar metadados da movimentacao de estoque." }, { status: 500 });
  }
}
