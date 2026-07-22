import { buildCsvContent } from "@/lib/utils/csv";

import {
  extractTextAfterDash,
  extractTextBeforeDash,
  formatDate,
  formatDateTime,
  formatExpectedHours,
  formatExpectedTimeAsClock,
  formatInfoStatusEtapa,
  formatStructureSummaryByCode,
  formatWeekday,
  formatWeekdayExecutionEnelNovo,
  getEnelStatusLabel,
  getStageClassificationLabel,
  getStageStatusLabel,
  getWorkCompletionLabel,
  isAreaLivreSgd,
  normalizeSgdNumberForExport,
  resolveEnelNovoPeriod,
  resolveTeamStructureCode,
  toExcelDateSerial,
} from "./utils";
import type { ElectricalEqCatalogItem, ProjectItem, SgdTypeItem, StageListItem, SupportOptionItem, TeamItem } from "./types";

type ExportContext = {
  stages: StageListItem[];
  projectMap: Map<string, ProjectItem>;
  teamMap: Map<string, TeamItem>;
  sgdTypeMap: Map<string, SgdTypeItem>;
  eqCatalogMap: Map<string, ElectricalEqCatalogItem>;
  supportOptionMap: Map<string, SupportOptionItem>;
};

function activeTeamsOf(stage: StageListItem) {
  return stage.teams.filter((team) => team.status === "ATIVA");
}

function resolveTeamItems(stage: StageListItem, teamMap: Map<string, TeamItem>) {
  return activeTeamsOf(stage)
    .map((team) => teamMap.get(team.teamId))
    .filter((team): team is TeamItem => Boolean(team));
}

function resolveSupportLabel(stage: StageListItem, supportOptionMap: Map<string, SupportOptionItem>) {
  if (stage.support.trim()) return stage.support.trim();
  if (stage.supportItemId) return supportOptionMap.get(stage.supportItemId)?.description ?? "";
  return "";
}

function resolveEqLabel(stage: StageListItem, eqCatalogMap: Map<string, ElectricalEqCatalogItem>) {
  if (!stage.electricalEqCatalogId) return "";
  const item = eqCatalogMap.get(stage.electricalEqCatalogId);
  return item ? `${item.code} - ${item.label}` : "";
}

function findDocumentNumber(stage: StageListItem, documentType: "SGD" | "PI" | "PEP") {
  return stage.documents.find((document) => document.documentType === documentType)?.number ?? "";
}

export function buildProgrammingCsvContent({ stages, projectMap, sgdTypeMap, eqCatalogMap, supportOptionMap }: ExportContext) {
  const header = [
    "Data execucao",
    "Projeto",
    "Municipio",
    "Equipes",
    "Hora inicio",
    "Hora termino",
    "Periodo",
    "No EQ",
    "Tipo de SGD",
    "Alimentador",
    "Inicio de desligamento",
    "Termino de desligamento",
    "Apoio",
    "Descricao do servico",
    "Status",
    "ETAPA",
    "Estado trabalho",
    "Nº Clientes afetados",
    "POSTE",
    "ESTRUTURA",
    "TRAFO",
    "REDE",
    "SGD",
    "PI",
    "PEP",
    "Motivo do cancelamento",
    "Criado por",
    "Criado em",
    "Atualizado por",
    "Atualizado em",
  ];

  const rows = stages.map((stage) => {
    const project = projectMap.get(stage.projectId);
    const teamNames = activeTeamsOf(stage).map((team) => team.teamName).join(" / ");
    const sgdType = stage.sgdTypeId ? sgdTypeMap.get(stage.sgdTypeId) : undefined;

    return [
      formatDate(stage.executionDate),
      stage.projectCode || project?.code || stage.projectId,
      stage.city || project?.city || "",
      teamNames,
      (stage.startTime ?? "").slice(0, 5),
      (stage.endTime ?? "").slice(0, 5),
      stage.period ?? "",
      resolveEqLabel(stage, eqCatalogMap),
      sgdType?.description ?? "",
      stage.feeder,
      (stage.outageStartTime ?? "").slice(0, 5),
      (stage.outageEndTime ?? "").slice(0, 5),
      resolveSupportLabel(stage, supportOptionMap),
      stage.serviceDescription,
      getStageStatusLabel(stage.status),
      getStageClassificationLabel(stage),
      getWorkCompletionLabel(stage.workCompletionStatus),
      stage.affectedCustomers ?? "",
      stage.posteQty,
      stage.estruturaQty,
      stage.trafoQty,
      stage.redeQty,
      findDocumentNumber(stage, "SGD"),
      findDocumentNumber(stage, "PI"),
      findDocumentNumber(stage, "PEP"),
      stage.cancellationReason,
      stage.createdByName,
      formatDateTime(stage.createdAt),
      stage.updatedByName,
      formatDateTime(stage.updatedAt),
    ];
  });

  return buildCsvContent(header, rows);
}

