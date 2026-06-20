import type { ProjectItem, ScheduleItem, TeamItem } from "./types";
import {
  escapeCsvValue,
  extractTextAfterDash,
  extractTextBeforeDash,
  formatAuditActor,
  formatDate,
  formatDateExecutionEnelNovo,
  formatDateTime,
  formatExpectedHours,
  formatExpectedTimeAsClock,
  formatInfoStatusEtapa,
  formatStructureSummaryByCode,
  formatWeekday,
  formatWeekdayExecutionEnelNovo,
  getDisplayProgrammingStatus,
  isAreaLivreSgd,
  normalizeSgdNumberForExport,
  resolveEnelNovoPeriod,
  resolveEnelNovoStatus,
  resolveScheduleTeamInfo,
  resolveTeamStructureCode,
} from "./utils";

type CsvValue = string | number;

type DeadlineExportItem = {
  sob: string;
  serviceCenter: string;
  priority: string;
  workType: string;
  executionDeadline: string;
  latestProgrammingDate: string;
  reason: string;
  workCompletionStatus: string;
  statusLabel: string;
  daysDiff: number;
  rangeLabel: string;
};

type ExportContext = {
  schedules: ScheduleItem[];
  projectMap: Map<string, ProjectItem>;
  teamMap: Map<string, TeamItem>;
};

function buildCsvContent(header: CsvValue[], rows: CsvValue[][]) {
  const csvLines = [header, ...rows].map((line) => line.map((item) => escapeCsvValue(item)).join(";"));
  return `\uFEFF${csvLines.join("\n")}`;
}

export function buildDeadlineCsvContent(params: {
  items: DeadlineExportItem[];
  deadlineWindowDays: number;
}) {
  const header = [
    "SOB",
    "Centro de servico",
    "Prioridade",
    "Tipo de obra",
    "Data limite",
    "Data Programacao",
    "Motivo",
    "Estado Trabalho",
    "Status do prazo",
    "Dias para vencimento",
    "Faixa",
    "Janela selecionada",
  ];
  const rows = params.items.map((item) => [
    item.sob,
    item.serviceCenter,
    item.priority,
    item.workType,
    formatDate(item.executionDeadline),
    item.latestProgrammingDate ? formatDate(item.latestProgrammingDate) : "",
    item.reason,
    item.workCompletionStatus,
    item.statusLabel,
    item.daysDiff,
    item.rangeLabel,
    `${params.deadlineWindowDays} dias`,
  ]);

  return buildCsvContent(header, rows);
}

export function buildProgrammingCsvContent({ schedules, projectMap, teamMap }: ExportContext) {
  const header = [
    "Data execucao",
    "Projeto",
    "Equipe",
    "Base",
    "Hora inicio",
    "Hora termino",
    "Periodo",
    "Nº EQ - Numero",
    "Tipo de SGD",
    "Alimentador",
    "Inicio de desligamento",
    "Termino de desligamento",
    "Apoio",
    "Descricao do servico",
    "Status",
    "Motivo do status",
    "Status alterado em",
    "POSTE",
    "ESTRUTURA",
    "TRAFO",
    "REDE",
    "ETAPA",
    "Estado trabalho",
    "Nº Clientes afetados",
    "SGD",
    "PI",
    "PEP",
    "Criado por",
    "Criado em",
    "Atualizado por",
    "Atualizado em",
  ];

  const rows = schedules.map((schedule) => {
    const project = projectMap.get(schedule.projectId);
    const team = resolveScheduleTeamInfo(schedule, teamMap);
    const displayStatus = getDisplayProgrammingStatus(schedule);

    return [
      formatDate(schedule.date),
      project?.code ?? schedule.projectId,
      team.name,
      team.serviceCenterName ?? "-",
      schedule.startTime,
      schedule.endTime,
      schedule.period === "integral" ? "Integral" : "Parcial",
      schedule.electricalField || "",
      schedule.sgdTypeDescription || "",
      schedule.feeder || "",
      schedule.outageStartTime || "",
      schedule.outageEndTime || "",
      schedule.support || "",
      schedule.serviceDescription || "",
      displayStatus,
      schedule.statusReason || "",
      formatDateTime(schedule.statusChangedAt ?? ""),
      schedule.posteQty,
      schedule.estruturaQty,
      schedule.trafoQty,
      schedule.redeQty,
      schedule.etapaNumber ?? "",
      schedule.workCompletionStatus ?? "",
      schedule.affectedCustomers,
      schedule.documents?.sgd?.number ?? "",
      schedule.documents?.pi?.number ?? "",
      schedule.documents?.pep?.number ?? "",
      formatAuditActor(schedule.createdByName),
      formatDateTime(schedule.createdAt),
      formatAuditActor(schedule.updatedByName),
      formatDateTime(schedule.updatedAt),
    ];
  });

  return buildCsvContent(header, rows);
}

