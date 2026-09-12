import { buildCsvContent } from "@/lib/utils/csv";
import { formatAuditActor, formatDateTime } from "@/lib/utils/formatters";

type UtilityContactCsvItem = {
  name: string;
  telefoneCorporativo: string | null;
  email: string | null;
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
      "Telefone Corporativo",
      "E-mail",
      "Status",
      "Registrado por",
      "Registrado em",
      "Atualizado por",
      "Atualizado em",
    ],
    items.map((item) => [
      item.name,
      item.telefoneCorporativo ?? "",
      item.email ?? "",
      item.isActive ? "Ativo" : "Inativo",
      formatAuditActor(item.createdByName),
      formatDateTime(item.createdAt),
      formatAuditActor(item.updatedByName),
      formatDateTime(item.updatedAt),
    ]),
  );
}
