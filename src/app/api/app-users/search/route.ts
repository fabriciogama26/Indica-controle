import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAdminOperator } from "@/lib/server/appUsersAdmin";

function normalizeSearchTerm(value: string) {
  return value.replace(/[,%()]/g, " ").trim();
}

type SearchUserRow = {
  id: string;
  tenant_id: string;
  matricula: string | null;
  login_name: string;
  ativo: boolean;
  role_id: string | null;
};

async function listTenantUsers(supabase: SupabaseClient, tenantId: string) {
  const users: SearchUserRow[] = [];
  const batchSize = 500;

  for (let offset = 0; ; offset += batchSize) {
    const { data, error } = await supabase
      .from("app_users")
      .select("id, tenant_id, matricula, login_name, ativo, role_id")
      .eq("tenant_id", tenantId)
      .order("login_name", { ascending: true })
      .range(offset, offset + batchSize - 1)
      .returns<SearchUserRow[]>();

    if (error) {
      return { users: [], error };
    }

    users.push(...(data ?? []));

    if ((data ?? []).length < batchSize) {
      return { users, error: null };
    }
  }
}

async function searchTenantUsers(supabase: SupabaseClient, tenantId: string, query: string) {
  const { data, error } = await supabase
    .from("app_users")
    .select("id, tenant_id, matricula, login_name, ativo, role_id")
    .eq("tenant_id", tenantId)
    .or(`login_name.ilike.*${query}*,matricula.ilike.*${query}*`)
    .order("login_name", { ascending: true })
    .limit(8)
    .returns<SearchUserRow[]>();

  return { users: data ?? [], error };
}

export async function GET(request: NextRequest) {
  try {
    const query = normalizeSearchTerm(request.nextUrl.searchParams.get("q") ?? "");
    const shouldListTenantUsers = request.nextUrl.searchParams.get("list") === "tenant";

    if (!shouldListTenantUsers && query.length < 2) {
      return NextResponse.json({ users: [] });
    }

    const resolution = await resolveAdminOperator(request);
    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, operator } = resolution;

    const { users, error: usersError } = shouldListTenantUsers
      ? await listTenantUsers(supabase, operator.tenantId)
      : await searchTenantUsers(supabase, operator.tenantId, query);

    if (usersError) {
      return NextResponse.json({ message: "Falha ao buscar usuarios do tenant." }, { status: 500 });
    }

    const roleIds = Array.from(new Set((users ?? []).map((item) => item.role_id).filter((value): value is string => Boolean(value))));

    const { data: roles, error: rolesError } = roleIds.length
      ? await supabase.from("app_roles").select("id, role_key, name").in("id", roleIds)
      : { data: [], error: null };

    if (rolesError) {
      return NextResponse.json({ message: "Falha ao buscar perfis dos usuarios do tenant." }, { status: 500 });
    }

    const rolesMap = new Map(
      (roles ?? []).map((role) => [
        String((role as Record<string, unknown>).id),
        {
          roleKey: String((role as Record<string, unknown>).role_key ?? "user"),
          name: String((role as Record<string, unknown>).name ?? "User"),
        },
      ]),
    );

    return NextResponse.json({
      users: (users ?? []).map((item) => {
        const role = item.role_id ? rolesMap.get(item.role_id) : null;
        return {
          id: item.id,
          tenantId: item.tenant_id,
          matricula: item.matricula,
          loginName: item.login_name,
          status: item.ativo ? "Ativo" : "Inativo",
          role: role?.roleKey ?? "user",
          roleLabel: role?.name ?? "User",
        };
      }),
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message === "SUPABASE_SERVICE_ROLE_KEY is missing for tenant admin routes."
        ? "Configure SUPABASE_SERVICE_ROLE_KEY no .env para buscar usuarios do tenant."
        : "Falha ao buscar usuarios do tenant.";

    return NextResponse.json({ message }, { status: 500 });
  }
}
