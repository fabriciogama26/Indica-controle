import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser, type AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { buildUserDisplayMap, parsePagination } from "@/lib/server/apiHelpers";
import { normalizeExpectedUpdatedAt } from "@/lib/server/concurrency";
import { DEFAULT_HISTORY_PAGE_SIZE } from "@/lib/constants/pagination";
import { requirePageAction, type PageAction } from "@/lib/server/pageAuthorization";
import type {
  AssignWarehouseAddressPayload,
  SaveWarehouseMapPayload,
  WarehouseAddressRow,
  WarehouseBalanceRow,
  WarehouseConfigHistoryRow,
  WarehouseMapRow,
  WarehouseMaterialRow,
  WarehouseShelfFloorRow,
  WarehouseShelfRow,
  WarehouseStorageTypeRow,
  WarehouseStockCenterRow,
  WarehouseTeamStockCenterRow,
} from "./types";

type RpcConflictRow = {
  materialId: string;
  codigo: string;
  coluna: string;
  linha: number;
  andar: number;
  posicao: number;
};

type RpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  map_id?: string;
  address_id?: string;
  assigned_count?: number;
  cleared_count?: number;
  updated_at?: string;
  conflicts?: RpcConflictRow[];
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeColumn(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function normalizePositiveInteger(value: unknown) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function normalizeStorageType(value: unknown) {
  const normalized = normalizeText(value).toUpperCase();
  return normalized || "SHELF";
}

function normalizeColumns(values: unknown) {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(new Set(values.map(normalizeColumn).filter(Boolean)));
}

function normalizeLines(values: unknown) {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .map((value) => normalizePositiveInteger(value))
        .filter((value): value is number => value !== null),
    ),
  ).sort((a, b) => a - b);
}

function normalizeShelves(values: unknown, storageTypesWithoutFloors: Set<string>) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.map((item) => {
    const raw = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const tipo = normalizeStorageType(raw.tipo ?? raw.storageType);
    const andares = Array.isArray(raw.andares) ? raw.andares : [];

    return {
      id: normalizeText(raw.id) || undefined,
      coluna: normalizeColumn(raw.coluna),
      linha: normalizePositiveInteger(raw.linha) ?? 0,
      tipo,
      andares: storageTypesWithoutFloors.has(tipo)
        ? [{ numero: 1, qtdPosicoes: normalizePositiveInteger((andares[0] as Record<string, unknown> | undefined)?.qtdPosicoes) ?? 1 }]
        : andares.map((floor) => {
            const floorRaw = floor && typeof floor === "object" ? floor as Record<string, unknown> : {};
            return {
              numero: normalizePositiveInteger(floorRaw.numero) ?? 0,
              qtdPosicoes: normalizePositiveInteger(floorRaw.qtdPosicoes) ?? 1,
            };
          }),
    };
  });
}

function normalizeBatchAssignments(values: unknown) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.map((item) => {
    const raw = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      materialId: normalizeText(raw.materialId),
      coluna: normalizeColumn(raw.coluna),
      linha: normalizePositiveInteger(raw.linha),
      andar: normalizePositiveInteger(raw.andar),
      posicao: normalizePositiveInteger(raw.posicao),
    };
  });
}

async function resolveContext(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para operar o enderecamento do almoxarifado.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return {
      response: NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status }),
      context: null,
    };
  }

  return { response: null, context: resolution };
}

async function authorize(context: AuthenticatedAppUserContext, pageKey: string, action: PageAction) {
  const authorization = await requirePageAction({ context, pageKey, action });
  if (!authorization.allowed) {
    return NextResponse.json(
      { message: authorization.error.message, code: authorization.error.code },
      { status: authorization.error.status },
    );
  }

  return null;
}

