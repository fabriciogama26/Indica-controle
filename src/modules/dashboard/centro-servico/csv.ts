import { buildCsvContent } from "@/lib/utils/csv";
import { formatAuditActor, formatDateTime } from "@/lib/utils/formatters";

type ServiceCenterCsvItem = {
  name: string;
  isActive: boolean;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

export function buildServiceCentersCsv(serviceCenters: ServiceCenterCsvItem[]) {
  return buildCsvContent(
    [
      "Nome",
      "Status",
      "Registrado por",
      "Registrado em",
      "Atualizado por",
      "Atualizado em",
    ],
    serviceCenters.map((serviceCenter) => [
      serviceCenter.name,
      serviceCenter.isActive ? "Ativo" : "Inativo",
      formatAuditActor(serviceCenter.createdByName),
      formatDateTime(serviceCenter.createdAt),
      formatAuditActor(serviceCenter.updatedByName),
      formatDateTime(serviceCenter.updatedAt),
    ]),
  );
}
