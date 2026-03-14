import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import {
  ensureActiveLocationProject,
  ensureLocationPlan,
  fetchLocationPlanData,
  normalizePositiveNumber,
  registerLocationHistory,
  saveLocationActivityViaRpc,
} from "@/lib/server/locationPlanning";

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

    const projectGuard = await ensureActiveLocationProject({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      projectId,
      inactiveMessage: "Projeto inativo nao pode ser alterado na locacao.",
      notFoundMessage: "Projeto nao encontrado para locacao.",
    });

    if (!projectGuard.ok) {
      return NextResponse.json({ message: projectGuard.message }, { status: projectGuard.status });
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

    const saveResult = await saveLocationActivityViaRpc({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      projectId,
      actorUserId: resolution.appUser.id,
      activityId,
      quantity,
      observation,
    });

    if (!saveResult.ok) {
      return NextResponse.json({ message: saveResult.message }, { status: saveResult.status });
    }

    const { data: current } = await resolution.supabase
      .from("project_location_activities")
      .select("id, activity_code, planned_qty, observation")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("id", saveResult.itemId)
      .maybeSingle<LocationActivityCurrentRow>();

    if (current) {
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
          activityId,
        },
      });
    }

    const data = await fetchLocationPlanData(resolution.supabase, resolution.appUser.tenant_id, projectId);
    return NextResponse.json({
      ...data,
      message: saveResult.message,
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
      expectedUpdatedAt?: string;
    } | null;

    const projectId = normalizeText(payload?.projectId);
    const itemId = normalizeText(payload?.id);
    const quantity = normalizePositiveNumber(payload?.quantity);
    const observation = normalizeText(payload?.observation);

    if (!projectId || !itemId || quantity === null) {
      return NextResponse.json({ message: "Projeto, item e quantidade sao obrigatorios." }, { status: 400 });
    }

    const projectGuard = await ensureActiveLocationProject({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      projectId,
      inactiveMessage: "Projeto inativo nao pode ser alterado na locacao.",
      notFoundMessage: "Projeto nao encontrado para locacao.",
    });

    if (!projectGuard.ok) {
      return NextResponse.json({ message: projectGuard.message }, { status: projectGuard.status });
    }

    const { data: current, error: currentError } = await resolution.supabase
      .from("project_location_activities")
      .select("id, activity_code, planned_qty, observation")
      .eq("tenant_id", resolution.appUser.tenant_id)
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

    const saveResult = await saveLocationActivityViaRpc({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      projectId,
      actorUserId: resolution.appUser.id,
      itemId,
      quantity,
      observation,
      expectedUpdatedAt: normalizeText(payload?.expectedUpdatedAt) || null,
    });

    if (!saveResult.ok) {
      return NextResponse.json({ message: saveResult.message }, { status: saveResult.status });
    }

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
      message: saveResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao editar atividade da locacao." }, { status: 500 });
  }
}
