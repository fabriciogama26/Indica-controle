import { buildCsvContent } from "@/lib/utils/csv";
import { formatAuditActor, formatDateTime } from "@/lib/utils/formatters";

type MunicipalityCsvItem = {
  name: string;
  isActive: boolean;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

export function buildMunicipalitiesCsv(municipalities: MunicipalityCsvItem[]) {
  return buildCsvContent(
    [
      "Nome",
      "Status",
      "Registrado por",
      "Registrado em",
      "Atualizado por",
      "Atualizado em",
    ],
    municipalities.map((municipality) => [
      municipality.name,
      municipality.isActive ? "Ativo" : "Inativo",
      formatAuditActor(municipality.createdByName),
      formatDateTime(municipality.createdAt),
      formatAuditActor(municipality.updatedByName),
      formatDateTime(municipality.updatedAt),
    ]),
  );
}