export function buildEnelCsvContent({ schedules, projectMap, teamMap }: ExportContext) {
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
    "Motivo do Cancelamento / Parcial / Adiamento",
    "Observação do Cancelamento / Parcial / Adiamento",
    "Data da programação",
    "Trafo - kVA",
    "Observação",
    "Estado Trabalho",
    "Data Energização",
    "PEP",
    "Serviço",
    "COM INSTALAÇÃO DE MEDIDOR?",
    "OBSERVAÇÃO SOBRE PADRÃO DO CLIENTE",
    "Mão de obra",
    "Gestor de campo",
  ];

  const groupedAccumulator = new Map<string, {
    baseSchedule: ScheduleItem;
    schedules: ScheduleItem[];
    codeCount: Record<string, number>;
    foremanNames: Set<string>;
  }>();

  for (const schedule of schedules) {
    const project = projectMap.get(schedule.projectId);
    const key = buildEnelNovoGroupKey(schedule, project);
    const current = groupedAccumulator.get(key) ?? {
      baseSchedule: schedule,
      schedules: [],
      codeCount: {},
      foremanNames: new Set<string>(),
    };

    current.schedules.push(schedule);

    const team = resolveScheduleTeamInfo(schedule, teamMap);
    const foremanName = String(team.foremanName ?? "").trim();
    if (foremanName) {
      current.foremanNames.add(foremanName);
    }

    const teamCode = resolveTeamStructureCode(team);
    if (teamCode) {
      current.codeCount[teamCode] = (current.codeCount[teamCode] ?? 0) + 1;
    }

    groupedAccumulator.set(key, current);
  }

  const rows = Array.from(groupedAccumulator.values()).map((group) => {
    const schedule = group.baseSchedule;
    const project = projectMap.get(schedule.projectId);
    const displayStatus = getDisplayProgrammingStatus(schedule);
    const periodLabel = schedule.period === "integral" ? "INTEGRAL" : "PARCIAL";
    const sgdExportValue = schedule.electricalField ?? "";
    const sgdExportColumn = (schedule.sgdExportColumn ?? "").trim().toUpperCase();
    const sgdTypeDescription = (schedule.sgdTypeDescription ?? "").trim().toUpperCase();
    const isAreaLivreSgdType = sgdExportColumn === "AREA_LIVRE" || sgdExportColumn === "AREA LIVRE"
      || sgdTypeDescription === "AREA_LIVRE" || sgdTypeDescription === "AREA LIVRE";
    const isSgdBt = sgdExportColumn === "SGD_BT" || sgdExportColumn === "SGD BT"
      || sgdTypeDescription === "SGD_BT" || sgdTypeDescription === "SGD BT";
    const isSgdTet = sgdExportColumn === "SGD_TET" || sgdExportColumn === "SGD TET"
      || sgdTypeDescription === "SGD_TET" || sgdTypeDescription === "SGD TET"
      || sgdTypeDescription === "SGD TET";
    const isSgdAtMtVyp = !isAreaLivreSgdType && !isSgdBt && !isSgdTet && (
      !sgdExportColumn
      || sgdExportColumn === "SGD_AT_MT_VYP"
      || sgdExportColumn === "SGD AT/MT/VYP"
      || sgdExportColumn === "SGD AT/MT"
      || sgdExportColumn === "SGD AT"
      || sgdExportColumn === "SGD MT"
      || sgdExportColumn === "SGD VYP"
      || sgdTypeDescription === "SGD AT/MT/VYP"
      || sgdTypeDescription === "SGD AT/MT"
      || sgdTypeDescription === "SGD AT"
      || sgdTypeDescription === "SGD MT"
      || sgdTypeDescription === "SGD VYP"
    );
    const sgdAtMtVyp = isSgdAtMtVyp ? sgdExportValue : "";
    const sgdBt = isSgdBt ? sgdExportValue : "";
    const sgdTet = isSgdTet ? sgdExportValue : "";
    const infoStatus = formatInfoStatusEtapa(schedule.etapaNumber, schedule.etapaUnica, schedule.etapaFinal);
    const scheduleCreatedDate = schedule.createdAt ? schedule.createdAt.slice(0, 10) : "";
    const estruturaValue = formatStructureSummaryByCode(group.codeCount);
    const foremanNamesValue = Array.from(group.foremanNames).sort((a, b) => a.localeCompare(b)).join(" / ");
    const supportValue = resolveFirstFilledText(group.schedules, (item) => item.support, schedule.support);
    const serviceDescriptionValue = resolveFirstFilledText(
      group.schedules,
      (item) => item.serviceDescription,
      schedule.serviceDescription,
    );
    const statusReasonValue = resolveFirstFilledText(group.schedules, (item) => item.statusReason, schedule.statusReason);
    const noteValue = resolveFirstFilledText(group.schedules, (item) => item.note, schedule.note);
    const workCompletionStatusValue = resolveFirstFilledText(
      group.schedules,
      (item) => item.workCompletionStatus,
      schedule.workCompletionStatus,
    );

    return [
      project?.base ?? "",
      project?.serviceType ?? "",
      project?.code ?? "",
      formatDate(schedule.date),
      formatWeekday(schedule.date),
      periodLabel,
      schedule.startTime ?? "",
      schedule.endTime ?? "",
      formatExpectedHours(schedule.expectedMinutes ?? 0),
      displayStatus ?? "",
      infoStatus,
      project?.priority ?? "",
      estruturaValue,
      foremanNamesValue,
      supportValue,
      project?.utilityResponsible ?? "",
      project?.partner ?? "",
      "INDICA",
      schedule.sgdTypeDescription ?? "",
      schedule.affectedCustomers ?? "",
      sgdAtMtVyp,
      sgdBt,
      sgdTet,
      schedule.electricalField ?? "",
      schedule.outageStartTime ?? "",
      schedule.outageEndTime ?? "",
      schedule.feeder ?? "",
      project?.street ?? "",
      project?.district ?? "",
      project?.city ?? "",
      serviceDescriptionValue,
      statusReasonValue,
      statusReasonValue,
      formatDate(scheduleCreatedDate),
      schedule.trafoQty ?? "",
      noteValue,
      workCompletionStatusValue,
      "",
      schedule.documents?.pep?.number ?? "",
      project?.serviceType ?? "",
      "",
      "",
      "",
      project?.utilityFieldManager ?? "",
    ];
  });

  return buildCsvContent(header, rows);
}

