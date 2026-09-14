import { NextRequest } from "next/server";

import { exportChangeHistoryHandler } from "@/server/modules/auditoria/handlers";

export async function GET(request: NextRequest) {
  return exportChangeHistoryHandler(request);
}
