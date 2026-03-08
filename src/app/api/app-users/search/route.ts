import { NextRequest, NextResponse } from "next/server";
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

export async function GET(request: NextRequest) {
  try {
    const query = normalizeSearchTerm(request.nextUrl.searchParams.get("q") ?? "");
    if (query.length < 2) {
      return NextResponse.json({ users: [] });
    }

    const resolution = await resolveAdminOperator(request);
    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, operator } = resolution;

    const { data: users, error: usersError } = await supabase
      .from("app_users")
      .select("id, tenant_id, matricula, login_name, ativo, role_id")
      .eq("tenant_id", operator.tenantId)
      .or(`login_name.ilike.*${query}*,matricula.ilike.*${query}*`)
      .order("login_name", { ascending: true })
      .limit(8)
      .returns<SearchUserRow[]>();

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
