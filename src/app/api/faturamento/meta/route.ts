import { NextRequest, NextResponse } from "next/server";

import { resolveBillingContext } from "@/server/modules/faturamento";

type ProjectRow = {
  id: string;
  sob: string | null;
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
  const resolved = await resolveBillingContext(request, {
    invalidSessionMessage: "Sessao invalida para carregar metadados do faturamento.",
    action: "read",
  });

  if ("errorResponse" in resolved) {
    return resolved.errorResponse;
  }
  const resolution = resolved.context;

  const [projectResult, noProductionReasonResult] = await Promise.all([
    resolution.supabase
      .from("project")
      .select("id, sob")
      .eq("tenant_id", resolution.appUser.tenant_id)
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
    return NextResponse.json({ message: "Falha ao carregar projetos do faturamento." }, { status: 500 });
  }

  if (noProductionReasonResult.error) {
    return NextResponse.json({ message: "Falha ao carregar motivos de sem producao do faturamento." }, { status: 500 });
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
