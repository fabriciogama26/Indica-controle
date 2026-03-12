import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type MaterialRow = {
  id: string;
  codigo: string;
  descricao: string;
  umb: string | null;
  tipo: string;
  unit_price: number;
  is_active: boolean;
  cancellation_reason: string | null;
  canceled_at: string | null;
  canceled_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

type CreateMaterialPayload = {
  codigo: string;
  descricao: string;
  umb?: string | null;
  tipo: string;
  unitPrice: string | number;
};

type UpdateMaterialPayload = CreateMaterialPayload & {
  id: string;
};

type CancelMaterialPayload = {
  id: string;
  reason: string;
  action?: "cancel" | "activate";
};

type MaterialHistoryRow = {
  id: string;
  change_type: "UPDATE" | "CANCEL" | "ACTIVATE";
  changes: unknown;
  created_at: string;
  created_by: string | null;
};

type HistoryChange = {
  from: string | null;
  to: string | null;
};

type MaterialInput = {
  codigo: string;
  descricao: string;
  umb: string | null;
  tipo: string;
  unitPrice: number | null;
};

type MaterialCodePrecheckResult = {
  success?: boolean;
  reason?: string;
  codigo?: string;
  existing_id?: string;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeNullableText(value: unknown) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeCode(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function normalizeType(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function normalizePrice(value: unknown) {
  const raw = String(value ?? "").trim().replace(",", ".");
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  return Number(numeric.toFixed(2));
}

function parseMaterialInput(payload: Partial<CreateMaterialPayload>): MaterialInput {
  return {
    codigo: normalizeCode(payload.codigo),
    descricao: normalizeText(payload.descricao),
    umb: normalizeNullableText(payload.umb),
    tipo: normalizeType(payload.tipo),
    unitPrice: normalizePrice(payload.unitPrice),
  };
}

function validateRequiredMaterialFields(input: MaterialInput) {
  if (!input.codigo || !input.descricao || !input.tipo || input.unitPrice === null) {
    return "Preencha os campos obrigatorios: Codigo, Descricao, Tipo e Preco.";
  }

  return null;
}

function formatComparableValue(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toFixed(2) : null;
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  const normalized = String(value).trim();
  return normalized || null;
}

function addChange(
  changes: Record<string, HistoryChange>,
  field: string,
  previousValue: unknown,
  nextValue: unknown,
) {
  const from = formatComparableValue(previousValue);
  const to = formatComparableValue(nextValue);

  if (from === to) {
    return;
  }

  changes[field] = { from, to };
}

function normalizeHistoryChanges(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, HistoryChange>;
  }

  const result: Record<string, HistoryChange> = {};
  for (const [field, rawChange] of Object.entries(value as Record<string, unknown>)) {
    if (!rawChange || typeof rawChange !== "object" || Array.isArray(rawChange)) {
      continue;
    }

    const from = formatComparableValue((rawChange as { from?: unknown }).from);
    const to = formatComparableValue((rawChange as { to?: unknown }).to);
    result[field] = { from, to };
  }

  return result;
}

function parsePositiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function buildUserDisplayMap(users: AppUserRow[]) {
  return new Map(
    users.map((user) => [
      user.id,
      String(user.display ?? user.login_name ?? "").trim() || "Nao identificado",
    ]),
  );
}

function buildUserLoginNameMap(users: AppUserRow[]) {
  return new Map(
    users.map((user) => [user.id, String(user.login_name ?? "").trim() || "Nao identificado"]),
  );
}

async function fetchMaterialById(
  supabase: SupabaseClient,
  tenantId: string,
  materialId: string,
) {
  const { data, error } = await supabase
    .from("materials")
    .select(
      "id, codigo, descricao, umb, tipo, unit_price, is_active, cancellation_reason, canceled_at, canceled_by, created_by, updated_by, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("id", materialId)
    .maybeSingle<MaterialRow>();

  if (error || !data) {
    return null;
  }

  return data;
}

async function precheckMaterialCodeConflict(
  supabase: SupabaseClient,
  tenantId: string,
  materialId: string | null,
  codigo: string,
) {
  const { data, error } = await supabase.rpc("precheck_material_code_conflict", {
    p_tenant_id: tenantId,
    p_material_id: materialId,
    p_codigo: codigo,
  });

  if (error) {
    return {
      ok: false,
      status: 500,
      message: "Falha ao validar codigo do material.",
    } as const;
  }

  const result = (data ?? {}) as MaterialCodePrecheckResult;
  if (result.success !== true) {
    if (result.reason === "CODE_ALREADY_EXISTS") {
      return {
        ok: false,
        status: 409,
        message: "Ja existe material com este codigo no tenant atual.",
      } as const;
    }

    return {
      ok: false,
      status: 400,
      message: "Codigo do material invalido para cadastro.",
    } as const;
  }

  return {
    ok: true,
  } as const;
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para consultar materiais.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const historyMaterialId = normalizeText(request.nextUrl.searchParams.get("historyMaterialId"));

    if (historyMaterialId) {
      const material = await fetchMaterialById(supabase, appUser.tenant_id, historyMaterialId);
      if (!material) {
        return NextResponse.json({ message: "Material nao encontrado." }, { status: 404 });
      }

      const historyPage = parsePositiveInteger(request.nextUrl.searchParams.get("historyPage"), 1);
      const historyPageSize = Math.min(parsePositiveInteger(request.nextUrl.searchParams.get("historyPageSize"), 5), 30);
      const historyFrom = (historyPage - 1) * historyPageSize;
      const historyTo = historyFrom + historyPageSize - 1;

      const { data: historyData, error: historyError, count: historyCount } = await supabase
        .from("material_history")
        .select("id, change_type, changes, created_at, created_by", { count: "exact" })
        .eq("tenant_id", appUser.tenant_id)
        .eq("material_id", historyMaterialId)
        .order("created_at", { ascending: false })
        .range(historyFrom, historyTo)
        .returns<MaterialHistoryRow[]>();

      if (historyError) {
        return NextResponse.json({ message: "Falha ao carregar historico do material." }, { status: 500 });
      }

      const userIds = Array.from(
        new Set((historyData ?? []).map((entry) => entry.created_by).filter((value): value is string => Boolean(value))),
      );

      let users: AppUserRow[] = [];
      if (userIds.length > 0) {
        const usersResult = await supabase
          .from("app_users")
          .select("id, display, login_name")
          .eq("tenant_id", appUser.tenant_id)
          .in("id", userIds)
          .returns<AppUserRow[]>();

        if (!usersResult.error) {
          users = usersResult.data ?? [];
        }
      }

      const userDisplayMap = buildUserDisplayMap(users);

      return NextResponse.json({
        material: {
          id: material.id,
          codigo: material.codigo,
          isActive: material.is_active,
        },
        history: (historyData ?? []).map((entry) => ({
          id: entry.id,
          changeType: entry.change_type,
          changes: normalizeHistoryChanges(entry.changes),
          createdAt: entry.created_at,
          createdByName: userDisplayMap.get(entry.created_by ?? "") ?? "Nao identificado",
        })),
        pagination: {
          page: historyPage,
          pageSize: historyPageSize,
          total: historyCount ?? 0,
        },
      });
    }

    const page = parsePositiveInteger(request.nextUrl.searchParams.get("page"), 1);
    const pageSize = Math.min(parsePositiveInteger(request.nextUrl.searchParams.get("pageSize"), 20), 100);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const codeFilter = normalizeText(request.nextUrl.searchParams.get("codigo"));
    const descriptionFilter = normalizeText(request.nextUrl.searchParams.get("descricao"));
    const typeFilter = normalizeType(request.nextUrl.searchParams.get("tipo"));
    const statusFilter = normalizeText(request.nextUrl.searchParams.get("status")).toLowerCase();

    let query = supabase
      .from("materials")
      .select(
        "id, codigo, descricao, umb, tipo, unit_price, is_active, cancellation_reason, canceled_at, canceled_by, created_by, updated_by, created_at, updated_at",
        { count: "exact" },
      )
      .eq("tenant_id", appUser.tenant_id)
      .order("is_active", { ascending: false })
      .order("updated_at", { ascending: false })
      .range(from, to);

    if (codeFilter) {
      query = query.ilike("codigo", `%${codeFilter}%`);
    }
    if (descriptionFilter) {
      query = query.ilike("descricao", `%${descriptionFilter}%`);
    }
    if (typeFilter) {
      query = query.ilike("tipo", `%${typeFilter}%`);
    }
    if (statusFilter === "ativo") {
      query = query.eq("is_active", true);
    } else if (statusFilter === "inativo") {
      query = query.eq("is_active", false);
    }

    const { data, error, count } = await query.returns<MaterialRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao listar materiais." }, { status: 500 });
    }

    const userIds = Array.from(
      new Set(
        (data ?? [])
          .flatMap((item) => [item.created_by, item.updated_by, item.canceled_by])
          .filter((value): value is string => Boolean(value)),
      ),
    );

    let users: AppUserRow[] = [];
    if (userIds.length > 0) {
      const usersResult = await supabase
        .from("app_users")
        .select("id, display, login_name")
        .eq("tenant_id", appUser.tenant_id)
        .in("id", userIds)
        .returns<AppUserRow[]>();

      if (!usersResult.error) {
        users = usersResult.data ?? [];
      }
    }

    const userDisplayMap = buildUserDisplayMap(users);
    const userLoginNameMap = buildUserLoginNameMap(users);

    return NextResponse.json({
      materials: (data ?? []).map((item) => ({
        id: item.id,
        codigo: item.codigo,
        descricao: item.descricao,
        umb: item.umb,
        tipo: item.tipo,
        unitPrice: item.unit_price,
        isActive: item.is_active,
        cancellationReason: item.cancellation_reason,
        canceledAt: item.canceled_at,
        canceledByName: userDisplayMap.get(item.canceled_by ?? "") ?? null,
        createdByName: userLoginNameMap.get(item.created_by ?? "") ?? "Nao identificado",
        updatedByName: userDisplayMap.get(item.updated_by ?? "") ?? "Nao identificado",
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      })),
      pagination: {
        page,
        pageSize,
        total: count ?? 0,
      },
    });
  } catch {
    return NextResponse.json({ message: "Falha ao listar materiais." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para registrar materiais.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const body = (await request.json().catch(() => ({}))) as Partial<CreateMaterialPayload>;
    const input = parseMaterialInput(body);
    const validationError = validateRequiredMaterialFields(input);

    if (validationError) {
      return NextResponse.json({ message: validationError }, { status: 400 });
    }

    const { supabase, appUser } = resolution;
    const precheck = await precheckMaterialCodeConflict(supabase, appUser.tenant_id, null, input.codigo);
    if (!precheck.ok) {
      return NextResponse.json({ message: precheck.message }, { status: precheck.status });
    }

    const { error } = await supabase.from("materials").insert({
      tenant_id: appUser.tenant_id,
      codigo: input.codigo,
      descricao: input.descricao,
      umb: input.umb,
      tipo: input.tipo,
      unit_price: input.unitPrice,
      is_active: true,
      cancellation_reason: null,
      canceled_at: null,
      canceled_by: null,
      created_by: appUser.id,
      updated_by: appUser.id,
    });

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ message: "Ja existe material com este codigo no tenant atual." }, { status: 409 });
      }

      return NextResponse.json({ message: "Falha ao registrar material." }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Material ${input.codigo} registrado com sucesso.`,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao registrar material." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para editar materiais.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const body = (await request.json().catch(() => ({}))) as Partial<UpdateMaterialPayload>;
    const materialId = normalizeText(body.id);

    if (!materialId) {
      return NextResponse.json({ message: "ID do material obrigatorio." }, { status: 400 });
    }

    const input = parseMaterialInput(body);
    const validationError = validateRequiredMaterialFields(input);

    if (validationError) {
      return NextResponse.json({ message: validationError }, { status: 400 });
    }

    const { supabase, appUser } = resolution;
    const currentMaterial = await fetchMaterialById(supabase, appUser.tenant_id, materialId);

    if (!currentMaterial) {
      return NextResponse.json({ message: "Material nao encontrado para edicao." }, { status: 404 });
    }

    if (!currentMaterial.is_active) {
      return NextResponse.json({ message: "Ative o material antes de editar." }, { status: 409 });
    }

    const precheck = await precheckMaterialCodeConflict(supabase, appUser.tenant_id, materialId, input.codigo);
    if (!precheck.ok) {
      return NextResponse.json({ message: precheck.message }, { status: precheck.status });
    }

    const changes: Record<string, HistoryChange> = {};
    addChange(changes, "codigo", currentMaterial.codigo, input.codigo);
    addChange(changes, "descricao", currentMaterial.descricao, input.descricao);
    addChange(changes, "umb", currentMaterial.umb, input.umb);
    addChange(changes, "tipo", currentMaterial.tipo, input.tipo);
    addChange(changes, "unitPrice", currentMaterial.unit_price, input.unitPrice);

    if (Object.keys(changes).length === 0) {
      return NextResponse.json({ success: true, message: `Nenhuma alteracao detectada no material ${currentMaterial.codigo}.` });
    }

    const { error } = await supabase
      .from("materials")
      .update({
        codigo: input.codigo,
        descricao: input.descricao,
        umb: input.umb,
        tipo: input.tipo,
        unit_price: input.unitPrice,
        updated_by: appUser.id,
      })
      .eq("tenant_id", appUser.tenant_id)
      .eq("id", materialId);

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ message: "Ja existe material com este codigo no tenant atual." }, { status: 409 });
      }

      return NextResponse.json({ message: "Falha ao editar material." }, { status: 500 });
    }

    const { error: historyError } = await supabase.from("material_history").insert({
      tenant_id: appUser.tenant_id,
      material_id: materialId,
      change_type: "UPDATE",
      changes,
      created_by: appUser.id,
      updated_by: appUser.id,
    });

    if (historyError) {
      return NextResponse.json(
        {
          success: true,
          warning: true,
          message: `Material ${input.codigo} atualizado, mas falhou ao registrar historico.`,
        },
        { status: 200 },
      );
    }

    return NextResponse.json({ success: true, message: `Material ${input.codigo} atualizado com sucesso.` });
  } catch {
    return NextResponse.json({ message: "Falha ao editar material." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para atualizar status de materiais.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const body = (await request.json().catch(() => ({}))) as Partial<CancelMaterialPayload>;
    const materialId = normalizeText(body.id);
    const reason = normalizeText(body.reason);
    const action = normalizeText(body.action).toLowerCase() === "activate" ? "ACTIVATE" : "CANCEL";

    if (!materialId) {
      return NextResponse.json({ message: "ID do material obrigatorio." }, { status: 400 });
    }

    if (!reason) {
      return NextResponse.json({ message: "Informe o motivo." }, { status: 400 });
    }

    const { supabase, appUser } = resolution;
    const currentMaterial = await fetchMaterialById(supabase, appUser.tenant_id, materialId);

    if (!currentMaterial) {
      return NextResponse.json({ message: "Material nao encontrado." }, { status: 404 });
    }

    if (action === "CANCEL" && !currentMaterial.is_active) {
      return NextResponse.json({ message: `Material ${currentMaterial.codigo} ja esta inativo.` }, { status: 409 });
    }

    if (action === "ACTIVATE" && currentMaterial.is_active) {
      return NextResponse.json({ message: `Material ${currentMaterial.codigo} ja esta ativo.` }, { status: 409 });
    }

    const nowIso = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("materials")
      .update(
        action === "ACTIVATE"
          ? {
              is_active: true,
              cancellation_reason: null,
              canceled_at: null,
              canceled_by: null,
              updated_by: appUser.id,
            }
          : {
              is_active: false,
              cancellation_reason: reason,
              canceled_at: nowIso,
              canceled_by: appUser.id,
              updated_by: appUser.id,
            },
      )
      .eq("tenant_id", appUser.tenant_id)
      .eq("id", materialId);

    if (updateError) {
      return NextResponse.json(
        { message: action === "ACTIVATE" ? "Falha ao ativar material." : "Falha ao cancelar material." },
        { status: 500 },
      );
    }

    const { error: cancellationHistoryError } = await supabase.from("material_cancellation_history").insert({
      tenant_id: appUser.tenant_id,
      material_id: materialId,
      action_type: action,
      reason,
      created_by: appUser.id,
      updated_by: appUser.id,
    });

    if (cancellationHistoryError) {
      return NextResponse.json(
        {
          success: true,
          warning: true,
          message:
            action === "ACTIVATE"
              ? `Material ${currentMaterial.codigo} ativado, mas falhou ao registrar historico de cancelamento.`
              : `Material ${currentMaterial.codigo} cancelado, mas falhou ao registrar historico de cancelamento.`,
        },
        { status: 200 },
      );
    }

    const changePayload: Record<string, HistoryChange> =
      action === "ACTIVATE"
        ? {
            isActive: { from: "false", to: "true" },
            cancellationReason: { from: currentMaterial.cancellation_reason, to: null },
            canceledAt: { from: currentMaterial.canceled_at, to: null },
            activationReason: { from: null, to: reason },
          }
        : {
            isActive: { from: "true", to: "false" },
            cancellationReason: { from: currentMaterial.cancellation_reason, to: reason },
            canceledAt: { from: currentMaterial.canceled_at, to: nowIso },
          };

    const { error: historyError } = await supabase.from("material_history").insert({
      tenant_id: appUser.tenant_id,
      material_id: materialId,
      change_type: action,
      changes: changePayload,
      created_by: appUser.id,
      updated_by: appUser.id,
    });

    if (historyError) {
      return NextResponse.json(
        {
          success: true,
          warning: true,
          message:
            action === "ACTIVATE"
              ? `Material ${currentMaterial.codigo} ativado, mas falhou ao registrar historico do material.`
              : `Material ${currentMaterial.codigo} cancelado, mas falhou ao registrar historico do material.`,
        },
        { status: 200 },
      );
    }

    return NextResponse.json({
      success: true,
      message:
        action === "ACTIVATE"
          ? `Material ${currentMaterial.codigo} ativado com sucesso.`
          : `Material ${currentMaterial.codigo} cancelado com sucesso.`,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao atualizar status do material." }, { status: 500 });
  }
}
