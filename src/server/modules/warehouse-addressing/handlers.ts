import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser, type AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { normalizeExpectedUpdatedAt } from "@/lib/server/concurrency";
import { requirePageAction, type PageAction } from "@/lib/server/pageAuthorization";
import type {
  AssignWarehouseAddressPayload,
  SaveWarehouseMapPayload,
  WarehouseAddressRow,
  WarehouseBalanceRow,
  WarehouseMapRow,
  WarehouseMaterialRow,
  WarehouseShelfFloorRow,
  WarehouseShelfRow,
  WarehouseStockCenterRow,
} from "./types";

type RpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  map_id?: string;
  address_id?: string;
  updated_at?: string;
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

function normalizeShelves(values: unknown) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.map((item) => {
    const raw = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const andares = Array.isArray(raw.andares) ? raw.andares : [];

    return {
      id: normalizeText(raw.id) || undefined,
      coluna: normalizeColumn(raw.coluna),
      linha: normalizePositiveInteger(raw.linha) ?? 0,
      andares: andares.map((floor) => {
        const floorRaw = floor && typeof floor === "object" ? floor as Record<string, unknown> : {};
        return {
          numero: normalizePositiveInteger(floorRaw.numero) ?? 0,
          qtdPosicoes: normalizePositiveInteger(floorRaw.qtdPosicoes) ?? 1,
        };
      }),
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
      andares: (floorsByShelf.get(shelf.id) ?? [])
        .sort((a, b) => a.numero - b.numero)
        .map((floor) => ({
          numero: floor.numero,
          qtdPosicoes: floor.qtd_posicoes,
        })),
    })),
  };
}

async function fetchStockCenters(context: AuthenticatedAppUserContext) {
  const { data, error } = await context.supabase
    .from("stock_centers")
    .select("id, name, center_type, controls_balance")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("is_active", true)
    .eq("controls_balance", true)
    .order("name", { ascending: true })
    .returns<WarehouseStockCenterRow[]>();

  if (error) {
    return { data: null, response: NextResponse.json({ message: "Falha ao carregar centros de estoque." }, { status: 500 }) };
  }

  return {
    data: (data ?? []).map((center) => ({
      id: center.id,
      name: center.name,
      centerType: center.center_type,
      controlsBalance: center.controls_balance,
    })),
    response: null,
  };
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
    .select("id, coluna, linha")
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

  const centers = await fetchStockCenters(context);
  if (centers.response) return centers.response;

  const stockCenterId = normalizeText(request.nextUrl.searchParams.get("stockCenterId"));
  const config = stockCenterId ? await fetchMapConfig(context, stockCenterId) : { config: null, response: null };
  if (config.response) return config.response;

  return NextResponse.json({
    stockCenters: centers.data ?? [],
    configuracao: config.config,
  });
}

export async function handleWarehouseConfigPost(request: NextRequest) {
  const { context, response } = await resolveContext(request);
  if (!context) return response;

  const authResponse = await authorize(context, "configuracao-mapa-almoxarifado", "update");
  if (authResponse) return authResponse;

  const body = (await request.json().catch(() => ({}))) as SaveWarehouseMapPayload;
  const stockCenterId = normalizeText(body.stockCenterId);
  const colunas = normalizeColumns(body.colunas);
  const linhas = normalizeLines(body.linhas);
  const prateleiras = normalizeShelves(body.prateleiras);

  if (!stockCenterId || colunas.length === 0 || linhas.length === 0) {
    return NextResponse.json({ message: "Centro, colunas e linhas sao obrigatorios." }, { status: 400 });
  }

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
      { message: result.message ?? "Falha ao salvar configuracao do mapa.", code: result.reason ?? undefined },
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

export async function handleWarehouseMapGet(request: NextRequest) {
  const { context, response } = await resolveContext(request);
  if (!context) return response;

  const authResponse = await authorize(context, "mapa-almoxarifado", "read");
  if (authResponse) return authResponse;

  const stockCenterId = normalizeText(request.nextUrl.searchParams.get("stockCenterId"));
  if (!stockCenterId) {
    const centers = await fetchStockCenters(context);
    if (centers.response) return centers.response;
    return NextResponse.json({ stockCenters: centers.data ?? [], configuracao: null, materiais: [] });
  }

  const [centers, config] = await Promise.all([
    fetchStockCenters(context),
    fetchMapConfig(context, stockCenterId),
  ]);
  if (centers.response) return centers.response;
  if (config.response) return config.response;

  const mapId = config.config?.id ?? null;
  if (!mapId) {
    return NextResponse.json({ stockCenters: centers.data ?? [], configuracao: null, materiais: [] });
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
  const addressByMaterial = new Map((addressesResult.data ?? []).map((row) => [row.material_id, row]));

  return NextResponse.json({
    stockCenters: centers.data ?? [],
    configuracao: config.config,
    materiais: materials
      .filter((material) => material.is_active)
      .map((material) => {
        const address = addressByMaterial.get(material.id) ?? null;
        return {
          id: material.id,
          codigo: material.codigo,
          nome: material.descricao,
          unidade: material.umb ?? "",
          quantidade: balanceByMaterial.get(material.id) ?? 0,
          estoqueMinimo: Number(material.stock_minimum ?? 0),
          estoqueMaximo: material.stock_maximum === null ? null : Number(material.stock_maximum),
          enderecoId: address?.id ?? null,
          enderecoUpdatedAt: address?.updated_at ?? null,
          coluna: address?.coluna ?? null,
          linha: address?.linha ?? null,
          andar: address?.andar ?? null,
          posicao: address?.posicao ?? null,
        };
      }),
  });
}

export async function handleWarehouseAddressPost(request: NextRequest) {
  const { context, response } = await resolveContext(request);
  if (!context) return response;

  const authResponse = await authorize(context, "mapa-almoxarifado", "update");
  if (authResponse) return authResponse;

  const body = (await request.json().catch(() => ({}))) as AssignWarehouseAddressPayload;
  const mapId = normalizeText(body.mapId);
  const materialId = normalizeText(body.materialId);
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
  const materialId = normalizeText(body.materialId);
  const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);

  if (!mapId || !materialId || !expectedUpdatedAt) {
    return NextResponse.json({ message: "Mapa, material e versao do endereco sao obrigatorios." }, { status: 400 });
  }

  const { data, error } = await context.supabase.rpc("clear_warehouse_material_address", {
    p_tenant_id: context.appUser.tenant_id,
    p_actor_user_id: context.appUser.id,
    p_map_id: mapId,
    p_material_id: materialId,
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