export function buildEnelCsvContent({ stages, projectMap, teamMap, sgdTypeMap, eqCatalogMap }: ExportContext) {
  const header = [
    "BASE",
    "Tipo de Serviço",
    "SOB",
    "Data Execução",
    "Dia da semana",
    "Período",
    "Hor Inic Obra",
    "Hor Térm Obra",
    "Tempo Previsto",
    "STATUS",
    "INFO STATUS",
    "PRIORIDADE",
    "Estrutura",
    "ENCARREGADO",
    "Apoio",
    "Data limite",
    "Responsáveis Enel",
    "Parceira",
    "Responsável Execução",
    "Tipo de SGD",
    "Nº Clientes Afetados",
    "SGD AT/MT/VyP",
    "SGD BT",
    "SGD TeT",
    "Nº EQ (RE, CO, CF, CC ou TR)",
    "Inic deslig",
    "Térm deslig",
    "Alim.",
    "Logradouro",
    "Bairro",
    "Município",
    "Descrição do serviço",
    "Motivo do Cancelamento",
    "Data da programação",
    "Trafo - kVA",
    "Observação",
    "Estado Trabalho",
    "PEP",
    "Serviço",
    "Mão de obra",
    "Gestor de campo",
  ];

  const exportStages = stages.filter((stage) => stage.status !== "CANCELADA");

  const rows = exportStages.map((stage) => {
    const project = projectMap.get(stage.projectId);
    const teamItems = resolveTeamItems(stage, teamMap);
    const sgdType = stage.sgdTypeId ? sgdTypeMap.get(stage.sgdTypeId) : undefined;
    const sgdExportColumn = (sgdType?.exportColumn ?? "").trim().toUpperCase();
    const sgdTypeDescription = (sgdType?.description ?? "").trim().toUpperCase();
    const isAreaLivre = sgdExportColumn === "AREA_LIVRE" || sgdExportColumn === "AREA LIVRE"
      || sgdTypeDescription === "AREA_LIVRE" || sgdTypeDescription === "AREA LIVRE";
    const isSgdBt = sgdExportColumn === "SGD_BT" || sgdExportColumn === "SGD BT" || sgdTypeDescription === "SGD_BT" || sgdTypeDescription === "SGD BT";
    const isSgdTet = sgdExportColumn === "SGD_TET" || sgdExportColumn === "SGD TET" || sgdTypeDescription === "SGD_TET" || sgdTypeDescription === "SGD TET";
    const isSgdAtMtVyp = !isAreaLivre && !isSgdBt && !isSgdTet;
    const eqLabel = resolveEqLabel(stage, eqCatalogMap);

    const codeCount: Record<string, number> = {};
    for (const team of teamItems) {
      const code = resolveTeamStructureCode(team);
      if (code) codeCount[code] = (codeCount[code] ?? 0) + 1;
    }

    const foremanNames = Array.from(new Set(teamItems.map((team) => team.foremanName).filter(Boolean))).sort((a, b) => a.localeCompare(b)).join(" / ");

    return [
      project?.base ?? "",
      project?.serviceType ?? "",
      stage.projectCode || project?.code || "",
      formatDate(stage.executionDate),
      formatWeekday(stage.executionDate ?? ""),
      stage.period ?? "",
      (stage.startTime ?? "").slice(0, 5),
      (stage.endTime ?? "").slice(0, 5),
      formatExpectedHours(stage.expectedMinutes),
      getEnelStatusLabel(stage.status),
      formatInfoStatusEtapa(stage.etapaNumber, stage.etapaUnica, stage.etapaFinal),
      project?.priority ?? "",
      formatStructureSummaryByCode(codeCount),
      foremanNames,
      stage.support,
      formatDate(project?.executionDeadline ?? ""),
      project?.utilityResponsible ?? "",
      project?.partner ?? "",
      "INDICA",
      sgdType?.description ?? "",
      stage.affectedCustomers ?? "",
      isSgdAtMtVyp ? eqLabel : "",
      isSgdBt ? eqLabel : "",
      isSgdTet ? eqLabel : "",
      eqLabel,
      (stage.outageStartTime ?? "").slice(0, 5),
      (stage.outageEndTime ?? "").slice(0, 5),
      stage.feeder,
      project?.street ?? "",
      project?.district ?? "",
      stage.city || project?.city || "",
      stage.serviceDescription,
      stage.cancellationReason,
      formatDate(stage.createdAt ? stage.createdAt.slice(0, 10) : ""),
      stage.trafoQty,
      stage.note,
      getWorkCompletionLabel(stage.workCompletionStatus),
      findDocumentNumber(stage, "PEP"),
      project?.serviceType ?? "",
      isAreaLivre ? "AREA LIVRE" : "",
      project?.utilityFieldManager ?? "",
    ];
  });

  return buildCsvContent(header, rows);
}

