import { NextRequest, NextResponse } from "next/server";

import { resolveBillingContext } from "@/server/modules/faturamento";

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

/**
 * Envolve um valor de filtro do PostgREST em aspas duplas, escapando `\` e `"`.
 *
 * A gramatica do `or=(...)` e posicional: virgula separa condicoes, parenteses
 * delimitam o grupo e ponto separa coluna/operador/valor. Interpolar o termo cru
 * deixava o usuario injetar predicados arbitrarios sobre `service_activities`
 * (`?q=x,unit_value.gte.0`) e quebrava a busca com qualquer termo que contivesse
 * virgula. Entre aspas, esses caracteres viram parte do valor.
 *
 * Os curingas do `ilike` (`%` e o `*` que o PostgREST converte em `%`) NAO sao
 * escapados: continuam valendo como hoje dentro do valor citado. O que muda e
 * so a impossibilidade de encerrar o valor e emendar outra condicao.
 */
function quoteFilterValue(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export async function GET(request: NextRequest) {
  try {
    const resolved = await resolveBillingContext(request, {
      invalidSessionMessage: "Sessao invalida para pesquisar atividades do faturamento.",
      action: "read",
    });

    if ("errorResponse" in resolved) {
      return resolved.errorResponse;
    }
    const resolution = resolved.context;

    const query = normalizeText(request.nextUrl.searchParams.get("q"));
    const includeInactive = normalizeText(request.nextUrl.searchParams.get("includeInactive")).toLowerCase() === "true";
    if (query.length < 2) {
      return NextResponse.json({ items: [] });
    }

    const likeTerm = quoteFilterValue(`%${query}%`);
    let servicePrimaryQuery = resolution.supabase
      .from("service_activities")
      .select("id, code, description, unit, voice_point, unit_value, ativo")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .or(`code.ilike.${likeTerm},description.ilike.${likeTerm}`)
      .order("code", { ascending: true })
      .limit(40);
    if (!includeInactive) {
      servicePrimaryQuery = servicePrimaryQuery.eq("ativo", true);
    }
    const servicePrimary = await servicePrimaryQuery;

    if (servicePrimary.error) {
      return NextResponse.json({ message: "Falha ao pesquisar atividades do faturamento." }, { status: 500 });
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
    return NextResponse.json({ message: "Falha ao pesquisar atividades do faturamento." }, { status: 500 });
  }
}
