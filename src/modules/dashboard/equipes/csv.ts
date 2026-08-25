import { escapeCsvValue } from "@/lib/utils/csv";
import { formatAuditActor, formatDateTime } from "@/lib/utils/formatters";

type TeamCsvItem = {
  name: string;
  vehiclePlate: string;
  serviceCenterName: string;
  stockCenterName: string;
  teamTypeName: string;
  foremanName: string;
  supervisorName: string;
  isActive: boolean;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

export function buildTeamsCsv(teamItems: TeamCsvItem[]) {
  const header = [
    "Nome da equipe",
    "Placa do veiculo",
    "Base",
    "Centro de estoque proprio",
    "Tipo",
    "Encarregado",
    "Supervisor",
    "Status",
    "Registrado por",
    "Registrado em",
    "Atualizado por",
    "Atualizado em",
  ];
  const rows = teamItems.map((team) => [
    team.name,
    team.vehiclePlate,
    team.serviceCenterName,
    team.stockCenterName,
    team.teamTypeName,
    team.foremanName,
    team.supervisorName,
    team.isActive ? "Ativo" : "Inativo",
    formatAuditActor(team.createdByName),
    formatDateTime(team.createdAt),
    formatAuditActor(team.updatedByName),
    formatDateTime(team.updatedAt),
  ]);

  const csvLines = [header, ...rows].map((line) => line.map((item) => escapeCsvValue(item)).join(";"));
  return `\uFEFF${csvLines.join("\n")}`;
}
