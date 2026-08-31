import {
  handleCreateActivityGroup,
  handleGetActivityGroups,
  handleUpdateActivityGroup,
  handleUpdateActivityGroupStatus,
} from "@/server/modules/activity-groups";

export const GET = handleGetActivityGroups;
export const POST = handleCreateActivityGroup;
export const PUT = handleUpdateActivityGroup;
export const PATCH = handleUpdateActivityGroupStatus;
