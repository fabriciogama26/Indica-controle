import { NextRequest } from "next/server";

import { handleAsbuiltMeasurementExportGet } from "@/server/modules/medicao-asbuilt";

export async function GET(request: NextRequest) {
  return handleAsbuiltMeasurementExportGet(request);
}
