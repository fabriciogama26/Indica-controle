import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import {
  ensureLocationPlan,
  fetchLocationPlanData,
  normalizePositiveNumber,
  registerLocationHistory,
  saveLocationMaterialViaRpc,
} from "@/lib/server/locationPlanning";

type LocationMaterialCurrentRow = {
  id: string;
  material_code: string;
  original_qty: number | string;
  planned_qty: number | string;
  observation: string | null;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para adicionar material da locacao.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const payload = (await request.json().catch(() => null)) as {
      projectId?: string;
      materialId?: string;
      quantity?: string | number;
      observation?: string;
    } | null;

    const projectId = normalizeText(payload?.projectId);
    const materialId = normalizeText(payload?.materialId);
    const quantity = normalizePositiveNumber(payload?.quantity);
    const observation = normalizeText(payload?.observation);

    if (!projectId || !materialId || quantity === null) {
      return NextResponse.json({ message: "Projeto, material e quantidade sao obrigatorios." }, { status: 400 });
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

    const saveResult = await saveLocationMaterialViaRpc({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      projectId,
      actorUserId: resolution.appUser.id,
      materialId,
      quantity,
      observation,
    });

    if (!saveResult.ok) {
      return NextResponse.json({ message: saveResult.message }, { status: saveResult.status });
    }

    const { data: current } = await resolution.supabase
      .from("project_location_materials")
      .select("id, material_code, original_qty, planned_qty, observation")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("id", saveResult.itemId)
      .maybeSingle<LocationMaterialCurrentRow>();

    if (current) {
      await registerLocationHistory({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        actorUserId: resolution.appUser.id,
        entityTable: "project_location_materials",
        entityId: current.id,
        entityCode: normalizeText(current.material_code),
        changes: {
          originalQty: { from: null, to: "0.00" },
          plannedQty: { from: null, to: Number(quantity).toFixed(2) },
          observation: { from: null, to: observation || null },
        },
        metadata: {
          action: "ADD_MATERIAL",
          projectId,
          materialId,
          sourceType: "MANUAL",
        },
      });
    }

    const data = await fetchLocationPlanData(resolution.supabase, resolution.appUser.tenant_id, projectId);
    return NextResponse.json({
      ...data,
      message: saveResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao adicionar material na locacao." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para editar material da locacao.",
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

    const { data: current, error: currentError } = await resolution.supabase
      .from("project_location_materials")
      .select("id, material_code, original_qty, planned_qty, observation")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("id", itemId)
      .maybeSingle<LocationMaterialCurrentRow>();

    if (currentError || !current) {
      return NextResponse.json({ message: "Material da locacao nao encontrado." }, { status: 404 });
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

    const saveResult = await saveLocationMaterialViaRpc({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      projectId,
      actorUserId: resolution.appUser.id,
      itemId,
      quantity,
      observation,
    });

    if (!saveResult.ok) {
      return NextResponse.json({ message: saveResult.message }, { status: saveResult.status });
    }

    await registerLocationHistory({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      actorUserId: resolution.appUser.id,
      entityTable: "project_location_materials",
      entityId: current.id,
      entityCode: normalizeText(current.material_code),
      changes,
      metadata: {
        action: "UPDATE_MATERIAL",
        projectId,
      },
    });

    const data = await fetchLocationPlanData(resolution.supabase, resolution.appUser.tenant_id, projectId);
    return NextResponse.json({
      ...data,
      message: saveResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao editar material da locacao." }, { status: 500 });
  }
}
