import { NextRequest } from "next/server";

import { handleMeasurementActivitiesCatalogGet } from "@/server/modules/medicao/activitiesCatalogHandler";
import { DEFAULT_MEASUREMENT_ROUTE_CONFIG } from "@/server/modules/medicao/routeConfig";

export async function GET(request: NextRequest) {
  return handleMeasurementActivitiesCatalogGet(request, DEFAULT_MEASUREMENT_ROUTE_CONFIG);
}
