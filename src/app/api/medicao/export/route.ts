import { NextRequest } from "next/server";

import { DEFAULT_EXPORT_ROUTE_CONFIG, handleMeasurementExportGet } from "@/server/modules/medicao/exportHandler";

export async function GET(request: NextRequest) {
  return handleMeasurementExportGet(request, DEFAULT_EXPORT_ROUTE_CONFIG);
}
