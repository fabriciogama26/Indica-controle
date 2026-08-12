// Cluster "Prazos das Obras" — constantes, tipos e helpers.
//
// Movido de `programacao-simples` no C2 do corte da Programacao Normalizada.
// Verificado simbolo a simbolo antes do move: o Mapa era o UNICO consumidor de
// todos eles; a tela de Programacao nao usava nenhum na propria tela. Sao ativos
// do Mapa que moravam no modulo errado — nao ha paridade perdida na Simples.
//
// As funcoes de formatacao e de CSV sao copia VERBATIM da origem, de proposito:
// `formatDate` e `escapeCsvValue` da Simples tem semantica propria (fallback ao
// valor cru em data invalida; separador `;` com BOM) diferente da que o Mapa usa
// em `formatters.ts`. Reaproveitar a versao do Mapa mudaria a saida do CSV e do
// painel — e o C2 e movimentacao sem mudanca de comportamento.

export const DEADLINE_CAROUSEL_PAGE_SIZE = 6;
export const DEADLINE_WINDOW_SHORT_DAYS = 15;
export const DEADLINE_WINDOW_LONG_DAYS = 30;
export const DEADLINE_WINDOW_EXTENDED_DAYS = 60;
export const DEADLINE_WINDOW_MAX_DAYS = 90;

export type DeadlineStatus = "OVERDUE" | "TODAY" | "SOON" | "NORMAL";
export type DeadlineVisualVariant = "OVERDUE_CRITICAL" | "OVERDUE" | "TODAY" | "SOON" | "NORMAL";
export type DeadlineViewMode = "15" | "30" | "60" | "90";

export type DeadlinePanelSummary = {
  dueToday: number;
  dueSoon: number;
  overdue: number;
  normal: number;
};

export type DeadlinePanelItem = {
  id: string;
  sob: string;
  executionDeadline: string;
  statusLabel: string;
  visualVariant: DeadlineVisualVariant;
};

export type DeadlineModalItem = {
  id: string;
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

type DeadlineExportItem = Omit<DeadlineModalItem, "id">;

type CsvValue = string | number;

// Copia verbatim de programacao-simples/utils.ts.
function formatDeadlineDate(value: string) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("pt-BR");
}

// Copia verbatim de programacao-simples/utils.ts.
function escapeCsvValue(value: string | number) {
  const raw = String(value ?? "").replace(/\r?\n|\r/g, " ").trim();
  if (raw.includes(";") || raw.includes('"')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

// Copia verbatim do helper local de programacao-simples/exports.ts — separador
// `;` e BOM inicial, que o Excel pt-BR espera. NAO trocar por
// `@/lib/utils/csv#buildCsvContent`, que usa outra convencao.
function buildCsvContent(header: CsvValue[], rows: CsvValue[][]) {
  const csvLines = [header, ...rows].map((line) => line.map((item) => escapeCsvValue(item)).join(";"));
  return `﻿${csvLines.join("\n")}`;
}

export function formatDeadlineStatusLabel(daysDiff: number, windowDays: number) {
  if (daysDiff < 0) {
    const absDays = Math.abs(daysDiff);
    return `Vencida ha ${absDays} dia${absDays === 1 ? "" : "s"}`;
  }

  if (daysDiff === 0) {
    return "Vence hoje";
  }

  if (daysDiff <= windowDays) {
    return `Vence em ${daysDiff} dia${daysDiff === 1 ? "" : "s"}`;
  }

  return "Ainda no prazo";
}

export function resolveDeadlineStatus(daysDiff: number, windowDays: number): DeadlineStatus {
  if (daysDiff < 0) {
    return "OVERDUE";
  }

  if (daysDiff === 0) {
    return "TODAY";
  }

  if (daysDiff <= windowDays) {
    return "SOON";
  }

  return "NORMAL";
}

export function resolveDeadlineVisualVariant(daysDiff: number, windowDays: number): DeadlineVisualVariant {
  if (daysDiff <= -30) {
    return "OVERDUE_CRITICAL";
  }

  if (daysDiff < 0) {
    return "OVERDUE";
  }

  if (daysDiff === 0) {
    return "TODAY";
  }

  if (daysDiff <= windowDays) {
    return "SOON";
  }

  return "NORMAL";
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
    formatDeadlineDate(item.executionDeadline),
    item.latestProgrammingDate ? formatDeadlineDate(item.latestProgrammingDate) : "",
    item.reason,
    item.workCompletionStatus,
    item.statusLabel,
    item.daysDiff,
    item.rangeLabel,
    `${params.deadlineWindowDays} dias`,
  ]);

  return buildCsvContent(header, rows);
}

export { formatDeadlineDate };
