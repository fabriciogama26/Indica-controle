import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { formatDateTime } from "@/lib/utils/formatters";

export type TeamFilterState = {
  name: string;
  vehiclePlate: string;
  serviceCenterId: string;
  teamTypeId: string;
  foremanId: string;
  supervisorId: string;
};

export const HISTORY_FIELD_LABELS: Record<string, string> = {
  name: "Nome da equipe",
  vehiclePlate: "Placa do veiculo",
  serviceCenterName: "Base",
  stockCenterName: "Centro de estoque proprio",
  teamTypeName: "Tipo",
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

