import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type StockCenterRow = {
  id: string;
  name: string;
  center_type: "OWN" | "THIRD_PARTY";
  controls_balance: boolean;
};

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para carregar os centros do estoque atual.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const { data, error } = await supabase
      .from("stock_centers")
      .select("id, name, center_type, controls_balance")
      .eq("tenant_id", appUser.tenant_id)
      .eq("is_active", true)
      .eq("center_type", "OWN")
      .order("name", { ascending: true })
      .returns<StockCenterRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao carregar os centros do estoque atual." }, { status: 500 });
    }

    return NextResponse.json({
      stockCenters: (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        centerType: row.center_type,
        controlsBalance: Boolean(row.controls_balance),
      })),
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar os centros do estoque atual." }, { status: 500 });
  }
}
