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

type UserTenantLinkRow = {
  user_id: string;
};

function mergeUsers(users: SearchUserRow[]) {
  const map = new Map<string, SearchUserRow>();
  users.forEach((user) => {
    map.set(user.id, user);
  });
  return Array.from(map.values()).sort((left, right) => left.login_name.localeCompare(right.login_name));
}

async function fetchLinkedTenantUserIds(supabase: SupabaseClient, tenantId: string) {
  const userIds: string[] = [];
  const batchSize = 500;

  for (let offset = 0; ; offset += batchSize) {
    const { data, error } = await supabase
      .from("app_user_tenants")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .range(offset, offset + batchSize - 1)
      .returns<UserTenantLinkRow[]>();

    if (error) {
      return { userIds: [], error };
    }

    userIds.push(...(data ?? []).map((item) => item.user_id).filter(Boolean));

    if ((data ?? []).length < batchSize) {
      return { userIds: Array.from(new Set(userIds)), error: null };
    }
  }
}

async function fetchUsersByIds(supabase: SupabaseClient, userIds: string[]) {
  const users: SearchUserRow[] = [];
  const batchSize = 500;

  for (let offset = 0; offset < userIds.length; offset += batchSize) {
    const ids = userIds.slice(offset, offset + batchSize);
    const { data, error } = await supabase
      .from("app_users")
      .select("id, tenant_id, matricula, login_name, ativo, role_id")
      .in("id", ids)
      .returns<SearchUserRow[]>();

    if (error) {
      return { users: [], error };
    }

    users.push(...(data ?? []));
  }

  return { users, error: null };
}

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

function filterUsersByQuery(users: SearchUserRow[], query: string) {
  const normalizedQuery = query.toLowerCase();
  return users.filter((user) => {
    const loginName = user.login_name.toLowerCase();
    const matricula = String(user.matricula ?? "").toLowerCase();
    return loginName.includes(normalizedQuery) || matricula.includes(normalizedQuery);
  });
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

    const { users: homeUsers, error: homeUsersError } = shouldListTenantUsers
      ? await listTenantUsers(supabase, operator.tenantId)
      : await searchTenantUsers(supabase, operator.tenantId, query);

    if (homeUsersError) {
      return NextResponse.json({ message: "Falha ao buscar usuarios do tenant." }, { status: 500 });
    }

    const { userIds: linkedUserIds, error: linkedUserIdsError } = await fetchLinkedTenantUserIds(supabase, operator.tenantId);
    if (linkedUserIdsError) {
      return NextResponse.json({ message: "Falha ao buscar vinculos dos usuarios do tenant." }, { status: 500 });
    }

    const missingLinkedUserIds = linkedUserIds.filter((userId) => !homeUsers.some((user) => user.id === userId));
    const { users: linkedUsers, error: linkedUsersError } = missingLinkedUserIds.length
      ? await fetchUsersByIds(supabase, missingLinkedUserIds)
      : { users: [], error: null };

    if (linkedUsersError) {
      return NextResponse.json({ message: "Falha ao buscar usuarios vinculados ao tenant." }, { status: 500 });
    }

    const users = shouldListTenantUsers
      ? mergeUsers([...homeUsers, ...linkedUsers])
      : mergeUsers([...homeUsers, ...filterUsersByQuery(linkedUsers, query)]).slice(0, 8);

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
          tenantId: operator.tenantId,
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