function mapConfig(map: WarehouseMapRow | null, shelves: WarehouseShelfRow[], floors: WarehouseShelfFloorRow[]) {
  if (!map) {
    return null;
  }

  const floorsByShelf = new Map<string, WarehouseShelfFloorRow[]>();
  for (const floor of floors) {
    const list = floorsByShelf.get(floor.shelf_id) ?? [];
    list.push(floor);
    floorsByShelf.set(floor.shelf_id, list);
  }

  return {
    id: map.id,
    stockCenterId: map.stock_center_id,
    colunas: map.colunas,
    linhas: map.linhas,
    updatedAt: map.updated_at,
    prateleiras: shelves.map((shelf) => ({
          id: shelf.id,
          coluna: shelf.coluna,
          linha: shelf.linha,
          tipo: shelf.storage_type ?? "SHELF",
          andares: (floorsByShelf.get(shelf.id) ?? [])
        .sort((a, b) => a.numero - b.numero)
        .map((floor) => ({
          numero: floor.numero,
          qtdPosicoes: floor.qtd_posicoes,
        })),
    })),
  };
}

async function fetchWarehouseStorageTypes(context: AuthenticatedAppUserContext) {
  const { data, error } = await context.supabase
    .from("warehouse_storage_types")
    .select("code, label, uses_floors, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .returns<WarehouseStorageTypeRow[]>();

  if (error) {
    return { data: null, response: NextResponse.json({ message: "Falha ao carregar tipos de endereco." }, { status: 500 }) };
  }

  return {
    data: (data ?? []).map((type) => ({
      code: type.code,
      label: type.label,
      usesFloors: type.uses_floors,
    })),
    response: null,
  };
}

async function fetchPhysicalWarehouseStockCenters(context: AuthenticatedAppUserContext) {
  const [stockCentersResult, teamCentersResult] = await Promise.all([
    context.supabase
      .from("stock_centers")
      .select("id, name, center_type, controls_balance")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("is_active", true)
      .eq("center_type", "OWN")
      .eq("controls_balance", true)
      .order("name", { ascending: true })
      .returns<WarehouseStockCenterRow[]>(),
    context.supabase
      .from("teams")
      .select("stock_center_id")
      .eq("tenant_id", context.appUser.tenant_id)
      .returns<WarehouseTeamStockCenterRow[]>(),
  ]);

  if (stockCentersResult.error || teamCentersResult.error) {
    return { data: null, response: NextResponse.json({ message: "Falha ao carregar centros de estoque." }, { status: 500 }) };
  }

  const teamStockCenterIds = new Set(
    (teamCentersResult.data ?? [])
      .map((row) => String(row.stock_center_id ?? "").trim())
      .filter(Boolean),
  );

  return {
    data: (stockCentersResult.data ?? [])
      .filter((center) => !teamStockCenterIds.has(center.id))
      .map((center) => ({
        id: center.id,
        name: center.name,
        centerType: center.center_type,
        controlsBalance: center.controls_balance,
        centerKind: "PHYSICAL_WAREHOUSE" as const,
        isPhysicalWarehouse: true,
      })),
    response: null,
  };
}

async function ensurePhysicalWarehouseStockCenter(context: AuthenticatedAppUserContext, stockCenterId: string) {
  const centers = await fetchPhysicalWarehouseStockCenters(context);
  if (centers.response) {
    return { centers: null, response: centers.response };
  }

  if (!centers.data?.some((center) => center.id === stockCenterId)) {
    return {
      centers: centers.data ?? [],
      response: NextResponse.json(
        { message: "Use somente centro fisico de almoxarifado. Centros vinculados a equipes nao podem receber enderecamento." },
        { status: 422 },
      ),
    };
  }

  return { centers: centers.data ?? [], response: null };
}

async function fetchMapConfig(context: AuthenticatedAppUserContext, stockCenterId: string) {
  const { data: map, error: mapError } = await context.supabase
    .from("warehouse_maps")
    .select("id, stock_center_id, colunas, linhas, updated_at")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("stock_center_id", stockCenterId)
    .eq("is_active", true)
    .maybeSingle<WarehouseMapRow>();

  if (mapError) {
    return { config: null, response: NextResponse.json({ message: "Falha ao carregar configuracao do mapa." }, { status: 500 }) };
  }

  if (!map) {
    return { config: null, response: null };
  }

  const shelvesResult = await context.supabase
    .from("warehouse_shelves")
    .select("id, coluna, linha, storage_type")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("map_id", map.id)
    .order("linha", { ascending: true })
    .order("coluna", { ascending: true })
    .returns<WarehouseShelfRow[]>();

  if (shelvesResult.error) {
    return { config: null, response: NextResponse.json({ message: "Falha ao carregar prateleiras do mapa." }, { status: 500 }) };
  }

  const shelfIds = new Set((shelvesResult.data ?? []).map((shelf) => shelf.id));
  let floors: WarehouseShelfFloorRow[] = [];

  if (shelfIds.size > 0) {
    const floorsResult = await context.supabase
      .from("warehouse_shelf_floors")
      .select("shelf_id, numero, qtd_posicoes")
      .eq("tenant_id", context.appUser.tenant_id)
      .in("shelf_id", Array.from(shelfIds))
      .order("numero", { ascending: true })
      .returns<WarehouseShelfFloorRow[]>();

    if (floorsResult.error) {
      return { config: null, response: NextResponse.json({ message: "Falha ao carregar andares do mapa." }, { status: 500 }) };
    }

    floors = floorsResult.data ?? [];
  }

  return { config: mapConfig(map, shelvesResult.data ?? [], floors), response: null };
}

export async function handleWarehouseConfigGet(request: NextRequest) {
  const { context, response } = await resolveContext(request);
  if (!context) return response;

  const authResponse = await authorize(context, "configuracao-mapa-almoxarifado", "read");
  if (authResponse) return authResponse;

  const centers = await fetchPhysicalWarehouseStockCenters(context);
  if (centers.response) return centers.response;
  const storageTypes = await fetchWarehouseStorageTypes(context);
  if (storageTypes.response) return storageTypes.response;

  const stockCenterId = normalizeText(request.nextUrl.searchParams.get("stockCenterId"));
  if (stockCenterId && !centers.data?.some((center) => center.id === stockCenterId)) {
    return NextResponse.json(
      { message: "Use somente centro fisico de almoxarifado. Centros vinculados a equipes nao podem receber enderecamento." },
      { status: 422 },
    );
  }

  const config = stockCenterId ? await fetchMapConfig(context, stockCenterId) : { config: null, response: null };
  if (config.response) return config.response;

  return NextResponse.json({
    stockCenters: centers.data ?? [],
    storageTypes: storageTypes.data ?? [],
    configuracao: config.config,
  });
}

export async function handleWarehouseConfigPost(request: NextRequest) {
  const { context, response } = await resolveContext(request);
  if (!context) return response;

  const authResponse = await authorize(context, "configuracao-mapa-almoxarifado", "update");
  if (authResponse) return authResponse;

  const body = (await request.json().catch(() => ({}))) as SaveWarehouseMapPayload;
  const storageTypes = await fetchWarehouseStorageTypes(context);
  if (storageTypes.response) return storageTypes.response;
  const storageTypesWithoutFloors = new Set(
    (storageTypes.data ?? [])
      .filter((type) => !type.usesFloors)
      .map((type) => type.code),
  );
  const stockCenterId = normalizeText(body.stockCenterId);
  const colunas = normalizeColumns(body.colunas);
  const linhas = normalizeLines(body.linhas);
  const prateleiras = normalizeShelves(body.prateleiras, storageTypesWithoutFloors);

  if (!stockCenterId || colunas.length === 0 || linhas.length === 0) {
    return NextResponse.json({ message: "Centro, colunas e linhas sao obrigatorios." }, { status: 400 });
  }

  const physicalCenter = await ensurePhysicalWarehouseStockCenter(context, stockCenterId);
  if (physicalCenter.response) return physicalCenter.response;

  const { data, error } = await context.supabase.rpc("save_warehouse_map_config", {
    p_tenant_id: context.appUser.tenant_id,
    p_actor_user_id: context.appUser.id,
    p_stock_center_id: stockCenterId,
    p_colunas: colunas,
    p_linhas: linhas,
    p_prateleiras: prateleiras,
    p_expected_updated_at: normalizeExpectedUpdatedAt(body.expectedUpdatedAt),
  });

  if (error) {
    return NextResponse.json({ message: "Falha ao salvar configuracao do mapa." }, { status: 500 });
  }

  const result = (data ?? {}) as RpcResult;
  if (result.success !== true) {
    return NextResponse.json(
      {
        message: result.message ?? "Falha ao salvar configuracao do mapa.",
        code: result.reason ?? undefined,
        conflicts: Array.isArray(result.conflicts) ? result.conflicts : undefined,
      },
      { status: Number(result.status ?? 500) },
    );
  }

  return NextResponse.json({
    success: true,
    mapId: result.map_id,
    updatedAt: result.updated_at,
    message: "Configuracao do mapa salva com sucesso.",
  });
}

export async function handleWarehouseConfigHistoryGet(request: NextRequest) {
  const { context, response } = await resolveContext(request);
  if (!context) return response;

  const authResponse = await authorize(context, "configuracao-mapa-almoxarifado", "read");
  if (authResponse) return authResponse;

  const mapId = normalizeText(request.nextUrl.searchParams.get("mapId"));
  if (!mapId) {
    return NextResponse.json({ message: "Mapa e obrigatorio." }, { status: 400 });
  }

  const { page, pageSize, from, to } = parsePagination(request.nextUrl.searchParams, {
    defaultPageSize: DEFAULT_HISTORY_PAGE_SIZE,
    maxPageSize: 30,
  });

  const { data, error, count } = await context.supabase
    .from("warehouse_address_history")
    .select("id, details, created_at, created_by", { count: "exact" })
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("map_id", mapId)
    .eq("action_type", "CONFIG_SAVE")
    .order("created_at", { ascending: false })
    .range(from, to)
    .returns<WarehouseConfigHistoryRow[]>();

  if (error) {
    return NextResponse.json({ message: "Falha ao carregar historico da configuracao do mapa." }, { status: 500 });
  }

  const rows = data ?? [];
  const userIds = Array.from(new Set(rows.map((row) => row.created_by).filter((id): id is string => Boolean(id))));

  let userDisplayMap = new Map<string, string>();
  if (userIds.length > 0) {
    const usersResult = await context.supabase
      .from("app_users")
      .select("id, display, login_name")
      .in("id", userIds);

    if (usersResult.error) {
      return NextResponse.json({ message: "Falha ao carregar historico da configuracao do mapa." }, { status: 500 });
    }

    userDisplayMap = buildUserDisplayMap(usersResult.data ?? []);
  }

  return NextResponse.json({
    entries: rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      createdByName: (row.created_by && userDisplayMap.get(row.created_by)) ?? "Nao identificado",
      details: row.details ?? {},
    })),
    total: count ?? rows.length,
    page,
    pageSize,
  });
}

