import { NextRequest } from "next/server";

import { getChangeHistory } from "@/server/modules/auditoria/handlers";

export async function GET(request: NextRequest) {
  return getChangeHistory(request);
}
