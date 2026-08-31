import {
  handleCreateActivityCategory,
  handleGetActivityCategories,
  handleUpdateActivityCategory,
  handleUpdateActivityCategoryStatus,
} from "@/server/modules/activity-categories";

export const GET = handleGetActivityCategories;
export const POST = handleCreateActivityCategory;
export const PUT = handleUpdateActivityCategory;
export const PATCH = handleUpdateActivityCategoryStatus;
