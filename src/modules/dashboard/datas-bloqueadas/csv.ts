import { buildCsvContent } from "@/lib/utils/csv";
import { formatAuditActor, formatDateTime } from "@/lib/utils/formatters";

import { formatBlockedDateShort } from "./blockedDates";
import { BLOCKED_DATE_KIND_LABELS, BLOCKED_DATE_SCOPE_LABELS, type BlockedDateItem } from "./types";

export function buildBlockedDatesCsv(blockedDates: BlockedDateItem[]) {
  return buildCsvContent(
    [
      "Data",
      "Descricao",
      "Abrangencia",
      "Municipio",
      "Tipo",
      "Status",
      "Registrado por",
      "Registrado em",
      "Atualizado por",
      "Atualizado em",
    ],
    blockedDates.map((item) => [
      formatBlockedDateShort(item.blockedDate),
      item.description,
      BLOCKED_DATE_SCOPE_LABELS[item.scope] ?? item.scope,
      item.municipalityName || "-",
      BLOCKED_DATE_KIND_LABELS[item.kind] ?? item.kind,
      item.isActive ? "Ativo" : "Inativo",
      formatAuditActor(item.createdByName),
      formatDateTime(item.createdAt),
      formatAuditActor(item.updatedByName),
      formatDateTime(item.updatedAt),
    ]),
  );
}
