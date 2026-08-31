import {
  handleCreateActivityType,
  handleGetActivityTypes,
  handleUpdateActivityType,
  handleUpdateActivityTypeStatus,
} from "@/server/modules/activity-types";

export const GET = handleGetActivityTypes;
export const POST = handleCreateActivityType;
export const PUT = handleUpdateActivityType;
export const PATCH = handleUpdateActivityTypeStatus;
