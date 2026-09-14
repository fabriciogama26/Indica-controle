import { NextRequest, NextResponse } from "next/server";

import { AUTH_UNAVAILABLE_MESSAGE } from "@/lib/auth/authErrors";
import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { checkPageReadAccess } from "@/lib/server/pageAuthorization";

type CatalogRow = {
  id?: string;
  code: string;
  description: string;
  unit: string;
  voice_point: number | string;
  unit_value: number | string;
  ativo: boolean;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeSearchText(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeCodeToken(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function matchCatalogRow(item: CatalogRow, rawQuery: string) {
  const normalizedQuery = normalizeSearchText(rawQuery);
  if (!normalizedQuery) return false;
  const codeCandidate = normalizedQuery.split("-")[0]?.trim();
  const queryToken = normalizeCodeToken(codeCandidate);
  const code = normalizeSearchText(item.code);
  const description = normalizeSearchText(item.description);
  const label = `${code} - ${description}`;
  const codeToken = normalizeCodeToken(item.code);

  return (
    code === normalizedQuery
    || label === normalizedQuery
    || code.includes(normalizedQuery)
    || description.includes(normalizedQuery)
    || label.includes(normalizedQuery)
    || (queryToken && (codeToken === queryToken || codeToken.startsWith(queryToken)))
  );
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para pesquisar atividades do medicao-asbuilt.",
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
      return NextResponse.json({ message: "Acesso negado para pesquisar atividades do medicao-asbuilt." }, { status: 403 });
    }

    const query = normalizeText(request.nextUrl.searchParams.get("q"));
    const includeInactive = normalizeText(request.nextUrl.searchParams.get("includeInactive")).toLowerCase() === "true";
    if (query.length < 2) {
      return NextResponse.json({ items: [] });
    }

    let servicePrimaryQuery = resolution.supabase
      .from("service_activities")
      .select("id, code, description, unit, voice_point, unit_value, ativo")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .or(`code.ilike.%${query}%,description.ilike.%${query}%`)
      .order("code", { ascending: true })
      .limit(40);
    if (!includeInactive) {
      servicePrimaryQuery = servicePrimaryQuery.eq("ativo", true);
    }
    const servicePrimary = await servicePrimaryQuery;

    if (servicePrimary.error) {
      return NextResponse.json({ message: "Falha ao pesquisar atividades do medicao-asbuilt." }, { status: 500 });
    }

    let serviceData = (servicePrimary.data ?? []) as CatalogRow[];
    if (serviceData.length === 0) {
      let broadQuery = resolution.supabase
        .from("service_activities")
        .select("id, code, description, unit, voice_point, unit_value, ativo")
        .eq("tenant_id", resolution.appUser.tenant_id)
        .order("code", { ascending: true })
        .limit(500);
      if (!includeInactive) {
        broadQuery = broadQuery.eq("ativo", true);
      }
      const broad = await broadQuery;

      if (!broad.error) {
        serviceData = ((broad.data ?? []) as CatalogRow[]).filter((item) => matchCatalogRow(item, query)).slice(0, 40);
      }
    }

    return NextResponse.json({
      items: serviceData.map((item) => ({
        id: String(item.id ?? ""),
        code: String(item.code),
        description: String(item.description),
        unit: String(item.unit),
        voicePoint: Number(item.voice_point ?? 1),
        unitValue: Number(item.unit_value ?? 0),
        isActive: item.ativo !== false,
      })),
    });
  } catch {
    return NextResponse.json({ message: "Falha ao pesquisar atividades do medicao-asbuilt." }, { status: 500 });
  }
}

