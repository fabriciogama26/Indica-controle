import { NextRequest } from "next/server";

import { handleDashboardMeasurementGet } from "@/server/modules/dashboard-measurement";

export async function GET(request: NextRequest) {
  return handleDashboardMeasurementGet(request, "dashboard-equipes");
}
