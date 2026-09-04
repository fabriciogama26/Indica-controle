import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import {
  buildConcurrencyConflictResponse,
  hasUpdatedAtConflict,
  normalizeExpectedUpdatedAt,
} from "@/lib/server/concurrency";
import {
  addChange,
  buildUserDisplayMap,
  buildUserLoginNameMap,

  normalizeHistoryChanges,
  normalizeText,
  parsePagination,
  parsePositiveInteger,
} from "@/lib/server/apiHelpers";
import { MASS_IMPORT_ROW_LIMIT } from "@/lib/constants/massImport";
import { authorizePageAction } from "@/lib/server/routeAuthorization";
import {
  fetchExistingTeamByForeman,
  fetchForemanById,
  fetchServiceCenterById,
  fetchStockCenterById,
  fetchSupervisorById,
  fetchTeamById,
  fetchTeamCategoryById,
  fetchTeamTypeById,
  type ServiceCenterRow,
  type StockCenterRow,
  type TeamCategoryRow,
  type TeamRow,
  type TeamTypeRow,
} from "@/server/modules/teams/lookups";
import {
  buildForemanMap,
  buildTeamCategoryMap,
  buildTeamTypeMap,
  isCommercialTeamCategory,
  isTechnicalTeamCategory,
  normalizePlate,
  type AppUserRow,
  type CreateTeamPayload,
  type HistoryChange,
  type PersonRow,
  type TeamHistoryRow,
  type UpdateTeamPayload,
  type UpdateTeamStatusPayload,
} from "@/server/modules/teams/types";
import {
  saveTeamViaRpc,
  setTeamStatusViaRpc,
  swapTeamForemenViaRpc,
} from "@/server/modules/teams/writes";
import {
  importTeamBatch,
  type TeamBatchImportPayload,
} from "@/server/modules/teams/massImport";

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para consultar equipes.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorizationError = await authorizePageAction(resolution, "equipes", "read");
    if (authorizationError) {
      return authorizationError;
    }

    const { supabase, appUser } = resolution;
    const params = request.nextUrl.searchParams;
    const historyTeamId = normalizeText(params.get("historyTeamId"));

    if (historyTeamId) {
      const team = await fetchTeamById(supabase, appUser.tenant_id, historyTeamId);
      if (!team) {
        return NextResponse.json({ message: "Equipe nao encontrada." }, { status: 404 });
      }

      const historyPage = parsePositiveInteger(params.get("historyPage"), 1);
      const historyPageSize = Math.min(parsePositiveInteger(params.get("historyPageSize"), 5), 30);
      const historyFrom = (historyPage - 1) * historyPageSize;
      const historyTo = historyFrom + historyPageSize - 1;

      const { data: historyData, error: historyError, count: historyCount } = await supabase
        .from("app_entity_history")
        .select("id, change_type, reason, changes, created_at, created_by", { count: "exact" })
        .eq("tenant_id", appUser.tenant_id)
        .eq("module_key", "equipes")
        .eq("entity_table", "teams")
        .eq("entity_id", historyTeamId)
        .order("created_at", { ascending: false })
        .range(historyFrom, historyTo)
        .returns<TeamHistoryRow[]>();

      if (historyError) {
        return NextResponse.json({ message: "Falha ao carregar historico da equipe." }, { status: 500 });
      }

      const userIds = Array.from(
        new Set((historyData ?? []).map((entry) => entry.created_by).filter((value): value is string => Boolean(value))),
      );

      let users: AppUserRow[] = [];
      if (userIds.length > 0) {
        const usersResult = await supabase
          .from("app_users")
          .select("id, display, login_name")
          .eq("tenant_id", appUser.tenant_id)
          .in("id", userIds)
          .returns<AppUserRow[]>();

        if (!usersResult.error) {
          users = usersResult.data ?? [];
        }
      }

      const userDisplayMap = buildUserDisplayMap(users);

      return NextResponse.json({
        team: {
          id: team.id,
          name: team.name,
          isActive: team.ativo,
        },
        history: (historyData ?? []).map((entry) => ({
          id: entry.id,
          changeType: entry.change_type,
          reason: entry.reason,
          changes: normalizeHistoryChanges(entry.changes),
          createdAt: entry.created_at,
          createdByName: userDisplayMap.get(entry.created_by ?? "") ?? "Nao identificado",
        })),
        pagination: {
          page: historyPage,
          pageSize: historyPageSize,
          total: historyCount ?? 0,
        },
      });
    }

    const name = normalizeText(params.get("name"));
    const vehiclePlate = normalizePlate(params.get("vehiclePlate"));
    const serviceCenterId = normalizeText(params.get("serviceCenterId"));
    const teamTypeId = normalizeText(params.get("teamTypeId"));
    const teamCategoryId = normalizeText(params.get("teamCategoryId"));
    const foremanId = normalizeText(params.get("foremanId"));
    const supervisorId = normalizeText(params.get("supervisorId"));
    const { page, pageSize, from, to } = parsePagination(params);

    let query = supabase
      .from("teams")
      .select(
        "id, name, vehicle_plate, service_center_id, stock_center_id, team_type_id, team_category_id, foreman_person_id, supervisor_person_id, ativo, cancellation_reason, canceled_at, canceled_by, created_by, updated_by, created_at, updated_at",
        { count: "exact" },
      )
      .eq("tenant_id", appUser.tenant_id);

    if (name) {
      query = query.ilike("name", `%${name}%`);
    }

    if (vehiclePlate) {
      query = query.ilike("vehicle_plate", `%${vehiclePlate}%`);
    }

    if (serviceCenterId) {
      query = query.eq("service_center_id", serviceCenterId);
    }

    if (teamTypeId) {
      query = query.eq("team_type_id", teamTypeId);
    }

    if (teamCategoryId) {
      query = query.eq("team_category_id", teamCategoryId);
    }

    if (foremanId) {
      query = query.eq("foreman_person_id", foremanId);
    }

    if (supervisorId) {
      query = query.eq("supervisor_person_id", supervisorId);
    }

    const { data, error, count } = await query
      .order("ativo", { ascending: false })
      .order("name", { ascending: true })
      .range(from, to)
      .returns<TeamRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao listar equipes." }, { status: 500 });
    }

    const userIds = Array.from(
      new Set(
        (data ?? [])
          .flatMap((item) => [item.created_by, item.updated_by, item.canceled_by])
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const foremanIds = Array.from(
      new Set((data ?? []).map((item) => item.foreman_person_id).filter((value): value is string => Boolean(value))),
    );
    const supervisorIds = Array.from(
      new Set((data ?? []).map((item) => item.supervisor_person_id).filter((value): value is string => Boolean(value))),
    );
    const teamTypeIds = Array.from(
      new Set((data ?? []).map((item) => item.team_type_id).filter((value): value is string => Boolean(value))),
    );
    const teamCategoryIds = Array.from(
      new Set((data ?? []).map((item) => item.team_category_id).filter((value): value is string => Boolean(value))),
    );
    const serviceCenterIds = Array.from(
      new Set((data ?? []).map((item) => item.service_center_id).filter((value): value is string => Boolean(value))),
    );
    const stockCenterIds = Array.from(
      new Set((data ?? []).map((item) => item.stock_center_id).filter((value): value is string => Boolean(value))),
    );

    let users: AppUserRow[] = [];
    if (userIds.length > 0) {
      const usersResult = await supabase
        .from("app_users")
        .select("id, display, login_name")
        .eq("tenant_id", appUser.tenant_id)
        .in("id", userIds)
        .returns<AppUserRow[]>();

      if (!usersResult.error) {
        users = usersResult.data ?? [];
      }
    }

    let foremen: PersonRow[] = [];
    if (foremanIds.length > 0) {
      const foremenResult = await supabase
        .from("people")
        .select("id, nome")
        .eq("tenant_id", appUser.tenant_id)
        .in("id", foremanIds)
        .returns<PersonRow[]>();

      if (!foremenResult.error) {
        foremen = foremenResult.data ?? [];
      }
    }

    let teamTypes: TeamTypeRow[] = [];
    if (teamTypeIds.length > 0) {
      const teamTypesResult = await supabase
        .from("team_types")
        .select("id, name")
        .eq("tenant_id", appUser.tenant_id)
        .in("id", teamTypeIds)
        .returns<TeamTypeRow[]>();

      if (!teamTypesResult.error) {
        teamTypes = teamTypesResult.data ?? [];
      }
    }

    let teamCategories: TeamCategoryRow[] = [];
    if (teamCategoryIds.length > 0) {
      const teamCategoriesResult = await supabase
        .from("team_categories")
        .select("id, code, name")
        .eq("tenant_id", appUser.tenant_id)
        .in("id", teamCategoryIds)
        .returns<TeamCategoryRow[]>();

      if (!teamCategoriesResult.error) {
        teamCategories = teamCategoriesResult.data ?? [];
      }
    }

    let serviceCenters: ServiceCenterRow[] = [];
    if (serviceCenterIds.length > 0) {
      const serviceCentersResult = await supabase
        .from("project_service_centers")
        .select("id, name")
        .eq("tenant_id", appUser.tenant_id)
        .in("id", serviceCenterIds)
        .returns<ServiceCenterRow[]>();

      if (!serviceCentersResult.error) {
        serviceCenters = serviceCentersResult.data ?? [];
      }
    }

    let supervisors: PersonRow[] = [];
    if (supervisorIds.length > 0) {
      const supervisorsResult = await supabase
        .from("people")
        .select("id, nome")
        .eq("tenant_id", appUser.tenant_id)
        .in("id", supervisorIds)
        .returns<PersonRow[]>();

      if (!supervisorsResult.error) {
        supervisors = supervisorsResult.data ?? [];
      }
    }

    let stockCenters: StockCenterRow[] = [];
    if (stockCenterIds.length > 0) {
      const stockCentersResult = await supabase
        .from("stock_centers")
        .select("id, name, center_type")
        .eq("tenant_id", appUser.tenant_id)
        .in("id", stockCenterIds)
        .returns<StockCenterRow[]>();

      if (!stockCentersResult.error) {
        stockCenters = stockCentersResult.data ?? [];
      }
    }

    const userDisplayMap = buildUserDisplayMap(users);
    const userLoginNameMap = buildUserLoginNameMap(users);
    const foremanMap = buildForemanMap(foremen);
    const supervisorMap = buildForemanMap(supervisors);
    const teamTypeMap = buildTeamTypeMap(teamTypes);
    const teamCategoryMap = buildTeamCategoryMap(teamCategories);
    const serviceCenterMap = new Map(serviceCenters.map((item) => [item.id, normalizeText(item.name)]));
    const stockCenterMap = new Map(stockCenters.map((item) => [item.id, normalizeText(item.name)]));

    return NextResponse.json({
      teams: (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        vehiclePlate: row.vehicle_plate,
        serviceCenterId: row.service_center_id,
        serviceCenterName: row.service_center_id ? serviceCenterMap.get(row.service_center_id) ?? "Nao identificado" : "Sem base",
        stockCenterId: row.stock_center_id,
        stockCenterName: row.stock_center_id ? stockCenterMap.get(row.stock_center_id) ?? "Nao identificado" : "Sem centro proprio",
        teamTypeId: row.team_type_id,
        teamTypeName: teamTypeMap.get(row.team_type_id) ?? "Nao identificado",
        teamCategoryId: row.team_category_id,
        teamCategoryCode: teamCategoryMap.get(row.team_category_id ?? "")?.code ?? "",
        teamCategoryName: teamCategoryMap.get(row.team_category_id ?? "")?.name ?? "Nao identificado",
        foremanId: row.foreman_person_id,
        foremanName: row.foreman_person_id ? foremanMap.get(row.foreman_person_id) ?? "Nao identificado" : "Sem encarregado",
        supervisorId: row.supervisor_person_id,
        supervisorName: row.supervisor_person_id ? supervisorMap.get(row.supervisor_person_id) ?? "Nao identificado" : "Sem supervisor",
        isActive: Boolean(row.ativo),
        cancellationReason: row.cancellation_reason,
        canceledAt: row.canceled_at,
        canceledByName: row.canceled_by ? userDisplayMap.get(row.canceled_by) ?? "Nao identificado" : null,
        createdByName: row.created_by ? userLoginNameMap.get(row.created_by) ?? "Nao identificado" : "Nao identificado",
        updatedByName: row.updated_by ? userDisplayMap.get(row.updated_by) ?? "Nao identificado" : "Nao identificado",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      pagination: {
        page,
        pageSize,
        total: count ?? 0,
      },
    });
  } catch {
    return NextResponse.json({ message: "Falha ao listar equipes." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para cadastrar equipes.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as Partial<CreateTeamPayload> & TeamBatchImportPayload;

    if (normalizeText(body.action).toUpperCase() === "BATCH_IMPORT") {
      const authorizationError = await authorizePageAction(resolution, "equipes", "import");
      if (authorizationError) {
        return authorizationError;
      }

      const rows = Array.isArray(body.rows) ? body.rows : [];

      if (!rows.length) {
        return NextResponse.json({ message: "Nenhuma linha valida enviada para cadastro em massa." }, { status: 400 });
      }

      if (rows.length > MASS_IMPORT_ROW_LIMIT) {
        return NextResponse.json(
          { message: `Cadastro em massa limitado a ${MASS_IMPORT_ROW_LIMIT} linhas por arquivo.` },
          { status: 400 },
        );
      }

      const batchResult = await importTeamBatch({
        supabase,
        tenantId: appUser.tenant_id,
        actorUserId: appUser.id,
        rows,
      });

      return NextResponse.json({
        ...batchResult,
        message:
          batchResult.errorCount > 0
            ? `Cadastro em massa processado com ${batchResult.savedCount} equipes salvas e ${batchResult.errorCount} linhas com erro.`
            : `Cadastro em massa concluido com ${batchResult.savedCount} equipes salvas.`,
      });
    }

    const authorizationError = await authorizePageAction(resolution, "equipes", "create");
    if (authorizationError) {
      return authorizationError;
    }

    const input = {
      name: normalizeText(body.name),
      vehiclePlate: normalizePlate(body.vehiclePlate),
      serviceCenterId: normalizeText(body.serviceCenterId),
      stockCenterId: normalizeText(body.stockCenterId) || null,
      teamTypeId: normalizeText(body.teamTypeId),
      teamCategoryId: normalizeText(body.teamCategoryId),
      foremanId: normalizeText(body.foremanId) || null,
      supervisorId: normalizeText(body.supervisorId) || null,
    };

    if (!input.name || !input.vehiclePlate || !input.serviceCenterId || !input.teamTypeId || !input.teamCategoryId) {
      return NextResponse.json({ message: "Preencha todos os campos obrigatorios da equipe." }, { status: 400 });
    }

    const serviceCenter = await fetchServiceCenterById(supabase, appUser.tenant_id, input.serviceCenterId);
    if (!serviceCenter) {
      return NextResponse.json({ message: "Base invalida para o tenant atual." }, { status: 422 });
    }

    const teamType = await fetchTeamTypeById(supabase, appUser.tenant_id, input.teamTypeId);
    if (!teamType) {
      return NextResponse.json({ message: "Tipo de equipe invalido para o tenant atual." }, { status: 422 });
    }

    const teamCategory = await fetchTeamCategoryById(supabase, appUser.tenant_id, input.teamCategoryId);
    if (!teamCategory) {
      return NextResponse.json({ message: "Tipo de equipe invalido para o tenant atual." }, { status: 422 });
    }

    if (isTechnicalTeamCategory(teamCategory) && !input.foremanId) {
      return NextResponse.json({ message: "Encarregado e obrigatorio para equipe tecnica." }, { status: 400 });
    }

    if (isCommercialTeamCategory(teamCategory) && !input.supervisorId) {
      return NextResponse.json({ message: "Supervisor e obrigatorio para equipe comercial." }, { status: 400 });
    }

    const foreman = input.foremanId ? await fetchForemanById(supabase, appUser.tenant_id, input.foremanId) : null;
    if (input.foremanId && !foreman) {
      return NextResponse.json({ message: "Encarregado invalido para o tenant atual." }, { status: 422 });
    }

    if (input.supervisorId) {
      const supervisor = await fetchSupervisorById(supabase, appUser.tenant_id, input.supervisorId);
      if (!supervisor) {
        return NextResponse.json({ message: "Supervisor invalido para o tenant atual." }, { status: 422 });
      }
    }

    if (input.stockCenterId) {
      const stockCenter = await fetchStockCenterById(supabase, appUser.tenant_id, input.stockCenterId);
      if (!stockCenter) {
        return NextResponse.json({ message: "Centro de estoque proprio invalido para a equipe." }, { status: 422 });
      }
    }

    const existingTeamByForeman = input.foremanId
      ? await fetchExistingTeamByForeman({
          supabase,
          tenantId: appUser.tenant_id,
          foremanId: input.foremanId,
          excludeTeamId: null,
        })
      : null;
    if (existingTeamByForeman) {
      return NextResponse.json(
        { message: "Ja existe equipe ativa cadastrada para este encarregado. Selecione outro encarregado." },
        { status: 409 },
      );
    }

    const saveResult = await saveTeamViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      teamId: null,
      name: input.name,
      vehiclePlate: input.vehiclePlate,
      serviceCenterId: input.serviceCenterId,
      stockCenterId: input.stockCenterId,
      teamTypeId: input.teamTypeId,
      teamCategoryId: input.teamCategoryId,
      foremanId: input.foremanId,
      supervisorId: input.supervisorId,
    });

    if (!saveResult.ok) {
      return NextResponse.json({ message: saveResult.message, code: saveResult.reason ?? undefined }, { status: saveResult.status });
    }

    return NextResponse.json({
      success: true,
      message: `Equipe ${input.name} cadastrada com sucesso.`,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao cadastrar equipe." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para editar equipes.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorizationError = await authorizePageAction(resolution, "equipes", "update");
    if (authorizationError) {
      return authorizationError;
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as Partial<UpdateTeamPayload>;
    const teamId = normalizeText(body.id);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);
    const input = {
      name: normalizeText(body.name),
      vehiclePlate: normalizePlate(body.vehiclePlate),
      serviceCenterId: normalizeText(body.serviceCenterId),
      stockCenterId: normalizeText(body.stockCenterId) || null,
      teamTypeId: normalizeText(body.teamTypeId),
      teamCategoryId: normalizeText(body.teamCategoryId),
      foremanId: normalizeText(body.foremanId) || null,
      supervisorId: normalizeText(body.supervisorId) || null,
    };

    if (!teamId) {
      return NextResponse.json({ message: "Equipe invalida para edicao." }, { status: 400 });
    }

    if (!expectedUpdatedAt) {
      return NextResponse.json({ message: "Atualize a lista antes de editar a equipe." }, { status: 400 });
    }

    if (!input.name || !input.vehiclePlate || !input.serviceCenterId || !input.teamTypeId || !input.teamCategoryId) {
      return NextResponse.json({ message: "Preencha todos os campos obrigatorios da equipe." }, { status: 400 });
    }

    const currentTeam = await fetchTeamById(supabase, appUser.tenant_id, teamId);
    if (!currentTeam) {
      return NextResponse.json({ message: "Equipe nao encontrada." }, { status: 404 });
    }

    if (hasUpdatedAtConflict(expectedUpdatedAt, currentTeam.updated_at)) {
      return buildConcurrencyConflictResponse(
        `A equipe ${currentTeam.name} foi alterada por outro usuario. Recarregue os dados antes de salvar novamente.`,
      );
    }

    if (!currentTeam.ativo) {
      return buildConcurrencyConflictResponse("Ative a equipe antes de editar.", "RECORD_INACTIVE");
    }

    const currentTeamType = await fetchTeamTypeById(supabase, appUser.tenant_id, currentTeam.team_type_id);
    const currentTeamCategory = currentTeam.team_category_id
      ? await fetchTeamCategoryById(supabase, appUser.tenant_id, currentTeam.team_category_id)
      : null;
    const currentServiceCenter = currentTeam.service_center_id
      ? await fetchServiceCenterById(supabase, appUser.tenant_id, currentTeam.service_center_id)
      : null;
    const currentStockCenter = currentTeam.stock_center_id
      ? await fetchStockCenterById(supabase, appUser.tenant_id, currentTeam.stock_center_id)
      : null;
    const nextServiceCenter = await fetchServiceCenterById(supabase, appUser.tenant_id, input.serviceCenterId);
    if (!nextServiceCenter) {
      return NextResponse.json({ message: "Base invalida para o tenant atual." }, { status: 422 });
    }
    const nextTeamType = await fetchTeamTypeById(supabase, appUser.tenant_id, input.teamTypeId);
    if (!nextTeamType) {
      return NextResponse.json({ message: "Tipo de equipe invalido para o tenant atual." }, { status: 422 });
    }
    const nextTeamCategory = await fetchTeamCategoryById(supabase, appUser.tenant_id, input.teamCategoryId);
    if (!nextTeamCategory) {
      return NextResponse.json({ message: "Tipo de equipe invalido para o tenant atual." }, { status: 422 });
    }
    const nextStockCenter = input.stockCenterId
      ? await fetchStockCenterById(supabase, appUser.tenant_id, input.stockCenterId)
      : null;
    if (input.stockCenterId && !nextStockCenter) {
      return NextResponse.json({ message: "Centro de estoque proprio invalido para a equipe." }, { status: 422 });
    }

    const currentForeman = currentTeam.foreman_person_id
      ? await fetchForemanById(supabase, appUser.tenant_id, currentTeam.foreman_person_id)
      : null;
    const nextForeman = input.foremanId ? await fetchForemanById(supabase, appUser.tenant_id, input.foremanId) : null;
    const currentSupervisor = await fetchSupervisorById(supabase, appUser.tenant_id, currentTeam.supervisor_person_id);
    const nextSupervisor = input.supervisorId
      ? await fetchSupervisorById(supabase, appUser.tenant_id, input.supervisorId)
      : null;

    if (isTechnicalTeamCategory(nextTeamCategory) && !input.foremanId) {
      return NextResponse.json({ message: "Encarregado e obrigatorio para equipe tecnica." }, { status: 400 });
    }

    if (isCommercialTeamCategory(nextTeamCategory) && !input.supervisorId) {
      return NextResponse.json({ message: "Supervisor e obrigatorio para equipe comercial." }, { status: 400 });
    }

    if (input.foremanId && !nextForeman) {
      return NextResponse.json({ message: "Encarregado invalido para o tenant atual." }, { status: 422 });
    }

    if (input.supervisorId && !nextSupervisor) {
      return NextResponse.json({ message: "Supervisor invalido para o tenant atual." }, { status: 422 });
    }

    const existingTeamByForeman = input.foremanId
      ? await fetchExistingTeamByForeman({
          supabase,
          tenantId: appUser.tenant_id,
          foremanId: input.foremanId,
          excludeTeamId: teamId,
        })
      : null;
    if (existingTeamByForeman) {
      return NextResponse.json(
        { message: "Ja existe equipe ativa cadastrada para este encarregado. Selecione outro encarregado." },
        { status: 409 },
      );
    }

    const changes: Record<string, HistoryChange> = {};
    addChange(changes, "name", currentTeam.name, input.name);
    addChange(changes, "vehiclePlate", currentTeam.vehicle_plate, input.vehiclePlate);
    addChange(changes, "serviceCenterName", currentServiceCenter?.name ?? null, nextServiceCenter.name);
    addChange(changes, "stockCenterName", currentStockCenter?.name ?? null, nextStockCenter?.name ?? null);
    addChange(changes, "teamTypeName", currentTeamType?.name ?? null, nextTeamType.name);
    addChange(changes, "teamCategoryName", currentTeamCategory?.name ?? null, nextTeamCategory.name);
    addChange(changes, "foremanName", currentForeman?.name ?? null, nextForeman?.name ?? null);
    addChange(changes, "supervisorName", currentSupervisor?.name ?? null, nextSupervisor?.name ?? null);

    if (Object.keys(changes).length === 0) {
      return NextResponse.json({
        success: true,
        message: `Nenhuma alteracao detectada na equipe ${currentTeam.name}.`,
      });
    }

    const saveResult = await saveTeamViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      teamId,
      name: input.name,
      vehiclePlate: input.vehiclePlate,
      serviceCenterId: input.serviceCenterId,
      stockCenterId: input.stockCenterId,
      teamTypeId: input.teamTypeId,
      teamCategoryId: input.teamCategoryId,
      foremanId: input.foremanId,
      supervisorId: input.supervisorId,
      changes,
      expectedUpdatedAt,
    });

    if (!saveResult.ok) {
      return NextResponse.json({ message: saveResult.message, code: saveResult.reason ?? undefined }, { status: saveResult.status });
    }

    return NextResponse.json({
      success: true,
      message: `Equipe ${input.name} atualizada com sucesso.`,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao editar equipe." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para atualizar status de equipes.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as Partial<UpdateTeamStatusPayload>;
    const teamId = normalizeText(body.id);
    const targetTeamId = normalizeText(body.targetTeamId);
    const reason = normalizeText(body.reason);
    const nextForemanId = normalizeText(body.foremanId);
    const requestedAction = normalizeText(body.action).toLowerCase();
    const action = requestedAction === "activate" ? "ACTIVATE" : "CANCEL";
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);
    const targetExpectedUpdatedAt = normalizeExpectedUpdatedAt(body.targetExpectedUpdatedAt);

    const authorizationError = await authorizePageAction(resolution, "equipes", requestedAction === "swapforeman" || action === "ACTIVATE" ? "update" : "cancel");
    if (authorizationError) {
      return authorizationError;
    }

    if (!teamId) {
      return NextResponse.json({ message: "Equipe invalida para atualizar status." }, { status: 400 });
    }

    if (requestedAction === "swapforeman") {
      if (!targetTeamId || targetTeamId === teamId) {
        return NextResponse.json({ message: "Selecione outra equipe ativa para permutar o encarregado." }, { status: 400 });
      }

      if (!expectedUpdatedAt || !targetExpectedUpdatedAt) {
        return NextResponse.json({ message: "Atualize a lista antes de permutar encarregados." }, { status: 400 });
      }

      if (!reason) {
        return NextResponse.json({ message: "Informe o motivo da permuta de encarregado." }, { status: 400 });
      }

      const sourceTeam = await fetchTeamById(supabase, appUser.tenant_id, teamId);
      const targetTeam = await fetchTeamById(supabase, appUser.tenant_id, targetTeamId);

      if (!sourceTeam || !targetTeam) {
        return NextResponse.json({ message: "Equipe de origem ou destino nao encontrada." }, { status: 404 });
      }

      if (!sourceTeam.ativo || !targetTeam.ativo) {
        return buildConcurrencyConflictResponse("A permuta exige duas equipes ativas.", "RECORD_INACTIVE");
      }

      const [sourceTeamCategory, targetTeamCategory] = await Promise.all([
        sourceTeam.team_category_id ? fetchTeamCategoryById(supabase, appUser.tenant_id, sourceTeam.team_category_id) : null,
        targetTeam.team_category_id ? fetchTeamCategoryById(supabase, appUser.tenant_id, targetTeam.team_category_id) : null,
      ]);

      if (
        !isTechnicalTeamCategory(sourceTeamCategory)
        || !isTechnicalTeamCategory(targetTeamCategory)
        || !sourceTeam.foreman_person_id
        || !targetTeam.foreman_person_id
      ) {
        return NextResponse.json(
          { message: "Permuta de encarregado disponivel apenas para equipes tecnicas com encarregado vinculado." },
          { status: 400 },
        );
      }

      if (hasUpdatedAtConflict(expectedUpdatedAt, sourceTeam.updated_at)) {
        return buildConcurrencyConflictResponse(
          `A equipe ${sourceTeam.name} foi alterada por outro usuario. Recarregue os dados antes de permutar.`,
        );
      }

      if (hasUpdatedAtConflict(targetExpectedUpdatedAt, targetTeam.updated_at)) {
        return buildConcurrencyConflictResponse(
          `A equipe ${targetTeam.name} foi alterada por outro usuario. Recarregue os dados antes de permutar.`,
        );
      }

      if (sourceTeam.foreman_person_id === targetTeam.foreman_person_id) {
        return NextResponse.json({ message: "As equipes selecionadas ja possuem o mesmo encarregado." }, { status: 409 });
      }

      const swapResult = await swapTeamForemenViaRpc({
        supabase,
        tenantId: appUser.tenant_id,
        actorUserId: appUser.id,
        sourceTeamId: teamId,
        targetTeamId,
        reason,
        sourceExpectedUpdatedAt: expectedUpdatedAt,
        targetExpectedUpdatedAt,
      });

      if (!swapResult.ok) {
        return NextResponse.json({ message: swapResult.message, code: swapResult.reason ?? undefined }, { status: swapResult.status });
      }

      return NextResponse.json({
        success: true,
        message: `Encarregados permutados entre as equipes ${sourceTeam.name} e ${targetTeam.name}.`,
      });
    }

    if (!expectedUpdatedAt) {
      return NextResponse.json({ message: "Atualize a lista antes de alterar o status da equipe." }, { status: 400 });
    }

    if (!reason) {
      return NextResponse.json(
        { message: action === "ACTIVATE" ? "Informe o motivo da ativacao." : "Informe o motivo do cancelamento." },
        { status: 400 },
      );
    }

    const currentTeam = await fetchTeamById(supabase, appUser.tenant_id, teamId);
    if (!currentTeam) {
      return NextResponse.json({ message: "Equipe nao encontrada." }, { status: 404 });
    }

    if (hasUpdatedAtConflict(expectedUpdatedAt, currentTeam.updated_at)) {
      return buildConcurrencyConflictResponse(
        `A equipe ${currentTeam.name} foi alterada por outro usuario. Recarregue os dados antes de alterar o status.`,
      );
    }

    if (action === "CANCEL" && !currentTeam.ativo) {
      return buildConcurrencyConflictResponse(`Equipe ${currentTeam.name} ja esta inativa.`, "STATUS_ALREADY_CHANGED");
    }

    if (action === "ACTIVATE" && currentTeam.ativo) {
      return buildConcurrencyConflictResponse(`Equipe ${currentTeam.name} ja esta ativa.`, "STATUS_ALREADY_CHANGED");
    }

    const activationForemanId =
      action === "ACTIVATE" && nextForemanId && nextForemanId !== currentTeam.foreman_person_id
        ? nextForemanId
        : null;

    if (activationForemanId) {
      const nextForeman = await fetchForemanById(supabase, appUser.tenant_id, activationForemanId);
      if (!nextForeman) {
        return NextResponse.json({ message: "Encarregado invalido para o tenant atual." }, { status: 422 });
      }
    }

    const statusResult = await setTeamStatusViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      teamId,
      action,
      reason,
      foremanId: activationForemanId,
      expectedUpdatedAt,
    });

    if (!statusResult.ok) {
      return NextResponse.json({ message: statusResult.message, code: statusResult.reason ?? undefined }, { status: statusResult.status });
    }

    return NextResponse.json({
      success: true,
      message:
        action === "ACTIVATE"
          ? `Equipe ${currentTeam.name} ativada com sucesso.`
          : `Equipe ${currentTeam.name} cancelada com sucesso.`,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao atualizar status da equipe." }, { status: 500 });
  }
}

