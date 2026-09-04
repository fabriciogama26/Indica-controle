import { buildCsvContent } from "@/lib/utils/csv";
import { formatAuditActor, formatDateTime } from "@/lib/utils/formatters";

type TeamTypeCsvItem = {
  name: string;
  teamCategoryName: string;
  isActive: boolean;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

export function buildTeamTypesCsv(teamTypes: TeamTypeCsvItem[]) {
  return buildCsvContent(
    [
      "Nome",
      "Tipo operacional",
      "Status",
      "Registrado por",
      "Registrado em",
      "Atualizado por",
      "Atualizado em",
    ],
    teamTypes.map((teamType) => [
      teamType.name,
      teamType.teamCategoryName,
      teamType.isActive ? "Ativo" : "Inativo",
      formatAuditActor(teamType.createdByName),
      formatDateTime(teamType.createdAt),
      formatAuditActor(teamType.updatedByName),
      formatDateTime(teamType.updatedAt),
    ]),
  );
}