export function buildEnelNovoWorkbookData({ stages, projectMap, teamMap, sgdTypeMap, eqCatalogMap }: ExportContext) {
  const exportStages = stages.filter((stage) => {
    if (stage.status === "CANCELADA") return false;
    const project = projectMap.get(stage.projectId);
    return (project?.serviceType ?? "").trim().toUpperCase() !== "EMERGENCIAL";
  });

  const header = [
    "BASE",
    "Tipo de Serviço",
    "SOB",
    "Data Execução",
    "Dia da semana",
    "Período",
    "Hor Inic obra",
    "Hor Térm obra",
    "Tempo previsto",
    "STATUS",
    "INFO STATUS",
    "PRIORIDADE",
    "Estrutura",
    "Placa",
    "Anotação",
    "Apoio",
    "Responsáveis Ampla",
    "Parceira",
    "Responsável Execução",
    "AREA LIVRE",
    "SOLICITAÇÃO",
    "TIPO DE SGD",
    "NÚMERO SGD",
    "Nº Clientes Afetados",
    "Nº EQ (RE, CO,CF, CC ou TR)",
    "Inic deslig",
    "Térm deslig",
    "Alim",
    "Logradouro",
    "Bairro",
    "Município",
    "Descrição do serviço",
    "Motivo do cancelamento",
    "Data da programação",
    "BT / MT",
    "Tipo de rede",
    "Tipo de serviço",
    "Tipo de cabo",
    "Status rede",
    "km",
    "Tipo de equipamento",
    "Status equipamento",
    "Potência equipamento",
    "Qtd equipamentos",
    "Status poste",
    "Tipo poste",
    "Qtd Postes",
    "Qtd Clandestinos",
  ];

  const rows = exportStages.map((stage) => {
    const project = projectMap.get(stage.projectId);
    const teamItems = resolveTeamItems(stage, teamMap);
    const sgdType = stage.sgdTypeId ? sgdTypeMap.get(stage.sgdTypeId) : undefined;
    const isAreaLivre = isAreaLivreSgd(sgdType?.exportColumn, sgdType?.description);
    const teamLabels = Array.from(new Set(teamItems.map((team) => team.name).filter(Boolean))).sort((a, b) => a.localeCompare(b)).join("|");
    const plates = Array.from(new Set(teamItems.map((team) => team.vehiclePlate).filter(Boolean))).sort((a, b) => a.localeCompare(b)).join(" - ");

    return [
      extractTextAfterDash(project?.base ?? ""),
      project?.serviceType ?? "",
      stage.projectCode || project?.code || "",
      toExcelDateSerial(stage.executionDate),
      formatWeekdayExecutionEnelNovo(stage.executionDate ?? ""),
      resolveEnelNovoPeriod(stage.startTime, stage.endTime),
      (stage.startTime ?? "").slice(0, 5),
      (stage.endTime ?? "").slice(0, 5),
      formatExpectedTimeAsClock(stage.expectedMinutes),
      getEnelStatusLabel(stage.status),
      formatInfoStatusEtapa(stage.etapaNumber, stage.etapaUnica, stage.etapaFinal),
      project?.priority ?? "",
      teamLabels,
      plates,
      stage.note,
      stage.support,
      project?.utilityFieldManager ?? "",
      extractTextBeforeDash(project?.partner ?? ""),
      Array.from(new Set(teamItems.map((team) => team.foremanName).filter(Boolean))).sort((a, b) => a.localeCompare(b)).join(" / "),
      isAreaLivre ? "SIM" : "NAO",
      isAreaLivre ? "NAO" : "SIM",
      sgdType?.description ?? "",
      normalizeSgdNumberForExport(findDocumentNumber(stage, "SGD")),
      stage.affectedCustomers ?? "",
      resolveEqLabel(stage, eqCatalogMap),
      (stage.outageStartTime ?? "").slice(0, 5),
      (stage.outageEndTime ?? "").slice(0, 5),
      stage.feeder,
      project?.street ?? "",
      project?.district ?? "",
      stage.city || project?.city || "",
      stage.serviceDescription || project?.serviceName || "",
      stage.cancellationReason,
      formatDate(stage.createdAt ? stage.createdAt.slice(0, 10) : ""),
      "", // BT / MT
      "", // Tipo de rede
      "", // Tipo de serviço
      "", // Tipo de cabo
      "", // Status rede
      stage.redeQty || "", // km
      "", // Tipo de equipamento
      "", // Status equipamento
      "", // Potência equipamento
      "", // Qtd equipamentos
      "", // Status poste
      "", // Tipo poste
      stage.posteQty || "", // Qtd Postes
      "", // Qtd Clandestinos
    ];
  });

  return { header, rows, eligibleCount: exportStages.length };
}
