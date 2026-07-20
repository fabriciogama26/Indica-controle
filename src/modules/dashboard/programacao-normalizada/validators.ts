import type { ReasonOptionItem } from "./types";

export function buildReasonText(reasonOptions: ReasonOptionItem[], code: string, notes: string) {
  const option = reasonOptions.find((item) => item.code === code);
  if (!option) return "";

  const trimmedNotes = notes.trim();
  if (option.requiresNotes && !trimmedNotes) return "";

  return trimmedNotes ? `${option.label}: ${trimmedNotes}` : option.label;
}

export function isReasonSelectionValid(reasonOptions: ReasonOptionItem[], code: string, notes: string) {
  return Boolean(buildReasonText(reasonOptions, code, notes));
}

export function isFormReadyToSave(params: {
  projectId: string;
  executionDate: string;
  period: string;
  startTime: string;
  endTime: string;
  sgdTypeId: string;
  electricalEqCatalogId: string;
  campoEletrico: string;
  serviceDescription: string;
}) {
  return Boolean(
    params.projectId
    && params.executionDate
    && params.period
    && params.startTime
    && params.endTime
    && params.sgdTypeId
    && params.electricalEqCatalogId
    && params.campoEletrico.trim()
    && params.serviceDescription.trim(),
  );
}

export function isTimeRangeValid(startTime: string, endTime: string) {
  if (!startTime || !endTime) return true;
  return startTime < endTime;
}
