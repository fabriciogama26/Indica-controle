// Tipos, constantes e normalizadores da tela Equipes.
//
// Vieram de `TeamsPageView.tsx`, que ficou acima do baseline de linhas do
// CLAUDE.md ao ganhar o campo Tipo de Equipe. Sao dados puros, sem React.
import { DEFAULT_EXPORT_PAGE_SIZE, DEFAULT_HISTORY_PAGE_SIZE, DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { formatDateTime } from "@/lib/utils/formatters";

export type TeamFilterState = {
  name: string;
  vehiclePlate: string;
  serviceCenterId: string;
  teamTypeId: string;
  teamCategoryId: string;
  foremanId: string;
  supervisorId: string;
};

export const HISTORY_FIELD_LABELS: Record<string, string> = {
  name: "Nome da equipe",
  vehiclePlate: "Placa do veiculo",
  serviceCenterName: "Base",
  stockCenterName: "Centro de estoque proprio",
  teamTypeName: "Tipo de equipe",
  teamCategoryName: "Tipo operacional",
  foremanName: "Encarregado",
  supervisorName: "Supervisor",
  isActive: "Status",
  cancellationReason: "Motivo do cancelamento",
  canceledAt: "Data do cancelamento",
  activationReason: "Motivo da ativacao",
};

export const INITIAL_FILTERS: TeamFilterState = {
  name: "",
  vehiclePlate: "",
  serviceCenterId: "",
  teamTypeId: "",
  teamCategoryId: "",
  foremanId: "",
  supervisorId: "",
};

export function buildQuery(filters: TeamFilterState, page: number, pageSize = DEFAULT_PAGE_SIZE) {
  const params = new URLSearchParams();
  if (filters.name.trim()) {
    params.set("name", filters.name.trim());
  }
  if (filters.vehiclePlate.trim()) {
    params.set("vehiclePlate", filters.vehiclePlate.trim());
  }
  if (filters.serviceCenterId.trim()) {
    params.set("serviceCenterId", filters.serviceCenterId.trim());
  }
  if (filters.teamTypeId.trim()) {
    params.set("teamTypeId", filters.teamTypeId.trim());
  }
  if (filters.teamCategoryId.trim()) {
    params.set("teamCategoryId", filters.teamCategoryId.trim());
  }
  if (filters.foremanId.trim()) {
    params.set("foremanId", filters.foremanId.trim());
  }
  if (filters.supervisorId.trim()) {
    params.set("supervisorId", filters.supervisorId.trim());
  }
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return params.toString();
}

export function formatHistoryValue(field: string, value: string | null) {
  if (!value) {
    return "-";
  }

  if (field === "isActive") {
    return value === "true" ? "Ativo" : "Inativo";
  }

  if (field === "canceledAt") {
    return formatDateTime(value);
  }

  return value;
}


export type TeamItem = {
  id: string;
  name: string;
  vehiclePlate: string;
  serviceCenterId: string | null;
  serviceCenterName: string;
  stockCenterId: string | null;
  stockCenterName: string;
  teamTypeId: string;
  teamTypeName: string;
  teamCategoryId: string;
  teamCategoryCode: string;
  teamCategoryName: string;
  foremanId: string | null;
  foremanName: string;
  supervisorId: string | null;
  supervisorName: string;
  isActive: boolean;
  cancellationReason: string | null;
  canceledAt: string | null;
  canceledByName: string | null;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

export type TeamHistoryEntry = {
  id: string;
  changeType: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason: string | null;
  createdAt: string;
  createdByName: string;
  changes: Record<string, { from: string | null; to: string | null }>;
};

export type ForemanOption = {
  id: string;
  name: string;
};

export type SupervisorOption = ForemanOption;

export type TeamTypeOption = {
  id: string;
  name: string;
  teamCategoryId: string | null;
};

export type TeamCategoryOption = {
  id: string;
  code: string;
  name: string;
};

export type ServiceCenterOption = {
  id: string;
  name: string;
};

export type TeamFormState = {
  id: string | null;
  name: string;
  vehiclePlate: string;
  serviceCenterId: string;
  teamTypeId: string;
  teamCategoryId: string;
  foremanId: string;
  supervisorId: string;
  updatedAt: string;
};

export type TeamsListResponse = {
  teams?: TeamItem[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

export type TeamsMetaResponse = {
  foremen?: ForemanOption[];
  supervisors?: SupervisorOption[];
  teamTypes?: TeamTypeOption[];
  teamCategories?: TeamCategoryOption[];
  serviceCenters?: ServiceCenterOption[];
  message?: string;
};

export type TeamHistoryResponse = {
  history?: TeamHistoryEntry[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};


export const PAGE_SIZE = DEFAULT_PAGE_SIZE;
export const HISTORY_PAGE_SIZE = DEFAULT_HISTORY_PAGE_SIZE;
export const EXPORT_PAGE_SIZE = DEFAULT_EXPORT_PAGE_SIZE;

export const INITIAL_FORM: TeamFormState = {
  id: null,
  name: "",
  vehiclePlate: "",
  serviceCenterId: "",
  teamTypeId: "",
  teamCategoryId: "",
  foremanId: "",
  supervisorId: "",
  updatedAt: "",
};

export function normalizeText(value: string) {
  return String(value ?? "").trim();
}

export function normalizePlate(value: string) {
  return normalizeText(value).toUpperCase();
}

export function scrollDashboardContentToTop() {
  if (typeof window === "undefined") {
    return;
  }

  const content = document.querySelector<HTMLElement>('[data-main-content-scroll="true"]');
  if (content) {
    content.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

/**
 * Pre-requisitos de cadastro que faltam para o formulario de Equipes.
 *
 * Depende do tipo operacional escolhido: TECNICA exige encarregado, COMERCIAL
 * exige supervisor, e o tipo de equipe so e cobrado depois da escolha -- antes
 * disso nao da para saber se falta, porque o tenant pode ter tipos so de um
 * dos lados.
 */
export function buildMissingTeamMetaReasons(params: {
  isLoadingMeta: boolean;
  serviceCenterCount: number;
  teamCategoryCount: number;
  teamTypeOptionCount: number;
  foremanCount: number;
  supervisorCount: number;
  selectedTeamCategoryId: string;
  isTechnicalCategory: boolean;
  isCommercialCategory: boolean;
}) {
  if (params.isLoadingMeta) {
    return [] as string[];
  }

  const reasons: string[] = [];
  if (params.serviceCenterCount === 0) reasons.push("Base (Centro de Servico)");
  if (params.teamCategoryCount === 0) reasons.push("Tipo operacional");
  if (params.selectedTeamCategoryId && params.teamTypeOptionCount === 0) {
    reasons.push("Tipo de equipe para este tipo operacional");
  }
  if (params.isTechnicalCategory && params.foremanCount === 0) reasons.push("Encarregado");
  if (params.isCommercialCategory && params.supervisorCount === 0) reasons.push("Supervisor");
  return reasons;
}
