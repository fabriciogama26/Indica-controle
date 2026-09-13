import type { SupabaseClient } from "@supabase/supabase-js";

import { parseLatitude, parseLongitude } from "@/lib/utils/parsers";
import { runMassImport, type PreparedMassImportRow } from "@/lib/server/massImportRunner";

export type ProjectImportRow = {
  rowNumber?: number;
  sob?: string;
  serviceCenter?: string;
  serviceType?: string;
  executionDeadline?: string;
  priority?: string;
  estimatedValue?: string | number;
  voltageLevel?: string | null;
  projectSize?: string | null;
  contractorResponsible?: string;
  utilityResponsible?: string;
  utilityFieldManager?: string;
  street?: string;
  neighborhood?: string;
  city?: string;
  latitude?: string | number;
  longitude?: string | number;
  serviceDescription?: string | null;
  observation?: string | null;
  isTest?: boolean;
  isWithdrawn?: boolean;
  isThirdParty?: boolean;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeNullableText(value: unknown) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  return normalizeText(value).toLowerCase() === "true" || normalizeText(value) === "1" || normalizeText(value).toLowerCase() === "sim";
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Mesma normalizacao de valor monetario de `normalizeEstimatedValue`
 * (src/app/api/projects/route.ts), duplicada aqui de proposito -- ver nota em
 * `src/server/modules/materials/import.ts`.
 */
function normalizeEstimatedValue(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.round((value + Number.EPSILON) * 100) / 100 : null;
  }

  const raw = normalizeText(value);
  if (!raw || raw.includes("-")) {
    return null;
  }

  const cleaned = raw.replace(/\s/g, "").replace(/[R$]/gi, "");
  if (!/^\d+(?:[.,]\d+)*$/.test(cleaned)) {
    return null;
  }

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;

  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  } else if (lastComma >= 0) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot >= 0) {
    const dotCount = (cleaned.match(/\./g) ?? []).length;
    const [whole, fraction = ""] = cleaned.split(".");

    if (dotCount === 1 && fraction.length > 3) {
      normalized = `${whole}${fraction.slice(0, -2)}.${fraction.slice(-2)}`;
    } else if (dotCount === 1 && fraction.length === 3) {
      normalized = `${whole}${fraction}`;
    } else if (dotCount > 1) {
      normalized = cleaned.replace(/\./g, "");
    }
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round((numeric + Number.EPSILON) * 100) / 100 : null;
}

/**
 * Mesma validacao estrutural de `validateRequiredProjectFields` (route.ts):
 * obrigatoriedade, formato de data e presenca de latitude/longitude. A
 * existencia dos 9 campos de catalogo (Prioridade, Centro de Servico, Tipo de
 * Servico, Nivel de Tensao, Porte, Municipio, Responsavel Contratada,
 * Responsavel/Gestor de campo Distribuidora) e o contrato ativo (Parceira)
 * ficam para `save_project_records_batch` (migration 438), que resolve cada
 * nome dentro do proprio loop em SQL -- por isso esta funcao so faz
 * normalizacao pura, sem nenhuma consulta ao banco.
 */
function prepareRow(row: ProjectImportRow, index: number): PreparedMassImportRow<Record<string, unknown>> {
  const rowNumber = Number.isInteger(Number(row.rowNumber)) && Number(row.rowNumber) > 0
    ? Number(row.rowNumber)
    : index + 2;

  const sob = normalizeText(row.sob).toUpperCase();
  const serviceCenter = normalizeText(row.serviceCenter);
  const serviceType = normalizeText(row.serviceType);
  const executionDeadline = normalizeText(row.executionDeadline);
  const priority = normalizeText(row.priority).toUpperCase();
  const estimatedValue = normalizeEstimatedValue(row.estimatedValue);
  const voltageLevel = normalizeNullableText(row.voltageLevel);
  const projectSize = normalizeNullableText(row.projectSize);
  const contractorResponsible = normalizeText(row.contractorResponsible);
  const utilityResponsible = normalizeText(row.utilityResponsible);
  const utilityFieldManager = normalizeText(row.utilityFieldManager);
  const street = normalizeText(row.street);
  const neighborhood = normalizeText(row.neighborhood);
  const city = normalizeText(row.city);
  const latitude = parseLatitude(row.latitude);
  const longitude = parseLongitude(row.longitude);
  const serviceDescription = normalizeNullableText(row.serviceDescription);
  const observation = normalizeNullableText(row.observation);

  if (
    !sob || !serviceCenter || !serviceType || !executionDeadline || !priority || estimatedValue === null
    || !contractorResponsible || !utilityResponsible || !utilityFieldManager
    || !street || !neighborhood || !city
  ) {
    return { rowNumber, ok: false, message: "Preencha todos os campos obrigatorios do projeto." };
  }

  if (!isIsoDate(executionDeadline)) {
    return { rowNumber, ok: false, message: "Data limite invalida." };
  }

  if (latitude === null) {
    return {
      rowNumber,
      ok: false,
      message: "Latitude obrigatoria. Informe em graus decimais entre -90 e 90 (ex.: -23.550520).",
    };
  }

  if (longitude === null) {
    return {
      rowNumber,
      ok: false,
      message: "Longitude obrigatoria. Informe em graus decimais entre -180 e 180 (ex.: -46.633308).",
    };
  }

  return {
    rowNumber,
    ok: true,
    payload: {
      rowNumber,
      sob,
      serviceCenter,
      serviceType,
      executionDeadline,
      priority,
      estimatedValue,
      voltageLevel,
      projectSize,
      contractorResponsible,
      utilityResponsible,
      utilityFieldManager,
      street,
      neighborhood,
      city,
      latitude,
      longitude,
      serviceDescription,
      observation,
      isTest: normalizeBoolean(row.isTest),
      isWithdrawn: normalizeBoolean(row.isWithdrawn),
      isThirdParty: normalizeBoolean(row.isThirdParty),
    },
  };
}

export async function importProjectBatch(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  rows: ProjectImportRow[];
}) {
  const prepared = params.rows.map((row, index) => prepareRow(row, index));

  return runMassImport({
    supabase: params.supabase,
    prepared,
    rpcName: "save_project_records_batch",
    genericFailureMessage: "Falha ao salvar projeto.",
    buildRpcParams: (validRows) => ({
      p_tenant_id: params.tenantId,
      p_actor_user_id: params.actorUserId,
      p_rows: validRows.map((row) => ({
        ...row.payload,
        rowNumber: row.rowNumber,
      })),
    }),
  });
}
