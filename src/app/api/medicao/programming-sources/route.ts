import { NextRequest } from "next/server";

import { handleMeasurementProgrammingSourcesGet } from "@/server/modules/medicao/programmingSourcesHandler";
import { DEFAULT_MEASUREMENT_ROUTE_CONFIG } from "@/server/modules/medicao/routeConfig";

export async function GET(request: NextRequest) {
  return handleMeasurementProgrammingSourcesGet(request, DEFAULT_MEASUREMENT_ROUTE_CONFIG);
}