export async function handleWarehouseMapGet(request: NextRequest) {
  const { context, response } = await resolveContext(request);
  if (!context) return response;

  const authResponse = await authorize(context, "mapa-almoxarifado", "read");
  if (authResponse) return authResponse;

  const stockCenterId = normalizeText(request.nextUrl.searchParams.get("stockCenterId"));
  if (!stockCenterId) {
    const centers = await fetchPhysicalWarehouseStockCenters(context);
    if (centers.response) return centers.response;
    const storageTypes = await fetchWarehouseStorageTypes(context);
    if (storageTypes.response) return storageTypes.response;
    return NextResponse.json({ stockCenters: centers.data ?? [], storageTypes: storageTypes.data ?? [], configuracao: null, materiais: [] });
  }

  const physicalCenter = await ensurePhysicalWarehouseStockCenter(context, stockCenterId);
  if (physicalCenter.response) return physicalCenter.response;
  const storageTypes = await fetchWarehouseStorageTypes(context);
  if (storageTypes.response) return storageTypes.response;

  const config = await fetchMapConfig(context, stockCenterId);
  if (config.response) return config.response;

  const mapId = config.config?.id ?? null;
  if (!mapId) {
    return NextResponse.json({ stockCenters: physicalCenter.centers ?? [], storageTypes: storageTypes.data ?? [], configuracao: null, materiais: [] });
  }

  const [balancesResult, addressesResult] = await Promise.all([
    context.supabase
      .from("stock_center_balances")
      .select("material_id, quantity")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("stock_center_id", stockCenterId)
      .returns<WarehouseBalanceRow[]>(),
    context.supabase
      .from("warehouse_material_addresses")
      .select("id, material_id, coluna, linha, andar, posicao, updated_at")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("map_id", mapId)
      .returns<WarehouseAddressRow[]>(),
  ]);

  if (balancesResult.error || addressesResult.error) {
    return NextResponse.json({ message: "Falha ao carregar ocupacao do mapa." }, { status: 500 });
  }

  const materialIds = Array.from(
    new Set([
      ...(balancesResult.data ?? []).map((row) => row.material_id),
      ...(addressesResult.data ?? []).map((row) => row.material_id),
    ]),
  );

  let materials: WarehouseMaterialRow[] = [];
  if (materialIds.length > 0) {
    const materialsResult = await context.supabase
      .from("materials")
      .select("id, codigo, descricao, umb, stock_minimum, stock_maximum, is_active")
      .eq("tenant_id", context.appUser.tenant_id)
      .in("id", materialIds)
      .returns<WarehouseMaterialRow[]>();

    if (materialsResult.error) {
      return NextResponse.json({ message: "Falha ao carregar materiais do mapa." }, { status: 500 });
    }

    materials = materialsResult.data ?? [];
  }

  const balanceByMaterial = new Map((balancesResult.data ?? []).map((row) => [row.material_id, Number(row.quantity ?? 0)]));
  const addressesByMaterial = new Map<string, WarehouseAddressRow[]>();
  for (const row of addressesResult.data ?? []) {
    const list = addressesByMaterial.get(row.material_id) ?? [];
    list.push(row);
    addressesByMaterial.set(row.material_id, list);
  }

  return NextResponse.json({
    stockCenters: physicalCenter.centers ?? [],
    storageTypes: storageTypes.data ?? [],
    configuracao: config.config,
    materiais: materials
      .filter((material) => material.is_active)
      .map((material) => ({
        id: material.id,
        codigo: material.codigo,
        nome: material.descricao,
        unidade: material.umb ?? "",
        quantidade: balanceByMaterial.get(material.id) ?? 0,
        estoqueMinimo: Number(material.stock_minimum ?? 0),
        estoqueMaximo: material.stock_maximum === null ? null : Number(material.stock_maximum),
        enderecos: (addressesByMaterial.get(material.id) ?? []).map((address) => ({
          id: address.id,
          coluna: address.coluna,
          linha: address.linha,
          andar: address.andar,
          posicao: address.posicao,
          updatedAt: address.updated_at,
        })),
      })),
  });
}

