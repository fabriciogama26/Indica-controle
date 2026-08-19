import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { parsePagination } from "@/lib/server/apiHelpers";

type TeamRow = {
  id: string;
  name: string;
  stock_center_id: string | null;
  service_center_id: string | null;
  foreman_person_id: string | null;
  ativo: boolean;
};

type NamedRow = {
  id: string;
  name?: string | null;
  nome?: string | null;
};

type MaterialRow = {
  id: string;
  codigo: string;
  descricao: string;
  umb: string | null;
  tipo: string | null;
  is_active: boolean;
};

type BalanceRow = {
  stock_center_id: string;
  material_id: string;
  quantity: number | string | null;
  updated_at: string | null;
  materials: MaterialRow | MaterialRow[] | null;
};

type TransferRow = {
  id: string;
  movement_type: "ENTRY" | "EXIT" | "TRANSFER";
  from_stock_center_id: string;
  to_stock_center_id: string;
  project_id: string | null;
  entry_date: string;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
};

type TransferItemRow = {
  id: string;
  stock_transfer_id: string;
  material_id: string;
  quantity: number | string | null;
  serial_number: string | null;
  lot_code: string | null;
  materials?: MaterialRow | MaterialRow[] | null;
};

type ProjectRow = {
  id: string;
  sob: string;
};

type TeamOperationRow = {
  transfer_id: string;
  operation_kind: "REQUISITION" | "RETURN" | "FIELD_RETURN" | null;
};

type TeamStockListFilters = {
  teamId: string;
  foreman: string;
  serviceCenter: string;
  materialCode: string;
  description: string;
  materialType: string;
  unit: string;
  teamStatus: string;
  qtyMin: number | null;
  qtyMax: number | null;
  includeZero: boolean;
};

type TeamStockListItem = {
  teamId: string;
  teamName: string;
  teamIsActive: boolean;
  foremanName: string;
  serviceCenterName: string;
  stockCenterId: string;
  materialId: string;
  materialCode: string;
  description: string;
  unit: string;
  materialType: string;
  balanceQuantity: number;
  lastMovementAt: string | null;
};

