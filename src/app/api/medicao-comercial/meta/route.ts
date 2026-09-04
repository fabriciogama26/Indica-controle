import { NextRequest } from "next/server";

import { handleMeasurementMetaGet } from "@/server/modules/medicao/metaHandler";
import { COMMERCIAL_MEASUREMENT_ROUTE_CONFIG } from "@/server/modules/medicao/routeConfig";

export async function GET(request: NextRequest) {
  return handleMeasurementMetaGet(request, COMMERCIAL_MEASUREMENT_ROUTE_CONFIG);
}
