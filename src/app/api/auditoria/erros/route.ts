import { NextRequest } from "next/server";

import { getErrorLog } from "@/server/modules/auditoria/handlers";

export async function GET(request: NextRequest) {
  return getErrorLog(request);
}
