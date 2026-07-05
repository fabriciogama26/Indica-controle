import { NextRequest } from "next/server";

import {
  handleWarehouseAddressDelete,
  handleWarehouseAddressPost,
  handleWarehouseMapGet,
} from "@/server/modules/warehouse-addressing/handlers";

export async function GET(request: NextRequest) {
  return handleWarehouseMapGet(request);
}

export async function POST(request: NextRequest) {
  return handleWarehouseAddressPost(request);
}

export async function DELETE(request: NextRequest) {
  return handleWarehouseAddressDelete(request);
}
