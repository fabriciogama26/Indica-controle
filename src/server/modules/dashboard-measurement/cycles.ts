// Matematica de ciclo e datas do Dashboard Medicao / Dashboard Equipes.
// O ciclo do negocio vai do dia 21 ao dia 20 do mes seguinte -- ver
// `resolveCycleStart`. Sairam de `controller.ts` para o arquivo caber no teto de
// 1.500 linhas; sao funcoes puras, sem Supabase nem request.
import { normalizeIsoDate, normalizeText } from "./normalizers";
import type { CycleWeek, MeasurementOrderRow } from "./types";

export function createUtcDate(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day));
}

export function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map((item) => Number(item));
  return createUtcDate(year, month - 1, day);
}

export function toIsoDate(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(value: Date, days: number) {
  return createUtcDate(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() + days);
}

export function addMonths(value: Date, months: number) {
  return createUtcDate(value.getUTCFullYear(), value.getUTCMonth() + months, value.getUTCDate());
}

export function resolveCycleStart(reference: Date) {
  const year = reference.getUTCFullYear();
  const monthIndex = reference.getUTCMonth();
  const day = reference.getUTCDate();
  return day >= 21 ? createUtcDate(year, monthIndex, 21) : createUtcDate(year, monthIndex - 1, 21);
}

export function formatCycleLabel(start: Date, end: Date) {
  const startDay = String(start.getUTCDate()).padStart(2, "0");
  const startMonth = String(start.getUTCMonth() + 1).padStart(2, "0");
  const startYear = String(start.getUTCFullYear());
  const endDay = String(end.getUTCDate()).padStart(2, "0");
  const endMonth = String(end.getUTCMonth() + 1).padStart(2, "0");
  const endYear = String(end.getUTCFullYear());
  return `Ciclo ${startDay}/${startMonth}/${startYear} a ${endDay}/${endMonth}/${endYear}`;
}

export function formatShortDate(value: Date) {
  const day = String(value.getUTCDate()).padStart(2, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

export function countBusinessDays(start: Date, end: Date) {
  let total = 0;
  for (let current = start; current <= end; current = addDays(current, 1)) {
    const day = current.getUTCDay();
    if (day !== 0 && day !== 6) total += 1;
  }
  return total;
}

export function countDistinctExecutionDates(orders: MeasurementOrderRow[], startDate: string, endDate: string) {
  return new Set(orders
    .map((order) => normalizeIsoDate(order.execution_date))
    .filter((date): date is string => Boolean(date))
    .filter((date) => date >= startDate && date <= endDate)).size;
}

export function resolvePerformanceWorkdays(orders: MeasurementOrderRow[], startDate: string, endDate: string) {
  const businessDays = countBusinessDays(parseIsoDate(startDate), parseIsoDate(endDate));
  return businessDays > 0 ? businessDays : countDistinctExecutionDates(orders, startDate, endDate);
}

export function buildCycleWeeks(cycleStart: string, cycleEnd: string): CycleWeek[] {
  const weeks: CycleWeek[] = [];
  let start = parseIsoDate(cycleStart);
  const cycleEndDate = parseIsoDate(cycleEnd);
  let index = 1;

  while (start <= cycleEndDate) {
    const end = addDays(start, 6) > cycleEndDate ? cycleEndDate : addDays(start, 6);
    weeks.push({
      id: `week-${index}`,
      label: `${index}ª semana (${formatShortDate(start)} a ${formatShortDate(end)})`,
      startDate: toIsoDate(start),
      endDate: toIsoDate(end),
      workdays: countBusinessDays(start, end),
    });
    start = addDays(end, 1);
    index += 1;
  }

  return weeks;
}

export function buildCycleFromMeasurementDate(value: string) {
  const measurementDate = parseIsoDate(value);
  const start = resolveCycleStart(measurementDate);
  const end = addMonths(start, 1);
  end.setUTCDate(20);
  return {
    cycleStart: toIsoDate(start),
    cycleEnd: toIsoDate(end),
    label: formatCycleLabel(start, end),
  };
}

export function normalizeYear(value: unknown) {
  const normalized = Number(normalizeText(value));
  if (!Number.isInteger(normalized) || normalized < 2000 || normalized > 2100) return null;
  return normalized;
}

export function buildAnnualCycles(year: number) {
  const cycles: ReturnType<typeof buildCycleFromMeasurementDate>[] = [];
  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const end = createUtcDate(year, monthIndex, 20);
    const start = addMonths(end, -1);
    start.setUTCDate(21);
    cycles.push({
      cycleStart: toIsoDate(start),
      cycleEnd: toIsoDate(end),
      label: formatCycleLabel(start, end),
    });
  }
  return cycles;
}

export function formatPeriodLabel(period: string) {
  const [year, month] = period.split("-");
  return `${month}/${year}`;
}

export function formatMonthName(value: string | null) {
  if (!value) return "Sem atuacao";
  const date = parseIsoDate(value);
  const months = [
    "Janeiro",
    "Fevereiro",
    "Marco",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];
  return months[date.getUTCMonth()] ?? "Sem atuacao";
}
