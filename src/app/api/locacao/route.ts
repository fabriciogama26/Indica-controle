import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import {
  ensureActiveLocationProject,
  ensureLocationPlan,
  fetchLocationPlanData,
  registerLocationHistory,
  saveLocationPlanViaRpc,
} from "@/lib/server/locationPlanning";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeQuestionnaireAnswers(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para consultar locacao.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const projectId = normalizeText(request.nextUrl.searchParams.get("projectId"));
    if (!projectId) {
      return NextResponse.json({ message: "projectId obrigatorio." }, { status: 400 });
    }

    const projectGuard = await ensureActiveLocationProject({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      projectId,
      inactiveMessage: "Projeto inativo nao pode ser carregado na locacao.",
      notFoundMessage: "Projeto nao encontrado para locacao.",
    });

    if (!projectGuard.ok) {
      return NextResponse.json({ message: projectGuard.message }, { status: projectGuard.status });
    }

    const data = await fetchLocationPlanData(resolution.supabase, resolution.appUser.tenant_id, projectId);
    if (!data) {
      return NextResponse.json({ message: "Projeto nao encontrado para locacao." }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ message: "Falha ao consultar locacao." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para inicializar locacao.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const payload = (await request.json().catch(() => null)) as { projectId?: string } | null;
    const projectId = normalizeText(payload?.projectId);
    if (!projectId) {
      return NextResponse.json({ message: "Projeto obrigatorio para inicializar a locacao." }, { status: 400 });
    }

    const projectGuard = await ensureActiveLocationProject({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      projectId,
      inactiveMessage: "Projeto inativo nao pode ser alocado na locacao.",
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

    const data = await fetchLocationPlanData(resolution.supabase, resolution.appUser.tenant_id, projectId);
    if (!data) {
      return NextResponse.json({ message: "Projeto nao encontrado para locacao." }, { status: 404 });
    }

    return NextResponse.json({
      ...data,
      initialization: {
        created: ensured.created,
        seededMaterials: ensured.seededMaterials,
      },
    });
  } catch {
    return NextResponse.json({ message: "Falha ao inicializar locacao." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para atualizar locacao.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const payload = (await request.json().catch(() => null)) as {
      projectId?: string;
      notes?: string;
      questionnaireAnswers?: Record<string, unknown>;
      risks?: Array<{ id?: string; isActive?: boolean }>;
      expectedUpdatedAt?: string;
    } | null;

    const projectId = normalizeText(payload?.projectId);
    if (!projectId) {
      return NextResponse.json({ message: "Projeto obrigatorio para atualizar a locacao." }, { status: 400 });
    }

    const projectGuard = await ensureActiveLocationProject({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      projectId,
      inactiveMessage: "Projeto inativo nao pode ser editado na locacao.",
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

    const currentData = await fetchLocationPlanData(resolution.supabase, resolution.appUser.tenant_id, projectId);
    if (!currentData?.plan) {
      return NextResponse.json({ message: "Locacao nao encontrada para o projeto." }, { status: 404 });
    }

    const nextNotes = normalizeText(payload?.notes);
    const nextQuestionnaire = normalizeQuestionnaireAnswers(payload?.questionnaireAnswers);
    const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt);

    if (!expectedUpdatedAt) {
      return NextResponse.json(
        { message: "Atualize a locacao antes de salvar para evitar sobreposicao com outro usuario." },
        { status: 409 },
      );
    }

    const changes: Record<string, { from: string | null; to: string | null }> = {};
    if ((currentData.plan.notes ?? "") !== nextNotes) {
      changes.notes = { from: currentData.plan.notes ?? null, to: nextNotes || null };
    }

    const previousQuestionnaire = JSON.stringify(currentData.plan.questionnaireAnswers ?? {});
    const nextQuestionnaireRaw = JSON.stringify(nextQuestionnaire);
    if (previousQuestionnaire !== nextQuestionnaireRaw) {
      changes.questionnaireAnswers = { from: previousQuestionnaire, to: nextQuestionnaireRaw };
    }

    const requestedRisks = Array.isArray(payload?.risks) ? payload.risks : [];
    const saveResult = await saveLocationPlanViaRpc({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      projectId,
      actorUserId: resolution.appUser.id,
      notes: nextNotes,
      questionnaireAnswers: nextQuestionnaire,
      risks: requestedRisks,
      expectedUpdatedAt,
    });

    if (!saveResult.ok) {
      return NextResponse.json({ message: saveResult.message }, { status: saveResult.status });
    }

    await registerLocationHistory({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      actorUserId: resolution.appUser.id,
      entityTable: "project_location_plans",
      entityId: currentData.plan.id,
      entityCode: currentData.project.sob,
      changes,
      metadata: {
        projectId,
      },
    });

    const data = await fetchLocationPlanData(resolution.supabase, resolution.appUser.tenant_id, projectId);
    const currentRisks = currentData.risks ?? [];
    const nextRisks = data?.risks ?? [];

    for (const currentRisk of currentRisks) {
      const nextRisk = nextRisks.find((item) => item.id === currentRisk.id);
      if (!nextRisk || currentRisk.isActive === nextRisk.isActive) {
        continue;
      }

      await registerLocationHistory({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        actorUserId: resolution.appUser.id,
        entityTable: "project_location_risks",
        entityId: currentRisk.id,
        entityCode: currentData.project.sob,
        changes: {
          isActive: {
            from: currentRisk.isActive ? "true" : "false",
            to: nextRisk.isActive ? "true" : "false",
          },
        },
        metadata: {
          projectId,
          locationPlanId: currentData.plan.id,
          description: currentRisk.description,
        },
      });
    }

    return NextResponse.json({
      ...data,
      message: saveResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao atualizar locacao." }, { status: 500 });
  }
}
