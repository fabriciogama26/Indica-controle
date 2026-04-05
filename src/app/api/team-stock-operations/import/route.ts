import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import {
  normalizeDateInput,
  normalizeEntryType,
  normalizeText,
  parsePositiveNumber,
  StockTransferItemInput,
} from "@/lib/server/stockTransfers";
import {
  normalizeTeamOperationKind,
  saveTeamStockOperationBatchViaRpc,
  SaveTeamStockOperationBatchEntry,
} from "@/lib/server/teamStockOperations";

type ImportEntryPayload = {
  rowNumber?: number;
  operationKind?: unknown;
  stockCenterId?: unknown;
  teamId?: unknown;
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
  codigo: string;
  is_transformer: boolean;
  is_active: boolean;
};

type TeamLookupRow = {
  id: string;
  name: string;
  stock_center_id: string | null;
  ativo: boolean;
};

type StockCenterLookupRow = {
  id: string;
  name: string;
  is_active: boolean;
  center_type: "OWN" | "THIRD_PARTY";
};

type ProjectLookupRow = {
  id: string;
  sob: string;
  is_active: boolean;
};

type BalanceLookupRow = {
  stock_center_id: string;
  material_id: string;
  quantity: number | string | null;
};

type TrafoInstanceLookupRow = {
  material_id: string;
  serial_number: string;
  lot_code: string;
  current_stock_center_id: string | null;
};

type ImportValidationIssue = {
  rowNumber: number;
  column: string;
  value: string;
  error: string;
};

