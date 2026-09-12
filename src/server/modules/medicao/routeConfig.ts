// Configuracao por variante das rotas de Medicao (tecnica e comercial).
//
// Vive aqui, e nao em `src/app/api/medicao/route.ts`, porque route.ts do Next
// so pode exportar handlers HTTP: qualquer export extra quebra o build/typecheck
// (`OmitWithTag ... is not assignable to type 'never'`). Mesmo motivo ja
// documentado em `index.ts` deste modulo.
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";

import { COMMERCIAL_MEASUREMENT_PAGE_KEY, MEASUREMENT_PAGE_KEY } from "./authorization";
import { resolveTeamMeasurementMode } from "./teamMode";

export type MeasurementTeamCategoryCode = "TECNICA" | "COMERCIAL";

export type MeasurementRouteConfig = {
  pageKey: string;
  teamCategoryCode: MeasurementTeamCategoryCode;
  commercial: boolean;
};

export const DEFAULT_MEASUREMENT_ROUTE_CONFIG: MeasurementRouteConfig = {
  pageKey: MEASUREMENT_PAGE_KEY,
  teamCategoryCode: "TECNICA",
  commercial: false,
};

export const COMMERCIAL_MEASUREMENT_ROUTE_CONFIG: MeasurementRouteConfig = {
  pageKey: COMMERCIAL_MEASUREMENT_PAGE_KEY,
  teamCategoryCode: "COMERCIAL",
  commercial: true,
};

export async function resolveTeamCategoryCode(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  teamId: string;
}) {
  return resolveTeamMeasurementMode(params);
}

export async function orderMatchesRouteCategory(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  orderId: string;
  teamCategoryCode: MeasurementTeamCategoryCode;
}) {
  const { data, error } = await params.supabase
    .from("project_measurement_orders")
    .select("team_id")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.orderId)
    .maybeSingle<{ team_id: string }>();

  if (error || !data?.team_id) {
    return false;
  }

  const code = await resolveTeamCategoryCode({
    supabase: params.supabase,
    tenantId: params.tenantId,
    teamId: data.team_id,
  });
  return code === params.teamCategoryCode;
}
