import { NextRequest } from "next/server";

import { handleMeasurementMinimumBillingGet } from "@/server/modules/medicao/minimumBillingHandler";
import { COMMERCIAL_MEASUREMENT_ROUTE_CONFIG } from "@/server/modules/medicao/routeConfig";

export async function GET(request: NextRequest) {
  return handleMeasurementMinimumBillingGet(request, COMMERCIAL_MEASUREMENT_ROUTE_CONFIG);
}
