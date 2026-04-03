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

type ReversalReasonRow = {
  code: string;
  label_pt: string;
  requires_notes: boolean;
  is_active: boolean;
  sort_order: number;
};

const DEFAULT_REVERSAL_REASONS = [
  { code: "DATA_ENTRY_ERROR", label: "Erro de digitacao", requiresNotes: false },
  { code: "WRONG_STOCK_CENTER", label: "Centro incorreto", requiresNotes: false },
  { code: "WRONG_MATERIAL", label: "Material incorreto", requiresNotes: false },
  { code: "WRONG_QUANTITY", label: "Quantidade incorreta", requiresNotes: false },
  { code: "DUPLICATE_ENTRY", label: "Lancamento duplicado", requiresNotes: false },
] as const;

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

    const [stockCentersResult, projectsResult, materialsResult, reversalReasonsResult] = await Promise.all([
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
      supabase
        .from("stock_transfer_reversal_reason_catalog")
        .select("code, label_pt, requires_notes, is_active, sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("code", { ascending: true })
        .returns<ReversalReasonRow[]>(),
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
      reversalReasons: reversalReasonsResult.error
        ? DEFAULT_REVERSAL_REASONS
        : (reversalReasonsResult.data ?? []).map((row) => ({
            code: row.code,
            label: row.label_pt,
            requiresNotes: Boolean(row.requires_notes),
          })),
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar metadados da movimentacao de estoque." }, { status: 500 });
  }
}
