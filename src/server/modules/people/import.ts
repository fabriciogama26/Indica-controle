import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeNullableText, normalizeText } from "@/lib/server/apiHelpers";

export type PersonImportRow = {
  rowNumber?: number;
  name: string;
  matriculation: string;
  cpf?: string | null;
  phone?: string | null;
  jobTitleId: string;
  jobTitleTypeId?: string | null;
  jobLevel?: string | null;
};

export type PersonImportRowResult = {
  rowNumber: number;
  success: boolean;
  message: string;
  code?: string;
};

type JobTitleCatalogRow = { id: string; code: string; name: string };
type JobTitleTypeCatalogRow = { id: string; job_title_id: string; name: string };
type JobLevelCatalogRow = { level: string };

type BatchRpcRowResult = {
  rowNumber: number;
  success: boolean;
  personId?: string;
  reason?: string;
  message?: string;
};

type BatchRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  results?: BatchRpcRowResult[];
};

function normalizeCpfDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeRuleText(value: unknown) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function isJobTitleTypeRequired(jobTitle: { code?: string | null; name?: string | null } | null) {
  const code = normalizeRuleText(jobTitle?.code);
  const name = normalizeRuleText(jobTitle?.name);
  const requiredNames = new Set([
    "ENCARREGADO DE TURMA",
    "AJUDANTE DE ELETRICISTA",
    "ELETRICISTA DE CONSTRUCAO",
  ]);

  return requiredNames.has(name) || requiredNames.has(code);
}

async function loadTenantCatalogs(supabase: SupabaseClient, tenantId: string) {
  const [jobTitlesResult, jobTitleTypesResult, jobLevelsResult] = await Promise.all([
    supabase
      .from("job_titles")
      .select("id, code, name")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .returns<JobTitleCatalogRow[]>(),
    supabase
      .from("job_title_types")
      .select("id, job_title_id, name")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .returns<JobTitleTypeCatalogRow[]>(),
    supabase
      .from("job_levels")
      .select("level")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .returns<JobLevelCatalogRow[]>(),
  ]);

  return {
    jobTitleMap: new Map((jobTitlesResult.data ?? []).map((row) => [row.id, row])),
    jobTitleTypeMap: new Map((jobTitleTypesResult.data ?? []).map((row) => [row.id, row])),
    jobLevelSet: new Set((jobLevelsResult.data ?? []).map((row) => row.level)),
  };
}

async function loadExistingIdentities(supabase: SupabaseClient, tenantId: string, matriculations: string[], cpfs: string[]) {
  const [matriculationResult, cpfResult] = await Promise.all([
    matriculations.length
      ? supabase
        .from("people")
        .select("matriculation")
        .eq("tenant_id", tenantId)
        .in("matriculation", matriculations)
        .returns<{ matriculation: string | null }[]>()
      : Promise.resolve({ data: [] as { matriculation: string | null }[], error: null }),
    cpfs.length
      ? supabase
        .from("people")
        .select("cpf")
        .eq("tenant_id", tenantId)
        .in("cpf", cpfs)
        .returns<{ cpf: string | null }[]>()
      : Promise.resolve({ data: [] as { cpf: string | null }[], error: null }),
  ]);

  return {
    existingMatriculations: new Set(
      (matriculationResult.data ?? []).map((row) => (row.matriculation ?? "").toUpperCase()).filter(Boolean),
    ),
    existingCpfs: new Set((cpfResult.data ?? []).map((row) => row.cpf ?? "").filter(Boolean)),
  };
}

/**
 * Importa pessoas em lote com o minimo de idas ao banco: catalogos e duplicidade
 * sao carregados uma vez para o arquivo inteiro (nao por linha), e a gravacao
 * roda numa unica chamada RPC (`save_person_records_batch`) em vez de uma por pessoa.
 */
