import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import {
  fetchProjects,
  fetchProjectSupportDefaults,
  fetchProgrammingEqCatalog,
  fetchProgrammingReasonCatalog,
  fetchProgrammingSgdTypes,
  fetchProgrammingWorkCompletionCatalog,
  fetchSupportOptions,
  fetchTeams,
} from "@/server/modules/programacao/catalogs";
import { authorizeProgrammingReadAction } from "@/server/modules/programacao/handlers";
import { normalizeText } from "@/server/modules/programacao/normalizers";

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para consultar catalogo de programacao.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorizationError = await authorizeProgrammingReadAction(resolution);
    if (authorizationError) return authorizationError;

    const [projects, teams, supportOptions, sgdTypes, eqCatalog, reasonOptions, workCompletionCatalog] = await Promise.all([
      fetchProjects(resolution.supabase, resolution.appUser.tenant_id),
      fetchTeams(resolution.supabase, resolution.appUser.tenant_id),
      fetchSupportOptions(resolution.supabase, resolution.appUser.tenant_id),
      fetchProgrammingSgdTypes(resolution.supabase, resolution.appUser.tenant_id),
      fetchProgrammingEqCatalog(resolution.supabase, resolution.appUser.tenant_id),
      fetchProgrammingReasonCatalog(resolution.supabase, resolution.appUser.tenant_id),
      fetchProgrammingWorkCompletionCatalog(resolution.supabase, resolution.appUser.tenant_id),
    ]);

    const supportDefaults = await fetchProjectSupportDefaults({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      projectIds: projects.map((item) => item.id),
      supportOptions,
    });

    return NextResponse.json({
      projects: projects.map((item) => ({
        id: item.id,
        code: normalizeText(item.sob),
        executionDeadline: item.execution_deadline,
        serviceName: normalizeText(item.service_description) || normalizeText(item.service_type_text) || "Sem descricao",
        city: normalizeText(item.city_text) || "Sem municipio",
        base: normalizeText(item.service_center_text) || "Sem base",
        serviceType: normalizeText(item.service_type_text) || "Sem tipo",
        priority: normalizeText(item.priority_text) || "Sem prioridade",
        partner: normalizeText(item.partner_text),
        utilityResponsible: normalizeText(item.utility_responsible_text),
        utilityFieldManager: normalizeText(item.utility_field_manager_text),
        street: normalizeText(item.street),
        district: normalizeText(item.neighborhood),
        note: normalizeText(item.observation) || normalizeText(item.service_description),
        hasLocacao: Boolean(item.has_locacao),
        defaultSupportItemId: supportDefaults.get(item.id)?.supportItemId ?? null,
        defaultSupportLabel: supportDefaults.get(item.id)?.supportLabel ?? null,
      })),
      teams,
      supportOptions: supportOptions.map((item) => ({
        id: item.id,
        description: normalizeText(item.description),
      })),
      sgdTypes: sgdTypes.map((item) => ({
        id: item.id,
        description: normalizeText(item.description),
        exportColumn: normalizeText(item.export_column),
      })),
      electricalEqCatalog: eqCatalog.map((item) => ({
        id: item.id,
        code: normalizeText(item.code),
        label: normalizeText(item.label_pt) || normalizeText(item.code),
      })),
      reasonOptions: reasonOptions.map((item) => ({
        code: normalizeText(item.code),
        label: normalizeText(item.label_pt),
        requiresNotes: Boolean(item.requires_notes),
      })),
      workCompletionCatalog: workCompletionCatalog.map((item) => ({
        code: normalizeText(item.code),
        label: normalizeText(item.label_pt) || normalizeText(item.code),
      })),
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar catalogo de programacao." }, { status: 500 });
  }
}
