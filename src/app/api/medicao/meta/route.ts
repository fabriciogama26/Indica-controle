import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type NoProductionReasonRow = {
  id: string;
  code: string;
  name: string;
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

  const { data, error } = await resolution.supabase
    .from("measurement_no_production_reasons")
    .select("id, code, name, is_active, sort_order")
    .eq("tenant_id", resolution.appUser.tenant_id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<NoProductionReasonRow[]>();

  if (error) {
    return NextResponse.json({ message: "Falha ao carregar motivos de sem producao da medicao." }, { status: 500 });
  }

  return NextResponse.json({
    noProductionReasons: (data ?? []).map((item) => ({
      id: item.id,
      code: String(item.code ?? "").trim(),
      name: String(item.name ?? "").trim(),
    })),
  });
}
