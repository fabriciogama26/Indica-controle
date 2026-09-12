import { NextRequest } from "next/server";

import { handleMeasurementRateSuggestionGet } from "@/server/modules/medicao/rateSuggestionHandler";
import { DEFAULT_MEASUREMENT_ROUTE_CONFIG } from "@/server/modules/medicao/routeConfig";

export async function GET(request: NextRequest) {
  return handleMeasurementRateSuggestionGet(request, DEFAULT_MEASUREMENT_ROUTE_CONFIG);
}