export async function handleWarehouseAddressPost(request: NextRequest) {
  const { context, response } = await resolveContext(request);
  if (!context) return response;

  const authResponse = await authorize(context, "mapa-almoxarifado", "update");
  if (authResponse) return authResponse;

  const body = (await request.json().catch(() => ({}))) as AssignWarehouseAddressPayload;
  const mapId = normalizeText(body.mapId);

  if (Array.isArray(body.assignments)) {
    const assignments = normalizeBatchAssignments(body.assignments);
    if (!mapId || assignments.length === 0 || assignments.some((item) => !item.materialId || !item.coluna || item.linha === null || item.andar === null || item.posicao === null)) {
      return NextResponse.json({ message: "Mapa e lista de enderecos completos sao obrigatorios." }, { status: 400 });
    }

    const { data, error } = await context.supabase.rpc("assign_warehouse_material_addresses_batch", {
      p_tenant_id: context.appUser.tenant_id,
      p_actor_user_id: context.appUser.id,
      p_map_id: mapId,
      p_assignments: assignments,
    });

    if (error) {
      return NextResponse.json({ message: "Falha ao enderecar materiais em massa." }, { status: 500 });
    }

    const result = (data ?? {}) as RpcResult;
    if (result.success !== true) {
      return NextResponse.json(
        { message: result.message ?? "Falha ao enderecar materiais em massa.", code: result.reason ?? undefined },
        { status: Number(result.status ?? 500) },
      );
    }

    return NextResponse.json({
      success: true,
      assignedCount: Number(result.assigned_count ?? assignments.length),
      message: result.message ?? "Materiais enderecados com sucesso.",
    });
  }

  const materialId = normalizeText(body.materialId);
  const addressId = normalizeText(body.addressId) || null;
  const coluna = normalizeColumn(body.coluna);
  const linha = normalizePositiveInteger(body.linha);
  const andar = normalizePositiveInteger(body.andar);
  const posicao = normalizePositiveInteger(body.posicao);

  if (!mapId || !materialId || !coluna || linha === null || andar === null || posicao === null) {
    return NextResponse.json({ message: "Mapa, material e endereco completo sao obrigatorios." }, { status: 400 });
  }

  const { data, error } = await context.supabase.rpc("assign_warehouse_material_address", {
    p_tenant_id: context.appUser.tenant_id,
    p_actor_user_id: context.appUser.id,
    p_map_id: mapId,
    p_material_id: materialId,
    p_coluna: coluna,
    p_linha: linha,
    p_andar: andar,
    p_posicao: posicao,
    p_address_id: addressId,
    p_expected_updated_at: normalizeExpectedUpdatedAt(body.expectedUpdatedAt),
  });

  if (error) {
    return NextResponse.json({ message: "Falha ao atribuir endereco." }, { status: 500 });
  }

  const result = (data ?? {}) as RpcResult;
  if (result.success !== true) {
    return NextResponse.json(
      { message: result.message ?? "Falha ao atribuir endereco.", code: result.reason ?? undefined },
      { status: Number(result.status ?? 500) },
    );
  }

  return NextResponse.json({
    success: true,
    addressId: result.address_id,
    updatedAt: result.updated_at,
    message: "Endereco atribuido com sucesso.",
  });
}

