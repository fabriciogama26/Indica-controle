import { buildCsvContent } from "@/lib/utils/csv";
import { formatAuditActor, formatDateTime } from "@/lib/utils/formatters";

type UtilityContactCsvItem = {
  name: string;
  isActive: boolean;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

export function buildUtilityContactsCsv(items: UtilityContactCsvItem[]) {
  return buildCsvContent(
    [
      "Nome",
      "Status",
      "Registrado por",
      "Registrado em",
      "Atualizado por",
      "Atualizado em",
    ],
    items.map((item) => [
      item.name,
      item.isActive ? "Ativo" : "Inativo",
      formatAuditActor(item.createdByName),
      formatDateTime(item.createdAt),
      formatAuditActor(item.updatedByName),
      formatDateTime(item.updatedAt),
    ]),
  );
}
