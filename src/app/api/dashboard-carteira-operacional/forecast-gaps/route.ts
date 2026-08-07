import { NextRequest } from "next/server";

import { handleDashboardPortfolioForecastGapsGet } from "@/server/modules/dashboard-portfolio";

export async function GET(request: NextRequest) {
  return handleDashboardPortfolioForecastGapsGet(request);
}
