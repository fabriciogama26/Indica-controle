import { escapeCsvValue } from "@/lib/utils/csv";
import { formatAuditActor, formatDateTime } from "@/lib/utils/formatters";
import { formatPoints } from "./formatters";

type ActivityCsvItem = {
  code: string;
  codeIdd: string;
  description: string;
  teamTypeName: string;
  categoryName: string;
  groupName: string;
  value: number;
  voicePoint: number | null;
  unit: string;
  scope: string;
  isActive: boolean;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

export function buildActivitiesCsv(activityItems: ActivityCsvItem[]) {
  const header = [
    "Codigo",
    "Cod. SAP",
    "Descricao",
    "Tipo",
    "Categoria",
    "Grupo",
    "Valor",
    "Pontos",
    "Unidade",
    "Alcance",
    "Status",
    "Registrado por",
    "Registrado em",
    "Atualizado por",
    "Atualizado em",
  ];
  const rows = activityItems.map((activity) => [
    activity.code,
    activity.codeIdd || "-",
    activity.description,
    activity.teamTypeName,
    activity.categoryName,
    activity.groupName || "",
    activity.value.toFixed(2),
    formatPoints(activity.voicePoint),
    activity.unit,
    activity.scope || "",
    activity.isActive ? "Ativo" : "Inativo",
    formatAuditActor(activity.createdByName),
    formatDateTime(activity.createdAt),
    formatAuditActor(activity.updatedByName),
    formatDateTime(activity.updatedAt),
  ]);

  const csvLines = [header, ...rows].map((line) => line.map((item) => escapeCsvValue(item)).join(";"));
  return `\uFEFF${csvLines.join("\n")}`;
}