const CHUNK_SIZE = 100;
const QUERY_PAGE_SIZE = 1000;

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeCode(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function parseNonNegativeDecimal(value: string | null) {
  const normalized = normalizeText(value).replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function unwrapRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function chunks<T>(values: T[], size = CHUNK_SIZE) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function ensurePageAccess(context: AuthenticatedAppUserContext) {
  if (context.role.isAdmin) return true;

  const userPermission = await context.supabase
    .from("app_user_page_permissions")
    .select("can_access")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("user_id", context.appUser.id)
    .eq("page_key", "estoque-equipes")
    .maybeSingle<{ can_access: boolean }>();

  if (!userPermission.error && userPermission.data) {
    return Boolean(userPermission.data.can_access);
  }

  if (!context.appUser.role_id) return false;

  const rolePermission = await context.supabase
    .from("role_page_permissions")
    .select("can_access")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("role_id", context.appUser.role_id)
    .eq("page_key", "estoque-equipes")
    .maybeSingle<{ can_access: boolean }>();

  return !rolePermission.error && Boolean(rolePermission.data?.can_access);
}

async function resolveContext(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar o estoque das equipes.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) return resolution;

  if (!(await ensurePageAccess(resolution))) {
    return {
      error: {
        status: 403,
        message: "Acesso negado para carregar o estoque das equipes.",
      },
    };
  }

  return resolution;
}

async function loadTeams(context: AuthenticatedAppUserContext) {
  const rows: TeamRow[] = [];

  for (let from = 0; ; from += QUERY_PAGE_SIZE) {
    const { data, error } = await context.supabase
      .from("teams")
      .select("id, name, stock_center_id, service_center_id, foreman_person_id, ativo")
      .eq("tenant_id", context.appUser.tenant_id)
      .not("stock_center_id", "is", null)
      .order("name", { ascending: true })
      .range(from, from + QUERY_PAGE_SIZE - 1)
      .returns<TeamRow[]>();

    if (error) throw new Error("Falha ao carregar equipes.");
    rows.push(...(data ?? []));
    if ((data ?? []).length < QUERY_PAGE_SIZE) break;
  }

  return rows;
}

async function loadTeamLabels(context: AuthenticatedAppUserContext, teams: TeamRow[]) {
  const foremanIds = Array.from(new Set(teams.map((row) => row.foreman_person_id).filter(Boolean))) as string[];
  const serviceCenterIds = Array.from(new Set(teams.map((row) => row.service_center_id).filter(Boolean))) as string[];

  const [foremenResult, serviceCentersResult] = await Promise.all([
    foremanIds.length
      ? context.supabase
          .from("people")
          .select("id, nome")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", foremanIds)
          .returns<NamedRow[]>()
      : Promise.resolve({ data: [], error: null }),
    serviceCenterIds.length
      ? context.supabase
          .from("project_service_centers")
          .select("id, name")
          .eq("tenant_id", context.appUser.tenant_id)
          .in("id", serviceCenterIds)
          .returns<NamedRow[]>()
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (foremenResult.error || serviceCentersResult.error) {
    throw new Error("Falha ao carregar dados complementares das equipes.");
  }

  return {
    foremanMap: new Map((foremenResult.data ?? []).map((row) => [row.id, normalizeText(row.nome)])),
    serviceCenterMap: new Map((serviceCentersResult.data ?? []).map((row) => [row.id, normalizeText(row.name)])),
  };
}

async function loadMeta(context: AuthenticatedAppUserContext) {
  const teams = await loadTeams(context);
  const { foremanMap, serviceCenterMap } = await loadTeamLabels(context, teams);

  return NextResponse.json({
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      foremanName: team.foreman_person_id ? foremanMap.get(team.foreman_person_id) || "Nao informado" : "Nao informado",
      serviceCenterName: team.service_center_id
        ? serviceCenterMap.get(team.service_center_id) || "Nao informado"
        : "Sem base",
      isActive: Boolean(team.ativo),
    })),
    foremen: Array.from(new Set(Array.from(foremanMap.values()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, "pt-BR"),
    ),
    serviceCenters: Array.from(new Set(Array.from(serviceCenterMap.values()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, "pt-BR"),
    ),
  });
}

async function loadHistory(request: NextRequest, context: AuthenticatedAppUserContext) {
  const teamId = normalizeText(request.nextUrl.searchParams.get("teamId"));
  const materialId = normalizeText(request.nextUrl.searchParams.get("materialId"));
  const { page, pageSize } = parsePagination(request.nextUrl.searchParams, {
    defaultPageSize: 5,
    maxPageSize: 50,
  });

  if (!teamId || !materialId) {
    return NextResponse.json({ message: "Equipe e material sao obrigatorios para carregar o historico." }, { status: 400 });
  }

  const { data: team, error: teamError } = await context.supabase
    .from("teams")
    .select("id, name, stock_center_id, service_center_id, foreman_person_id, ativo")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("id", teamId)
    .maybeSingle<TeamRow>();

  if (teamError || !team?.stock_center_id) {
    return NextResponse.json({ message: "Equipe nao encontrada." }, { status: 404 });
  }

  const transfers: TransferRow[] = [];
  for (let from = 0; ; from += QUERY_PAGE_SIZE) {
    const { data, error } = await context.supabase
      .from("stock_transfers")
      .select("id, movement_type, from_stock_center_id, to_stock_center_id, project_id, entry_date, notes, created_at, updated_at")
      .eq("tenant_id", context.appUser.tenant_id)
      .or(`from_stock_center_id.eq.${team.stock_center_id},to_stock_center_id.eq.${team.stock_center_id}`)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + QUERY_PAGE_SIZE - 1)
      .returns<TransferRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao carregar o historico do estoque da equipe." }, { status: 500 });
    }

    transfers.push(...(data ?? []));
    if ((data ?? []).length < QUERY_PAGE_SIZE) break;
  }

  const transferIds = transfers.map((row) => row.id);
  const itemRows: TransferItemRow[] = [];
  const operationRows: TeamOperationRow[] = [];

  for (const transferIdChunk of chunks(transferIds)) {
    const [itemsResult, operationsResult] = await Promise.all([
      context.supabase
        .from("stock_transfer_items")
        .select("id, stock_transfer_id, material_id, quantity, serial_number, lot_code")
        .eq("tenant_id", context.appUser.tenant_id)
        .eq("material_id", materialId)
        .in("stock_transfer_id", transferIdChunk)
        .returns<TransferItemRow[]>(),
      context.supabase
        .from("stock_transfer_team_operations")
        .select("transfer_id, operation_kind")
        .eq("tenant_id", context.appUser.tenant_id)
        .eq("team_id", teamId)
        .in("transfer_id", transferIdChunk)
        .returns<TeamOperationRow[]>(),
    ]);

    if (itemsResult.error || operationsResult.error) {
      return NextResponse.json({ message: "Falha ao carregar o historico do estoque da equipe." }, { status: 500 });
    }

    itemRows.push(...(itemsResult.data ?? []));
    operationRows.push(...(operationsResult.data ?? []));
  }

  const itemsByTransfer = itemRows.reduce((map, row) => {
    const current = map.get(row.stock_transfer_id) ?? [];
    current.push(row);
    map.set(row.stock_transfer_id, current);
    return map;
  }, new Map<string, TransferItemRow[]>());
  const operationMap = new Map(operationRows.map((row) => [row.transfer_id, row.operation_kind]));
  const projectIds = Array.from(new Set(transfers.map((row) => row.project_id).filter(Boolean))) as string[];
  const projectRows: ProjectRow[] = [];
  for (const projectIdChunk of chunks(projectIds)) {
    const { data, error } = await context.supabase
      .from("project")
      .select("id, sob")
      .eq("tenant_id", context.appUser.tenant_id)
      .in("id", projectIdChunk)
      .returns<ProjectRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao carregar o historico do estoque da equipe." }, { status: 500 });
    }
    projectRows.push(...(data ?? []));
  }

  const projectMap = new Map(projectRows.map((row) => [row.id, row.sob]));
  const history = transfers.flatMap((transfer) => {
    const transferItems = itemsByTransfer.get(transfer.id) ?? [];
    return transferItems.map((item) => {
      const isTarget = transfer.to_stock_center_id === team.stock_center_id;
      return {
        id: item.id,
        transferId: transfer.id,
        operationKind: operationMap.get(transfer.id) ?? transfer.movement_type,
        signedQuantity: (isTarget ? 1 : -1) * Number(item.quantity ?? 0),
        quantity: Number(item.quantity ?? 0),
        entryDate: transfer.entry_date,
        changedAt: transfer.updated_at ?? transfer.created_at,
        projectCode: transfer.project_id ? projectMap.get(transfer.project_id) ?? "-" : "-",
        serialNumber: item.serial_number,
        lotCode: item.lot_code,
        notes: transfer.notes,
      };
    });
  });

  const from = (page - 1) * pageSize;
  return NextResponse.json({
    history: history.slice(from, from + pageSize),
    pagination: { page, pageSize, total: history.length },
  });
}

