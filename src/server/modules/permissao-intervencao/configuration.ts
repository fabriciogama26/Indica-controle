import { NextResponse } from "next/server";

import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { normalizeExpectedUpdatedAt } from "@/lib/server/concurrency";
import { authorizePageAction } from "@/lib/server/routeAuthorization";

import { fetchJobTitleOptions, fetchPiMeta, fetchPiRoleJobTitles } from "./queries";
import { PI_TEMPLATE_PAGE_KEY } from "./templates";

/**
 * Configuracao da PI por contrato.
 *
 * Vive sob a `page_key` `modelo-pi`, e nao sob a da PI: trocar o prefixo do
 * codigo, o Plano de Emergencia ou os cargos habilitados e ato de administracao
 * do contrato, nao rotina de quem emite uma PI.
 */

type RpcResult = { success?: boolean; status?: number; reason?: string | null; message?: string; updated_at?: string };

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ message, ...(extra ?? {}) }, { status });
}

export async function getPiConfiguration(context: AuthenticatedAppUserContext) {
  const denied = await authorizePageAction(context, PI_TEMPLATE_PAGE_KEY, "read");
  if (denied) return denied;

  const { supabase, appUser } = context;

  try {
    const [meta, jobTitles, roles] = await Promise.all([
      fetchPiMeta(supabase, appUser.tenant_id),
      fetchJobTitleOptions(supabase, appUser.tenant_id),
      fetchPiRoleJobTitles(supabase, appUser.tenant_id),
    ]);

    const { data: updatedAt } = await supabase
      .from("pi_settings")
      .select("updated_at")
      .eq("tenant_id", appUser.tenant_id)
      .maybeSingle<{ updated_at: string }>();

    return NextResponse.json({
      settings: meta.settings
        ? {
            codePrefix: meta.settings.code_prefix,
            companyCode: meta.settings.company_code,
            sequenceDigits: meta.settings.sequence_digits,
            emergencyPlanText: meta.settings.emergency_plan_text,
            emergencyPlanVersion: meta.settings.emergency_plan_version,
            supervisorRequiredTeamCount: meta.settings.supervisor_required_team_count,
            utilityContactSource: meta.settings.utility_contact_source,
            updatedAt: updatedAt?.updated_at ?? null,
          }
        : null,
      jobTitles,
      foremanJobTitleIds: Array.from(roles.foreman),
      supervisorJobTitleIds: Array.from(roles.supervisor),
    });
  } catch {
    return jsonError("Falha ao carregar a configuracao da PI.", 500);
  }
}

export type SavePiConfigurationPayload = {
  codePrefix?: string;
  companyCode?: string;
  sequenceDigits?: number;
  emergencyPlanText?: string | null;
  supervisorRequiredTeamCount?: number;
  utilityContactSource?: string;
  foremanJobTitleIds?: string[];
  supervisorJobTitleIds?: string[];
  expectedUpdatedAt?: string;
};

export async function savePiConfiguration(
  context: AuthenticatedAppUserContext,
  payload: SavePiConfigurationPayload,
) {
  const denied = await authorizePageAction(context, PI_TEMPLATE_PAGE_KEY, "update");
  if (denied) return denied;

  const { supabase, appUser } = context;

  const settings = await supabase.rpc("save_pi_settings", {
    p_tenant_id: appUser.tenant_id,
    p_actor_user_id: appUser.id,
    p_code_prefix: payload.codePrefix ?? null,
    p_company_code: payload.companyCode ?? null,
    p_sequence_digits: payload.sequenceDigits ?? 4,
    p_emergency_plan_text: payload.emergencyPlanText ?? null,
    p_supervisor_required_team_count: payload.supervisorRequiredTeamCount ?? 3,
    p_utility_contact_source: payload.utilityContactSource ?? "RESPONSIBLE",
    p_expected_updated_at: normalizeExpectedUpdatedAt(payload.expectedUpdatedAt),
  });

  if (settings.error) return jsonError("Falha ao salvar a configuracao da PI.", 500);

  const settingsResult = (settings.data ?? {}) as RpcResult;
  if (settingsResult.success !== true) {
    return jsonError(settingsResult.message ?? "Falha ao salvar a configuracao.", Number(settingsResult.status ?? 400), {
      reason: settingsResult.reason ?? null,
    });
  }

  // Os cargos vao em RPC propria, depois da configuracao: se a primeira falhar
  // por concorrencia, os cargos nao chegam a mudar.
  for (const [role, ids] of [
    ["FOREMAN", payload.foremanJobTitleIds],
    ["SUPERVISOR", payload.supervisorJobTitleIds],
  ] as const) {
    if (!ids) continue;
    const roleResult = await supabase.rpc("save_pi_role_job_titles", {
      p_tenant_id: appUser.tenant_id,
      p_actor_user_id: appUser.id,
      p_role: role,
      p_job_title_ids: ids,
    });

    if (roleResult.error) return jsonError("Falha ao salvar os cargos do papel.", 500);
    const parsed = (roleResult.data ?? {}) as RpcResult;
    if (parsed.success !== true) {
      return jsonError(parsed.message ?? "Falha ao salvar os cargos do papel.", Number(parsed.status ?? 400), {
        reason: parsed.reason ?? null,
      });
    }
  }

  return NextResponse.json({
    updatedAt: settingsResult.updated_at ?? null,
    message: settingsResult.message ?? "Configuracao salva.",
  });
}
