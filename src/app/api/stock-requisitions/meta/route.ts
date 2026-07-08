import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { fetchActiveOperationalMaterials, toOperationalMaterialOption } from "@/lib/server/materialCatalog";

type StockCenterRow = {
  id: string;
  name: string;
  center_type: "OWN" | "THIRD_PARTY";
};

type TeamRow = {
  id: string;
  name: string;
  stock_center_id: string | null;
  ativo: boolean;
};

type ProjectRow = {
  id: string;
  sob: string;
};

type AdjustmentReasonRow = {
  code: string;
  label_pt: string;
  requires_notes: boolean;
};

const DEFAULT_ADJUSTMENT_REASONS = [
  { code: "INSUFFICIENT_STOCK", label: "Saldo insuficiente", requiresNotes: false },
  { code: "DAMAGED_MATERIAL", label: "Material avariado", requiresNotes: false },
  { code: "PARTIAL_SEPARATION", label: "Separacao parcial", requiresNotes: false },
  { code: "TRANSPORT_LIMIT", label: "Limite de transporte", requiresNotes: false },
  { code: "REQUEST_DIVERGENCE", label: "Divergencia de pedido", requiresNotes: false },
  { code: "BLOCKED_MATERIAL", label: "Material bloqueado", requiresNotes: false },
  { code: "OTHER", label: "Outro", requiresNotes: true },
] as const;

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para carregar metadados das requisicoes.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;

    const [stockCentersResult, teamsResult, projectsResult, materialsResult, reasonsResult] = await Promise.all([
      supabase
        .from("stock_centers")
        .select("id, name, center_type")
        .eq("tenant_id", appUser.tenant_id)
        .eq("is_active", true)
        .eq("center_type", "OWN")
        .order("name", { ascending: true })
        .returns<StockCenterRow[]>(),
      supabase
        .from("teams")
        .select("id, name, stock_center_id, ativo")
        .eq("tenant_id", appUser.tenant_id)
        .order("name", { ascending: true })
        .returns<TeamRow[]>(),
      supabase
        .from("project")
        .select("id, sob")
        .eq("tenant_id", appUser.tenant_id)
        .eq("is_active", true)
        .order("sob", { ascending: true })
        .returns<ProjectRow[]>(),
      fetchActiveOperationalMaterials(supabase, appUser.tenant_id),
      supabase
        .from("stock_requisition_adjustment_reason_catalog")
        .select("code, label_pt, requires_notes")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("code", { ascending: true })
        .returns<AdjustmentReasonRow[]>(),
    ]);

    if (stockCentersResult.error || teamsResult.error || projectsResult.error || materialsResult.error) {
      return NextResponse.json({ message: "Falha ao carregar metadados das requisicoes." }, { status: 500 });
    }

    const teamStockCenterIds = new Set(
      (teamsResult.data ?? []).map((team) => String(team.stock_center_id ?? "").trim()).filter(Boolean),
    );

    return NextResponse.json({
      stockCenters: (stockCentersResult.data ?? [])
        .filter((row) => !teamStockCenterIds.has(row.id))
        .map((row) => ({ id: row.id, name: row.name })),
      teams: (teamsResult.data ?? [])
        .filter((row) => Boolean(row.ativo))
        .map((row) => ({
          id: row.id,
          name: row.name,
          stockCenterId: row.stock_center_id,
          hasStockCenter: Boolean(row.stock_center_id),
        })),
      projects: (projectsResult.data ?? []).map((row) => ({ id: row.id, projectCode: row.sob })),
      materials: (materialsResult.data ?? []).map(toOperationalMaterialOption),
      adjustmentReasons: reasonsResult.error
        ? DEFAULT_ADJUSTMENT_REASONS
        : (reasonsResult.data ?? []).map((row) => ({
            code: row.code,
            label: row.label_pt,
            requiresNotes: Boolean(row.requires_notes),
          })),
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar metadados das requisicoes." }, { status: 500 });
  }
}
