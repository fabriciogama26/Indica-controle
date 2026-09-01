import { buildCsvContent } from "@/lib/utils/csv";
import { formatAuditActor, formatDateTime } from "@/lib/utils/formatters";

type NoProductionReasonCsvItem = {
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

export function buildNoProductionReasonsCsv(reasons: NoProductionReasonCsvItem[]) {
  return buildCsvContent(
    [
      "Codigo",
      "Nome",
      "Ordem",
      "Status",
      "Registrado por",
      "Registrado em",
      "Atualizado por",
      "Atualizado em",
    ],
    reasons.map((reason) => [
      reason.code,
      reason.name,
      String(reason.sortOrder),
      reason.isActive ? "Ativo" : "Inativo",
      formatAuditActor(reason.createdByName),
      formatDateTime(reason.createdAt),
      formatAuditActor(reason.updatedByName),
      formatDateTime(reason.updatedAt),
    ]),
  );
}
