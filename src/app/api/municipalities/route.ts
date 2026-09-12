import {
  handleCreateMunicipality,
  handleGetMunicipalities,
  handleUpdateMunicipality,
  handleUpdateMunicipalityStatus,
} from "@/server/modules/municipalities";

export const GET = handleGetMunicipalities;
export const POST = handleCreateMunicipality;
export const PUT = handleUpdateMunicipality;
export const PATCH = handleUpdateMunicipalityStatus;
