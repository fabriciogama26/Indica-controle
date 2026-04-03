import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type StockCenterRow = {
  id: string;
  name: string;
};

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para carregar metadados da posicao de TRAFO.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;

    const { data, error } = await supabase
      .from("stock_centers")
      .select("id, name")
      .eq("tenant_id", appUser.tenant_id)
      .eq("is_active", true)
      .eq("center_type", "OWN")
      .order("name", { ascending: true })
      .returns<StockCenterRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao carregar metadados da posicao de TRAFO." }, { status: 500 });
    }

    return NextResponse.json({
      stockCenters: (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
      })),
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar metadados da posicao de TRAFO." }, { status: 500 });
  }
}