function parseListFilters(params: URLSearchParams): TeamStockListFilters {
  return {
    teamId: normalizeText(params.get("teamId")),
    foreman: normalizeCode(params.get("foreman")),
    serviceCenter: normalizeCode(params.get("serviceCenter")),
    materialCode: normalizeCode(params.get("materialCode")),
    description: normalizeCode(params.get("description")),
    materialType: normalizeCode(params.get("materialType")),
    unit: normalizeCode(params.get("unit")),
    teamStatus: normalizeCode(params.get("teamStatus")) || "ATIVAS",
    qtyMin: parseNonNegativeDecimal(params.get("qtyMin")),
    qtyMax: parseNonNegativeDecimal(params.get("qtyMax")),
    includeZero: normalizeText(params.get("includeZero")) === "1",
  };
}

async function buildListDataset(context: AuthenticatedAppUserContext, filters: TeamStockListFilters) {
  const teams = await loadTeams(context);
  const { foremanMap, serviceCenterMap } = await loadTeamLabels(context, teams);
  const filteredTeams = teams.filter((team) => {
    const foremanName = team.foreman_person_id ? foremanMap.get(team.foreman_person_id) ?? "" : "";
    const serviceCenterName = team.service_center_id ? serviceCenterMap.get(team.service_center_id) ?? "" : "";
    if (filters.teamId && team.id !== filters.teamId) return false;
    if (filters.teamStatus === "ATIVAS" && !team.ativo) return false;
    if (filters.teamStatus === "INATIVAS" && team.ativo) return false;
    if (filters.foreman && !normalizeCode(foremanName).includes(filters.foreman)) return false;
    if (filters.serviceCenter && !normalizeCode(serviceCenterName).includes(filters.serviceCenter)) return false;
    return true;
  });

  const centerIds = filteredTeams.map((row) => row.stock_center_id).filter(Boolean) as string[];
  if (centerIds.length === 0) {
    return {
      items: [],
      summary: { teamsWithStock: 0, distinctMaterials: 0, totalRows: 0 },
      summaryByUnit: [],
    };
  }

  const balances: BalanceRow[] = [];
  for (const centerIdChunk of chunks(centerIds)) {
    for (let from = 0; ; from += QUERY_PAGE_SIZE) {
      let query = context.supabase
        .from("stock_center_balances")
        .select("stock_center_id, material_id, quantity, updated_at, materials!inner(id, codigo, descricao, umb, tipo, is_active)")
        .eq("tenant_id", context.appUser.tenant_id)
        .in("stock_center_id", centerIdChunk)
        .eq("materials.is_active", true);

      if (!filters.includeZero) query = query.gt("quantity", 0);
      if (filters.qtyMin !== null) query = query.gte("quantity", filters.qtyMin);
      if (filters.qtyMax !== null) query = query.lte("quantity", filters.qtyMax);
      if (filters.materialCode) query = query.ilike("materials.codigo", `%${filters.materialCode}%`);
      if (filters.description) query = query.ilike("materials.descricao", `%${filters.description}%`);
      if (filters.materialType) query = query.ilike("materials.tipo", filters.materialType);
      if (filters.unit) query = query.ilike("materials.umb", filters.unit);

      const { data, error } = await query.range(from, from + QUERY_PAGE_SIZE - 1).returns<BalanceRow[]>();

      if (error) {
        throw new Error("Falha ao carregar o estoque das equipes.");
      }

      balances.push(...(data ?? []));
      if ((data ?? []).length < QUERY_PAGE_SIZE) break;
    }
  }

  const teamByCenter = new Map(filteredTeams.map((team) => [team.stock_center_id, team]));
  const items = balances
    .flatMap<TeamStockListItem>((balance) => {
      const team = teamByCenter.get(balance.stock_center_id);
      const material = unwrapRelation(balance.materials);
      if (!team || !material) return [];

      const quantity = Number(balance.quantity ?? 0);
      const foremanName = team.foreman_person_id ? foremanMap.get(team.foreman_person_id) || "Nao informado" : "Nao informado";
      const serviceCenterName = team.service_center_id
        ? serviceCenterMap.get(team.service_center_id) || "Nao informado"
        : "Sem base";

      if (!filters.includeZero && quantity <= 0) return [];
      if (filters.qtyMin !== null && quantity < filters.qtyMin) return [];
      if (filters.qtyMax !== null && quantity > filters.qtyMax) return [];
      if (filters.materialCode && !normalizeCode(material.codigo).includes(filters.materialCode)) return [];
      if (filters.description && !normalizeCode(material.descricao).includes(filters.description)) return [];
      if (filters.materialType && normalizeCode(material.tipo) !== filters.materialType) return [];
      if (filters.unit && normalizeCode(material.umb) !== filters.unit) return [];

      return [{
        teamId: team.id,
        teamName: team.name,
        teamIsActive: Boolean(team.ativo),
        foremanName,
        serviceCenterName,
        stockCenterId: balance.stock_center_id,
        materialId: material.id,
        materialCode: material.codigo,
        description: material.descricao,
        unit: normalizeText(material.umb),
        materialType: normalizeCode(material.tipo),
        balanceQuantity: quantity,
        lastMovementAt: balance.updated_at,
      }];
    })
    .sort((left, right) => {
      const teamComparison = left.teamName.localeCompare(right.teamName, "pt-BR");
      return teamComparison || left.materialCode.localeCompare(right.materialCode, "pt-BR");
    });

  const summaryByUnit = Array.from(
    items.reduce((summary, item) => {
      const itemUnit = normalizeCode(item.unit) || "SEM UMB";
      summary.set(itemUnit, (summary.get(itemUnit) ?? 0) + item.balanceQuantity);
      return summary;
    }, new Map<string, number>()),
    ([summaryUnit, balanceQuantity]) => ({ unit: summaryUnit, balanceQuantity }),
  ).sort((left, right) => left.unit.localeCompare(right.unit, "pt-BR"));

  return {
    items,
    summary: {
      teamsWithStock: new Set(items.filter((item) => item.balanceQuantity > 0).map((item) => item.teamId)).size,
      distinctMaterials: new Set(items.map((item) => item.materialId)).size,
      totalRows: items.length,
    },
    summaryByUnit,
  };
}

