import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { requirePageAction } from "@/lib/server/pageAuthorization";

type MaterialUmbRow = {
  id: string | null;
};

type MaterialUmbOptionRow = {
  code: string;
};

type MaterialCategoryRow = {
  id: string;
  name: string;
};

type MaterialSubcategoryRow = {
  id: string;
  category_id: string;
  name: string;
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

  const [optionsResult, categoriesResult, subcategoriesResult, withoutUmbResult] = await Promise.all([
    resolution.supabase
      .from("material_umb_options")
      .select("code")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("code", { ascending: true })
      .returns<MaterialUmbOptionRow[]>(),
    resolution.supabase
      .from("material_categories")
      .select("id, name")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .returns<MaterialCategoryRow[]>(),
    resolution.supabase
      .from("material_subcategories")
      .select("id, category_id, name")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .returns<MaterialSubcategoryRow[]>(),
    resolution.supabase
      .from("materials")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", resolution.appUser.tenant_id)
      .or("umb.is.null,umb.eq.")
      .returns<MaterialUmbRow[]>(),
  ]);

  if (optionsResult.error || categoriesResult.error || subcategoriesResult.error || withoutUmbResult.error) {
    return NextResponse.json({ message: "Falha ao carregar UMBs dos materiais." }, { status: 500 });
  }

  const subcategoriesByCategoryId = new Map<string, Array<{ id: string; name: string }>>();
  for (const subcategory of subcategoriesResult.data ?? []) {
    const current = subcategoriesByCategoryId.get(subcategory.category_id) ?? [];
    current.push({ id: subcategory.id, name: subcategory.name });
    subcategoriesByCategoryId.set(subcategory.category_id, current);
  }

  return NextResponse.json({
    umbOptions: (optionsResult.data ?? []).map((item) => normalizeUmb(item.code)).filter(Boolean),
    categoryOptions: (categoriesResult.data ?? []).map((category) => ({
      id: category.id,
      name: category.name,
      subcategories: subcategoriesByCategoryId.get(category.id) ?? [],
    })),
    hasMaterialsWithoutUmb: Boolean(withoutUmbResult.count),
  });
}
