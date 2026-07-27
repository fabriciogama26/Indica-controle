import { NextRequest } from "next/server";

import { handleDashboardPortfolioGet } from "@/server/modules/dashboard-portfolio";

export async function GET(request: NextRequest) {
  return handleDashboardPortfolioGet(request);
}