async function loadList(request: NextRequest, context: AuthenticatedAppUserContext) {
  const { page, pageSize } = parsePagination(request.nextUrl.searchParams, { maxPageSize: 100 });
  const filters = parseListFilters(request.nextUrl.searchParams);

  if (filters.qtyMin !== null && filters.qtyMax !== null && filters.qtyMin > filters.qtyMax) {
    return NextResponse.json({ message: "Saldo minimo nao pode ser maior que o saldo maximo." }, { status: 400 });
  }

  const dataset = await buildListDataset(context, filters);
  const from = (page - 1) * pageSize;
  return NextResponse.json({
    items: dataset.items.slice(from, from + pageSize),
    summary: dataset.summary,
    summaryByUnit: dataset.summaryByUnit,
    pagination: { page, pageSize, total: dataset.items.length },
  });
}

async function loadExport(request: NextRequest, context: AuthenticatedAppUserContext) {
  const filters = parseListFilters(request.nextUrl.searchParams);

  if (filters.qtyMin !== null && filters.qtyMax !== null && filters.qtyMin > filters.qtyMax) {
    return NextResponse.json({ message: "Saldo minimo nao pode ser maior que o saldo maximo." }, { status: 400 });
  }

  const dataset = await buildListDataset(context, filters);
  return NextResponse.json({
    items: dataset.items,
    summary: dataset.summary,
    summaryByUnit: dataset.summaryByUnit,
    pagination: { page: 1, pageSize: dataset.items.length, total: dataset.items.length },
  });
}

export async function GET(request: NextRequest) {
  try {
    const context = await resolveContext(request);
    if ("error" in context) {
      return NextResponse.json({ message: context.error.message }, { status: context.error.status });
    }

    const mode = normalizeText(request.nextUrl.searchParams.get("mode")).toLowerCase();
    if (mode === "meta") return await loadMeta(context);
    if (mode === "history") return await loadHistory(request, context);
    if (mode === "export") return await loadExport(request, context);
    return await loadList(request, context);
  } catch (error) {
    console.error("[team-stock-balance] load error", error);
    return NextResponse.json({ message: "Falha ao carregar o estoque das equipes." }, { status: 500 });
  }
}
