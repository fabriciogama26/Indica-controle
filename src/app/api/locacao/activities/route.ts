import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import {
  ensureLocationPlan,
  fetchLocationPlanData,
  fetchLocationPlanRow,
  markProjectHasLocacao,
  normalizePositiveNumber,
  registerLocationHistory,
} from "@/lib/server/locationPlanning";

type ActivityCatalogRow = {
  id: string;
  code: string;
  description: string;
  unit: string;
  unit_value: number | string;
  group_name: string | null;
  scope: string | null;
  ativo: boolean;
  team_types: {
    name: string | null;
  } | null;
};

type LocationActivityCurrentRow = {
  id: string;
  activity_code: string;
  planned_qty: number | string;
  observation: string | null;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para adicionar atividade da locacao.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const payload = (await request.json().catch(() => null)) as {
      projectId?: string;
      activityId?: string;
      quantity?: string | number;
      observation?: string;
    } | null;

    const projectId = normalizeText(payload?.projectId);
    const activityId = normalizeText(payload?.activityId);
    const quantity = normalizePositiveNumber(payload?.quantity);
    const observation = normalizeText(payload?.observation);

    if (!projectId || !activityId || quantity === null) {
      return NextResponse.json({ message: "Projeto, atividade e quantidade sao obrigatorios." }, { status: 400 });
    }

    const ensured = await ensureLocationPlan(
      resolution.supabase,
      resolution.appUser.tenant_id,
      projectId,
      resolution.appUser.id,
    );

    if (!ensured.ok) {
      return NextResponse.json({ message: ensured.message }, { status: ensured.status });
    }

    const plan = await fetchLocationPlanRow(resolution.supabase, resolution.appUser.tenant_id, projectId);
    if (!plan) {
      return NextResponse.json({ message: "Locacao nao encontrada para o projeto." }, { status: 404 });
    }

    const { data: activity, error: activityError } = await resolution.supabase
      .from("service_activities")
      .select("id, code, description, unit, unit_value, group_name, scope, ativo, team_types(name)")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("id", activityId)
      .maybeSingle<ActivityCatalogRow>();

    if (activityError || !activity || !activity.ativo) {
      return NextResponse.json({ message: "Atividade nao encontrada ou inativa." }, { status: 404 });
    }

    const { error } = await resolution.supabase.from("project_location_activities").insert({
      tenant_id: resolution.appUser.tenant_id,
      location_plan_id: plan.id,
      service_activity_id: activity.id,
      source_type: "CATALOG",
      activity_code: normalizeText(activity.code),
      activity_description: normalizeText(activity.description),
      team_type_name: normalizeText(activity.team_types?.name),
      activity_group: activity.group_name ? normalizeText(activity.group_name) : null,
      activity_unit: normalizeText(activity.unit),
      activity_scope: activity.scope ? normalizeText(activity.scope) : null,
      unit_value_snapshot: Number(activity.unit_value ?? 0),
      planned_qty: quantity,
      observation: observation || null,
      created_by: resolution.appUser.id,
      updated_by: resolution.appUser.id,
    });

    if (error) {
      const rawError = String(error.message ?? "").toLowerCase();
      if (rawError.includes("duplicate") || rawError.includes("unique")) {
        return NextResponse.json({ message: "Atividade ja adicionada na locacao deste projeto." }, { status: 409 });
      }

      return NextResponse.json({ message: "Falha ao adicionar atividade na locacao." }, { status: 500 });
    }

    const { data: current } = await resolution.supabase
      .from("project_location_activities")
      .select("id, activity_code, planned_qty, observation")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("location_plan_id", plan.id)
      .eq("service_activity_id", activity.id)
      .maybeSingle<LocationActivityCurrentRow>();

    if (current) {
      await markProjectHasLocacao(
        resolution.supabase,
        resolution.appUser.tenant_id,
        projectId,
        resolution.appUser.id,
      );

      await registerLocationHistory({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        actorUserId: resolution.appUser.id,
        entityTable: "project_location_activities",
        entityId: current.id,
        entityCode: normalizeText(current.activity_code),
        changes: {
          plannedQty: { from: null, to: Number(quantity).toFixed(2) },
          observation: { from: null, to: observation || null },
        },
        metadata: {
          action: "ADD_ACTIVITY",
          projectId,
          activityId: activity.id,
        },
      });
    }

    const data = await fetchLocationPlanData(resolution.supabase, resolution.appUser.tenant_id, projectId);
    return NextResponse.json({
      ...data,
      message: "Atividade adicionada na locacao com sucesso.",
    });
  } catch {
    return NextResponse.json({ message: "Falha ao adicionar atividade na locacao." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para editar atividade da locacao.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const payload = (await request.json().catch(() => null)) as {
      projectId?: string;
      id?: string;
      quantity?: string | number;
      observation?: string;
    } | null;

    const projectId = normalizeText(payload?.projectId);
    const itemId = normalizeText(payload?.id);
    const quantity = normalizePositiveNumber(payload?.quantity);
    const observation = normalizeText(payload?.observation);

    if (!projectId || !itemId || quantity === null) {
      return NextResponse.json({ message: "Projeto, item e quantidade sao obrigatorios." }, { status: 400 });
    }

    const plan = await fetchLocationPlanRow(resolution.supabase, resolution.appUser.tenant_id, projectId);
    if (!plan) {
      return NextResponse.json({ message: "Locacao nao encontrada para o projeto." }, { status: 404 });
    }

    const { data: current, error: currentError } = await resolution.supabase
      .from("project_location_activities")
      .select("id, activity_code, planned_qty, observation")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("location_plan_id", plan.id)
      .eq("id", itemId)
      .maybeSingle<LocationActivityCurrentRow>();

    if (currentError || !current) {
      return NextResponse.json({ message: "Atividade da locacao nao encontrada." }, { status: 404 });
    }

    const changes: Record<string, { from: string | null; to: string | null }> = {};
    const previousQty = Number(current.planned_qty ?? 0).toFixed(2);
    const nextQty = Number(quantity).toFixed(2);
    if (previousQty !== nextQty) {
      changes.plannedQty = { from: previousQty, to: nextQty };
    }

    const previousObservation = normalizeText(current.observation);
    if (previousObservation !== observation) {
      changes.observation = { from: previousObservation || null, to: observation || null };
    }

    const { error } = await resolution.supabase
      .from("project_location_activities")
      .update({
        planned_qty: quantity,
        observation: observation || null,
        updated_by: resolution.appUser.id,
      })
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("location_plan_id", plan.id)
      .eq("id", itemId);

    if (error) {
      return NextResponse.json({ message: "Falha ao editar atividade da locacao." }, { status: 500 });
    }

    await markProjectHasLocacao(
      resolution.supabase,
      resolution.appUser.tenant_id,
      projectId,
      resolution.appUser.id,
    );

    await registerLocationHistory({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      actorUserId: resolution.appUser.id,
      entityTable: "project_location_activities",
      entityId: current.id,
      entityCode: normalizeText(current.activity_code),
      changes,
      metadata: {
        action: "UPDATE_ACTIVITY",
        projectId,
      },
    });

    const data = await fetchLocationPlanData(resolution.supabase, resolution.appUser.tenant_id, projectId);
    return NextResponse.json({
      ...data,
      message: "Atividade da locacao atualizada com sucesso.",
    });
  } catch {
    return NextResponse.json({ message: "Falha ao editar atividade da locacao." }, { status: 500 });
  }
}