export async function importPersonBatch(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  rows: PersonImportRow[];
}) {
  const { supabase, tenantId, actorUserId, rows } = params;

  const { jobTitleMap, jobTitleTypeMap, jobLevelSet } = await loadTenantCatalogs(supabase, tenantId);

  const matriculationsInFile = Array.from(
    new Set(rows.map((row) => normalizeText(row.matriculation).toUpperCase()).filter(Boolean)),
  );
  const cpfsInFile = Array.from(
    new Set(rows.map((row) => normalizeCpfDigits(row.cpf)).filter(Boolean)),
  );

  const { existingMatriculations, existingCpfs } = await loadExistingIdentities(
    supabase,
    tenantId,
    matriculationsInFile,
    cpfsInFile,
  );

  const results: PersonImportRowResult[] = [];
  const rowNamesByRowNumber = new Map<number, string>();
  const rpcRows: Array<{
    rowNumber: number;
    name: string;
    matriculation: string;
    jobTitleId: string;
    jobTitleTypeId: string | null;
    jobLevel: string | null;
    cpf: string | null;
    phone: string | null;
  }> = [];

  const seenMatriculations = new Set<string>();
  const seenCpfs = new Set<string>();

  rows.forEach((row, index) => {
    const rowNumber = Number.isInteger(Number(row.rowNumber)) && Number(row.rowNumber) > 0
      ? Number(row.rowNumber)
      : index + 2;

    const name = normalizeText(row.name);
    const matriculation = normalizeText(row.matriculation).toUpperCase();
    const cpf = normalizeCpfDigits(row.cpf) || null;
    const phone = normalizeNullableText(row.phone);
    const jobTitleId = normalizeText(row.jobTitleId);
    const jobTitleTypeId = normalizeNullableText(row.jobTitleTypeId);
    const jobLevel = normalizeNullableText(row.jobLevel);

    if (!name || !matriculation || !jobTitleId) {
      results.push({ rowNumber, success: false, message: "Preencha os campos obrigatorios da pessoa." });
      return;
    }

    const jobTitle = jobTitleMap.get(jobTitleId) ?? null;
    if (!jobTitle) {
      results.push({
        rowNumber,
        success: false,
        message: "Cargo invalido para o tenant atual.",
        code: "INVALID_JOB_TITLE",
      });
      return;
    }

    const typeRequired = isJobTitleTypeRequired(jobTitle);
    const jobTitleType = jobTitleTypeId ? jobTitleTypeMap.get(jobTitleTypeId) ?? null : null;
    const hasInvalidType = jobTitleTypeId
      ? !jobTitleType || jobTitleType.job_title_id !== jobTitleId
      : typeRequired;

    if (hasInvalidType) {
      results.push({
        rowNumber,
        success: false,
        message: "Tipo invalido para o cargo selecionado.",
        code: "INVALID_JOB_TITLE_TYPE",
      });
      return;
    }

    if (jobLevel && !jobLevelSet.has(jobLevel)) {
      results.push({
        rowNumber,
        success: false,
        message: "Nivel invalido para o tenant atual.",
        code: "INVALID_JOB_LEVEL",
      });
      return;
    }

    if (existingMatriculations.has(matriculation) || seenMatriculations.has(matriculation)) {
      results.push({
        rowNumber,
        success: false,
        message: "Ja existe pessoa com esta matricula no tenant atual.",
        code: "DUPLICATE_PERSON_MATRICULATION",
      });
      return;
    }

    if (cpf && (existingCpfs.has(cpf) || seenCpfs.has(cpf))) {
      results.push({
        rowNumber,
        success: false,
        message: "Ja existe pessoa com este CPF no tenant atual.",
        code: "DUPLICATE_PERSON_CPF",
      });
      return;
    }

    seenMatriculations.add(matriculation);
    if (cpf) {
      seenCpfs.add(cpf);
    }

    rowNamesByRowNumber.set(rowNumber, name);
    rpcRows.push({ rowNumber, name, matriculation, jobTitleId, jobTitleTypeId, jobLevel, cpf, phone });
  });

  let savedCount = 0;

  if (rpcRows.length > 0) {
    const { data, error } = await supabase.rpc("save_person_records_batch", {
      p_tenant_id: tenantId,
      p_actor_user_id: actorUserId,
      p_rows: rpcRows.map((row) => ({
        rowNumber: row.rowNumber,
        name: row.name,
        matriculation: row.matriculation,
        jobTitleId: row.jobTitleId,
        jobTitleTypeId: row.jobTitleTypeId,
        jobLevel: row.jobLevel,
        cpf: row.cpf,
        phone: row.phone,
      })),
    });

    if (error) {
      rpcRows.forEach((row) => {
        results.push({ rowNumber: row.rowNumber, success: false, message: "Falha ao salvar pessoa." });
      });
    } else {
      const rpcResult = (data ?? {}) as BatchRpcResult;
      (rpcResult.results ?? []).forEach((row) => {
        if (row.success) {
          savedCount += 1;
        }

        const name = rowNamesByRowNumber.get(row.rowNumber) ?? "";
        results.push({
          rowNumber: row.rowNumber,
          success: row.success,
          message: row.success
            ? `Pessoa ${name} cadastrada com sucesso.`
            : row.message || "Falha ao salvar pessoa.",
          code: row.success ? undefined : row.reason,
        });
      });
    }
  }

  results.sort((a, b) => a.rowNumber - b.rowNumber);

  return {
    success: true as const,
    savedCount,
    errorCount: results.filter((row) => !row.success).length,
    results,
  };
}
