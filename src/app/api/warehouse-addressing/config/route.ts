import { NextRequest } from "next/server";

import { handleWarehouseConfigGet, handleWarehouseConfigPost } from "@/server/modules/warehouse-addressing/handlers";

export async function GET(request: NextRequest) {
  return handleWarehouseConfigGet(request);
}

export async function POST(request: NextRequest) {
  return handleWarehouseConfigPost(request);
}
