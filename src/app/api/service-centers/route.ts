import {
  handleCreateServiceCenter,
  handleGetServiceCenters,
  handleUpdateServiceCenter,
  handleUpdateServiceCenterStatus,
} from "@/server/modules/service-centers";

export const GET = handleGetServiceCenters;
export const POST = handleCreateServiceCenter;
export const PUT = handleUpdateServiceCenter;
export const PATCH = handleUpdateServiceCenterStatus;
