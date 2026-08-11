import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";

type ProjectServiceCenterRow = {
  id: string;
  service_center?: string | null;
  service_center_text: string | null;
};

type ProjectServiceCenterLookupRow = {
  id: string;
  name: string | null;
};

export const PROJECT_SERVICE_CENTER_FALLBACK = "Sem base";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeUuid(value: unknown) {
  const normalized = normalizeText(value);
  return /^[0-9a-f-]{36}$/i.test(normalized) ? normalized : null;
}

/**
 * Resolve o Centro de Servico de cada projeto (`project_with_labels.service_center_text`),
 * com fallback para `project` + `project_service_centers` quando a view nao estiver disponivel.
 * Retorna um Map projectId -> nome do centro de servico.
 */
export async function fetchProjectServiceCenterMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projectIds: string[];
}) {
  if (!params.projectIds.length) {
    return new Map<string, string>();
  }

  const uniqueProjectIds = Array.from(new Set(params.projectIds.filter(Boolean)));
  const labeled = await params.supabase
    .from("project_with_labels")
    .select("id, service_center_text")
    .eq("tenant_id", params.tenantId)
    .in("id", uniqueProjectIds)
    .returns<ProjectServiceCenterRow[]>();

  if (!labeled.error) {
    return new Map((labeled.data ?? []).map((item) => [item.id, normalizeText(item.service_center_text) || PROJECT_SERVICE_CENTER_FALLBACK]));
  }

  const { data, error } = await params.supabase
    .from("project")
    .select("id, service_center, service_center_text")
    .eq("tenant_id", params.tenantId)
    .in("id", uniqueProjectIds)
    .returns<ProjectServiceCenterRow[]>();

  if (error) {
    return new Map<string, string>();
  }

  const serviceCenterMap = new Map<string, string>();
  const lookupIds = Array.from(
    new Set(
      (data ?? [])
        .filter((item) => !normalizeText(item.service_center_text))
        .map((item) => normalizeUuid(item.service_center))
        .filter((item): item is string => Boolean(item)),
    ),
  );

  if (lookupIds.length) {
    const { data: lookups } = await params.supabase
      .from("project_service_centers")
      .select("id, name")
      .eq("tenant_id", params.tenantId)
      .in("id", lookupIds)
      .returns<ProjectServiceCenterLookupRow[]>();

    for (const item of lookups ?? []) {
      serviceCenterMap.set(item.id, normalizeText(item.name) || PROJECT_SERVICE_CENTER_FALLBACK);
    }
  }

  return new Map((data ?? []).map((item) => {
    const textValue = normalizeText(item.service_center_text);
    const lookupValue = normalizeUuid(item.service_center)
      ? serviceCenterMap.get(normalizeUuid(item.service_center) ?? "")
      : "";
    return [item.id, textValue || lookupValue || PROJECT_SERVICE_CENTER_FALLBACK];
  }));
}
