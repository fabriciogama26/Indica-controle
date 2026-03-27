import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type CatalogRow = {
  id?: string;
  code: string;
  description: string;
  unit: string;
  unit_value: number | string;
  voice_point?: number | string;
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

function normalizeCodeTokenLoose(value: string) {
  return normalizeCodeToken(value).replace(/o/g, "0");
}

function matchCatalogRow(item: CatalogRow, rawQuery: string) {
  const normalizedQuery = normalizeSearchText(rawQuery);
  if (!normalizedQuery) return false;
  const codeCandidate = normalizedQuery.split("-")[0]?.trim();
  const queryToken = normalizeCodeToken(codeCandidate);
  const queryTokenLoose = normalizeCodeTokenLoose(codeCandidate);
  const code = normalizeSearchText(item.code);
  const description = normalizeSearchText(item.description);
  const label = `${code} - ${description}`;
  const codeToken = normalizeCodeToken(item.code);
  const codeTokenLoose = normalizeCodeTokenLoose(item.code);

  return (
    code === normalizedQuery
    || label === normalizedQuery
    || code.includes(normalizedQuery)
    || description.includes(normalizedQuery)
    || label.includes(normalizedQuery)
    || (queryToken && (codeToken === queryToken || codeToken.startsWith(queryToken)))
    || (queryTokenLoose && (codeTokenLoose === queryTokenLoose || codeTokenLoose.startsWith(queryTokenLoose)))
  );
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para pesquisar atividades da medicao.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const query = normalizeText(request.nextUrl.searchParams.get("q"));
    if (query.length < 2) {
      return NextResponse.json({ items: [] });
    }

    let serviceData: CatalogRow[] = [];
    let serviceError: { message?: string } | null = null;

    const servicePrimary = await resolution.supabase
      .from("service_activities")
      .select("id, code, description, unit, unit_value, voice_point")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("ativo", true)
      .or(`code.ilike.%${query}%,description.ilike.%${query}%`)
      .order("code", { ascending: true })
      .limit(40);

    serviceData = (servicePrimary.data ?? []) as CatalogRow[];
    serviceError = servicePrimary.error ? { message: servicePrimary.error.message } : null;

    if (serviceError?.message?.toLowerCase().includes("voice_point")) {
      const serviceFallbackWithoutVoicePoint = await resolution.supabase
        .from("service_activities")
        .select("id, code, description, unit, unit_value")
        .eq("tenant_id", resolution.appUser.tenant_id)
        .eq("ativo", true)
        .or(`code.ilike.%${query}%,description.ilike.%${query}%`)
        .order("code", { ascending: true })
        .limit(40);

      serviceData = (serviceFallbackWithoutVoicePoint.data ?? []).map((item) => ({ ...item, voice_point: 1 })) as CatalogRow[];
      serviceError = serviceFallbackWithoutVoicePoint.error ? { message: serviceFallbackWithoutVoicePoint.error.message } : null;
    }

    if (serviceError) {
      return NextResponse.json({ message: "Falha ao pesquisar atividades da medicao." }, { status: 500 });
    }

    if (serviceData.length === 0) {
      const broadPrimary = await resolution.supabase
        .from("service_activities")
        .select("id, code, description, unit, unit_value, voice_point")
        .eq("tenant_id", resolution.appUser.tenant_id)
        .eq("ativo", true)
        .order("code", { ascending: true })
        .limit(500);

      let broadData = (broadPrimary.data ?? []) as CatalogRow[];
      let broadError = broadPrimary.error ? { message: broadPrimary.error.message } : null;

      if (broadError?.message?.toLowerCase().includes("voice_point")) {
        const broadFallbackWithoutVoicePoint = await resolution.supabase
          .from("service_activities")
          .select("id, code, description, unit, unit_value")
          .eq("tenant_id", resolution.appUser.tenant_id)
          .eq("ativo", true)
          .order("code", { ascending: true })
          .limit(500);
        broadData = (broadFallbackWithoutVoicePoint.data ?? []).map((item) => ({ ...item, voice_point: 1 })) as CatalogRow[];
        broadError = broadFallbackWithoutVoicePoint.error ? { message: broadFallbackWithoutVoicePoint.error.message } : null;
      }

      if (!broadError) {
        serviceData = broadData.filter((item) => matchCatalogRow(item, query)).slice(0, 40);
      }
    }

    if (serviceData.length === 0) {
      return NextResponse.json({ items: [] });
    }

    return NextResponse.json({
      items: serviceData.map((item) => ({
        id: String(item.id ?? ""),
        code: String(item.code),
        description: String(item.description),
        unit: String(item.unit),
        unitValue: Number(item.unit_value ?? 0),
        voicePoint: Number(item.voice_point ?? 1),
      })),
    });
  } catch {
    return NextResponse.json({ message: "Falha ao pesquisar atividades da medicao." }, { status: 500 });
  }
}
