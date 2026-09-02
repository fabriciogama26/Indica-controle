import {
  buildMassImportTemplateCsv,
  normalizeLookupText,
  readMassImportCsv,
  resolveCsvValue,
  type MassImportIssue,
} from "@/lib/utils/massImport";

export type ProjectImportRow = {
  rowNumber: number;
  sob: string;
  serviceCenter: string;
  serviceType: string;
  executionDeadline: string;
  priority: string;
  estimatedValue: string;
  voltageLevel: string;
  projectSize: string;
  contractorResponsible: string;
  utilityResponsible: string;
  utilityFieldManager: string;
  street: string;
  neighborhood: string;
  city: string;
  serviceDescription: string;
  observation: string;
  isTest: boolean;
  isWithdrawn: boolean;
  isThirdParty: boolean;
};

export type ProjectImportCatalogs = {
  priorities: string[];
  serviceCenters: string[];
  serviceTypes: string[];
  voltageLevels: string[];
  projectSizes: string[];
  cities: string[];
  contractorResponsibles: string[];
  utilityResponsibles: string[];
  utilityFieldManagers: string[];
};

const REQUIRED_HEADERS = [
  "prioridade",
  "projeto",
  "centro_servico",
  "tipo_servico",
  "data_limite",
  "valor_estimado",
  "responsavel_contratada",
  "responsavel_distribuidora",
  "gestor_campo_distribuidora",
  "municipio",
  "logradouro",
  "bairro",
];

export const PROJECT_MASS_IMPORT_COLUMNS_HINT =
  "Colunas obrigatorias: prioridade, projeto, centro_servico, tipo_servico, data_limite, valor_estimado, responsavel_contratada, responsavel_distribuidora, gestor_campo_distribuidora, municipio, logradouro e bairro. Use os mesmos nomes dos selects da tela.";

function normalizeText(value: string) {
  return String(value ?? "").trim();
}

function normalizeSob(value: string) {
  return normalizeText(value).toUpperCase();
}

function parseBoolean(value: string) {
  const normalized = normalizeLookupText(value);
  return normalized === "sim" || normalized === "s" || normalized === "true" || normalized === "1" || normalized === "x";
}

function normalizeDate(value: string) {
  const normalized = normalizeText(value);
  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return normalized;
  }

  const brMatch = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!brMatch) {
    return null;
  }

  const [, day, month, year] = brMatch;
  const candidate = `${year}-${month}-${day}`;
  const date = new Date(`${candidate}T00:00:00`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== candidate) {
    return null;
  }

  return candidate;
}

function parseEstimatedValue(value: string) {
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
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  return (Math.round((numeric + Number.EPSILON) * 100) / 100).toFixed(2);
}

function findCatalogValue(options: string[], value: string) {
  const normalizedValue = normalizeLookupText(value);
  if (!normalizedValue) {
    return "";
  }

  return options.find((option) => normalizeLookupText(option) === normalizedValue) ?? "";
}

function validateCatalog(params: {
  issues: MassImportIssue[];
  rowNumber: number;
  column: string;
  raw: string;
  options: string[];
  required: boolean;
  label: string;
}) {
  const raw = normalizeText(params.raw);
  if (!raw) {
    if (params.required) {
      params.issues.push({ rowNumber: params.rowNumber, column: params.column, value: raw, error: `${params.label} obrigatorio(a).` });
    }
    return "";
  }

  const value = findCatalogValue(params.options, raw);
  if (!value) {
    params.issues.push({ rowNumber: params.rowNumber, column: params.column, value: raw, error: `${params.label} invalido(a) ou inativo(a).` });
  }
  return value;
}

export function buildProjectMassImportTemplateCsv(catalogs: ProjectImportCatalogs) {
  return buildMassImportTemplateCsv(
    [
      "prioridade",
      "projeto",
      "centro_servico",
      "tipo_servico",
      "data_limite",
      "valor_estimado",
      "responsavel_contratada",
      "responsavel_distribuidora",
      "gestor_campo_distribuidora",
      "municipio",
      "logradouro",
      "bairro",
      "nivel_tensao",
      "porte",
      "descricao_servico",
      "observacao",
      "obra_teste",
      "retirado_carteira",
      "terceiros",
    ],
    [
      [
        catalogs.priorities[0] ?? "GRUPO B - FLUXO",
        "SOB000001",
        catalogs.serviceCenters[0] ?? "CENTRO DE SERVICO",
        catalogs.serviceTypes[0] ?? "TIPO DE SERVICO",
        "31/12/2026",
        "1000,00",
        catalogs.contractorResponsibles[0] ?? "RESPONSAVEL CONTRATADA",
        catalogs.utilityResponsibles[0] ?? "RESPONSAVEL DISTRIBUIDORA",
        catalogs.utilityFieldManagers[0] ?? "GESTOR DE CAMPO",
        catalogs.cities[0] ?? "MUNICIPIO",
        "Rua exemplo",
        "Bairro exemplo",
        catalogs.voltageLevels[0] ?? "",
        catalogs.projectSizes[0] ?? "",
        "Descricao do servico",
        "",
        "Nao",
        "Nao",
        "Nao",
      ],
    ],
  );
}

