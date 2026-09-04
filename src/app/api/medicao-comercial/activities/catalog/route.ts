import { NextRequest } from "next/server";

import { handleMeasurementActivitiesCatalogGet } from "@/server/modules/medicao/activitiesCatalogHandler";
import { COMMERCIAL_MEASUREMENT_ROUTE_CONFIG } from "@/server/modules/medicao/routeConfig";

export async function GET(request: NextRequest) {
  return handleMeasurementActivitiesCatalogGet(request, COMMERCIAL_MEASUREMENT_ROUTE_CONFIG);
}
