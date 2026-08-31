import { buildCsvContent } from "@/lib/utils/csv";
import { formatAuditActor, formatDateTime } from "@/lib/utils/formatters";

type ActivityGroupCsvItem = {
  name: string;
  isActive: boolean;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

export function buildActivityGroupsCsv(activityGroups: ActivityGroupCsvItem[]) {
  return buildCsvContent(
    [
      "Nome",
      "Status",
      "Registrado por",
      "Registrado em",
      "Atualizado por",
      "Atualizado em",
    ],
    activityGroups.map((activityGroup) => [
      activityGroup.name,
      activityGroup.isActive ? "Ativo" : "Inativo",
      formatAuditActor(activityGroup.createdByName),
      formatDateTime(activityGroup.createdAt),
      formatAuditActor(activityGroup.updatedByName),
      formatDateTime(activityGroup.updatedAt),
    ]),
  );
}
