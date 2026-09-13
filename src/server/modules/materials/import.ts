import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeNullableText, normalizeText } from "@/lib/server/apiHelpers";
import { allowsPendingSerialIdentification, normalizeSerialTrackingType, SerialTrackingType } from "@/lib/materialSerialTracking";
import { runMassImport, type PreparedMassImportRow } from "@/lib/server/massImportRunner";

export type MaterialImportRow = {
  rowNumber?: number;
  codigo: string;
  descricao: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  umb?: string | null;
  tipo: string;
  unitPrice?: string | number | null;
  stockMinimum?: string | number | null;
  stockMaximum?: string | number | null;
  isTransformer?: boolean;
  serialTrackingType?: SerialTrackingType | string | null;
  allowPendingSerialIdentification?: boolean | null;
};

function normalizeCode(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function normalizeMaterialType(value: unknown) {
  const normalized = normalizeText(value).toUpperCase();
  return normalized === "NOVO" || normalized === "SUCATA" ? normalized : "";
}

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = normalizeText(value).toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "sim";
}

function normalizePrice(value: unknown) {
  const raw = normalizeText(value).replace(",", ".");
  if (!raw) {
    return 0;
  }

  const numeric = Number(raw);
  return Number.isFinite(numeric) && numeric >= 0 ? Number(numeric.toFixed(2)) : NaN;
}

function normalizeOptionalNonNegativeNumber(value: unknown) {
  const raw = normalizeText(value).replace(",", ".");
  if (!raw) {
    return null;
  }

  const numeric = Number(raw);
  return Number.isFinite(numeric) && numeric >= 0 ? Number(numeric.toFixed(4)) : NaN;
}

/**
 * Mesma validacao estrutural de `validateRequiredMaterialFields`
 * (src/app/api/materials/route.ts), duplicada aqui de proposito: os
 * normalizadores de route.ts sao usados em ~40 outros pontos daquele arquivo
 * (filtros, PUT, PATCH) e nao valem a pena extrair so por causa do lote.
 * Existencia de categoria/subcategoria/UMB e as demais regras de negocio
 * (tipo, preco, estoque, rastreio) ficam para `save_material_records_batch`
 * (migration 437), que ja replica a validacao de `save_material_record`.
 */
function prepareRow(row: MaterialImportRow, index: number): PreparedMassImportRow<Record<string, unknown>> {
  const rowNumber = Number.isInteger(Number(row.rowNumber)) && Number(row.rowNumber) > 0
    ? Number(row.rowNumber)
    : index + 2;

  const codigo = normalizeCode(row.codigo);
  const descricao = normalizeText(row.descricao);
  const categoryId = normalizeNullableText(row.categoryId);
  const subcategoryId = normalizeNullableText(row.subcategoryId);
  const umb = normalizeCode(row.umb) || null;
  const tipo = normalizeMaterialType(row.tipo);
  const unitPrice = normalizePrice(row.unitPrice);
  const stockMinimum = normalizeOptionalNonNegativeNumber(row.stockMinimum) ?? 0;
  const stockMaximum = normalizeOptionalNonNegativeNumber(row.stockMaximum);
  const serialTrackingType = normalizeSerialTrackingType(
    row.serialTrackingType ?? (normalizeBoolean(row.isTransformer) ? "TRAFO" : "NONE"),
  );
  const allowPendingSerialIdentification = allowsPendingSerialIdentification(
    serialTrackingType,
    normalizeBoolean(row.allowPendingSerialIdentification),
  );

  if (!codigo || !descricao || !categoryId || !subcategoryId || !tipo || !umb) {
    return {
      rowNumber,
      ok: false,
      message: "Preencha os campos obrigatorios: Codigo, Descricao, Categoria, Subcategoria, Tipo e UMB.",
    };
  }

  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return { rowNumber, ok: false, message: "Preco invalido. Informe valor numerico maior ou igual a zero." };
  }

  if (
    !Number.isFinite(stockMinimum)
    || stockMinimum < 0
    || (stockMaximum !== null && (!Number.isFinite(stockMaximum) || stockMaximum < stockMinimum))
  ) {
    return {
      rowNumber,
      ok: false,
      message: "Limites de estoque invalidos. O maximo deve estar vazio ou ser maior/igual ao minimo.",
    };
  }

  return {
    rowNumber,
    ok: true,
    payload: {
      rowNumber,
      codigo,
      descricao,
      categoryId,
      subcategoryId,
      umb,
      tipo,
      unitPrice,
      stockMinimum,
      stockMaximum,
      isTransformer: serialTrackingType === "TRAFO",
      serialTrackingType,
      allowPendingSerialIdentification,
    },
  };
}

export async function importMaterialBatch(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  rows: MaterialImportRow[];
}) {
  const prepared = params.rows.map((row, index) => prepareRow(row, index));

  return runMassImport({
    supabase: params.supabase,
    prepared,
    rpcName: "save_material_records_batch",
    genericFailureMessage: "Falha ao salvar material.",
    buildRpcParams: (validRows) => ({
      p_tenant_id: params.tenantId,
      p_actor_user_id: params.actorUserId,
      p_rows: validRows.map((row) => ({
        ...row.payload,
        rowNumber: row.rowNumber,
      })),
    }),
  });
}
