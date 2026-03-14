import { SupabaseClient } from "@supabase/supabase-js";

type LocationProjectRow = {
  id: string;
  sob: string;
  city_text: string | null;
  is_active: boolean;
  has_locacao?: boolean;
};

type LocationPlanRow = {
  id: string;
  questionnaire_answers: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type LocationRiskRow = {
  id: string;
  description: string;
  is_active: boolean;
};

type LocationExecutionSupportRow = {
  id: string;
  description: string;
  is_active: boolean;
};

type LocationMaterialRow = {
  id: string;
  material_id: string;
  source_type: "PROJECT_FORECAST" | "MANUAL";
  material_code: string;
  material_description: string;
  material_umb: string | null;
  material_type: string | null;
  original_qty: number | string;
  planned_qty: number | string;
  observation: string | null;
  created_at: string;
  updated_at: string;
};

type LocationActivityRow = {
  id: string;
  service_activity_id: string;
  source_type: "CATALOG";
  activity_code: string;
  activity_description: string;
  team_type_name: string | null;
  activity_group: string | null;
  activity_unit: string;
  activity_scope: string | null;
  unit_value_snapshot: number | string;
  planned_qty: number | string;
  observation: string | null;
  created_at: string;
  updated_at: string;
};

type InitializeLocationPlanResult = {
  success?: boolean;
  reason?: string;
  plan_id?: string;
  created?: boolean;
  seeded_materials?: number;
};

type SaveLocationPlanRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  plan_id?: string;
};

type SaveLocationItemRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  action?: "INSERT" | "UPDATE";
  item_id?: string;
  entity_code?: string;
};

type LocationHistoryChange = {
  from: string | null;
  to: string | null;
};

function toNumber(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return numeric;
}

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

export function normalizePositiveNumber(value: unknown) {
  const raw = String(value ?? "").trim().replace(",", ".");
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return Number(numeric.toFixed(2));
}

export async function resolveLocationProject(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
) {
  const { data, error } = await supabase
    .from("project_with_labels")
    .select("id, sob, city_text, is_active")
    .eq("tenant_id", tenantId)
    .eq("id", projectId)
    .maybeSingle<LocationProjectRow>();

  if (error || !data) {
    return null;
  }

  return data;
}

export async function ensureActiveLocationProject(params: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  inactiveMessage: string;
  notFoundMessage?: string;
}) {
  const project = await resolveLocationProject(params.supabase, params.tenantId, params.projectId);
  if (!project) {
    return {
      ok: false,
      status: 404,
      message: params.notFoundMessage ?? "Projeto nao encontrado para locacao.",
    } as const;
  }

  if (!project.is_active) {
    return {
      ok: false,
      status: 409,
      message: params.inactiveMessage,
    } as const;
  }

  return {
    ok: true,
    project,
  } as const;
}

export async function ensureLocationPlan(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  actorUserId: string,
) {
  const { data, error } = await supabase.rpc("initialize_project_location_plan", {
    p_tenant_id: tenantId,
    p_project_id: projectId,
    p_actor_user_id: actorUserId,
  });

  if (error) {
    return {
      ok: false,
      status: 500,
      message: "Falha ao inicializar locacao do projeto.",
    } as const;
  }

  const result = (data ?? {}) as InitializeLocationPlanResult;
  if (result.success !== true || !result.plan_id) {
    return {
      ok: false,
      status: 404,
      message: "Projeto nao encontrado para inicializar a locacao.",
    } as const;
  }

  return {
    ok: true,
    planId: result.plan_id,
    created: Boolean(result.created),
    seededMaterials: Number(result.seeded_materials ?? 0),
  } as const;
}

