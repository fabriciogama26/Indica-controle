// Tipos compartilhados da tela Composicao de Equipe.
// Extraidos do PageView para permitir componentes proprios do modulo sem
// crescer o arquivo, que segue acima do limite do guia de frontend.

export type ProjectOption = {
  id: string;
  code: string;
  serviceCenter: string;
  hasMeasurement?: boolean;
};

export type TeamOption = {
  id: string;
  name: string;
  vehiclePlate: string;
  serviceCenterName: string;
  foremanName: string;
};

export type PersonOption = {
  id: string;
  name: string;
  matriculation: string | null;
  cpf: string | null;
  phone: string | null;
  jobTitleName: string;
};

export type CompositionMember = {
  id?: string;
  personId: string;
  name: string;
  matriculation: string | null;
  cpf: string | null;
  phone: string | null;
  jobTitleName: string | null;
  isPresent: boolean;
  sortOrder?: number;
};

export type WorkStatus = "WORKING" | "NOT_WORKING";
export type WorkStatusFilter = "" | WorkStatus;

export type CompositionItem = {
  id: string;
  compositionDate: string;
  projectId: string | null;
  projectIds?: string[];
  projects?: ProjectOption[];
  teamId: string;
  projectCode: string;
  projectServiceCenter: string;
  teamName: string;
  vehiclePlate: string;
  foremanId: string | null;
  foremanName: string;
  workStatus: WorkStatus;
  sector: string;
  yard: string;
  startTime: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  createdByName: string;
  updatedByName: string;
  members: CompositionMember[];
};

export type MetaResponse = {
  projects?: ProjectOption[];
  teams?: TeamOption[];
  people?: PersonOption[];
  message?: string;
};

export type ListResponse = {
  compositions?: CompositionItem[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

export type DailyCoverageItem = {
  teamId: string;
  isCompleted: boolean;
  workStatus: WorkStatus | null;
};

export type DailyCoverageResponse = {
  coverageDate?: string;
  coverage?: DailyCoverageItem[];
  summary?: {
    total: number;
    completed: number;
    pending: number;
    notWorking: number;
  };
  message?: string;
};

export type SaveResponse = {
  success?: boolean;
  message?: string;
  composition?: CompositionItem | null;
  updatedAt?: string | null;
};

export type HistoryEntry = {
  id: string;
  changeType: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason: string | null;
  changes: Record<string, { from: string | null; to: string | null }>;
  createdAt: string;
  createdByName: string;
};

export type HistoryResponse = {
  history?: HistoryEntry[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

export type FormState = {
  id: string | null;
  expectedUpdatedAt: string | null;
  compositionDate: string;
  projectCode: string;
  projectIds: string[];
  teamId: string;
  foremanPersonId: string;
  workStatus: WorkStatus;
  sector: string;
  yard: string;
  startTime: string;
  notes: string;
  personSearch: string;
  members: CompositionMember[];
};

export type FilterState = {
  startDate: string;
  endDate: string;
  projectCode: string;
  teamId: string;
  workStatus: WorkStatusFilter;
  measurementStatus: "" | "UNMEASURED";
};
