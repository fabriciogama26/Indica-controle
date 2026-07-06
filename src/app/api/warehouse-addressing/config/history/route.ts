import { NextRequest } from "next/server";

import { handleWarehouseConfigHistoryGet } from "@/server/modules/warehouse-addressing/handlers";

export async function GET(request: NextRequest) {
  return handleWarehouseConfigHistoryGet(request);
}
