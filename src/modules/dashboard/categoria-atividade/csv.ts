import { buildCsvContent } from "@/lib/utils/csv";
import { formatAuditActor, formatDateTime } from "@/lib/utils/formatters";

type ActivityCategoryCsvItem = {
  name: string;
  isActive: boolean;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

export function buildActivityCategoriesCsv(activityCategories: ActivityCategoryCsvItem[]) {
  return buildCsvContent(
    [
      "Nome",
      "Status",
      "Registrado por",
      "Registrado em",
      "Atualizado por",
      "Atualizado em",
    ],
    activityCategories.map((activityCategory) => [
      activityCategory.name,
      activityCategory.isActive ? "Ativo" : "Inativo",
      formatAuditActor(activityCategory.createdByName),
      formatDateTime(activityCategory.createdAt),
      formatAuditActor(activityCategory.updatedByName),
      formatDateTime(activityCategory.updatedAt),
    ]),
  );
}
