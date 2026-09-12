// Checagem de duplicidade da `Ordem` da Medicao Comercial, usada pela tela para
// avisar ANTES do submit (ao sair do campo).
//
// Isto e conveniencia de UX, NAO e a barreira. A barreira e o UNIQUE INDEX
// parcial `uq_project_measurement_orders_commercial_ref_team_date` (migration
// 419): entre esta consulta e o salvamento existe janela para outro usuario
// gravar a mesma Ordem, e so o indice fecha essa janela sem TOCTOU.
import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

import { authorizeMeasurementVariantReadOrExportAction } from "./authorization";
import { normalizeIsoDate, normalizeText, normalizeUuid } from "./normalizers";

type DuplicateCandidateRow = {
  id: string;
  order_number: string;
  commercial_order_ref: string | null;
};

// Mesma normalizacao do indice (`upper(btrim(...))`), para que o aviso da tela e
// a recusa do banco concordem.
function normalizeOrderRef(value: unknown) {
  return normalizeText(value).toUpperCase();
}

export async function handleCommercialOrderRefCheck(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para consultar ordens de medicao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  // Mesmo `page_key` da tela visivel (CLAUDE.md, padrao de permissao por tela):
  // quem abre a Medicao Comercial usa esta checagem sem permissao extra.
  const authorizationError = await authorizeMeasurementVariantReadOrExportAction(resolution, "read", true);
  if (authorizationError) {
    return authorizationError;
  }

  const orderRef = normalizeText(request.nextUrl.searchParams.get("orderRef"));
  const teamId = normalizeUuid(request.nextUrl.searchParams.get("teamId"));
  const executionDate = normalizeIsoDate(request.nextUrl.searchParams.get("executionDate"));
  const excludeOrderId = normalizeUuid(request.nextUrl.searchParams.get("excludeOrderId"));

  // Sem os tres nao ha o que checar: a chave da unicidade e Incidencia + Equipe
  // + Data. Responder 200 com `duplicate: false` mantem a tela simples -- o campo
  // vazio ja e barrado pela validacao de obrigatoriedade, nao por aqui.
  if (!orderRef || !teamId || !executionDate) {
    return NextResponse.json({ duplicate: false, orderNumber: null });
  }

  // Os filtros seletivos vao TODOS para o banco (tenant, equipe, data, ativa).
  // O que sobra e no maximo um punhado de ordens da mesma equipe no mesmo dia,
  // e so a comparacao normalizada de texto acontece aqui -- PostgREST nao
  // expressa `upper(btrim(col))` no filtro, e montar `ilike` com texto livre
  // exigiria escapar `%`/`_` da Incidencia digitada pelo usuario.
  const { data, error } = await resolution.supabase
    .from("project_measurement_orders")
    .select("id, order_number, commercial_order_ref")
    .eq("tenant_id", resolution.appUser.tenant_id)
    .eq("team_id", teamId)
    .eq("execution_date", executionDate)
    .eq("is_active", true)
    .not("commercial_order_ref", "is", null)
    .limit(200)
    .returns<DuplicateCandidateRow[]>();

  if (error) {
    console.error("[medicao] Falha ao checar duplicidade da Ordem comercial.", {
      operation: "checar Ordem + Equipe + Data",
      tenantId: resolution.appUser.tenant_id,
      userId: resolution.appUser.id,
      technicalDetail: normalizeText(error.message),
    });
    return NextResponse.json({ message: "Falha ao verificar a Ordem informada." }, { status: 500 });
  }

  const target = normalizeOrderRef(orderRef);
  const duplicate = (data ?? []).find(
    (row) => row.id !== excludeOrderId && normalizeOrderRef(row.commercial_order_ref) === target,
  );

  return NextResponse.json({
    duplicate: Boolean(duplicate),
    orderNumber: duplicate?.order_number ?? null,
  });
}
