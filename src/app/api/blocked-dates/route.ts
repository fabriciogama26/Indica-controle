import {
  handleCreateBlockedDate,
  handleGetBlockedDates,
  handleUpdateBlockedDate,
  handleUpdateBlockedDateStatus,
} from "@/server/modules/blocked-dates";

export const GET = handleGetBlockedDates;
export const POST = handleCreateBlockedDate;
export const PUT = handleUpdateBlockedDate;
export const PATCH = handleUpdateBlockedDateStatus;
