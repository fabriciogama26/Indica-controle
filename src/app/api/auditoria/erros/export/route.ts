import { NextRequest } from "next/server";

import { exportErrorLogHandler } from "@/server/modules/auditoria/handlers";

export async function GET(request: NextRequest) {
  return exportErrorLogHandler(request);
}
