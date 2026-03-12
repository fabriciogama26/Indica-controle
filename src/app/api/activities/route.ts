import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type ActivityRow = {
  id: string;
  code: string;
  description: string;
  group_name: string | null;
  unit_value: number | string;
  unit: string;
  scope: string | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
};

type CreateActivityPayload = {
  code: string;
  description: string;
  group?: string;
  value: string | number;
  unit: string;
  scope?: string;
};

type UpdateActivityPayload = CreateActivityPayload & {
  id: string;
};

type ActivityCodePrecheckResult = {
  success?: boolean;
  reason?: string;
};

function parsePositiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeCode(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function normalizeDecimal(value: unknown) {
  const raw = String(value ?? "").trim().replace(",", ".");
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  return numeric;
}

function parseActivityInput(payload: Partial<CreateActivityPayload>) {
  return {
    code: normalizeCode(payload.code),
    description: normalizeText(payload.description),
    group: normalizeText(payload.group),
    value: normalizeDecimal(payload.value),
    unit: normalizeText(payload.unit),
    scope: normalizeText(payload.scope),
  };
}

function mapCodeConflictReasonToMessage(reason: string | undefined) {
  if (reason === "CODE_ALREADY_EXISTS") {
    return { status: 409, message: "Ja existe atividade com este codigo no tenant atual." };
  }

  if (reason === "TENANT_REQUIRED") {
    return { status: 400, message: "Tenant obrigatorio para validar codigo da atividade." };
  }

  if (reason === "CODE_REQUIRED") {
    return { status: 400, message: "Codigo obrigatorio para validar atividade." };
  }

  return { status: 500, message: "Falha ao validar codigo da atividade." };
}

function mapActivityRow(row: ActivityRow) {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    group: row.group_name ?? "",
    value: Number(row.unit_value ?? 0),
    unit: row.unit,
    scope: row.scope ?? "",
    isActive: Boolean(row.ativo),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para consultar atividades.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const params = request.nextUrl.searchParams;
    const code = normalizeText(params.get("code"));
    const description = normalizeText(params.get("description"));
    const groupName = normalizeText(params.get("group"));
    const page = parsePositiveInteger(params.get("page"), 1);
    const pageSize = Math.min(parsePositiveInteger(params.get("pageSize"), 20), 100);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("service_activities")
      .select("id, code, description, group_name, unit_value, unit, scope, ativo, created_at, updated_at", {
        count: "exact",
      })
      .eq("tenant_id", appUser.tenant_id);

    if (code) {
      query = query.ilike("code", `%${code}%`);
    }

    if (description) {
      query = query.ilike("description", `%${description}%`);
    }

    if (groupName) {
      query = query.ilike("group_name", `%${groupName}%`);
    }

    const { data, error, count } = await query
      .order("ativo", { ascending: false })
      .order("code", { ascending: true })
      .range(from, to)
      .returns<ActivityRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao listar atividades." }, { status: 500 });
    }

    return NextResponse.json({
      activities: (data ?? []).map(mapActivityRow),
      pagination: {
        page,
        pageSize,
        total: count ?? 0,
      },
    });
  } catch {
    return NextResponse.json({ message: "Falha ao listar atividades." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para cadastrar atividades.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as Partial<CreateActivityPayload>;
    const input = parseActivityInput(body);

    if (!input.code || !input.description || input.value === null || !input.unit) {
      return NextResponse.json({ message: "Preencha todos os campos obrigatorios da atividade." }, { status: 400 });
    }

    const { data: precheck, error: precheckError } = await supabase
      .rpc("precheck_activity_code_conflict", {
        p_tenant_id: appUser.tenant_id,
        p_activity_id: null,
        p_code: input.code,
      });

    if (precheckError) {
      return NextResponse.json({ message: "Falha ao validar codigo da atividade." }, { status: 500 });
    }

    const precheckResult = (precheck ?? null) as ActivityCodePrecheckResult | null;
    if (!precheckResult?.success) {
      const mapped = mapCodeConflictReasonToMessage(precheckResult?.reason);
      return NextResponse.json({ message: mapped.message }, { status: mapped.status });
    }

    const { error } = await supabase.from("service_activities").insert({
      tenant_id: appUser.tenant_id,
      code: input.code,
      description: input.description,
      group_name: input.group || null,
      unit_value: input.value,
      unit: input.unit,
      scope: input.scope || null,
      ativo: true,
      created_by: appUser.id,
      updated_by: appUser.id,
    });

    if (error) {
      if (String(error.message ?? "").toLowerCase().includes("duplicate key")) {
        return NextResponse.json({ message: "Ja existe atividade com este codigo no tenant atual." }, { status: 409 });
      }

      return NextResponse.json({ message: "Falha ao cadastrar atividade." }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Atividade ${input.code} cadastrada com sucesso.`,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao cadastrar atividade." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para editar atividades.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as Partial<UpdateActivityPayload>;
    const activityId = normalizeText(body.id);
    const input = parseActivityInput(body);

    if (!activityId) {
      return NextResponse.json({ message: "Atividade invalida para edicao." }, { status: 400 });
    }

    if (!input.code || !input.description || input.value === null || !input.unit) {
      return NextResponse.json({ message: "Preencha todos os campos obrigatorios da atividade." }, { status: 400 });
    }

    const { data: existing, error: existingError } = await supabase
      .from("service_activities")
      .select("id")
      .eq("tenant_id", appUser.tenant_id)
      .eq("id", activityId)
      .maybeSingle<{ id: string }>();

    if (existingError || !existing) {
      return NextResponse.json({ message: "Atividade nao encontrada." }, { status: 404 });
    }

    const { data: precheck, error: precheckError } = await supabase
      .rpc("precheck_activity_code_conflict", {
        p_tenant_id: appUser.tenant_id,
        p_activity_id: activityId,
        p_code: input.code,
      });

    if (precheckError) {
      return NextResponse.json({ message: "Falha ao validar codigo da atividade." }, { status: 500 });
    }

    const precheckResult = (precheck ?? null) as ActivityCodePrecheckResult | null;
    if (!precheckResult?.success) {
      const mapped = mapCodeConflictReasonToMessage(precheckResult?.reason);
      return NextResponse.json({ message: mapped.message }, { status: mapped.status });
    }

    const { error } = await supabase
      .from("service_activities")
      .update({
        code: input.code,
        description: input.description,
        group_name: input.group || null,
        unit_value: input.value,
        unit: input.unit,
        scope: input.scope || null,
        updated_by: appUser.id,
      })
      .eq("tenant_id", appUser.tenant_id)
      .eq("id", activityId);

    if (error) {
      if (String(error.message ?? "").toLowerCase().includes("duplicate key")) {
        return NextResponse.json({ message: "Ja existe atividade com este codigo no tenant atual." }, { status: 409 });
      }

      return NextResponse.json({ message: "Falha ao editar atividade." }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Atividade ${input.code} atualizada com sucesso.`,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao editar atividade." }, { status: 500 });
  }
}
