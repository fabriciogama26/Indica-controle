import { DASHBOARD_TEAMS_ENDPOINT } from "./constants";
import type { DashboardTeamsFilters, DashboardTeamsResponse } from "./types";

export async function fetchDashboardTeams(params: {
  accessToken: string;
  filters: DashboardTeamsFilters;
}) {
  const searchParams = new URLSearchParams();
  if (params.filters.cycleStart) searchParams.set("cycleStart", params.filters.cycleStart);
  if (params.filters.startDate) searchParams.set("startDate", params.filters.startDate);
  if (params.filters.endDate) searchParams.set("endDate", params.filters.endDate);
  if (params.filters.project.trim()) searchParams.set("project", params.filters.project.trim());
  if (params.filters.teamId) searchParams.set("teamId", params.filters.teamId);
  if (params.filters.foreman) searchParams.set("foreman", params.filters.foreman);
  if (params.filters.supervisorId) searchParams.set("supervisorId", params.filters.supervisorId);

  const response = await fetch(`${DASHBOARD_TEAMS_ENDPOINT}?${searchParams.toString()}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
    },
  });
  const data = (await response.json().catch(() => ({}))) as DashboardTeamsResponse;

  if (!response.ok) {
    throw new Error(data.message ?? "Falha ao carregar Dashboard Equipes.");
  }

  return data;
}
