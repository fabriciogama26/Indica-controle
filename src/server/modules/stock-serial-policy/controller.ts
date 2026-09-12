import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { normalizeExpectedUpdatedAt } from "@/lib/server/concurrency";
import { authorizePageAction } from "@/lib/server/routeAuthorization";
import { loadStockSerialPolicy } from "@/lib/server/stockSerialPolicy";

const PAGE_KEY = "politica-serial";

type SavePolicyPayload = {
  allowPendingOnEntry?: unknown;
  allowPendingOnTransfer?: unknown;
  allowPendingOnExit?: unknown;
  expectedUpdatedAt?: string | null;
};

type PolicySaveRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  updated_at?: string;
  unchanged?: boolean;
};

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "sim";
}

export async function handleGetStockSerialPolicy(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para carregar a politica de serial.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorizationError = await authorizePageAction(resolution, PAGE_KEY, "read");
    if (authorizationError) {
      return authorizationError;
    }

    const { supabase, appUser } = resolution;
    const policyResult = await loadStockSerialPolicy(supabase, appUser.tenant_id);

    if (policyResult.error || !policyResult.data) {
      return NextResponse.json({ message: "Falha ao carregar a politica de serial." }, { status: 500 });
    }

    return NextResponse.json({ policy: policyResult.data });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar a politica de serial." }, { status: 500 });
  }
}

export async function handleUpdateStockSerialPolicy(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para salvar a politica de serial.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorizationError = await authorizePageAction(resolution, PAGE_KEY, "update");
    if (authorizationError) {
      return authorizationError;
    }

    const { supabase, appUser } = resolution;
    const payload = (await request.json().catch(() => ({}))) as SavePolicyPayload;

    const { data, error } = await supabase.rpc("save_tenant_stock_serial_policy", {
      p_tenant_id: appUser.tenant_id,
      p_actor_user_id: appUser.id,
      p_allow_pending_on_entry: normalizeBoolean(payload.allowPendingOnEntry),
      p_allow_pending_on_transfer: normalizeBoolean(payload.allowPendingOnTransfer),
      p_allow_pending_on_exit: normalizeBoolean(payload.allowPendingOnExit),
      p_expected_updated_at: normalizeExpectedUpdatedAt(payload.expectedUpdatedAt),
    });

    if (error) {
      return NextResponse.json({ message: "Falha ao salvar a politica de serial." }, { status: 500 });
    }

    const result = (data ?? {}) as PolicySaveRpcResult;
    if (result.success !== true) {
      return NextResponse.json(
        { message: result.message ?? "Falha ao salvar a politica de serial.", reason: result.reason ?? null },
        { status: Number(result.status ?? 500) },
      );
    }

    return NextResponse.json({
      success: true,
      updatedAt: result.updated_at ?? null,
      message: result.unchanged
        ? "Nenhuma alteracao detectada na politica."
        : "Politica de serial atualizada.",
    });
  } catch {
    return NextResponse.json({ message: "Falha ao salvar a politica de serial." }, { status: 500 });
  }
}
