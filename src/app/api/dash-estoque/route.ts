import { NextRequest } from "next/server";

import { handleStockDashboardGet } from "@/server/modules/dash-estoque";

export async function GET(request: NextRequest) {
  return handleStockDashboardGet(request);
}
