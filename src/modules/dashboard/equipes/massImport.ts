import {
  buildMassImportTemplateCsv,
  normalizeLookupText,
  readMassImportCsv,
  resolveCsvValue,
  type MassImportIssue,
} from "@/lib/utils/massImport";

export type TeamImportRow = {
  rowNumber: number;
  name: string;
  vehiclePlate: string;
  serviceCenterId: string;
  teamTypeId: string;
  teamCategoryId: string | null;
  foremanId: string;
  supervisorId: string;
};

export type TeamImportOption = {
  id: string;
  name: string;
};

// `tipo_operacional` define a regra de vinculo da equipe. `tipo_equipe` e a
// classificacao opcional TECNICA/COMERCIAL, mantida separada para relatorio.
const REQUIRED_HEADERS = ["nome", "placa", "base", "tipo_operacional"];

export const TEAM_MASS_IMPORT_COLUMNS_HINT =
  "Colunas obrigatorias: nome, placa, base e tipo_operacional. Tipo_equipe e opcional. Se tipo_operacional for COMERCIAL, supervisor e obrigatorio e encarregado e ignorado; nos demais tipos operacionais, encarregado e obrigatorio. Base, tipos, encarregado e supervisor sao informados pelo nome exato cadastrado no tenant.";

function normalizeText(value: string) {
  return String(value ?? "").trim();
}

/**
 * Indexa as opcoes pelo nome normalizado. Nomes repetidos ficam marcados como
 * ambiguos para o import recusar a linha em vez de escolher um registro no escuro.
 */
function indexByName(options: TeamImportOption[]) {
  const index = new Map<string, TeamImportOption | "AMBIGUOUS">();

  for (const option of options) {
    const key = normalizeLookupText(option.name);
    if (!key) {
      continue;
    }

    index.set(key, index.has(key) ? "AMBIGUOUS" : option);
  }

  return index;
}

export function buildTeamMassImportTemplateCsv() {
  return buildMassImportTemplateCsv(
    ["nome", "placa", "base", "tipo_operacional", "tipo_equipe", "encarregado", "supervisor"],
    [
      ["EQUIPE 01", "ABC1D23", "BASE CENTRO", "LEVE", "TECNICA", "JOAO DA SILVA", "MARIA SOUZA"],
      ["EQUIPE COMERCIAL 01", "XYZ4E56", "BASE NORTE", "COMERCIAL", "COMERCIAL", "", "MARIA SOUZA"],
    ],
  );
}

