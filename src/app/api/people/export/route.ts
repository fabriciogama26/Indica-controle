import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { loadAllRows, normalizeText } from "@/lib/server/apiHelpers";
import { isMatriculationNumericTypeMismatchError } from "@/server/modules/people/errors";
import { enrichPeopleRows, listPeopleRows, type PeopleListFilters } from "@/server/modules/people/list";

/**
 * Teto de seguranca para a exportacao: leitura completa da lista filtrada numa
 * unica resposta (via loadAllRows), em vez do loop client-side de paginas de 100
 * que hoje repete autenticacao, contagem e lookups a cada volta.
 */
const MAX_EXPORT_ROWS = 20000;

function normalizeMatriculation(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function normalizeCpf(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para exportar pessoas.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const params = request.nextUrl.searchParams;

    const listFilters: PeopleListFilters = {
      tenantId: appUser.tenant_id,
      name: normalizeText(params.get("name")),
      matriculation: normalizeMatriculation(params.get("matriculation")),
      cpf: normalizeCpf(params.get("cpf")),
      phone: normalizeText(params.get("phone")),
      jobTitleId: normalizeText(params.get("jobTitleId")),
      jobTitleTypeId: normalizeText(params.get("jobTitleTypeId")),
      jobLevel: normalizeText(params.get("jobLevel")),
      status: normalizeText(params.get("status")).toLowerCase(),
    };

    let { data, error } = await loadAllRows(
      (from, to) => listPeopleRows({ supabase, filters: listFilters, from, to }),
      { maxRows: MAX_EXPORT_ROWS },
    );

    if (listFilters.matriculation && error && isMatriculationNumericTypeMismatchError(error)) {
      ({ data, error } = await loadAllRows(
        (from, to) => listPeopleRows({
          supabase,
          filters: { ...listFilters, matriculationMatchMode: "exact" },
          from,
          to,
        }),
        { maxRows: MAX_EXPORT_ROWS },
      ));
    }

    if (error) {
      return NextResponse.json({ message: "Falha ao exportar pessoas." }, { status: 500 });
    }

    const rows = data ?? [];
    const people = await enrichPeopleRows({
      supabase,
      tenantId: appUser.tenant_id,
      rows,
    });

    return NextResponse.json({
      people,
      truncated: rows.length >= MAX_EXPORT_ROWS,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao exportar pessoas." }, { status: 500 });
  }
}
