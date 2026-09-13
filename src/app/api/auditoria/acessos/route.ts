import { NextRequest } from "next/server";

import { getAccessLog } from "@/server/modules/auditoria/handlers";

export async function GET(request: NextRequest) {
  return getAccessLog(request);
}
