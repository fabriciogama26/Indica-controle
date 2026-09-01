import {
  handleCreateNoProductionReason,
  handleGetNoProductionReasons,
  handleUpdateNoProductionReason,
  handleUpdateNoProductionReasonStatus,
} from "@/server/modules/no-production-reasons";

export const GET = handleGetNoProductionReasons;
export const POST = handleCreateNoProductionReason;
export const PUT = handleUpdateNoProductionReason;
export const PATCH = handleUpdateNoProductionReasonStatus;