function resolveFirstFilledText(
  schedules: ScheduleItem[],
  selector: (schedule: ScheduleItem) => string | null | undefined,
  fallback?: string | null,
) {
  return schedules
    .map((schedule) => String(selector(schedule) ?? "").trim())
    .find(Boolean)
    ?? String(fallback ?? "").trim();
}

function buildEnelNovoGroupKey(schedule: ScheduleItem, project?: ProjectItem) {
  const projectCode = String(project?.code ?? "").trim();
  const projectKey = projectCode ? projectCode.toUpperCase() : schedule.projectId;
  const executionDateKey = String(schedule.date ?? "").trim().slice(0, 10);

  return `${projectKey}__${executionDateKey}`;
}

function resolveFirstFilledNumber<T extends number | string>(
  schedules: ScheduleItem[],
  selector: (schedule: ScheduleItem) => T | null | undefined,
  fallback: T | null | undefined,
) {
  const filledValue = schedules
    .map((schedule) => selector(schedule))
    .find((value) => Number(value ?? 0) > 0);

  return filledValue ?? fallback ?? "";
}

function formatDecimalForEnelNovo(value: number | string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }

  const numericValue = Number(normalized.replace(",", "."));
  if (!Number.isFinite(numericValue)) {
    return normalized;
  }

  return normalized.replace(".", ",");
}