type PreparedImportEntry = SaveTeamStockOperationBatchEntry & {
  isTransformer: boolean;
  materialCode: string;
  quantity: number;
  serialNumber: string | null;
  lotCode: string | null;
  sourceStockCenterId: string;
  sourceStockCenterName: string;
  destinationStockCenterId: string;
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

function makeIssue(rowNumber: number, column: string, value: unknown, error: string): ImportValidationIssue {
  return {
    rowNumber,
    column,
    value: String(value ?? "").trim(),
    error,
  };
}

function buildErrorResults(issues: ImportValidationIssue[]) {
  const grouped = new Map<number, string[]>();

  for (const issue of issues) {
    const current = grouped.get(issue.rowNumber) ?? [];
    current.push(issue.error);
    grouped.set(issue.rowNumber, current);
  }

  return Array.from(grouped.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([rowNumber, messages]) => ({
      rowNumber,
      success: false,
      message: Array.from(new Set(messages)).join(" | "),
    }));
}

function buildValidationErrorResponse(issues: ImportValidationIssue[], total: number, message: string, status = 409) {
  const errorRows = new Set(issues.map((issue) => issue.rowNumber)).size;

  return NextResponse.json(
    {
      success: false,
      message,
      summary: {
        total,
        successCount: 0,
        errorCount: errorRows,
      },
      results: buildErrorResults(issues),
      validationIssues: issues,
    },
    { status },
  );
}

function makeBalanceKey(stockCenterId: string, materialId: string) {
  return `${stockCenterId}::${materialId}`;
}

function makeTrafoKey(materialId: string, serialNumber: string | null, lotCode: string | null) {
  return `${materialId}::${String(serialNumber ?? "").trim().toUpperCase()}::${String(lotCode ?? "").trim().toUpperCase()}`;
}

export async function POST(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para importar operacoes de equipe em massa.",
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
    const materialIds = Array.from(
      new Set(entries.flatMap((entry) => normalizeImportItems(entry).map((item) => item.materialId)).filter(Boolean)),
    );
    const teamIds = Array.from(new Set(entries.map((entry) => normalizeText(entry.teamId)).filter(Boolean)));
    const stockCenterIds = Array.from(new Set(entries.map((entry) => normalizeText(entry.stockCenterId)).filter(Boolean)));
    const projectIds = Array.from(new Set(entries.map((entry) => normalizeText(entry.projectId)).filter(Boolean)));

    const [
      materialResult,
      teamResult,
      allTeamCenterResult,
      projectResult,
    ] = await Promise.all([
      materialIds.length
        ? supabase
            .from("materials")
            .select("id, codigo, is_transformer, is_active")
            .eq("tenant_id", appUser.tenant_id)
            .in("id", materialIds)
            .returns<MaterialLookupRow[]>()
        : Promise.resolve({ data: [], error: null } as { data: MaterialLookupRow[]; error: null }),
      teamIds.length
        ? supabase
            .from("teams")
            .select("id, name, stock_center_id, ativo")
            .eq("tenant_id", appUser.tenant_id)
            .in("id", teamIds)
            .returns<TeamLookupRow[]>()
        : Promise.resolve({ data: [], error: null } as { data: TeamLookupRow[]; error: null }),
      supabase
        .from("teams")
        .select("stock_center_id")
        .eq("tenant_id", appUser.tenant_id),
      projectIds.length
        ? supabase
            .from("project")
            .select("id, sob, is_active")
            .eq("tenant_id", appUser.tenant_id)
            .in("id", projectIds)
            .returns<ProjectLookupRow[]>()
        : Promise.resolve({ data: [], error: null } as { data: ProjectLookupRow[]; error: null }),
    ]);

    if (materialResult.error || teamResult.error || allTeamCenterResult.error || projectResult.error) {
      return NextResponse.json({ message: "Falha ao validar catalogos da importacao em massa." }, { status: 500 });
    }

    const teamStockCenterIds = new Set(
      (allTeamCenterResult.data ?? [])
        .map((row) => String((row as { stock_center_id?: string | null }).stock_center_id ?? "").trim())
        .filter(Boolean),
    );
    const teamCenterIds = Array.from(
      new Set((teamResult.data ?? []).map((row) => String(row.stock_center_id ?? "").trim()).filter(Boolean)),
    );
    const stockCenterLookupIds = Array.from(new Set([...stockCenterIds, ...teamCenterIds]));

    const [stockCenterResult, balanceResult, trafoResult] = await Promise.all([
      stockCenterLookupIds.length
        ? supabase
            .from("stock_centers")
            .select("id, name, is_active, center_type")
            .eq("tenant_id", appUser.tenant_id)
            .in("id", stockCenterLookupIds)
            .returns<StockCenterLookupRow[]>()
        : Promise.resolve({ data: [], error: null } as { data: StockCenterLookupRow[]; error: null }),
      stockCenterLookupIds.length && materialIds.length
        ? supabase
            .from("stock_center_balances")
            .select("stock_center_id, material_id, quantity")
            .eq("tenant_id", appUser.tenant_id)
            .in("stock_center_id", stockCenterLookupIds)
            .in("material_id", materialIds)
            .returns<BalanceLookupRow[]>()
        : Promise.resolve({ data: [], error: null } as { data: BalanceLookupRow[]; error: null }),
      materialIds.length
        ? supabase
            .from("trafo_instances")
            .select("material_id, serial_number, lot_code, current_stock_center_id")
            .eq("tenant_id", appUser.tenant_id)
            .in("material_id", materialIds)
            .returns<TrafoInstanceLookupRow[]>()
        : Promise.resolve({ data: [], error: null } as { data: TrafoInstanceLookupRow[]; error: null }),
    ]);

    if (stockCenterResult.error || balanceResult.error || trafoResult.error) {
      return NextResponse.json({ message: "Falha ao validar saldo/posicao da importacao em massa." }, { status: 500 });
    }

    const materialMap = new Map((materialResult.data ?? []).map((row) => [
      row.id,
      {
        materialCode: row.codigo,
        isTransformer: Boolean(row.is_transformer),
        isActive: Boolean(row.is_active),
      },
    ]));
    const teamMap = new Map((teamResult.data ?? []).map((row) => [row.id, row]));
    const projectMap = new Map((projectResult.data ?? []).map((row) => [row.id, row]));
    const stockCenterMap = new Map((stockCenterResult.data ?? []).map((row) => [row.id, row]));

    const issues: ImportValidationIssue[] = [];
    const preparedEntries: PreparedImportEntry[] = [];

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const rowNumber = Number(entry.rowNumber ?? index + 1);
      const operationKind = normalizeTeamOperationKind(entry.operationKind);
      const stockCenterId = normalizeText(entry.stockCenterId);
      const teamId = normalizeText(entry.teamId);
      const projectId = normalizeText(entry.projectId);
      const entryDate = normalizeDateInput(entry.entryDate);
      const entryType = normalizeEntryType(entry.entryType);
      const notes = normalizeText(entry.notes) || null;
      const items = normalizeImportItems(entry);

      if (!operationKind) {
        issues.push(makeIssue(rowNumber, "operacao", entry.operationKind, "Operacao deve ser REQUISICAO, DEVOLUCAO ou RETORNO_DE_CAMPO."));
      }
      if (!stockCenterId) {
        issues.push(makeIssue(rowNumber, "centro_estoque", entry.stockCenterId, "Centro de estoque e obrigatorio."));
      }
      if (!teamId) {
        issues.push(makeIssue(rowNumber, "equipe", entry.teamId, "Equipe e obrigatoria."));
      }
      if (!projectId) {
        issues.push(makeIssue(rowNumber, "projeto", entry.projectId, "Projeto e obrigatorio."));
      }
      if (!entryDate) {
        issues.push(makeIssue(rowNumber, "data_operacao", entry.entryDate, "Data da operacao e obrigatoria."));
      }
      if (!entryType && operationKind !== "FIELD_RETURN") {
        issues.push(makeIssue(rowNumber, "tipo", entry.entryType, "Tipo do material deve ser NOVO ou SUCATA."));
      }
      if (items.length !== 1) {
        issues.push(makeIssue(rowNumber, "material_codigo", entry.materialId, "Cada linha deve conter exatamente um material valido."));
        continue;
      }

      const item = items[0];
      const material = materialMap.get(item.materialId);
      const team = teamMap.get(teamId);
      const project = projectMap.get(projectId);
      const mainStockCenter = stockCenterMap.get(stockCenterId);
      const teamStockCenter = team?.stock_center_id ? stockCenterMap.get(team.stock_center_id) ?? null : null;

      if (!material?.isActive) {
        issues.push(makeIssue(rowNumber, "material_codigo", item.materialId, "Material nao encontrado ou inativo."));
      }
      if (!project || !project.is_active) {
        issues.push(makeIssue(rowNumber, "projeto", projectId, "Projeto nao encontrado ou inativo."));
      }
      if (!team || !team.ativo) {
        issues.push(makeIssue(rowNumber, "equipe", teamId, "Equipe nao encontrada ou inativa."));
      }
      if (team && !team.stock_center_id) {
        issues.push(makeIssue(rowNumber, "equipe", team.name, "Equipe sem centro de estoque proprio vinculado."));
      }
      if (team?.stock_center_id && !teamStockCenter) {
        issues.push(makeIssue(rowNumber, "equipe", team.name, "Centro de estoque proprio da equipe nao foi encontrado."));
      }
      if (teamStockCenter && (!teamStockCenter.is_active || teamStockCenter.center_type !== "OWN")) {
        issues.push(makeIssue(rowNumber, "equipe", team?.name ?? teamId, "Centro de estoque proprio da equipe esta inativo ou invalido."));
      }
      if (!mainStockCenter || !mainStockCenter.is_active || mainStockCenter.center_type !== "OWN") {
        issues.push(makeIssue(rowNumber, "centro_estoque", stockCenterId, "Centro de estoque principal nao encontrado ou inativo."));
      }
      if (stockCenterId && teamStockCenterIds.has(stockCenterId)) {
        issues.push(makeIssue(rowNumber, "centro_estoque", stockCenterId, "Centro de estoque principal nao pode ser um centro vinculado a equipe."));
      }
      if (team?.stock_center_id && stockCenterId === team.stock_center_id) {
        issues.push(makeIssue(rowNumber, "centro_estoque", stockCenterId, "Centro de estoque principal e centro da equipe devem ser diferentes."));
      }
      if (item.quantity <= 0) {
        issues.push(makeIssue(rowNumber, "quantidade", item.quantity, "Quantidade deve ser maior que zero."));
      }
      if (entryDate && entryDate > today) {
        issues.push(makeIssue(rowNumber, "data_operacao", entryDate, "Data da movimentacao nao pode ser futura."));
      }
      if (material?.isTransformer && item.quantity !== 1) {
        issues.push(makeIssue(rowNumber, "quantidade", item.quantity, "Material TRAFO permite somente quantidade 1 por movimentacao."));
      }
      if (material?.isTransformer && !normalizeText(item.serialNumber)) {
        issues.push(makeIssue(rowNumber, "serial", item.serialNumber, "Serial e obrigatorio para material TRAFO."));
      }
      if (material?.isTransformer && !normalizeText(item.lotCode)) {
        issues.push(makeIssue(rowNumber, "lp", item.lotCode, "LP e obrigatorio para material TRAFO."));
      }

      const hasBlockingIssues = issues.some((issue) => issue.rowNumber === rowNumber);
      if (
        hasBlockingIssues
        || !material
        || !team
        || !team.stock_center_id
        || !project
        || !entryDate
        || !mainStockCenter
        || !teamStockCenter
      ) {
        continue;
      }

      const validatedOperationKind = operationKind as "REQUISITION" | "RETURN" | "FIELD_RETURN";
      const effectiveEntryType = validatedOperationKind === "FIELD_RETURN" ? "SUCATA" : (entryType as "NOVO" | "SUCATA");
      const sourceStockCenterId = validatedOperationKind === "REQUISITION"
        ? stockCenterId
        : validatedOperationKind === "RETURN"
          ? team.stock_center_id
          : "__FIELD_RETURN__";
      const sourceStockCenterName = validatedOperationKind === "REQUISITION"
        ? mainStockCenter.name
        : validatedOperationKind === "RETURN"
          ? teamStockCenter.name
          : "CAMPO / INSTALADO";
      const destinationStockCenterId = validatedOperationKind === "REQUISITION" ? team.stock_center_id : stockCenterId;

      preparedEntries.push({
        rowNumber,
        operationKind: validatedOperationKind,
        stockCenterId,
        teamId,
        projectId,
        entryDate,
        entryType: effectiveEntryType,
        notes,
        items: [item],
        isTransformer: material.isTransformer,
        materialCode: material.materialCode,
        quantity: item.quantity,
        serialNumber: item.serialNumber ?? null,
        lotCode: item.lotCode ?? null,
        sourceStockCenterId,
        sourceStockCenterName,
        destinationStockCenterId,
      });
    }

    if (issues.length > 0) {
      return buildValidationErrorResponse(
        issues,
        entries.length,
        "Cadastro em massa bloqueado por erros de validacao. Corrija o arquivo e tente novamente.",
        400,
      );
    }

    const projectedBalances = new Map<string, number>();
    for (const row of balanceResult.data ?? []) {
      projectedBalances.set(
        makeBalanceKey(row.stock_center_id, row.material_id),
        Number(row.quantity ?? 0),
      );
    }

    const projectedTrafoPositions = new Map<string, string | null>();
    for (const row of trafoResult.data ?? []) {
      projectedTrafoPositions.set(
        makeTrafoKey(row.material_id, row.serial_number, row.lot_code),
        row.current_stock_center_id,
      );
    }

    for (const entry of preparedEntries) {
      const item = entry.items[0];
      const balanceSourceKey = makeBalanceKey(entry.sourceStockCenterId, item.materialId);
      const balanceDestinationKey = makeBalanceKey(entry.destinationStockCenterId, item.materialId);

      if (entry.isTransformer) {
        const unitKey = makeTrafoKey(item.materialId, item.serialNumber ?? null, item.lotCode ?? null);
        const currentStockCenterId = projectedTrafoPositions.get(unitKey) ?? null;

        if (entry.operationKind === "FIELD_RETURN") {
          if (currentStockCenterId !== null) {
            issues.push(
              makeIssue(
                entry.rowNumber,
                "serial",
                `${item.serialNumber ?? ""}/${item.lotCode ?? ""}`,
                `A unidade TRAFO informada ja esta registrada no estoque com o material ${entry.materialCode}. Utilize Devolucao ou outra movimentacao compativel em vez de Retorno de campo.`,
              ),
            );
            continue;
          }

          projectedTrafoPositions.set(unitKey, entry.destinationStockCenterId);
        } else if (currentStockCenterId !== entry.sourceStockCenterId) {
          issues.push(
            makeIssue(
              entry.rowNumber,
              "serial",
              `${item.serialNumber ?? ""}/${item.lotCode ?? ""}`,
              `A unidade TRAFO informada nao esta no estoque de origem (${entry.sourceStockCenterName}). Confira Material, Serial e LP.`,
            ),
          );
          continue;
        } else {
          projectedTrafoPositions.set(unitKey, entry.destinationStockCenterId);
        }
      }

      if (entry.operationKind !== "FIELD_RETURN") {
        const sourceBalance = projectedBalances.get(balanceSourceKey) ?? 0;
        if (sourceBalance < entry.quantity) {
          issues.push(
            makeIssue(
              entry.rowNumber,
              "quantidade",
              entry.quantity,
              sourceBalance <= 0
                ? `O material ${entry.materialCode} nao existe com saldo disponivel no estoque de origem (${entry.sourceStockCenterName}).`
                : `Saldo insuficiente no estoque de origem (${entry.sourceStockCenterName}). Saldo atual: ${sourceBalance.toLocaleString("pt-BR")}.`,
            ),
          );
          continue;
        }

        projectedBalances.set(balanceSourceKey, sourceBalance - entry.quantity);
      }

      projectedBalances.set(
        balanceDestinationKey,
        (projectedBalances.get(balanceDestinationKey) ?? 0) + entry.quantity,
      );
    }

    if (issues.length > 0) {
      return buildValidationErrorResponse(
        issues,
        entries.length,
        "Cadastro em massa bloqueado por saldo/posicao inconsistente. Nenhuma linha foi salva.",
        409,
      );
    }

    const saveResult = await saveTeamStockOperationBatchViaRpc(supabase, {
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      entries: preparedEntries.map((entry) => ({
        rowNumber: entry.rowNumber,
        operationKind: entry.operationKind,
        stockCenterId: entry.stockCenterId,
        teamId: entry.teamId,
        projectId: entry.projectId,
        entryDate: entry.entryDate,
        entryType: entry.entryType,
        notes: entry.notes,
        items: entry.items,
      })),
    });

    if (!saveResult.ok) {
      const failedRowNumber = saveResult.failedRowNumber ?? 0;
      const failedIssue = failedRowNumber > 0
        ? [makeIssue(failedRowNumber, "linha", "", saveResult.message)]
        : [];

      return NextResponse.json(
        {
          success: false,
          message: saveResult.message,
          summary: {
            total: entries.length,
            successCount: 0,
            errorCount: failedIssue.length > 0 ? 1 : entries.length,
          },
          results: failedIssue.length > 0
            ? buildErrorResults(failedIssue)
            : [{
                rowNumber: 0,
                success: false,
                message: saveResult.message,
              }],
          validationIssues: failedIssue,
          details: saveResult.details,
        },
        { status: Math.max(409, saveResult.status) },
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: saveResult.message,
        summary: saveResult.summary,
        results: saveResult.results,
        validationIssues: [],
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json({ message: "Falha ao importar operacoes de equipe em massa." }, { status: 500 });
  }
}
