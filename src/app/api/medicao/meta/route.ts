import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type NoProductionReasonRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  sort_order: number | null;
};

type WorkCompletionCatalogRow = {
  id: string;
  code: string;
  label_pt: string | null;
  is_active: boolean;
  sort_order: number | null;
};

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar metadados da medicao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const [noProductionReasonResult, workCompletionCatalogResult] = await Promise.all([
    resolution.supabase
      .from("measurement_no_production_reasons")
      .select("id, code, name, is_active, sort_order")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .returns<NoProductionReasonRow[]>(),
    resolution.supabase
      .from("programming_work_completion_catalog")
      .select("id, code, label_pt, is_active, sort_order")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("label_pt", { ascending: true })
      .returns<WorkCompletionCatalogRow[]>(),
  ]);

  if (noProductionReasonResult.error) {
    return NextResponse.json({ message: "Falha ao carregar motivos de sem producao da medicao." }, { status: 500 });
  }

  const noProductionReasons = noProductionReasonResult.data ?? [];
  const workCompletionCatalog = workCompletionCatalogResult.error
    ? []
    : (workCompletionCatalogResult.data ?? []);

  return NextResponse.json({
    noProductionReasons: noProductionReasons.map((item) => ({
      id: item.id,
      code: String(item.code ?? "").trim(),
      name: String(item.name ?? "").trim(),
    })),
    workCompletionCatalog: workCompletionCatalog.map((item) => ({
      code: String(item.code ?? "").trim().toUpperCase(),
      label: String(item.label_pt ?? "").trim() || String(item.code ?? "").trim().toUpperCase(),
    })),
  });
}
