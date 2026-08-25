import { escapeCsvValue } from "@/lib/utils/csv";
import { formatAuditActor, formatDateTime } from "@/lib/utils/formatters";

type JobTitleCsvItem = {
  code: string;
  name: string;
  activeTypeNames: string[];
  activeLevelNames: string[];
  isActive: boolean;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

export function buildJobTitlesCsv(jobTitles: JobTitleCsvItem[]) {
  const header = [
    "Codigo",
    "Nome",
    "Tipos ativos",
    "Niveis ativos",
    "Status",
    "Registrado por",
    "Registrado em",
    "Atualizado por",
    "Atualizado em",
  ];
  const rows = jobTitles.map((jobTitle) => [
    jobTitle.code,
    jobTitle.name,
    jobTitle.activeTypeNames.join(", "),
    jobTitle.activeLevelNames.join(", "),
    jobTitle.isActive ? "Ativo" : "Inativo",
    formatAuditActor(jobTitle.createdByName),
    formatDateTime(jobTitle.createdAt),
    formatAuditActor(jobTitle.updatedByName),
    formatDateTime(jobTitle.updatedAt),
  ]);

  const csvLines = [header, ...rows].map((line) => line.map((item) => escapeCsvValue(item)).join(";"));
  return `\uFEFF${csvLines.join("\n")}`;
}
