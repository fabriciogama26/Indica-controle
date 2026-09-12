import {
  handleCreateStockCenter,
  handleGetStockCenters,
  handleUpdateStockCenter,
  handleUpdateStockCenterStatus,
} from "@/server/modules/stock-centers";

export const GET = handleGetStockCenters;
export const POST = handleCreateStockCenter;
export const PUT = handleUpdateStockCenter;
export const PATCH = handleUpdateStockCenterStatus;
