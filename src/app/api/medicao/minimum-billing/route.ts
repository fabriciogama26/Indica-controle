import { NextRequest } from "next/server";

import { handleMeasurementMinimumBillingGet } from "@/server/modules/medicao/minimumBillingHandler";
import { DEFAULT_MEASUREMENT_ROUTE_CONFIG } from "@/server/modules/medicao/routeConfig";

export async function GET(request: NextRequest) {
  return handleMeasurementMinimumBillingGet(request, DEFAULT_MEASUREMENT_ROUTE_CONFIG);
}