export function parseProjectMassImportCsv(params: {
  content: string;
  fileName: string;
  catalogs: ProjectImportCatalogs;
}) {
  const table = readMassImportCsv({ content: params.content, fileName: params.fileName, requiredHeaders: REQUIRED_HEADERS });
  const issues: MassImportIssue[] = [...table.issues];
  const rows: ProjectImportRow[] = [];
  const seenSobs = new Set<string>();

  for (const { rowNumber, values } of table.rows) {
    const sob = normalizeSob(resolveCsvValue(values, ["projeto", "sob"]));
    const executionDeadlineRaw = resolveCsvValue(values, ["data_limite", "data_execucao", "execution_deadline"]);
    const executionDeadline = normalizeDate(executionDeadlineRaw);
    const estimatedValueRaw = resolveCsvValue(values, ["valor_estimado", "valor", "estimated_value"]);
    const estimatedValue = parseEstimatedValue(estimatedValueRaw);
    const issuesBefore = issues.length;

    const priority = validateCatalog({ issues, rowNumber, column: "prioridade", raw: resolveCsvValue(values, ["prioridade", "priority"]), options: params.catalogs.priorities, required: true, label: "Prioridade" });
    const serviceCenter = validateCatalog({ issues, rowNumber, column: "centro_servico", raw: resolveCsvValue(values, ["centro_servico", "base", "service_center"]), options: params.catalogs.serviceCenters, required: true, label: "Centro de Servico" });
    const serviceType = validateCatalog({ issues, rowNumber, column: "tipo_servico", raw: resolveCsvValue(values, ["tipo_servico", "service_type"]), options: params.catalogs.serviceTypes, required: true, label: "Tipo de Servico" });
    const voltageLevel = validateCatalog({ issues, rowNumber, column: "nivel_tensao", raw: resolveCsvValue(values, ["nivel_tensao", "voltage_level"]), options: params.catalogs.voltageLevels, required: false, label: "Nivel de Tensao" });
    const projectSize = validateCatalog({ issues, rowNumber, column: "porte", raw: resolveCsvValue(values, ["porte", "project_size"]), options: params.catalogs.projectSizes, required: false, label: "Porte" });
    const contractorResponsible = validateCatalog({ issues, rowNumber, column: "responsavel_contratada", raw: resolveCsvValue(values, ["responsavel_contratada", "contractor_responsible"]), options: params.catalogs.contractorResponsibles, required: true, label: "Responsavel Contratada" });
    const utilityResponsible = validateCatalog({ issues, rowNumber, column: "responsavel_distribuidora", raw: resolveCsvValue(values, ["responsavel_distribuidora", "utility_responsible"]), options: params.catalogs.utilityResponsibles, required: true, label: "Responsavel Distribuidora" });
    const utilityFieldManager = validateCatalog({ issues, rowNumber, column: "gestor_campo_distribuidora", raw: resolveCsvValue(values, ["gestor_campo_distribuidora", "gestor_campo", "utility_field_manager"]), options: params.catalogs.utilityFieldManagers, required: true, label: "Gestor de campo Distribuidora" });
    const city = validateCatalog({ issues, rowNumber, column: "municipio", raw: resolveCsvValue(values, ["municipio", "cidade", "city"]), options: params.catalogs.cities, required: true, label: "Municipio" });
    const street = normalizeText(resolveCsvValue(values, ["logradouro", "rua", "street"]));
    const neighborhood = normalizeText(resolveCsvValue(values, ["bairro", "neighborhood"]));

    if (!sob) {
      issues.push({ rowNumber, column: "projeto", value: sob, error: "Projeto (SOB) obrigatorio." });
    } else if (seenSobs.has(sob)) {
      issues.push({ rowNumber, column: "projeto", value: sob, error: "Projeto (SOB) duplicado no arquivo." });
    }
    if (!executionDeadline) {
      issues.push({ rowNumber, column: "data_limite", value: executionDeadlineRaw, error: "Data limite invalida. Use dd/mm/aaaa ou aaaa-mm-dd." });
    }
    if (estimatedValue === null) {
      issues.push({ rowNumber, column: "valor_estimado", value: estimatedValueRaw, error: "Valor estimado invalido. Informe valor maior ou igual a zero." });
    }
    if (!street) {
      issues.push({ rowNumber, column: "logradouro", value: street, error: "Logradouro obrigatorio." });
    }
    if (!neighborhood) {
      issues.push({ rowNumber, column: "bairro", value: neighborhood, error: "Bairro obrigatorio." });
    }

    if (sob) {
      seenSobs.add(sob);
    }

    if (issues.length === issuesBefore) {
      rows.push({
        rowNumber,
        sob,
        priority,
        serviceCenter,
        serviceType,
        executionDeadline: executionDeadline ?? "",
        estimatedValue: estimatedValue ?? "0.00",
        voltageLevel,
        projectSize,
        contractorResponsible,
        utilityResponsible,
        utilityFieldManager,
        street,
        neighborhood,
        city,
        serviceDescription: normalizeText(resolveCsvValue(values, ["descricao_servico", "descricao", "service_description"])),
        observation: normalizeText(resolveCsvValue(values, ["observacao", "obs", "observation"])),
        isTest: parseBoolean(resolveCsvValue(values, ["obra_teste", "teste", "is_test"])),
        isWithdrawn: parseBoolean(resolveCsvValue(values, ["retirado_carteira", "retirado", "is_withdrawn"])),
        isThirdParty: parseBoolean(resolveCsvValue(values, ["terceiros", "terceiro", "is_third_party"])),
      });
    }
  }

  return { rows, issues };
}