export function buildEnelNovoWorkbookData({ schedules, projectMap, teamMap }: ExportContext) {
  const exportSchedules = schedules.filter((schedule) => {
    const project = projectMap.get(schedule.projectId);
    const serviceType = String(project?.serviceType ?? "").trim().toUpperCase();
    return serviceType !== "EMERGENCIAL";
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
    "Motivo do cancelamento / Parcial / Adiamento",
    "Responsável cancelamento / Parcial / Adiamento",
    "Data da programação",
    "Tipo de avanço",
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

  const groupedAccumulator = new Map<string, {
    baseSchedule: ScheduleItem;
    schedules: ScheduleItem[];
    teamLabels: Set<string>;
    plates: Set<string>;
    foremanNames: Set<string>;
  }>();

  for (const schedule of exportSchedules) {
    const key = buildEnelNovoGroupKey(schedule, projectMap.get(schedule.projectId));
    const current = groupedAccumulator.get(key) ?? {
      baseSchedule: schedule,
      schedules: [],
      teamLabels: new Set<string>(),
      plates: new Set<string>(),
      foremanNames: new Set<string>(),
    };

    current.schedules.push(schedule);

    const team = resolveScheduleTeamInfo(schedule, teamMap);
    const teamLabel = String(team.name ?? "").trim();
    if (teamLabel) {
      current.teamLabels.add(teamLabel);
    }

    const vehiclePlate = (team.vehiclePlate ?? "").trim();
    if (vehiclePlate) {
      current.plates.add(vehiclePlate);
    }

    const foremanName = String(team.foremanName ?? "").trim();
    if (foremanName) {
      current.foremanNames.add(foremanName);
    }

    groupedAccumulator.set(key, current);
  }

  const rows = Array.from(groupedAccumulator.values()).map((group) => {
    const schedule = group.baseSchedule;
    const project = projectMap.get(schedule.projectId);
    const firstStatusReason = group.schedules
      .map((item) => String(item.statusReason ?? "").trim())
      .find(Boolean) ?? "";
    const firstServiceDescription = group.schedules
      .map((item) => String(item.serviceDescription ?? "").trim())
      .find(Boolean) ?? "";
    const sgdTypeDescription = (schedule.sgdTypeDescription ?? "").trim();
    const isAreaLivre = isAreaLivreSgd(schedule.sgdExportColumn, schedule.sgdTypeDescription);
    const infoStatus = formatInfoStatusEtapa(schedule.etapaNumber, schedule.etapaUnica, schedule.etapaFinal);
    const createdDate = schedule.createdAt ? schedule.createdAt.slice(0, 10) : "";
    const estruturaValue = Array.from(group.teamLabels).sort((a, b) => a.localeCompare(b)).join("|");
    const plateValue = Array.from(group.plates).sort((a, b) => a.localeCompare(b)).join(" - ");
    const foremanNamesValue = Array.from(group.foremanNames).sort((a, b) => a.localeCompare(b)).join(" / ");
    const numEqValue = `${(schedule.electricalField ?? "").trim()}${(schedule.electricalEqCode ?? "").trim()}`;
    const serviceDescriptionValue = firstServiceDescription
      || (project?.serviceName ?? "").trim();
    const redeQtyValue = resolveFirstFilledNumber(
      group.schedules,
      (item) => item.redeQtyText ?? item.redeQty,
      schedule.redeQtyText ?? schedule.redeQty,
    );
    const posteQtyValue = resolveFirstFilledNumber(
      group.schedules,
      (item) => item.posteQty,
      schedule.posteQty,
    );

    return [
      extractTextAfterDash(project?.base ?? ""),
      project?.serviceType ?? "",
      project?.code ?? "",
      formatDateExecutionEnelNovo(schedule.date),
      formatWeekdayExecutionEnelNovo(schedule.date),
      resolveEnelNovoPeriod(schedule.startTime, schedule.endTime),
      schedule.startTime ?? "",
      schedule.endTime ?? "",
      formatExpectedTimeAsClock(schedule.expectedMinutes ?? 0),
      resolveEnelNovoStatus(schedule),
      infoStatus,
      project?.priority ?? "",
      estruturaValue,
      plateValue,
      schedule.note ?? "",
      schedule.support ?? "",
      project?.utilityFieldManager ?? "",
      extractTextBeforeDash(project?.partner ?? ""),
      foremanNamesValue,
      isAreaLivre ? "SIM" : "NAO",
      isAreaLivre ? "NAO" : "SIM",
      sgdTypeDescription,
      normalizeSgdNumberForExport(schedule.documents?.sgd?.number),
      schedule.affectedCustomers ?? "",
      numEqValue,
      schedule.outageStartTime ?? "",
      schedule.outageEndTime ?? "",
      schedule.feeder ?? "",
      project?.street ?? "",
      project?.district ?? "",
      project?.city ?? "",
      serviceDescriptionValue,
      firstStatusReason,
      "",
      formatDate(createdDate),
      "",
      "",
      "",
      "",
      "",
      "",
      formatDecimalForEnelNovo(redeQtyValue),
      "",
      "",
      "",
      "",
      "",
      "",
      posteQtyValue,
      "",
    ];
  });

  return {
    header,
    rows,
    eligibleCount: exportSchedules.length,
  };
}
