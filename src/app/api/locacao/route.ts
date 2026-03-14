import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import {
  ensureLocationPlan,
  fetchLocationPlanData,
  markProjectHasLocacao,
  registerLocationHistory,
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

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => normalizeText(item)).filter(Boolean);
}

function normalizeNonNegativeInteger(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  return Math.trunc(numeric);
}

function validateAndNormalizeLocationQuestionnaire(value: unknown) {
  const questionnaire = normalizeQuestionnaireAnswers(value);
  const planning = normalizeQuestionnaireAnswers(questionnaire.planning);
  const executionTeams = normalizeQuestionnaireAnswers(questionnaire.executionTeams);
  const executionForecast = normalizeQuestionnaireAnswers(questionnaire.executionForecast);
  const preApr = normalizeQuestionnaireAnswers(questionnaire.preApr);

  if (typeof planning.needsProjectReview !== "boolean") {
    return {
      ok: false,
      message: "Necessario informar se ha revisao de projeto antes de salvar a locacao.",
    } as const;
  }

  if (typeof planning.withShutdown !== "boolean") {
    return {
      ok: false,
      message: "Necessario informar se ha desligamento antes de salvar a locacao.",
    } as const;
  }

  const cestoQty = normalizeNonNegativeInteger(executionTeams.cestoQty);
  const linhaMortaQty = normalizeNonNegativeInteger(executionTeams.linhaMortaQty);
  const linhaVivaQty = normalizeNonNegativeInteger(executionTeams.linhaVivaQty);
  const podaLinhaMortaQty = normalizeNonNegativeInteger(executionTeams.podaLinhaMortaQty);
  const podaLinhaVivaQty = normalizeNonNegativeInteger(executionTeams.podaLinhaVivaQty);
  const stepsPlannedQty = normalizeNonNegativeInteger(executionForecast.stepsPlannedQty);

  if (
    cestoQty === null ||
    linhaMortaQty === null ||
    linhaVivaQty === null ||
    podaLinhaMortaQty === null ||
    podaLinhaVivaQty === null ||
    stepsPlannedQty === null
  ) {
    return {
      ok: false,
      message: "As quantidades da locacao devem ser numericas e nao podem ser negativas.",
    } as const;
  }

  return {
    ok: true,
    questionnaire: {
      planning: {
        needsProjectReview: planning.needsProjectReview,
        withShutdown: planning.withShutdown,
      },
      executionTeams: {
        cestoQty,
        linhaMortaQty,
        linhaVivaQty,
        podaLinhaMortaQty,
        podaLinhaVivaQty,
      },
      executionForecast: {
        stepsPlannedQty,
        observation: normalizeText(executionForecast.observation),
        removedSupportItemIds: normalizeStringArray(executionForecast.removedSupportItemIds),
      },
      preApr: {
        observation: normalizeText(preApr.observation),
      },
    },
  } as const;
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
    } | null;

    const projectId = normalizeText(payload?.projectId);
    if (!projectId) {
      return NextResponse.json({ message: "Projeto obrigatorio para atualizar a locacao." }, { status: 400 });
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
    const questionnaireValidation = validateAndNormalizeLocationQuestionnaire(payload?.questionnaireAnswers);
    if (!questionnaireValidation.ok) {
      return NextResponse.json({ message: questionnaireValidation.message }, { status: 400 });
    }

    const nextQuestionnaire = questionnaireValidation.questionnaire;

    const changes: Record<string, { from: string | null; to: string | null }> = {};
    if ((currentData.plan.notes ?? "") !== nextNotes) {
      changes.notes = { from: currentData.plan.notes ?? null, to: nextNotes || null };
    }

    const previousQuestionnaire = JSON.stringify(currentData.plan.questionnaireAnswers ?? {});
    const nextQuestionnaireRaw = JSON.stringify(nextQuestionnaire);
    if (previousQuestionnaire !== nextQuestionnaireRaw) {
      changes.questionnaireAnswers = { from: previousQuestionnaire, to: nextQuestionnaireRaw };
    }

    const { error } = await resolution.supabase
      .from("project_location_plans")
      .update({
        notes: nextNotes || null,
        questionnaire_answers: nextQuestionnaire,
        updated_by: resolution.appUser.id,
      })
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("project_id", projectId);

    if (error) {
      return NextResponse.json({ message: "Falha ao atualizar locacao." }, { status: 500 });
    }

    const requestedRisks = Array.isArray(payload?.risks) ? payload.risks : [];
    const currentRisks = currentData.risks ?? [];

    for (const currentRisk of currentRisks) {
      const nextRisk = requestedRisks.find((item) => normalizeText(item?.id) === currentRisk.id);
      if (!nextRisk) {
        continue;
      }

      const nextIsActive = Boolean(nextRisk.isActive);
      if (currentRisk.isActive === nextIsActive) {
        continue;
      }

      const { error: riskUpdateError } = await resolution.supabase
        .from("project_location_risks")
        .update({
          is_active: nextIsActive,
          updated_by: resolution.appUser.id,
        })
        .eq("tenant_id", resolution.appUser.tenant_id)
        .eq("id", currentRisk.id)
        .eq("location_plan_id", currentData.plan.id);

      if (riskUpdateError) {
        return NextResponse.json({ message: "Falha ao atualizar riscos da locacao." }, { status: 500 });
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
            to: nextIsActive ? "true" : "false",
          },
        },
        metadata: {
          projectId,
          locationPlanId: currentData.plan.id,
          description: currentRisk.description,
        },
      });
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
      entityTable: "project_location_plans",
      entityId: currentData.plan.id,
      entityCode: currentData.project.sob,
      changes,
      metadata: {
        projectId,
      },
    });

    const data = await fetchLocationPlanData(resolution.supabase, resolution.appUser.tenant_id, projectId);
    return NextResponse.json({
      ...data,
      message: "Locacao atualizada com sucesso.",
    });
  } catch {
    return NextResponse.json({ message: "Falha ao atualizar locacao." }, { status: 500 });
  }
}
