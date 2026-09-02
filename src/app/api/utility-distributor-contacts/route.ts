import {
  handleCreateUtilityDistributorContact,
  handleGetUtilityDistributorContacts,
  handleUpdateUtilityDistributorContact,
  handleUpdateUtilityDistributorContactStatus,
} from "@/server/modules/utility-distributor-contacts";

export const GET = handleGetUtilityDistributorContacts;
export const POST = handleCreateUtilityDistributorContact;
export const PUT = handleUpdateUtilityDistributorContact;
export const PATCH = handleUpdateUtilityDistributorContactStatus;
