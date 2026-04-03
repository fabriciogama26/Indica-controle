import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import {
  normalizeDateInput,
  normalizeEntryType,
  normalizeMovementType,
  normalizeText,
  parsePositiveNumber,
  saveStockTransferViaRpc,
  StockTransferItemInput,
} from "@/lib/server/stockTransfers";

type ImportEntryPayload = {
  rowNumber?: number;
  movementType?: unknown;
  fromStockCenterId?: unknown;
  toStockCenterId?: unknown;
  projectId?: unknown;
  entryDate?: unknown;
  entryType?: unknown;
  notes?: unknown;
  materialId?: unknown;
  quantity?: unknown;
  serialNumber?: unknown;
  lotCode?: unknown;
  items?: Array<{
    materialId?: unknown;
    quantity?: unknown;
    serialNumber?: unknown;
    lotCode?: unknown;
  }>;
};

type ImportPayload = {
  entries?: ImportEntryPayload[];
};

type MaterialLookupRow = {
  id: string;
  is_transformer: boolean;
  is_active: boolean;
};

function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeImportItems(entry: ImportEntryPayload) {
  const batchItems = Array.isArray(entry.items) ? entry.items : [];

  if (batchItems.length > 0) {
    return batchItems
      .map((item) => {
        const materialId = normalizeText(item.materialId);
        const quantity = parsePositiveNumber(item.quantity);
        const serialNumber = normalizeText(item.serialNumber) || null;
        const lotCode = normalizeText(item.lotCode) || null;
        return { materialId, quantity, serialNumber, lotCode };
      })
      .filter((item) => item.materialId && item.quantity !== null)
      .map(
        (item) =>
          ({
            materialId: item.materialId,
            quantity: item.quantity as number,
            serialNumber: item.serialNumber,
            lotCode: item.lotCode,
          }) satisfies StockTransferItemInput,
      );
  }

  const materialId = normalizeText(entry.materialId);
  const quantity = parsePositiveNumber(entry.quantity);
  if (!materialId || quantity === null) {
    return [] as StockTransferItemInput[];
  }

  return [
    {
      materialId,
      quantity,
      serialNumber: normalizeText(entry.serialNumber) || null,
      lotCode: normalizeText(entry.lotCode) || null,
    },
  ];
}

