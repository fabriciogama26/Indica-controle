export type MeasurementStatus = "ABERTA" | "FECHADA" | "CANCELADA";
export type MeasurementKind = "COM_PRODUCAO" | "SEM_PRODUCAO";
export type ProgrammingMatchStatus = "PROGRAMADA" | "NAO_PROGRAMADA";
export type MeasurementExportType = "summary" | "details";

export type ProjectItem = {
  id: string;
  code: string;
  serviceName: string;
};

export type TeamItem = {
  id: string;
  name: string;
};

export type ActivityCatalogItem = {
  id: string;
  code: string;
  description: string;
  unit: string;
  unitValue: number;
  voicePoint: number;
};

export type ActivityCatalogResponse = {
  items?: ActivityCatalogItem[];
};

export type NoProductionReasonItem = {
  id: string;
  code: string;
  name: string;
};

export type ProjectServiceTypeItem = {
  id: string;
  name: string;
};

export type WorkCompletionCatalogItem = {
  code: string;
  label: string;
};

export type MeasurementMetaResponse = {
  projects?: ProjectItem[];
  teams?: TeamItem[];
  noProductionReasons?: NoProductionReasonItem[];
  projectServiceTypes?: ProjectServiceTypeItem[];
  workCompletionCatalog?: WorkCompletionCatalogItem[];
  message?: string;
};

export type MeasurementCountResponse = {
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

export type Filters = {
  startDate: string;
  endDate: string;
  projectId: string;
  teamId: string;
  serviceTypeId: string;
  activityId: string;
  status: "TODOS" | MeasurementStatus;
  measurementKind: "TODOS" | MeasurementKind;
  noProductionReasonId: string;
  programmingMatch: "TODOS" | ProgrammingMatchStatus;
  workCompletionStatus: "TODOS" | "NAO_INFORMADO" | string;
  completionAlert: "TODOS" | "SIM" | "NAO";
};

export type ExportProgress = {
  title: string;
  message: string;
  percent?: number;
};
