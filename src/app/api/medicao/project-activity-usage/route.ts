import { NextRequest } from "next/server";

import { handleMeasurementProjectActivityUsageGet } from "@/server/modules/medicao/projectActivityUsageHandler";
import { DEFAULT_MEASUREMENT_ROUTE_CONFIG } from "@/server/modules/medicao/routeConfig";

export async function GET(request: NextRequest) {
  return handleMeasurementProjectActivityUsageGet(request, DEFAULT_MEASUREMENT_ROUTE_CONFIG);
}