export async function handleWarehouseAddressDelete(request: NextRequest) {
  const { context, response } = await resolveContext(request);
  if (!context) return response;

  const authResponse = await authorize(context, "mapa-almoxarifado", "update");
  if (authResponse) return authResponse;

  const body = (await request.json().catch(() => ({}))) as AssignWarehouseAddressPayload;
  const mapId = normalizeText(body.mapId);
  const addressId = normalizeText(body.addressId);

  if (!addressId) {
    const coluna = normalizeColumn(body.coluna);
    const linha = normalizePositiveInteger(body.linha);

    if (!mapId || !coluna || linha === null) {
      return NextResponse.json({ message: "Mapa, coluna e linha da posicao sao obrigatorios." }, { status: 400 });
    }

    const { data, error } = await context.supabase.rpc("clear_warehouse_cell_addresses", {
      p_tenant_id: context.appUser.tenant_id,
      p_actor_user_id: context.appUser.id,
      p_map_id: mapId,
      p_coluna: coluna,
      p_linha: linha,
    });

    if (error) {
      return NextResponse.json({ message: "Falha ao limpar materiais da posicao." }, { status: 500 });
    }

    const result = (data ?? {}) as RpcResult;
    if (result.success !== true) {
      return NextResponse.json(
        { message: result.message ?? "Falha ao limpar materiais da posicao.", code: result.reason ?? undefined },
        { status: Number(result.status ?? 500) },
      );
    }

    return NextResponse.json({
      success: true,
      clearedCount: Number(result.cleared_count ?? 0),
      message: result.message ?? "Posicao limpa com sucesso.",
    });
  }

  const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);

  if (!mapId || !expectedUpdatedAt) {
    return NextResponse.json({ message: "Mapa e versao do endereco sao obrigatorios." }, { status: 400 });
  }

  const { data, error } = await context.supabase.rpc("clear_warehouse_material_address", {
    p_tenant_id: context.appUser.tenant_id,
    p_actor_user_id: context.appUser.id,
    p_map_id: mapId,
    p_address_id: addressId,
    p_expected_updated_at: expectedUpdatedAt,
  });

  if (error) {
    return NextResponse.json({ message: "Falha ao remover endereco." }, { status: 500 });
  }

  const result = (data ?? {}) as RpcResult;
  if (result.success !== true) {
    return NextResponse.json(
      { message: result.message ?? "Falha ao remover endereco.", code: result.reason ?? undefined },
      { status: Number(result.status ?? 500) },
    );
  }

  return NextResponse.json({ success: true, message: "Endereco removido com sucesso." });
}
