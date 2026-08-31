import {
  handleCreateTeamType,
  handleGetTeamTypes,
  handleUpdateTeamType,
  handleUpdateTeamTypeStatus,
} from "@/server/modules/team-types";

export const GET = handleGetTeamTypes;
export const POST = handleCreateTeamType;
export const PUT = handleUpdateTeamType;
export const PATCH = handleUpdateTeamTypeStatus;
