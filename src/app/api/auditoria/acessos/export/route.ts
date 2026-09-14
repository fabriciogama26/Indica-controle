import { NextRequest } from "next/server";

import { exportAccessLogHandler } from "@/server/modules/auditoria/handlers";

export async function GET(request: NextRequest) {
  return exportAccessLogHandler(request);
}
