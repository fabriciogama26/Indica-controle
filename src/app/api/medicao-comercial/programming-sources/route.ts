import { NextRequest } from "next/server";

import { handleMeasurementProgrammingSourcesGet } from "@/server/modules/medicao/programmingSourcesHandler";
import { COMMERCIAL_MEASUREMENT_ROUTE_CONFIG } from "@/server/modules/medicao/routeConfig";

export async function GET(request: NextRequest) {
  return handleMeasurementProgrammingSourcesGet(request, COMMERCIAL_MEASUREMENT_ROUTE_CONFIG);
}
