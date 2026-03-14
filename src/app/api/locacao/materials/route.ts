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

type MaterialCatalogRow = {
  id: string;
  codigo: string;
  descricao: string;
  umb: string | null;
  tipo: string | null;
  is_active: boolean;
};

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

    const plan = await fetchLocationPlanRow(resolution.supabase, resolution.appUser.tenant_id, projectId);
    if (!plan) {
      return NextResponse.json({ message: "Locacao nao encontrada para o projeto." }, { status: 404 });
    }

    const { data: material, error: materialError } = await resolution.supabase
      .from("materials")
      .select("id, codigo, descricao, umb, tipo, is_active")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("id", materialId)
      .maybeSingle<MaterialCatalogRow>();

    if (materialError || !material || !material.is_active) {
      return NextResponse.json({ message: "Material nao encontrado ou inativo." }, { status: 404 });
    }

    const { error } = await resolution.supabase.from("project_location_materials").insert({
      tenant_id: resolution.appUser.tenant_id,
      location_plan_id: plan.id,
      material_id: material.id,
      source_type: "MANUAL",
      material_code: normalizeText(material.codigo),
      material_description: normalizeText(material.descricao),
      material_umb: material.umb ? normalizeText(material.umb) : null,
      material_type: material.tipo ? normalizeText(material.tipo) : null,
      original_qty: 0,
      planned_qty: quantity,
      observation: observation || null,
      created_by: resolution.appUser.id,
      updated_by: resolution.appUser.id,
    });

    if (error) {
      const rawError = String(error.message ?? "").toLowerCase();
      if (rawError.includes("duplicate") || rawError.includes("unique")) {
        return NextResponse.json({ message: "Material ja adicionado na locacao deste projeto." }, { status: 409 });
      }

      return NextResponse.json({ message: "Falha ao adicionar material na locacao." }, { status: 500 });
    }

    const { data: current } = await resolution.supabase
      .from("project_location_materials")
      .select("id, material_code, original_qty, planned_qty, observation")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("location_plan_id", plan.id)
      .eq("material_id", material.id)
      .maybeSingle<LocationMaterialCurrentRow>();

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
          materialId: material.id,
          sourceType: "MANUAL",
        },
      });
    }

    const data = await fetchLocationPlanData(resolution.supabase, resolution.appUser.tenant_id, projectId);
    return NextResponse.json({
      ...data,
      message: "Material adicionado na locacao com sucesso.",
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

    const plan = await fetchLocationPlanRow(resolution.supabase, resolution.appUser.tenant_id, projectId);
    if (!plan) {
      return NextResponse.json({ message: "Locacao nao encontrada para o projeto." }, { status: 404 });
    }

    const { data: current, error: currentError } = await resolution.supabase
      .from("project_location_materials")
      .select("id, material_code, original_qty, planned_qty, observation")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("location_plan_id", plan.id)
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

    const { error } = await resolution.supabase
      .from("project_location_materials")
      .update({
        planned_qty: quantity,
        observation: observation || null,
        updated_by: resolution.appUser.id,
      })
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("location_plan_id", plan.id)
      .eq("id", itemId);

    if (error) {
      return NextResponse.json({ message: "Falha ao editar material da locacao." }, { status: 500 });
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
      message: "Material da locacao atualizado com sucesso.",
    });
  } catch {
    return NextResponse.json({ message: "Falha ao editar material da locacao." }, { status: 500 });
  }
}
