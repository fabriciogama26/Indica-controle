import { NextRequest, NextResponse } from "next/server";

import { isSerialTrackedMaterial, normalizeSerialTrackingType, requiresLotCode, SerialTrackingType } from "@/lib/materialSerialTracking";
import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { normalizeMovementType, normalizeText } from "@/lib/server/stockTransfers";

type MaterialRow = {
  id: string;
  codigo: string;
  is_transformer: boolean | null;
  serial_tracking_type: SerialTrackingType | null;
  is_active: boolean | null;
};

type StockCenterRow = {
  id: string;
  center_type: "OWN" | "THIRD_PARTY" | null;
  is_active: boolean | null;
};

type TrafoInstanceRow = {
  id: string;
  material_id: string;
  serial_number: string;
  lot_code: string;
  current_stock_center_id: string | null;
  updated_at: string | null;
};

function parsePageSize(value: string | null) {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 50;
  }

  return Math.min(parsed, 100);
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para carregar seriais disponiveis.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const movementType = normalizeMovementType(request.nextUrl.searchParams.get("movementType"));
    const fromStockCenterId = normalizeText(request.nextUrl.searchParams.get("fromStockCenterId"));
    const materialId = normalizeText(request.nextUrl.searchParams.get("materialId"));
    const serialNumber = normalizeText(request.nextUrl.searchParams.get("serialNumber"));
    const lotCode = normalizeText(request.nextUrl.searchParams.get("lotCode"));
    const pageSize = parsePageSize(request.nextUrl.searchParams.get("pageSize"));

    if (!movementType || !fromStockCenterId || !materialId || movementType === "ENTRY") {
      return NextResponse.json({ items: [] });
    }

    const [materialResult, stockCenterResult, teamStockCenterConflictResult] = await Promise.all([
      supabase
        .from("materials")
        .select("id, codigo, is_transformer, serial_tracking_type, is_active")
        .eq("tenant_id", appUser.tenant_id)
        .eq("id", materialId)
        .maybeSingle<MaterialRow>(),
      supabase
        .from("stock_centers")
        .select("id, center_type, is_active")
        .eq("tenant_id", appUser.tenant_id)
        .eq("id", fromStockCenterId)
        .maybeSingle<StockCenterRow>(),
      supabase
        .from("teams")
        .select("id")
        .eq("tenant_id", appUser.tenant_id)
        .eq("stock_center_id", fromStockCenterId)
        .limit(1),
    ]);

    if (materialResult.error || stockCenterResult.error || teamStockCenterConflictResult.error) {
      return NextResponse.json({ message: "Falha ao carregar seriais disponiveis." }, { status: 500 });
    }

    const material = materialResult.data;
    const stockCenter = stockCenterResult.data;
    const serialTrackingType = normalizeSerialTrackingType(material?.serial_tracking_type ?? (material?.is_transformer ? "TRAFO" : "NONE"));

    if (
      !material?.is_active
      || !isSerialTrackedMaterial(serialTrackingType)
      || !stockCenter?.is_active
      || stockCenter.center_type !== "OWN"
      || (teamStockCenterConflictResult.data ?? []).length > 0
    ) {
      return NextResponse.json({ items: [] });
    }

    let query = supabase
      .from("trafo_instances")
      .select("id, material_id, serial_number, lot_code, current_stock_center_id, updated_at")
      .eq("tenant_id", appUser.tenant_id)
      .eq("material_id", materialId)
      .eq("current_stock_center_id", fromStockCenterId)
      .order("serial_number", { ascending: true })
      .limit(pageSize);

    if (serialNumber) {
      query = query.ilike("serial_number", `%${serialNumber}%`);
    }

    if (requiresLotCode(serialTrackingType) && lotCode) {
      query = query.ilike("lot_code", `%${lotCode}%`);
    }

    const { data, error } = await query.returns<TrafoInstanceRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao carregar seriais disponiveis." }, { status: 500 });
    }

    return NextResponse.json({
      items: (data ?? []).map((row) => ({
        id: row.id,
        materialId: row.material_id,
        materialCode: material.codigo,
        serialTrackingType,
        serialNumber: row.serial_number,
        lotCode: row.lot_code,
        currentStockCenterId: row.current_stock_center_id,
        updatedAt: row.updated_at,
      })),
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar seriais disponiveis." }, { status: 500 });
  }
}
