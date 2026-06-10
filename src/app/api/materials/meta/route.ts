import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type MaterialUmbRow = {
  umb: string | null;
};

const PAGE_SIZE = 1000;

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

  const umbSet = new Set<string>();
  let from = 0;

  while (true) {
    const { data, error } = await resolution.supabase
      .from("materials")
      .select("umb")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .not("umb", "is", null)
      .order("umb", { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
      .returns<MaterialUmbRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao carregar UMBs dos materiais." }, { status: 500 });
    }

    for (const item of data ?? []) {
      const umb = normalizeUmb(item.umb);
      if (umb) {
        umbSet.add(umb);
      }
    }

    if ((data ?? []).length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  return NextResponse.json({
    umbOptions: Array.from(umbSet).sort((a, b) => a.localeCompare(b, "pt-BR")),
  });
}
