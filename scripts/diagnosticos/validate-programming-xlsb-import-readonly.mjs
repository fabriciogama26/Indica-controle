// validate-programming-xlsb-import-readonly.mjs
// Diagnostico SOMENTE-LEITURA para carga em massa da Programacao Normalizada.
// Le uma planilha .xlsb/.xlsx no layout de Extracao ENEL NOVO, cruza com o
// Supabase do `.env` e aponta bloqueios antes de qualquer tentativa de import.
//
// Rodar (raiz do repo):
//   node scripts/diagnosticos/validate-programming-xlsb-import-readonly.mjs --file "C:\Users\operador\Downloads\PROGRAMAÇÃO_MACAÉ_INDICA.xlsb" --tenant-name "MACAÉ"
//
// Este script NAO faz INSERT/UPDATE/DELETE e NAO chama RPC de escrita.

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(repoRoot, "package.json"));
const XLSX = require("xlsx");

const DEFAULT_FILE = "C:\\Users\\operador\\Downloads\\PROGRAMAÇÃO_MACAÉ_INDICA.xlsb";
const DEFAULT_TENANT_NAME = "MACAÉ";
const READ_CHUNK = 500;

const HEADER_ALIASES = {
  base: ["BASE"],
  serviceType: ["Tipo de Serviço"],
  project: ["Projeto"],
  executionDate: ["DATA"],
  period: ["Período"],
  startTime: ["Hor Inic Obra"],
  endTime: ["Hor Térm Obra"],
  expectedTime: ["Tempo Previsto"],
  status: ["STATUS"],
  infoStatus: ["INFO STATUS"],
  priority: ["PRIORIDADE"],
  teams: ["Estrutura"],
  plate: ["Placa"],
  note: ["Anotação"],
  support: ["Apoio"],
  utilityResponsible: ["Responsáveis Enel", "Responsáveis\nEnel"],
  partner: ["Parceira"],
  executionResponsible: ["Responsável Execução"],
  freeArea: ["AREA LIVRE"],
  request: ["SOLICITAÇÃO"],
  sgdType: ["Tipo de SGD"],
  sgdNumber: ["NÚMERO SGD"],
  affectedCustomers: ["Nº Clientes Afetados", "Nº Clientes \nAfetados"],
  electricalEq: ["Nº EQ (RE, CO, CF, CC ou TR)"],
  outageStart: ["Inic deslig"],
  outageEnd: ["Térm deslig"],
  feeder: ["Alim."],
  street: ["Logradouro"],
  district: ["Bairro"],
  municipality: ["Município"],
  serviceDescription: ["Descrição do serviço"],
  reason: ["Motivo do Cancelamento / Parcial / Adiamento"],
  reasonNote: ["Observação do Cancelamento / Parcial / Adiamento"],
  programmedAt: ["Data da programação"],
  advanceType: ["Tipo de avanço"],
  btMt: ["BT / MT"],
  networkType: ["Tipo de rede"],
  networkStatus: ["Status rede"],
  cableType: ["Tipo de cabo"],
  networkServiceType: ["Tipo de serviço"],
  networkKm: ["km"],
  equipmentType: ["Tipo de equipamento"],
  equipmentStatus: ["Status equipamento"],
  equipmentPower: ["Potência equipamento"],
  equipmentQty: ["Qtd equipamentos"],
  poleType: ["Tipo poste"],
  poleStatus: ["Status poste"],
  poleQty: ["Qtd Postes"],
  clandestineQty: ["Qtd Clandestinos"],
};

function usage() {
  console.log("Uso:");
  console.log("  node scripts/diagnosticos/validate-programming-xlsb-import-readonly.mjs --file <arquivo.xlsb> [--tenant-name MACAÉ] [--tenant <uuid>]");
}

function parseArgs(argv) {
  const args = { file: DEFAULT_FILE, tenantName: DEFAULT_TENANT_NAME, tenantId: null };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--file") args.file = argv[++index];
    else if (arg === "--tenant-name") args.tenantName = argv[++index];
    else if (arg === "--tenant") args.tenantId = argv[++index];
    else throw new Error(`Argumento desconhecido: ${arg}`);
  }
  if (!args.file) throw new Error("Informe --file.");
  return args;
}

function loadEnv() {
  const envPath = join(repoRoot, ".env");
  if (!existsSync(envPath)) throw new Error("Arquivo .env nao encontrado na raiz do repositorio.");
  const env = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[trimmed.slice(0, eq).trim()] = value;
  }
  return env;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/\s+/g, " ").trim();
}

function isBlank(value) {
  const text = normalizeText(value);
  return text === "" || text === "-" || text === "--" || text === "0";
}

function cellText(row, index) {
  if (index < 0) return "";
  return normalizeText(row[index]);
}