export function parseTeamMassImportCsv(params: {
  content: string;
  fileName: string;
  serviceCenters: TeamImportOption[];
  teamTypes: TeamImportOption[];
  teamCategories: TeamImportOption[];
  foremen: TeamImportOption[];
  supervisors: TeamImportOption[];
}) {
  const table = readMassImportCsv({
    content: params.content,
    fileName: params.fileName,
    requiredHeaders: REQUIRED_HEADERS,
  });
  const issues: MassImportIssue[] = [...table.issues];
  const rows: TeamImportRow[] = [];
  const seenPlates = new Set<string>();
  const seenForemen = new Set<string>();
  const serviceCenterByName = indexByName(params.serviceCenters);
  const teamTypeByName = indexByName(params.teamTypes);
  const teamCategoryByName = indexByName(params.teamCategories);
  const foremanByName = indexByName(params.foremen);
  const supervisorByName = indexByName(params.supervisors);

  for (const { rowNumber, values } of table.rows) {
    const name = normalizeText(resolveCsvValue(values, ["nome", "nome_equipe", "name"]));
    const vehiclePlate = normalizeText(resolveCsvValue(values, ["placa", "placa_veiculo", "vehicle_plate"])).toUpperCase();
    const serviceCenterRaw = resolveCsvValue(values, ["base", "centro_servico", "service_center"]);
    const teamTypeRaw = resolveCsvValue(values, ["tipo_operacional", "tipo", "team_type"]);
    const teamCategoryRaw = resolveCsvValue(values, ["tipo_equipe", "categoria_equipe", "classificacao_equipe"]);
    const foremanRaw = resolveCsvValue(values, ["encarregado", "foreman"]);
    const supervisorRaw = resolveCsvValue(values, ["supervisor"]);
    const serviceCenter = serviceCenterByName.get(normalizeLookupText(serviceCenterRaw)) ?? null;
    const teamType = teamTypeByName.get(normalizeLookupText(teamTypeRaw)) ?? null;
    const teamCategory = teamCategoryByName.get(normalizeLookupText(teamCategoryRaw)) ?? null;
    const foreman = foremanByName.get(normalizeLookupText(foremanRaw)) ?? null;
    const supervisor = normalizeText(supervisorRaw)
      ? supervisorByName.get(normalizeLookupText(supervisorRaw)) ?? null
      : null;
    const issuesBefore = issues.length;

    if (!name) {
      issues.push({ rowNumber, column: "nome", value: name, error: "Nome da equipe obrigatorio." });
    }

    if (!vehiclePlate) {
      issues.push({ rowNumber, column: "placa", value: vehiclePlate, error: "Placa obrigatoria." });
    } else if (seenPlates.has(vehiclePlate)) {
      issues.push({ rowNumber, column: "placa", value: vehiclePlate, error: "Placa duplicada no arquivo." });
    }

    if (!serviceCenter) {
      issues.push({ rowNumber, column: "base", value: serviceCenterRaw, error: "Base invalida ou inativa." });
    } else if (serviceCenter === "AMBIGUOUS") {
      issues.push({ rowNumber, column: "base", value: serviceCenterRaw, error: "Existe mais de uma base com este nome." });
    }

    if (!teamType) {
      issues.push({ rowNumber, column: "tipo_operacional", value: teamTypeRaw, error: "Tipo operacional invalido ou inativo." });
    } else if (teamType === "AMBIGUOUS") {
      issues.push({ rowNumber, column: "tipo_operacional", value: teamTypeRaw, error: "Existe mais de um tipo operacional com este nome." });
    }

    if (normalizeText(teamCategoryRaw) && !teamCategory) {
      issues.push({ rowNumber, column: "tipo_equipe", value: teamCategoryRaw, error: "Tipo de equipe invalido ou inativo." });
    } else if (teamCategory === "AMBIGUOUS") {
      issues.push({ rowNumber, column: "tipo_equipe", value: teamCategoryRaw, error: "Existe mais de um tipo de equipe com este nome." });
    }

    const teamTypeName = teamType !== "AMBIGUOUS" && teamType ? normalizeLookupText(teamType.name) : "";
    const teamCategoryName = teamCategory !== "AMBIGUOUS" && teamCategory ? normalizeLookupText(teamCategory.name) : "";
    const isCommercial = teamTypeName === "comercial" || teamCategoryName === "comercial";

    // Encarregado e obrigatorio so em equipe TECNICA. Em COMERCIAL a coluna pode
    // vir vazia, mas se vier preenchida ainda precisa resolver — senao o vinculo
    // sumiria em silencio no import.
    const foremanRawText = normalizeText(foremanRaw);
    if (!isCommercial && foreman === "AMBIGUOUS") {
      issues.push({ rowNumber, column: "encarregado", value: foremanRaw, error: "Existe mais de um encarregado com este nome." });
    } else if (!isCommercial && !foremanRawText) {
      issues.push({ rowNumber, column: "encarregado", value: foremanRaw, error: "Encarregado obrigatorio para equipe tecnica." });
    } else if (!isCommercial && foremanRawText && !foreman) {
      issues.push({ rowNumber, column: "encarregado", value: foremanRaw, error: "Encarregado invalido ou inativo." });
    } else if (!isCommercial && foreman && foreman !== "AMBIGUOUS" && seenForemen.has(foreman.id)) {
      issues.push({ rowNumber, column: "encarregado", value: foremanRaw, error: "Encarregado repetido no arquivo. Cada encarregado so pode ter uma equipe ativa." });
    }

    if (isCommercial && !normalizeText(supervisorRaw)) {
      issues.push({ rowNumber, column: "supervisor", value: supervisorRaw, error: "Supervisor obrigatorio para equipe comercial." });
    }

    if (normalizeText(supervisorRaw) && !supervisor) {
      issues.push({ rowNumber, column: "supervisor", value: supervisorRaw, error: "Supervisor invalido ou inativo." });
    } else if (supervisor === "AMBIGUOUS") {
      issues.push({ rowNumber, column: "supervisor", value: supervisorRaw, error: "Existe mais de um supervisor com este nome." });
    }

    if (vehiclePlate) {
      seenPlates.add(vehiclePlate);
    }

    if (!isCommercial && foreman && foreman !== "AMBIGUOUS") {
      seenForemen.add(foreman.id);
    }

    if (issues.length === issuesBefore) {
      rows.push({
        rowNumber,
        name,
        vehiclePlate,
        serviceCenterId: serviceCenter !== "AMBIGUOUS" && serviceCenter ? serviceCenter.id : "",
        teamTypeId: teamType !== "AMBIGUOUS" && teamType ? teamType.id : "",
        teamCategoryId: teamCategory !== "AMBIGUOUS" && teamCategory ? teamCategory.id : null,
        foremanId: !isCommercial && foreman !== "AMBIGUOUS" && foreman ? foreman.id : "",
        supervisorId: supervisor !== "AMBIGUOUS" && supervisor ? supervisor.id : "",
      });
    }
  }

  return { rows, issues };
}