export async function fetchLocationPlanRow(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
) {
  const { data, error } = await supabase
    .from("project_location_plans")
    .select("id, questionnaire_answers, notes, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .maybeSingle<LocationPlanRow>();

  if (error || !data) {
    return null;
  }

  return data;
}

export async function fetchLocationPlanData(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
) {
  const project = await resolveLocationProject(supabase, tenantId, projectId);
  if (!project) {
    return null;
  }

  const plan = await fetchLocationPlanRow(supabase, tenantId, projectId);
  if (!plan) {
    return {
      project: {
        id: project.id,
        sob: normalizeText(project.sob),
        city: normalizeText(project.city_text),
        isActive: Boolean(project.is_active),
      },
      plan: null,
      supportItems: [],
      risks: [],
      materials: [],
      activities: [],
      summary: {
        materialsCount: 0,
        materialsOriginalTotal: 0,
        materialsPlannedTotal: 0,
        activitiesCount: 0,
        activitiesPlannedTotal: 0,
      },
    };
  }

  const [materialsResult, activitiesResult, risksResult, executionSupportResult] = await Promise.all([
    supabase
      .from("project_location_materials")
      .select(
        "id, material_id, source_type, material_code, material_description, material_umb, material_type, original_qty, planned_qty, observation, created_at, updated_at",
      )
      .eq("tenant_id", tenantId)
      .eq("location_plan_id", plan.id)
      .order("material_code", { ascending: true })
      .returns<LocationMaterialRow[]>(),
    supabase
      .from("project_location_activities")
      .select(
        "id, service_activity_id, source_type, activity_code, activity_description, team_type_name, activity_group, activity_unit, activity_scope, unit_value_snapshot, planned_qty, observation, created_at, updated_at",
      )
      .eq("tenant_id", tenantId)
      .eq("location_plan_id", plan.id)
      .order("activity_code", { ascending: true })
      .returns<LocationActivityRow[]>(),
    supabase
      .from("project_location_risks")
      .select("id, description, is_active")
      .eq("tenant_id", tenantId)
      .eq("location_plan_id", plan.id)
      .order("description", { ascending: true })
      .returns<LocationRiskRow[]>(),
    supabase
      .from("location_execution_support_items")
      .select("id, description, is_active")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("description", { ascending: true })
      .returns<LocationExecutionSupportRow[]>(),
  ]);

  const materials = (materialsResult.data ?? []).map((item) => {
    const originalQty = toNumber(item.original_qty);
    const plannedQty = toNumber(item.planned_qty);

    return {
      id: item.id,
      materialId: item.material_id,
      sourceType: item.source_type,
      code: normalizeText(item.material_code),
      description: normalizeText(item.material_description),
      umb: item.material_umb ? normalizeText(item.material_umb) : null,
      type: item.material_type ? normalizeText(item.material_type) : null,
      originalQty,
      plannedQty,
      deltaQty: Number((plannedQty - originalQty).toFixed(2)),
      observation: item.observation ? normalizeText(item.observation) : null,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    };
  });

  const activities = (activitiesResult.data ?? []).map((item) => {
    const unitValue = toNumber(item.unit_value_snapshot);
    const plannedQty = toNumber(item.planned_qty);
    const totalValue = Number((unitValue * plannedQty).toFixed(2));

    return {
      id: item.id,
      activityId: item.service_activity_id,
      sourceType: item.source_type,
      code: normalizeText(item.activity_code),
      description: normalizeText(item.activity_description),
      teamTypeName: item.team_type_name ? normalizeText(item.team_type_name) : "",
      group: item.activity_group ? normalizeText(item.activity_group) : "",
      unit: normalizeText(item.activity_unit),
      scope: item.activity_scope ? normalizeText(item.activity_scope) : "",
      unitValue,
      plannedQty,
      totalValue,
      observation: item.observation ? normalizeText(item.observation) : null,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    };
  });

  const questionnaireAnswers = normalizeQuestionnaireAnswers(plan.questionnaire_answers);
  const executionForecast = normalizeQuestionnaireAnswers(questionnaireAnswers.executionForecast);
  const removedSupportItemIds = new Set(
    normalizeStringArray(executionForecast.removedSupportItemIds),
  );

  const risks = (risksResult.data ?? []).map((item) => ({
    id: item.id,
    description: normalizeText(item.description),
    isActive: Boolean(item.is_active),
  }));

  const supportItems = (executionSupportResult.data ?? []).map((item) => ({
    id: item.id,
    description: normalizeText(item.description),
    isIncluded: !removedSupportItemIds.has(item.id),
  }));

  const materialsOriginalTotal = materials.reduce((acc, item) => acc + item.originalQty, 0);
  const materialsPlannedTotal = materials.reduce((acc, item) => acc + item.plannedQty, 0);
  const activitiesPlannedTotal = activities.reduce((acc, item) => acc + item.totalValue, 0);

  return {
    project: {
      id: project.id,
      sob: normalizeText(project.sob),
      city: normalizeText(project.city_text),
      isActive: Boolean(project.is_active),
    },
    plan: {
      id: plan.id,
      questionnaireAnswers,
      notes: plan.notes ? normalizeText(plan.notes) : "",
      createdAt: plan.created_at,
      updatedAt: plan.updated_at,
    },
    supportItems,
    risks,
    materials,
    activities,
    summary: {
      materialsCount: materials.length,
      materialsOriginalTotal: Number(materialsOriginalTotal.toFixed(2)),
      materialsPlannedTotal: Number(materialsPlannedTotal.toFixed(2)),
      activitiesCount: activities.length,
      activitiesPlannedTotal: Number(activitiesPlannedTotal.toFixed(2)),
    },
  };
}

export async function saveLocationPlanViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  actorUserId: string;
  notes: string;
  questionnaireAnswers: Record<string, unknown>;
  risks: Array<{ id?: string; isActive?: boolean }>;
  expectedUpdatedAt?: string | null;
}) {
  const { data, error } = await params.supabase.rpc("save_project_location_plan", {
    p_tenant_id: params.tenantId,
    p_project_id: params.projectId,
    p_actor_user_id: params.actorUserId,
    p_notes: params.notes,
    p_questionnaire_answers: params.questionnaireAnswers,
    p_risks: params.risks,
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
  });

  if (error) {
    return {
      ok: false,
      status: 500,
      message: "Falha ao salvar locacao via RPC.",
    } as const;
  }

  const result = (data ?? {}) as SaveLocationPlanRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar locacao.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    planId: result.plan_id ?? null,
    message: result.message ?? "Locacao atualizada com sucesso.",
  } as const;
}

