import { NextRequest } from "next/server";

import { getAuditableScreens } from "@/server/modules/auditoria/handlers";

export async function GET(request: NextRequest) {
  return getAuditableScreens(request);
}
