// Normalizadores e predicados puros do Dashboard Medicao / Dashboard Equipes.
// Sairam de `controller.ts` para o arquivo caber no teto de 1.500 linhas de
// `controller.ts`; nao tem dependencia de Supabase nem de request.
import type { MeasurementTeamCategoryCode } from "@/server/modules/medicao/routeConfig";

import type { ServiceScope } from "./types";

export function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeToken(value: unknown) {
  return normalizeText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

export function normalizeUuid(value: unknown) {
  const normalized = normalizeText(value);
  return /^[0-9a-f-]{36}$/i.test(normalized) ? normalized : null;
}

export function normalizeIsoDate(value: unknown) {
  const normalized = normalizeText(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

export function normalizeCompletionStatus(value: unknown) {
  const token = normalizeToken(value)
    .replace(/\s+/g, "_");

  if (token === "CONCLUIDO" || token === "COMPLETO" || token.startsWith("CONCLUIDO")) return "CONCLUIDO";
  if (
    token === "BENEFICIO_ATINGIDO"
    || token === "PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO"
    || token === "PARCIAL_PLANEJADO_BENFICIO_ATINGIDO"
  ) {
    return "BENEFICIO_ATINGIDO";
  }
  if (token === "PARCIAL" || token.startsWith("PARCIAL")) return "PARCIAL";
  if (token === "PENDENCIA" || token === "PENDENCIAS" || token.startsWith("PENDEN")) return "PENDENCIA";
  return "NAO_INFORMADO";
}

export function isCompletionFilterStatus(value: string) { return value === "CONCLUIDO" || value === "PARCIAL" || value === "BENEFICIO_ATINGIDO" || value === "PENDENCIA"; }

export function normalizeServiceScope(value: unknown): ServiceScope { const token = normalizeToken(value); return token === "MANUTENCAO" ? "MANUTENCAO" : token === "OBRAS" ? "OBRAS" : "ALL"; }

export function normalizeTeamCategoryCode(value: unknown): MeasurementTeamCategoryCode {
  return normalizeToken(value) === "COMERCIAL" ? "COMERCIAL" : "TECNICA";
}

export function isMaintenanceServiceType(value: unknown) {
  return normalizeToken(value).includes("EMERGENCIAL") || normalizeToken(value).includes("MANUTENCAO");
}

export function periodOverlaps(startDate: string, endDate: string | null, windowStart: string, windowEnd: string) {
  return startDate <= windowEnd && (!endDate || endDate >= windowStart);
}

export function isCanceledProgrammingStatus(value: unknown) {
  return normalizeText(value).toUpperCase() === "CANCELADA";
}

export function maxIsoDate(left: string, right: string) {
  return left > right ? left : right;
}

export function minIsoDate(left: string, right: string) {
  return left < right ? left : right;
}