function splitPipe(value) {
  return normalizeText(value)
    .split("|")
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function parseExcelDate(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return `${String(parsed.y).padStart(4, "0")}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const text = normalizeText(value);
  if (!text || text === "-" || text === "--") return null;

  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const yearRaw = Number(slash[3]);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    const month = first > 12 && second <= 12 ? second : first;
    const day = first > 12 && second <= 12 ? first : second;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const dash = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dash) return `${dash[1]}-${dash[2]}-${dash[3]}`;
  return null;
}

function parseTime(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    const totalMinutes = Math.round(value * 24 * 60);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }
  const text = normalizeText(value);
  if (!text || text === "-" || text === "--") return null;
  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parseNumber(value) {
  if (isBlank(value)) return null;
  const normalized = normalizeText(value).replace(/\./g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function headerIndex(headers, aliases) {
  const normalizedHeaders = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    const found = normalizedHeaders.findIndex((header) => normalizeKey(header) === normalizeKey(normalizedAlias));
    if (found >= 0) return found;
  }
  return -1;
}

function countBy(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const value = row[key] || "(vazio)";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function readWorkbook(file) {
  if (!existsSync(file)) throw new Error(`Arquivo nao encontrado: ${file}`);
  const workbook = XLSX.readFile(file, { cellDates: false });
  if (!workbook.SheetNames.length) throw new Error("A planilha nao tem abas.");
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null, raw: false });
  const headers = rows[0] ?? [];
  const columns = Object.fromEntries(Object.entries(HEADER_ALIASES).map(([key, aliases]) => [key, headerIndex(headers, aliases)]));
  const required = ["base", "project", "executionDate", "period", "startTime", "endTime", "status", "infoStatus", "teams"];
  const missingHeaders = required.filter((key) => columns[key] < 0);
  if (missingHeaders.length) throw new Error(`Cabecalhos obrigatorios ausentes: ${missingHeaders.join(", ")}`);

  const dataRows = rows.slice(1).filter((row) => row.some((value) => !isBlank(value)));
  const parsedRows = dataRows.map((row, index) => {
    const status = normalizeKey(cellText(row, columns.status));
    return {
      line: index + 2,
      base: cellText(row, columns.base),
      projectSob: normalizeKey(cellText(row, columns.project)),
      executionDate: parseExcelDate(row[columns.executionDate]),
      period: normalizeKey(cellText(row, columns.period)),
      startTime: parseTime(row[columns.startTime]),
      endTime: parseTime(row[columns.endTime]),
      expectedTime: cellText(row, columns.expectedTime),
      status,
      infoStatus: normalizeKey(cellText(row, columns.infoStatus)),
      priority: cellText(row, columns.priority),
      teamNames: splitPipe(row[columns.teams]).map((name) => normalizeKey(name)),
      sgdType: cellText(row, columns.sgdType),
      sgdNumber: cellText(row, columns.sgdNumber),
      affectedCustomers: parseNumber(row[columns.affectedCustomers]),
      electricalEq: cellText(row, columns.electricalEq),
      outageStart: parseTime(row[columns.outageStart]),
      outageEnd: parseTime(row[columns.outageEnd]),
      feeder: cellText(row, columns.feeder),
      serviceDescription: cellText(row, columns.serviceDescription),
      note: cellText(row, columns.note),
      reason: cellText(row, columns.reason),
      reasonNote: cellText(row, columns.reasonNote),
      programmedAt: parseExcelDate(row[columns.programmedAt]),
      municipality: cellText(row, columns.municipality),
      poleQty: parseNumber(row[columns.poleQty]),
      equipmentQty: parseNumber(row[columns.equipmentQty]),
      networkKm: parseNumber(row[columns.networkKm]),
    };
  });

  return { sheetName, headers, columns, rows: parsedRows };
}

async function loadAll(queryFactory) {
  const all = [];
  for (let from = 0; ; from += READ_CHUNK) {
    const to = from + READ_CHUNK - 1;
    const { data, error } = await queryFactory(from, to);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    all.push(...page);
    if (page.length < READ_CHUNK) break;
  }
  return all;
}

async function resolveTenant(supabase, tenantId, tenantName) {
  if (tenantId) {
    const { data, error } = await supabase.from("tenants").select("id, name, ativo").eq("id", tenantId).maybeSingle();
    if (error) throw new Error(`Falha ao carregar tenant informado: ${error.message}`);
    if (!data) throw new Error(`Tenant nao encontrado: ${tenantId}`);
    return data;
  }

  const { data, error } = await supabase.from("tenants").select("id, name, ativo").order("name", { ascending: true });
  if (error) throw new Error(`Falha ao listar tenants: ${error.message}`);
  const expected = normalizeKey(tenantName);
  const matches = (data ?? []).filter((tenant) => normalizeKey(tenant.name).includes(expected));
  if (matches.length !== 1) {
    const detail = matches.map((tenant) => `${tenant.name} (${tenant.id})`).join(", ") || "nenhum";
    throw new Error(`Esperado encontrar exatamente 1 tenant por nome "${tenantName}", encontrados: ${detail}. Use --tenant <uuid>.`);
  }
  return matches[0];
}

async function main() {
  const args = parseArgs(process.argv);
  const env = loadEnv();
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("`.env` precisa de SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");

  const workbook = readWorkbook(args.file);
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const tenant = await resolveTenant(supabase, args.tenantId, args.tenantName);
  const tenantId = tenant.id;

  const projectSobs = [...new Set(workbook.rows.map((row) => row.projectSob).filter(Boolean))].sort();
  const teamNames = [...new Set(workbook.rows.flatMap((row) => row.teamNames).filter(Boolean))].sort();
  const sgdTypes = [...new Set(workbook.rows.map((row) => normalizeKey(row.sgdType)).filter((value) => value && value !== "-" && value !== "--"))].sort();

  const [projects, teams, existingStages, sgdCatalog, activeUsers] = await Promise.all([
    loadAll((from, to) =>
      supabase
        .from("project")
        .select("id, sob, is_active")
        .eq("tenant_id", tenantId)
        .in("sob", projectSobs)
        .range(from, to),
    ),
    loadAll((from, to) =>
      supabase
        .from("teams")
        .select("id, name, ativo, foreman_person_id")
        .eq("tenant_id", tenantId)
        .order("name", { ascending: true })
        .range(from, to),
    ),
    loadAll((from, to) =>
      supabase
        .from("programming")
        .select("id, project_id, execution_date, status, work_completion_status, updated_at")
        .eq("tenant_id", tenantId)
        .range(from, to),
    ),
    loadAll((from, to) =>
      supabase
        .from("programming_sgd_types")
        .select("id, description, is_active")
        .eq("tenant_id", tenantId)
        .order("description", { ascending: true })
        .range(from, to),
    ),
    loadAll((from, to) =>
      supabase
        .from("app_users")
        .select("id, display, login_name, ativo")
        .eq("tenant_id", tenantId)
        .eq("ativo", true)
        .range(from, to),
    ),
  ]);

  const projectBySob = new Map(projects.map((project) => [normalizeKey(project.sob), project]));
  const teamByName = new Map(teams.map((team) => [normalizeKey(team.name), team]));
  const sgdByDescription = new Map(sgdCatalog.map((item) => [normalizeKey(item.description), item]));
  const existingStageKeys = new Map(existingStages.map((stage) => [`${stage.project_id}|${stage.execution_date}`, stage]));

  const rowFindings = [];
  const importableCreateRows = [];
  for (const row of workbook.rows) {
    const issues = [];
    const warnings = [];
    const project = projectBySob.get(row.projectSob);

    if (!project) issues.push("PROJECT_NOT_FOUND");
    else if (project.is_active === false) issues.push("PROJECT_INACTIVE");

    if (!row.executionDate) issues.push("INVALID_EXECUTION_DATE");
    if (!["INTEGRAL", "PARCIAL"].includes(row.period)) issues.push("INVALID_PERIOD");
    if (!row.startTime) issues.push("INVALID_START_TIME");
    if (!row.endTime) issues.push("INVALID_END_TIME");
    if (!row.teamNames.length) warnings.push("NO_TEAM");

    for (const teamName of row.teamNames) {
      const team = teamByName.get(teamName);
      if (!team) issues.push(`TEAM_NOT_FOUND:${teamName}`);
      else if (team.ativo === false) issues.push(`TEAM_INACTIVE:${teamName}`);
      else if (!team.foreman_person_id) issues.push(`TEAM_WITHOUT_FOREMAN:${teamName}`);
    }

    if (row.sgdType && !isBlank(row.sgdType) && !sgdByDescription.get(normalizeKey(row.sgdType))) {
      issues.push(`SGD_TYPE_NOT_FOUND:${row.sgdType}`);
    }

    if (project && row.executionDate) {
      const existing = existingStageKeys.get(`${project.id}|${row.executionDate}`);
      if (existing) issues.push(`PROGRAMMING_ALREADY_EXISTS:${existing.status}`);
    }

    if (row.status === "PROGRAMADO") {
      importableCreateRows.push(row);
    } else if (row.status === "CONCLUIDO") {
      warnings.push("NEEDS_POST_CREATE_COMPLETE_RPC");
    } else if (row.status === "EXECUTADO") {
      warnings.push("AMBIGUOUS_EXECUTADO_NEEDS_WORK_STATUS_DECISION");
    } else if (row.status === "ADIADO") {
      warnings.push("ADIADO_NEEDS_REASON_AND_SEMANTIC_DECISION");
      if (!row.reason && !row.reasonNote) warnings.push("ADIADO_WITHOUT_REASON");
    } else if (row.status === "CANCELADO") {
      warnings.push("CANCELADO_NEEDS_REASON");
      if (!row.reason && !row.reasonNote) warnings.push("CANCELADO_WITHOUT_REASON");
    } else if (row.status === "ANTECIPADO") {
      warnings.push("ANTECIPADO_IS_DERIVED_REQUIRES_SOURCE_STAGE");
    } else {
      issues.push(`UNKNOWN_STATUS:${row.status}`);
    }

    if (!row.serviceDescription || isBlank(row.serviceDescription)) warnings.push("EMPTY_SERVICE_DESCRIPTION");
    if (!row.sgdNumber || isBlank(row.sgdNumber)) warnings.push("EMPTY_SGD_NUMBER");
    if (!row.electricalEq || isBlank(row.electricalEq)) warnings.push("EMPTY_ELECTRICAL_EQ");

    rowFindings.push({ row, project, issues, warnings });
  }

  const blockingRows = rowFindings.filter((item) => item.issues.length);
  const warningRows = rowFindings.filter((item) => item.warnings.length);
  const missingProjects = projectSobs.filter((sob) => !projectBySob.has(sob));
  const missingTeams = teamNames.filter((name) => !teamByName.has(name));
  const inactiveTeams = teamNames
    .map((name) => teamByName.get(name))
    .filter((team) => team?.ativo === false)
    .map((team) => team.name);
  const teamsWithoutForeman = teamNames
    .map((name) => teamByName.get(name))
    .filter((team) => team && team.ativo !== false && !team.foreman_person_id)
    .map((team) => team.name);
  const missingSgdTypes = sgdTypes.filter((description) => !sgdByDescription.has(description));

  console.log("=== Validacao de importacao da Programacao Normalizada (somente leitura) ===");
  console.log(`Arquivo: ${args.file}`);
  console.log(`Aba: ${workbook.sheetName}`);
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);
  console.log(`Linhas de dados: ${workbook.rows.length}`);
  console.log(`Projetos unicos: ${projectSobs.length}`);
  console.log(`Equipes unicas na planilha: ${teamNames.length}`);
  console.log(`Usuarios ativos para ator da carga: ${activeUsers.length}`);
  console.log("");

  console.log("Status da planilha:");
  for (const [status, count] of countBy(workbook.rows, "status")) console.log(`  ${status}: ${count}`);
  console.log("");

  console.log("Resultado:");
  console.log(`  Linhas com bloqueio: ${blockingRows.length}`);
  console.log(`  Linhas com alerta: ${warningRows.length}`);
  console.log(`  Linhas PROGRAMADO sem bloqueio tecnico basico: ${importableCreateRows.filter((row) => !rowFindings.find((item) => item.row === row)?.issues.length).length}`);
  console.log("");

  if (missingProjects.length) {
    console.log("Projetos nao encontrados no tenant:");
    for (const sob of missingProjects) console.log(`  - ${sob}`);
    console.log("");
  }

  if (missingTeams.length || inactiveTeams.length || teamsWithoutForeman.length) {
    console.log("Equipes com problema:");
    for (const name of missingTeams) console.log(`  - ${name}: nao encontrada`);
    for (const name of inactiveTeams) console.log(`  - ${name}: inativa`);
    for (const name of teamsWithoutForeman) console.log(`  - ${name}: sem encarregado padrao`);
    console.log("");
  }

  if (missingSgdTypes.length) {
    console.log("Tipos de SGD nao encontrados:");
    for (const description of missingSgdTypes) console.log(`  - ${description}`);
    console.log("");
  }

  const rowsToShow = rowFindings.filter((item) => item.issues.length || item.warnings.length);
  if (rowsToShow.length) {
    console.log("Linhas com bloqueios/alertas:");
    for (const item of rowsToShow) {
      const label = `linha ${item.row.line} | ${item.row.projectSob} | ${item.row.executionDate ?? "data invalida"} | ${item.row.status}`;
      const details = [...item.issues.map((issue) => `BLOQUEIO:${issue}`), ...item.warnings.map((warning) => `ALERTA:${warning}`)];
      console.log(`  - ${label} -> ${details.join("; ")}`);
    }
    console.log("");
  }

  console.log("Leitura sugerida:");
  if (blockingRows.length) {
    console.log("  NAO importar ainda. Resolva os bloqueios acima antes de qualquer escrita.");
  } else {
    console.log("  Sem bloqueios tecnicos basicos. Ainda falta decisao de mapeamento para status derivados antes da carga.");
  }
}

main().catch((error) => {
  console.error(`FALHA: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