export async function POST(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para importar movimentacoes em massa.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const payload = (await request.json().catch(() => ({}))) as ImportPayload;
    const entries = Array.isArray(payload.entries) ? payload.entries : [];

    if (entries.length === 0) {
      return NextResponse.json({ message: "Nenhum registro de importacao foi recebido." }, { status: 400 });
    }

    if (entries.length > 500) {
      return NextResponse.json(
        { message: "Limite de importacao excedido. Maximo de 500 registros por requisicao." },
        { status: 400 },
      );
    }

    const { supabase, appUser } = resolution;
    const today = toIsoDate(new Date());
    const materialIds = Array.from(new Set(
      entries.flatMap((entry) => normalizeImportItems(entry).map((item) => item.materialId)).filter(Boolean),
    ));

    const materialResult = materialIds.length
      ? await supabase
          .from("materials")
          .select("id, is_transformer, is_active")
          .eq("tenant_id", appUser.tenant_id)
          .in("id", materialIds)
          .returns<MaterialLookupRow[]>()
      : { data: [], error: null };

    if (materialResult.error) {
      return NextResponse.json({ message: "Falha ao validar materiais da importacao em massa." }, { status: 500 });
    }

    const materialMap = new Map((materialResult.data ?? []).map((row) => [
      row.id,
      { isTransformer: Boolean(row.is_transformer), isActive: Boolean(row.is_active) },
    ]));
    const seenTransformerUnits = new Map<string, number>();

    const results: Array<{
      rowNumber: number;
      success: boolean;
      transferId?: string;
      message: string;
      reason?: string;
      details?: unknown;
    }> = [];

    let successCount = 0;
    let errorCount = 0;

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const rowNumber = Number(entry.rowNumber ?? index + 1);

      const movementType = normalizeMovementType(entry.movementType);
      const fromStockCenterId = normalizeText(entry.fromStockCenterId);
      const toStockCenterId = normalizeText(entry.toStockCenterId);
      const projectId = normalizeText(entry.projectId);
      const entryDate = normalizeDateInput(entry.entryDate);
      const entryType = normalizeEntryType(entry.entryType);
      const notes = normalizeText(entry.notes) || null;
      const items = normalizeImportItems(entry);

      if (!movementType || !fromStockCenterId || !toStockCenterId || !projectId || !entryDate || !entryType || items.length === 0) {
        errorCount += 1;
        results.push({
          rowNumber,
          success: false,
          message:
            "Linha invalida. Campos obrigatorios: operacao, centro DE, centro PARA, projeto, data da entrada, tipo do material e quantidade valida.",
          reason: "INVALID_IMPORT_ROW",
        });
        continue;
      }

      const invalidTransformerItem = items.find((item) => {
        const material = materialMap.get(item.materialId);
        if (!material?.isTransformer) {
          return false;
        }
        return item.quantity !== 1 || !normalizeText(item.serialNumber) || !normalizeText(item.lotCode);
      });

      if (invalidTransformerItem) {
        errorCount += 1;
        results.push({
          rowNumber,
          success: false,
          message: invalidTransformerItem.quantity !== 1
            ? "Material TRAFO permite somente quantidade 1 por movimentacao."
            : "Serial e LP sao obrigatorios para material TRAFO.",
          reason: invalidTransformerItem.quantity !== 1
            ? "TRANSFORMER_QUANTITY_MUST_BE_ONE"
            : "TRANSFORMER_SERIAL_OR_LOT_REQUIRED",
        });
        continue;
      }

      if (entryDate > today) {
        errorCount += 1;
        results.push({
          rowNumber,
          success: false,
          message: "Data da movimentacao nao pode ser futura.",
          reason: "ENTRY_DATE_IN_FUTURE",
        });
        continue;
      }

      if (fromStockCenterId === toStockCenterId) {
        errorCount += 1;
        results.push({
          rowNumber,
          success: false,
          message: "Centro DE e centro PARA devem ser diferentes.",
          reason: "DUPLICATE_STOCK_CENTER",
        });
        continue;
      }

      const duplicateTransformerItem = items.find((item) => {
        const material = materialMap.get(item.materialId);
        if (!material?.isTransformer) {
          return false;
        }

        const unitKey = `${item.materialId}::${normalizeText(item.serialNumber)}::${normalizeText(item.lotCode)}`;
        const firstSeenRow = seenTransformerUnits.get(unitKey);
        if (firstSeenRow) {
          return true;
        }

        seenTransformerUnits.set(unitKey, rowNumber);
        return false;
      });

      if (duplicateTransformerItem) {
        const unitKey = `${duplicateTransformerItem.materialId}::${normalizeText(duplicateTransformerItem.serialNumber)}::${normalizeText(duplicateTransformerItem.lotCode)}`;
        const firstSeenRow = seenTransformerUnits.get(unitKey);
        errorCount += 1;
        results.push({
          rowNumber,
          success: false,
          message: `Ja existe outra linha na importacao com o mesmo material, Serial e LP (linha ${firstSeenRow ?? "-"})`,
          reason: "DUPLICATE_TRANSFORMER_UNIT_IN_IMPORT",
        });
        continue;
      }

      const saveResult = await saveStockTransferViaRpc(supabase, {
        tenantId: appUser.tenant_id,
        actorUserId: appUser.id,
        movementType,
        fromStockCenterId,
        toStockCenterId,
        projectId,
        entryDate,
        entryType,
        notes,
        items,
      });

      if (!saveResult.ok) {
        errorCount += 1;
        results.push({
          rowNumber,
          success: false,
          message: saveResult.message,
          reason: saveResult.reason,
          details: saveResult.details,
        });
        continue;
      }

      successCount += 1;
      results.push({
        rowNumber,
        success: true,
        transferId: saveResult.transferId,
        message: saveResult.message,
      });
    }

    return NextResponse.json(
      {
        success: errorCount === 0,
        summary: {
          total: entries.length,
          successCount,
          errorCount,
        },
        results,
      },
      { status: errorCount > 0 ? 207 : 200 },
    );
  } catch {
    return NextResponse.json({ message: "Falha ao importar movimentacoes em massa." }, { status: 500 });
  }
}
