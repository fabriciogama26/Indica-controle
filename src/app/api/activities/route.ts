import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type ActivityRow = {
  id: string;
  code: string;
  description: string;
  group_name: string;
  unit_value: number | string;
  unit: string;
  scope: string;
  ativo: boolean;
  created_at: string;
  updated_at: string;
};

type CreateActivityPayload = {
  code: string;
  description: string;
  group: string;
  value: string | number;
  unit: string;
  scope: string;
};

type UpdateActivityPayload = CreateActivityPayload & {
  id: string;
};

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

function mapActivityRow(row: ActivityRow) {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    group: row.group_name,
    value: Number(row.unit_value ?? 0),
    unit: row.unit,
    scope: row.scope,
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

    let query = supabase
      .from("service_activities")
      .select("id, code, description, group_name, unit_value, unit, scope, ativo, created_at, updated_at")
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

    const { data, error } = await query
      .order("ativo", { ascending: false })
      .order("code", { ascending: true })
      .returns<ActivityRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao listar atividades." }, { status: 500 });
    }

    return NextResponse.json({
      activities: (data ?? []).map(mapActivityRow),
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

    if (!input.code || !input.description || !input.group || input.value === null || !input.unit || !input.scope) {
      return NextResponse.json({ message: "Preencha todos os campos obrigatorios da atividade." }, { status: 400 });
    }

    const { error } = await supabase.from("service_activities").insert({
      tenant_id: appUser.tenant_id,
      code: input.code,
      description: input.description,
      group_name: input.group,
      unit_value: input.value,
      unit: input.unit,
      scope: input.scope,
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

    if (!input.code || !input.description || !input.group || input.value === null || !input.unit || !input.scope) {
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

    const { error } = await supabase
      .from("service_activities")
      .update({
        code: input.code,
        description: input.description,
        group_name: input.group,
        unit_value: input.value,
        unit: input.unit,
        scope: input.scope,
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
