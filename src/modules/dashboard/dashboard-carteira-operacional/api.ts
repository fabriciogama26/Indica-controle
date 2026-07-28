import { DASHBOARD_PORTFOLIO_ENDPOINT } from "./constants";
import type {
  DashboardPortfolioActivityForecastResponse,
  DashboardPortfolioFilters,
  DashboardPortfolioResponse,
} from "./types";

export async function fetchDashboardPortfolio(params: {
  accessToken: string;
  filters: DashboardPortfolioFilters;
}) {
  const searchParams = new URLSearchParams();
  if (params.filters.cycleStart) searchParams.set("cycleStart", params.filters.cycleStart);
  if (params.filters.project.trim()) searchParams.set("project", params.filters.project.trim());
  if (params.filters.serviceCenterId) searchParams.set("serviceCenterId", params.filters.serviceCenterId);
  if (params.filters.portfolioScope) searchParams.set("portfolioScope", params.filters.portfolioScope);

  const response = await fetch(`${DASHBOARD_PORTFOLIO_ENDPOINT}?${searchParams.toString()}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
    },
  });
  const data = (await response.json().catch(() => ({}))) as DashboardPortfolioResponse;

  if (!response.ok) {
    throw new Error(data.message ?? "Falha ao carregar Dashboard Carteira Operacional.");
  }

  return data;
}

export async function fetchDashboardPortfolioProjectActivities(params: {
  accessToken: string;
  projectId: string;
}) {
  const searchParams = new URLSearchParams({ projectId: params.projectId });
  const response = await fetch(`/api/projects/activity-forecast?${searchParams.toString()}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
    },
  });
  const data = (await response.json().catch(() => ({}))) as DashboardPortfolioActivityForecastResponse;

  if (!response.ok) {
    throw new Error(data.message ?? "Falha ao carregar atividades previstas do projeto.");
  }

  return data;
}
