import { NextRequest, NextResponse } from "next/server";

import { AUTH_UNAVAILABLE_MESSAGE } from "@/lib/auth/authErrors";
import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { checkPageReadAccess } from "@/lib/server/pageAuthorization";

type ProjectRow = {
  id: string;
  sob: string | null;
  is_active: boolean;
};

type NoProductionReasonRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  sort_order: number | null;
};

function normalizeReasonKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function dedupeNoProductionReasons(items: NoProductionReasonRow[]) {
  const byName = new Map<string, NoProductionReasonRow>();
  for (const item of items) {
    const key = normalizeReasonKey(item.name);
    if (!key || byName.has(key)) continue;
    byName.set(key, item);
  }
  return Array.from(byName.values());
}

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar metadados do medicao-asbuilt.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const access = await checkPageReadAccess(resolution, "medicao-asbuilt");
  if (access === "unavailable") {
    return NextResponse.json({ message: AUTH_UNAVAILABLE_MESSAGE }, { status: 503 });
  }
  if (access === "denied") {
    return NextResponse.json({ message: "Acesso negado para carregar metadados do medicao-asbuilt." }, { status: 403 });
  }

  const [projectResult, noProductionReasonResult] = await Promise.all([
    resolution.supabase
      .from("project")
      .select("id, sob, is_active")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("is_active", true)
      .order("sob", { ascending: true })
      .returns<ProjectRow[]>(),
    resolution.supabase
      .from("measurement_no_production_reasons")
      .select("id, code, name, is_active, sort_order")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .returns<NoProductionReasonRow[]>(),
  ]);

  if (projectResult.error) {
    return NextResponse.json({ message: "Falha ao carregar projetos do medicao-asbuilt." }, { status: 500 });
  }

  if (noProductionReasonResult.error) {
    return NextResponse.json({ message: "Falha ao carregar motivos de sem producao do medicao-asbuilt." }, { status: 500 });
  }

  return NextResponse.json({
    projects: (projectResult.data ?? []).map((item) => {
      const code = String(item.sob ?? "").trim();
      return {
        id: item.id,
        code,
        label: code || item.id,
      };
    }),
    noProductionReasons: dedupeNoProductionReasons(noProductionReasonResult.data ?? []).map((item) => ({
      id: item.id,
      code: String(item.code ?? "").trim(),
      name: String(item.name ?? "").trim(),
    })),
  });
}

