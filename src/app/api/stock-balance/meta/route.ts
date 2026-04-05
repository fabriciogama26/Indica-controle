import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type StockCenterRow = {
  id: string;
  name: string;
  center_type: "OWN" | "THIRD_PARTY";
  controls_balance: boolean;
};

type TeamStockCenterRow = {
  stock_center_id: string | null;
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
    const includeTeamCenters = String(request.nextUrl.searchParams.get("includeTeamCenters") ?? "").trim() === "1";

    const [stockCentersResult, teamCentersResult] = await Promise.all([
      supabase
        .from("stock_centers")
        .select("id, name, center_type, controls_balance")
        .eq("tenant_id", appUser.tenant_id)
        .eq("is_active", true)
        .eq("center_type", "OWN")
        .order("name", { ascending: true })
        .returns<StockCenterRow[]>(),
      includeTeamCenters
        ? Promise.resolve({ data: [], error: null } as { data: TeamStockCenterRow[]; error: null })
        : supabase
            .from("teams")
            .select("stock_center_id")
            .eq("tenant_id", appUser.tenant_id)
            .returns<TeamStockCenterRow[]>(),
    ]);

    if (stockCentersResult.error || teamCentersResult.error) {
      return NextResponse.json({ message: "Falha ao carregar os centros do estoque atual." }, { status: 500 });
    }

    const blockedCenterIds = new Set(
      (teamCentersResult.data ?? [])
        .map((row) => String(row.stock_center_id ?? "").trim())
        .filter(Boolean),
    );

    return NextResponse.json({
      stockCenters: (stockCentersResult.data ?? [])
        .filter((row) => includeTeamCenters || !blockedCenterIds.has(row.id))
        .map((row) => ({
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
