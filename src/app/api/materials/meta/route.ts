import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { requirePageAction } from "@/lib/server/pageAuthorization";

type MaterialUmbRow = {
  id: string | null;
};

type MaterialUmbOptionRow = {
  code: string;
};

function normalizeUmb(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar UMBs dos materiais.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorization = await requirePageAction({
    context: resolution,
    pageKey: "materiais",
    action: "read",
  });

  if (!authorization.allowed) {
    return NextResponse.json(
      { message: authorization.error.message, code: authorization.error.code },
      { status: authorization.error.status },
    );
  }

  const [optionsResult, withoutUmbResult] = await Promise.all([
    resolution.supabase
      .from("material_umb_options")
      .select("code")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("code", { ascending: true })
      .returns<MaterialUmbOptionRow[]>(),
    resolution.supabase
      .from("materials")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", resolution.appUser.tenant_id)
      .or("umb.is.null,umb.eq.")
      .returns<MaterialUmbRow[]>(),
  ]);

  if (optionsResult.error || withoutUmbResult.error) {
    return NextResponse.json({ message: "Falha ao carregar UMBs dos materiais." }, { status: 500 });
  }

  return NextResponse.json({
    umbOptions: (optionsResult.data ?? []).map((item) => normalizeUmb(item.code)).filter(Boolean),
    hasMaterialsWithoutUmb: Boolean(withoutUmbResult.count),
  });
}
