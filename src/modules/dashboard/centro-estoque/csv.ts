import { buildCsvContent } from "@/lib/utils/csv";
import { formatAuditActor, formatDateTime } from "@/lib/utils/formatters";

type StockCenterCsvItem = {
  name: string;
  description: string | null;
  isActive: boolean;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

export function buildStockCentersCsv(stockCenters: StockCenterCsvItem[]) {
  return buildCsvContent(
    [
      "Nome",
      "Descricao",
      "Status",
      "Registrado por",
      "Registrado em",
      "Atualizado por",
      "Atualizado em",
    ],
    stockCenters.map((center) => [
      center.name,
      center.description ?? "",
      center.isActive ? "Ativo" : "Inativo",
      formatAuditActor(center.createdByName),
      formatDateTime(center.createdAt),
      formatAuditActor(center.updatedByName),
      formatDateTime(center.updatedAt),
    ]),
  );
}
