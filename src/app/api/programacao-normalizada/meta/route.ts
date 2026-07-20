import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

import {
  fetchProgrammingEqCatalog,
  fetchProgrammingReasonCatalog,
  fetchProgrammingSgdTypes,
  fetchProgrammingSupportItems,
  fetchProgrammingWorkCompletionCatalog,
  fetchProjects,
  fetchTeams,
} from "@/server/modules/programacao-normalizada/catalogs";
import { authorizeProgrammingNormalizadaAction } from "@/server/modules/programacao-normalizada/handlers";
import { normalizeText } from "@/server/modules/programacao-normalizada/normalizers";

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para consultar catalogo de programacao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizeProgrammingNormalizadaAction(resolution, "read");
  if (authorizationError) return authorizationError;

  const [projects, teams, sgdTypes, eqCatalog, workCompletionCatalog, reasonOptions, supportOptions] = await Promise.all([
    fetchProjects(resolution.supabase, resolution.appUser.tenant_id),
    fetchTeams(resolution.supabase, resolution.appUser.tenant_id),
    fetchProgrammingSgdTypes(resolution.supabase, resolution.appUser.tenant_id),
    fetchProgrammingEqCatalog(resolution.supabase, resolution.appUser.tenant_id),
    fetchProgrammingWorkCompletionCatalog(resolution.supabase, resolution.appUser.tenant_id),
    fetchProgrammingReasonCatalog(resolution.supabase, resolution.appUser.tenant_id),
    fetchProgrammingSupportItems(resolution.supabase, resolution.appUser.tenant_id),
  ]);

  return NextResponse.json({
    projects: projects.map((item) => ({
      id: item.id,
      code: normalizeText(item.sob),
      city: normalizeText(item.city_text),
      serviceCenter: normalizeText(item.service_center_text),
      executionDeadline: item.execution_deadline,
      base: normalizeText(item.service_center_text) || "Sem base",
      serviceType: normalizeText(item.service_type_text),
      serviceName: normalizeText(item.service_description),
      priority: normalizeText(item.priority_text),
      partner: normalizeText(item.partner_text),
      utilityResponsible: normalizeText(item.utility_responsible_text),
      utilityFieldManager: normalizeText(item.utility_field_manager_text),
      street: normalizeText(item.street),
      district: normalizeText(item.neighborhood),
    })),
    teams,
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
    workCompletionCatalog: workCompletionCatalog.map((item) => ({
      code: normalizeText(item.code),
      label: normalizeText(item.label_pt) || normalizeText(item.code),
    })),
    reasonOptions: reasonOptions.map((item) => ({
      code: normalizeText(item.code),
      label: normalizeText(item.label_pt),
      requiresNotes: Boolean(item.requires_notes),
    })),
    supportOptions: supportOptions.map((item) => ({
      id: item.id,
      description: normalizeText(item.description),
    })),
  });
}
