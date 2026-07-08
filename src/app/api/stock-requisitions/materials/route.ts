import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { fetchActiveOperationalMaterials, toOperationalMaterialOption } from "@/lib/server/materialCatalog";

const BALANCE_PAGE_SIZE = 1000;

// Materiais que o centro selecionado carrega (opcao B): todo material com registro de saldo no
// centro, mesmo zerado. Evita usar codigo que o centro nunca movimentou, sem impedir reposicao.
export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para carregar materiais do centro.",
      inactiveMessage: "Usuario inativo.",
    });
    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const stockCenterId = String(request.nextUrl.searchParams.get("stockCenterId") ?? "").trim();
    if (!stockCenterId) {
      return NextResponse.json({ materials: [] });
    }

    // Coleta todos os material_id com saldo (qualquer quantidade) no centro, paginando.
    const materialIdsInCenter = new Set<string>();
    for (let from = 0; ; from += BALANCE_PAGE_SIZE) {
      const { data, error } = await supabase
        .from("stock_center_balances")
        .select("material_id")
        .eq("tenant_id", appUser.tenant_id)
        .eq("stock_center_id", stockCenterId)
        .range(from, from + BALANCE_PAGE_SIZE - 1)
        .returns<Array<{ material_id: string }>>();

      if (error) {
        return NextResponse.json({ message: "Falha ao carregar materiais do centro." }, { status: 500 });
      }

      for (const row of data ?? []) {
        if (row.material_id) materialIdsInCenter.add(row.material_id);
      }

      if (!data || data.length < BALANCE_PAGE_SIZE) break;
    }

    if (materialIdsInCenter.size === 0) {
      return NextResponse.json({ materials: [] });
    }

    const activeMaterials = await fetchActiveOperationalMaterials(supabase, appUser.tenant_id);
    if (activeMaterials.error) {
      return NextResponse.json({ message: "Falha ao carregar materiais do centro." }, { status: 500 });
    }
    const materials = (activeMaterials.data ?? [])
      .filter((material) => materialIdsInCenter.has(material.id))
      .map(toOperationalMaterialOption);

    return NextResponse.json({ materials });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar materiais do centro." }, { status: 500 });
  }
}
