import {
  handleCreateContract,
  handleGetContracts,
  handleUpdateContract,
} from "@/server/modules/contracts";

export const GET = handleGetContracts;
export const POST = handleCreateContract;
export const PUT = handleUpdateContract;
