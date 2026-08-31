import { buildCsvContent } from "@/lib/utils/csv";
import { formatAuditActor, formatDateTime } from "@/lib/utils/formatters";

type ActivityTypeCsvItem = {
  name: string;
  isActive: boolean;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

export function buildActivityTypesCsv(activityTypes: ActivityTypeCsvItem[]) {
  return buildCsvContent(
    [
      "Nome",
      "Status",
      "Registrado por",
      "Registrado em",
      "Atualizado por",
      "Atualizado em",
    ],
    activityTypes.map((activityType) => [
      activityType.name,
      activityType.isActive ? "Ativo" : "Inativo",
      formatAuditActor(activityType.createdByName),
      formatDateTime(activityType.createdAt),
      formatAuditActor(activityType.updatedByName),
      formatDateTime(activityType.updatedAt),
    ]),
  );
}