export async function saveLocationMaterialViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  actorUserId: string;
  quantity: number;
  itemId?: string | null;
  materialId?: string | null;
  observation?: string | null;
  expectedUpdatedAt?: string | null;
}) {
  const { data, error } = await params.supabase.rpc("save_project_location_material", {
    p_tenant_id: params.tenantId,
    p_project_id: params.projectId,
    p_actor_user_id: params.actorUserId,
    p_quantity: params.quantity,
    p_item_id: params.itemId ?? null,
    p_material_id: params.materialId ?? null,
    p_observation: params.observation ?? null,
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
  });

  if (error) {
    return {
      ok: false,
      status: 500,
      message: "Falha ao salvar material da locacao via RPC.",
    } as const;
  }

  const result = (data ?? {}) as SaveLocationItemRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar material da locacao.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    itemId: result.item_id ?? null,
    entityCode: result.entity_code ?? null,
    action: result.action ?? null,
    message: result.message ?? "Material da locacao atualizado com sucesso.",
  } as const;
}

export async function saveLocationActivityViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  actorUserId: string;
  quantity: number;
  itemId?: string | null;
  activityId?: string | null;
  observation?: string | null;
  expectedUpdatedAt?: string | null;
}) {
  const { data, error } = await params.supabase.rpc("save_project_location_activity", {
    p_tenant_id: params.tenantId,
    p_project_id: params.projectId,
    p_actor_user_id: params.actorUserId,
    p_quantity: params.quantity,
    p_item_id: params.itemId ?? null,
    p_activity_id: params.activityId ?? null,
    p_observation: params.observation ?? null,
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
  });

  if (error) {
    return {
      ok: false,
      status: 500,
      message: "Falha ao salvar atividade da locacao via RPC.",
    } as const;
  }

  const result = (data ?? {}) as SaveLocationItemRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar atividade da locacao.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    itemId: result.item_id ?? null,
    entityCode: result.entity_code ?? null,
    action: result.action ?? null,
    message: result.message ?? "Atividade da locacao atualizada com sucesso.",
  } as const;
}

export async function registerLocationHistory(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  entityTable: string;
  entityId: string;
  entityCode: string;
  changes: Record<string, LocationHistoryChange>;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}) {
  if (Object.keys(params.changes).length === 0) {
    return;
  }

  await params.supabase.from("app_entity_history").insert({
    tenant_id: params.tenantId,
    module_key: "locacao",
    entity_table: params.entityTable,
    entity_id: params.entityId,
    entity_code: params.entityCode,
    change_type: "UPDATE",
    reason: params.reason ? normalizeText(params.reason) : null,
    changes: params.changes,
    metadata: params.metadata ?? {},
    created_by: params.actorUserId,
    updated_by: params.actorUserId,
  });
}

export async function markProjectHasLocacao(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  actorUserId: string,
) {
  const { error } = await supabase
    .from("project")
    .update({
      has_locacao: true,
      updated_by: actorUserId,
    })
    .eq("tenant_id", tenantId)
    .eq("id", projectId)
    .eq("has_locacao", false);

  return !error;
}
