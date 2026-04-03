import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type TrafoInstanceRow = {
  id: string;
  material_id: string;
  serial_number: string;
  lot_code: string;
  current_stock_center_id: string | null;
  last_stock_transfer_id: string | null;
  last_project_id: string | null;
  last_movement_type: "ENTRY" | "EXIT" | "TRANSFER";
  last_entry_date: string;
  updated_at: string | null;
  updated_by: string | null;
  materials:
    | {
        id: string;
        codigo: string;
        descricao: string;
        tipo: string | null;
        is_transformer: boolean;
        is_active: boolean;
      }
    | Array<{
        id: string;
        codigo: string;
        descricao: string;
        tipo: string | null;
        is_transformer: boolean;
        is_active: boolean;
      }>
    | null;
  stock_centers:
    | {
        id: string;
        name: string;
        center_type: "OWN" | "THIRD_PARTY";
        is_active: boolean;
      }
    | Array<{
        id: string;
        name: string;
        center_type: "OWN" | "THIRD_PARTY";
        is_active: boolean;
      }>
    | null;
  project:
    | {
        id: string;
        sob: string;
        is_active: boolean;
      }
    | Array<{
        id: string;
        sob: string;
        is_active: boolean;
      }>
    | null;
};

type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

function parsePositiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function normalizeText(value: string | null) {
  return String(value ?? "").trim();
}

function normalizeCode(value: string | null) {
  return normalizeText(value).toUpperCase();
}

function normalizeCurrentStatus(value: string | null) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "EM_ESTOQUE" || normalized === "FORA_ESTOQUE") {
    return normalized;
  }
  return "TODOS" as const;
}

function unwrapRelation<T>(value: T | T[] | null) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para carregar a posicao de TRAFO.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const page = parsePositiveInteger(request.nextUrl.searchParams.get("page"), 1);
    const pageSize = Math.min(parsePositiveInteger(request.nextUrl.searchParams.get("pageSize"), 20), 100);
    const stockCenterId = normalizeText(request.nextUrl.searchParams.get("stockCenterId"));
    const materialCode = normalizeCode(request.nextUrl.searchParams.get("materialCode"));
    const serialNumber = normalizeText(request.nextUrl.searchParams.get("serialNumber"));
    const lotCode = normalizeText(request.nextUrl.searchParams.get("lotCode"));
    const currentStatus = normalizeCurrentStatus(request.nextUrl.searchParams.get("currentStatus"));

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("trafo_instances")
      .select(
        [
          "id",
          "material_id",
          "serial_number",
          "lot_code",
          "current_stock_center_id",
          "last_stock_transfer_id",
          "last_project_id",
          "last_movement_type",
          "last_entry_date",
          "updated_at",
          "updated_by",
          "materials!inner(id, codigo, descricao, tipo, is_transformer, is_active)",
          "stock_centers(id, name, center_type, is_active)",
          "project(id, sob, is_active)",
        ].join(", "),
        { count: "exact" },
      )
      .eq("tenant_id", appUser.tenant_id)
      .eq("materials.is_transformer", true)
      .eq("materials.is_active", true)
      .order("updated_at", { ascending: false })
      .range(from, to);

    if (stockCenterId) {
      query = query.eq("current_stock_center_id", stockCenterId);
    }

    if (materialCode) {
      query = query.ilike("materials.codigo", `%${materialCode}%`);
    }

    if (serialNumber) {
      query = query.ilike("serial_number", `%${serialNumber}%`);
    }

    if (lotCode) {
      query = query.ilike("lot_code", `%${lotCode}%`);
    }

    if (currentStatus === "EM_ESTOQUE") {
      query = query.not("current_stock_center_id", "is", null);
    } else if (currentStatus === "FORA_ESTOQUE") {
      query = query.is("current_stock_center_id", null);
    }

    const { data, error, count } = await query.returns<TrafoInstanceRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao carregar a posicao de TRAFO." }, { status: 500 });
    }

    const userIds = Array.from(
      new Set((data ?? []).map((row) => row.updated_by).filter((value): value is string => Boolean(value))),
    );

    const { data: usersData, error: usersError } = userIds.length
      ? await supabase
          .from("app_users")
          .select("id, display, login_name")
          .eq("tenant_id", appUser.tenant_id)
          .in("id", userIds)
          .returns<AppUserRow[]>()
      : { data: [], error: null as null };

    if (usersError) {
      return NextResponse.json({ message: "Falha ao carregar os usuarios da posicao de TRAFO." }, { status: 500 });
    }

    const userMap = new Map(
      (usersData ?? []).map((row) => [row.id, String(row.display ?? row.login_name ?? "").trim() || "Nao informado"]),
    );

    return NextResponse.json({
      items: (data ?? []).flatMap((row) => {
        const material = unwrapRelation(row.materials);
        if (!material) {
          return [];
        }

        const stockCenter = unwrapRelation(row.stock_centers);
        const project = unwrapRelation(row.project);

        return [
          {
            id: row.id,
            materialId: row.material_id,
            materialCode: material.codigo,
            description: material.descricao,
            materialType: String(material.tipo ?? "").trim().toUpperCase(),
            serialNumber: row.serial_number,
            lotCode: row.lot_code,
            currentStockCenterId: row.current_stock_center_id,
            currentStockCenterName: stockCenter?.name ?? null,
            currentStatus: row.current_stock_center_id ? "EM_ESTOQUE" : "FORA_ESTOQUE",
            lastTransferId: row.last_stock_transfer_id,
            lastProjectId: row.last_project_id,
            lastProjectCode: project?.sob ?? null,
            lastMovementType: row.last_movement_type,
            lastEntryDate: row.last_entry_date,
            updatedAt: row.updated_at,
            updatedByName: userMap.get(row.updated_by ?? "") ?? "Nao informado",
          },
        ];
      }),
      pagination: {
        page,
        pageSize,
        total: count ?? 0,
      },
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar a posicao de TRAFO." }, { status: 500 });
  }
}
