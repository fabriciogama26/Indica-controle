import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { requirePageAction } from "@/lib/server/pageAuthorization";
import { MEASUREMENT_PAGE_KEY } from "@/server/modules/medicao/authorization";
import {
  fetchProgrammingWorkCompletionCatalog,
  fetchProgrammingStagesForMeasurementSources,
  fetchServiceActivitiesByIds,
  fetchTeams,
  type ProgrammingMeasurementSourceStageRow,
} from "@/server/modules/programacao-normalizada";

type ProjectSourceRow = {
  id: string;
  sob: string | null;
  service_description: string | null;
  service_type_text: string | null;
};

const PROJECT_SOURCE_SELECT = "id, sob, service_description, service_type_text";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeIsoDate(value: unknown) {
  const text = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

async function fetchMeasurementSourceProjects(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
}) {
  const primary = await params.supabase
    .from("project_with_labels")
    .select(PROJECT_SOURCE_SELECT)
    .eq("tenant_id", params.tenantId)
    .eq("is_active", true)
    .eq("is_test", false)
    .eq("is_third_party", false)
    .order("sob", { ascending: true })
    .returns<ProjectSourceRow[]>();

  const rows = primary.error
    ? (await params.supabase
        .from("project_with_labels")
        .select(PROJECT_SOURCE_SELECT)
        .eq("tenant_id", params.tenantId)
        .eq("is_active", true)
        .order("sob", { ascending: true })
        .returns<ProjectSourceRow[]>()).data ?? []
    : primary.data ?? [];

  return rows.map((item) => ({
    id: item.id,
    code: normalizeText(item.sob),
    serviceName: normalizeText(item.service_description) || normalizeText(item.service_type_text) || "Sem descricao",
  }));
}

function collectActivityIds(stages: ProgrammingMeasurementSourceStageRow[]) {
  return Array.from(
    new Set(
      stages.flatMap((stage) =>
        (stage.programming_activity ?? [])
          .filter((activity) => activity.is_active)
          .map((activity) => activity.service_activity_id)
          .filter(Boolean),
      ),
    ),
  );
}

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar Programacao da Medicao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorization = await requirePageAction({
    context: resolution,
    pageKey: MEASUREMENT_PAGE_KEY,
    action: "read",
  });

  if (!authorization.allowed) {
    return NextResponse.json(
      {
        message: authorization.error.message,
        code: authorization.error.code,
        pageKey: authorization.pageKey,
        action: authorization.action,
      },
      { status: authorization.error.status },
    );
  }

  const startDate = normalizeIsoDate(request.nextUrl.searchParams.get("startDate"));
  const endDate = normalizeIsoDate(request.nextUrl.searchParams.get("endDate"));

  if (!startDate || !endDate) {
    return NextResponse.json({ message: "startDate e endDate sao obrigatorios." }, { status: 400 });
  }

  try {
    const [projects, teams, workCompletionCatalog, stages] = await Promise.all([
      fetchMeasurementSourceProjects({ supabase: resolution.supabase, tenantId: resolution.appUser.tenant_id }),
      fetchTeams(resolution.supabase, resolution.appUser.tenant_id),
      fetchProgrammingWorkCompletionCatalog(resolution.supabase, resolution.appUser.tenant_id),
      fetchProgrammingStagesForMeasurementSources({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        startDate,
        endDate,
      }),
    ]);

    const activityIds = collectActivityIds(stages);
    const activities = await fetchServiceActivitiesByIds(resolution.supabase, resolution.appUser.tenant_id, activityIds);
    const activityMap = new Map(activities.map((activity) => [activity.id, activity]));

    const schedules = stages.flatMap((stage) => {
      const executionDate = normalizeIsoDate(stage.execution_date);
      if (!executionDate) return [];

      const activeTeamIds = (stage.programming_team ?? [])
        .filter((team) => team.status === "ATIVA")
        .map((team) => normalizeText(team.team_id))
        .filter(Boolean);

      const scheduleActivities = (stage.programming_activity ?? [])
        .filter((activity) => activity.is_active)
        .map((activity) => {
          const catalog = activityMap.get(activity.service_activity_id);
          return {
            id: activity.id,
            catalogId: activity.service_activity_id,
            code: normalizeText(catalog?.code),
            description: normalizeText(catalog?.description),
            quantity: Number(activity.quantity ?? 0),
            unit: normalizeText(catalog?.unit),
          };
        });

      return activeTeamIds.map((teamId) => ({
        id: stage.id,
        projectId: stage.project_id,
        teamId,
        status: stage.status,
        date: executionDate,
        electricalField: normalizeText(stage.campo_eletrico),
        workCompletionStatus: normalizeText(stage.work_completion_status) || null,
        activities: scheduleActivities,
      }));
    });

    return NextResponse.json({
      projects,
      teams: teams.map((team) => ({
        id: team.id,
        name: normalizeText(team.name),
        foremanName: normalizeText(team.foremanName),
      })),
      schedules,
      workCompletionCatalog: workCompletionCatalog.map((item) => ({
        code: normalizeText(item.code),
        label: normalizeText(item.label_pt) || normalizeText(item.code),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar Programacao da Medicao.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
