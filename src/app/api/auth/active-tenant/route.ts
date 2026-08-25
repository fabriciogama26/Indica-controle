import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser, type AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";

const ACTIVE_TENANT_COOKIE_NAME = "INDICA.activeTenantId";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
} as const;

type TenantRow = {
  id: string;
  name: string;
  ativo: boolean;
};

type AdminTenantContextResolution =
  | {
      context: AuthenticatedAppUserContext;
    }
  | {
      error: {
        status: number;
        message: string;
      };
    };

function buildCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}

async function resolveAdminTenantContext(request: NextRequest): Promise<AdminTenantContextResolution> {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para selecionar contrato.",
    inactiveMessage: "Usuario inativo.",
    ignoreActiveTenantCookie: true,
    allowAdminWithoutActiveTenant: true,
  });

  if ("error" in resolution) {
    return { error: resolution.error };
  }

  if (!resolution.role.isAdmin) {
    return {
      error: {
        status: 403,
        message: "Apenas administradores podem selecionar contrato.",
      },
    };
  }

  return { context: resolution };
}

export async function GET(request: NextRequest) {
  try {
    const resolved = await resolveAdminTenantContext(request);
    if ("error" in resolved) {
      return NextResponse.json({ message: resolved.error.message }, { status: resolved.error.status });
    }

    const { context } = resolved;
    const tenantIds = context.tenantAccess.availableTenantIds;
    if (tenantIds.length === 0) {
      return NextResponse.json({ tenants: [], activeTenantId: null }, { headers: NO_STORE_HEADERS });
    }

    const { data, error } = await context.supabase
      .from("tenants")
      .select("id, name, ativo")
      .in("id", tenantIds)
      .eq("ativo", true)
      .order("name", { ascending: true })
      .returns<TenantRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao carregar contratos disponiveis." }, { status: 500 });
    }

    const cookieTenantId = request.cookies.get(ACTIVE_TENANT_COOKIE_NAME)?.value ?? null;
    const isCookieTenantAllowed = Boolean(cookieTenantId && context.tenantAccess.availableTenantIds.includes(cookieTenantId));
    const activeTenantId = isCookieTenantAllowed ? cookieTenantId : context.tenantAccess.activeTenantId;

    const response = NextResponse.json(
      {
        activeTenantId,
        tenants: (data ?? []).map((tenant) => ({
          id: tenant.id,
          name: tenant.name,
        })),
      },
      { headers: NO_STORE_HEADERS },
    );
    if (cookieTenantId && !isCookieTenantAllowed) {
      response.cookies.set(ACTIVE_TENANT_COOKIE_NAME, "", {
        ...buildCookieOptions(),
        maxAge: 0,
      });
    }
    return response;
  } catch {
    return NextResponse.json({ message: "Falha ao carregar contratos disponiveis." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const resolved = await resolveAdminTenantContext(request);
    if ("error" in resolved) {
      return NextResponse.json({ message: resolved.error.message }, { status: resolved.error.status });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const tenantId = String(body.tenantId ?? "").trim();
    if (!tenantId) {
      return NextResponse.json({ message: "Informe o contrato." }, { status: 400 });
    }

    const { context } = resolved;
    if (!context.tenantAccess.availableTenantIds.includes(tenantId)) {
      return NextResponse.json({ message: "Contrato nao permitido para o usuario autenticado." }, { status: 403 });
    }

    const { data: tenant, error: tenantError } = await context.supabase
      .from("tenants")
      .select("id, name, ativo")
      .eq("id", tenantId)
      .eq("ativo", true)
      .maybeSingle<TenantRow>();

    if (tenantError || !tenant) {
      return NextResponse.json({ message: "Contrato nao encontrado ou inativo." }, { status: 404 });
    }

    const response = NextResponse.json(
      {
        success: true,
        activeTenantId: tenant.id,
        activeTenantName: tenant.name,
      },
      { headers: NO_STORE_HEADERS },
    );
    response.cookies.set(ACTIVE_TENANT_COOKIE_NAME, tenant.id, buildCookieOptions());
    return response;
  } catch {
    return NextResponse.json({ message: "Falha ao selecionar contrato." }, { status: 500 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS });
  response.cookies.set(ACTIVE_TENANT_COOKIE_NAME, "", {
    ...buildCookieOptions(),
    maxAge: 0,
  });
  return response;
}
