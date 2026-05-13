import { SupabaseClient } from "@supabase/supabase-js";

import { isSerialTrackedMaterial, normalizeSerialTrackingType, SerialTrackingType } from "@/lib/materialSerialTracking";

export type OperationalMaterialRow = {
  id: string;
  codigo: string;
  descricao: string;
  tipo: string;
  is_transformer?: boolean | null;
  serial_tracking_type?: SerialTrackingType | string | null;
};

export type OperationalMaterialOption = {
  id: string;
  materialCode: string;
  description: string;
  materialType: string;
  isTransformer: boolean;
  serialTrackingType: SerialTrackingType;
};

const MATERIAL_PAGE_SIZE = 1000;

function isMissingSerialTrackingColumnError(error: { code?: string | null; message?: string | null; details?: string | null } | null) {
  if (!error) {
    return false;
  }

  const normalized = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return normalized.includes("serial_tracking_type") || error.code === "42703" || error.code === "PGRST204";
}

async function fetchMaterialPages(
  supabase: SupabaseClient,
  tenantId: string,
  selectColumns: string,
) {
  const rows: OperationalMaterialRow[] = [];
  let from = 0;

  while (true) {
    const to = from + MATERIAL_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("materials")
      .select(selectColumns)
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("codigo", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
      .returns<OperationalMaterialRow[]>();

    if (error) {
      return { data: rows, error };
    }

    rows.push(...(data ?? []));

    if (!data || data.length < MATERIAL_PAGE_SIZE) {
      return { data: rows, error: null };
    }

    from += MATERIAL_PAGE_SIZE;
  }
}

export async function fetchActiveOperationalMaterials(supabase: SupabaseClient, tenantId: string) {
  const fullResult = await fetchMaterialPages(
    supabase,
    tenantId,
    "id, codigo, descricao, tipo, is_transformer, serial_tracking_type",
  );

  if (!fullResult.error) {
    return fullResult;
  }

  if (!isMissingSerialTrackingColumnError(fullResult.error)) {
    return fullResult;
  }

  return fetchMaterialPages(
    supabase,
    tenantId,
    "id, codigo, descricao, tipo, is_transformer",
  );
}

export function toOperationalMaterialOption(row: OperationalMaterialRow): OperationalMaterialOption {
  const serialTrackingType = normalizeSerialTrackingType(
    row.serial_tracking_type ?? (row.is_transformer ? "TRAFO" : "NONE"),
  );

  return {
    id: row.id,
    materialCode: row.codigo,
    description: row.descricao,
    materialType: String(row.tipo ?? "").trim().toUpperCase(),
    isTransformer: isSerialTrackedMaterial(serialTrackingType),
    serialTrackingType,
  };
}
