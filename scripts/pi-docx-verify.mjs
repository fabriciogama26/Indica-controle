/**
 * pi-docx-verify.mjs — verificacao do template DOCX da Permissao de Intervencao.
 *
 * Nao existe runner de teste neste repositorio (nao ha script `test` no
 * package.json; CLAUDE.md secao 9 registra isso como lacuna conhecida). Este
 * script segue o padrao dos demais `scripts/*.mjs`: roda com `node`, imprime o
 * resultado e sai com codigo 1 na primeira falha.
 *
 * Ele importa o CODIGO REAL do modulo, nao uma copia: se o mapper ou o contrato
 * de tags mudarem, a verificacao acompanha.
 *
 * Uso:
 *   node scripts/pi-docx-verify.mjs                 # usa public/Modelo_PI_Template_Tags.docx
 *   node scripts/pi-docx-verify.mjs --storage       # baixa o template ativo do Supabase Storage
 *   node scripts/pi-docx-verify.mjs --out <pasta>   # onde gravar os DOCX gerados
 *
 * Os DOCX gerados existem para conferencia VISUAL no Word. Nenhuma verificacao
 * automatica substitui abrir o arquivo e olhar o layout: o risco conhecido do
 * template e a fonte do glifo de caixa marcada, que so o Word revela.
 */

import { registerHooks } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolvePath(scriptDir, "..");

/**
 * O repositorio importa sem extensao (`moduleResolution: bundler` no
 * tsconfig). O resolver do Node exige extensao explicita. Este hook fecha a
 * lacuna apenas para este script, sem alterar nenhuma convencao do projeto nem
 * exigir ferramenta de build adicional.
 *
 * Precisa rodar ANTES de qualquer import dos modulos TypeScript, por isso os
 * imports abaixo sao dinamicos.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      const base = new URL(specifier, context.parentURL);
      for (const extension of [".ts", ".tsx", "/index.ts"]) {
        const candidate = new URL(base.href + extension);
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const { findUnresolvedDocxTags, listDocxTemplateTags, renderDocxTemplate } = await import(
  `${new URL("../src/lib/server/docxTemplate.ts", import.meta.url)}`
);
const { buildPiTemplateTagReport, isPiTemplateActivatable, PI_EXECUTION_PLAN_SLOTS, PI_TEMPLATE_TAGS } = await import(
  `${new URL("../src/server/modules/permissao-intervencao/piTemplateTags.ts", import.meta.url)}`
);
const { buildPiTemplateData, findPiTemplateDataGaps, validatePiDocumentData } = await import(
  `${new URL("../src/server/modules/permissao-intervencao/piTemplateMapper.ts", import.meta.url)}`
);

// ---------------------------------------------------------------------------
// Infraestrutura minima de verificacao
// ---------------------------------------------------------------------------

const failures = [];
let checks = 0;

function check(label, condition, detail) {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
    return true;
  }
  console.log(`  FALHA ${label}${detail ? ` -> ${detail}` : ""}`);
  failures.push(label);
  return false;
}

function section(title) {
  console.log(`\n=== ${title}`);
}

// ---------------------------------------------------------------------------
// Dados de demonstracao
// ---------------------------------------------------------------------------

function demoStep(index) {
  return {
    workZone: `Zona ${index} - entre postes P${index} e P${index + 1}`,
    teamName: index % 2 === 0 ? "LV-02" : "MK-01",
    activity: `Etapa ${index}: atividade prevista no plano de execucao`,
  };
}

/**
 * Conjunto completo, com acentuacao, multilinha e todas as caixas em uso.
 * Serve tanto de fixture da verificacao quanto de base do DOCX de conferencia.
 */
function buildDemoData(overrides = {}) {
  const base = {
    piCode: "PI-RJ-MT-PM-INDICA-0001",
    projectCode: "0013199671",
    responsibleParty: {
      managerName: "LUIZ CARLOS QUINTANILHA JÚNIOR",
      companyName: "INDICA SERVIÇOS",
      contractNumber: "2024/001",
      managerPhone: "(21) 99999-0000",
      managerEmail: "gestor@indica.com.br",
    },
    operationAreas: ["PM", "CE"],
    utilityContact: {
      name: "MARIA APARECIDA GONÇALVES",
      phone: "(21) 98888-1111",
      email: "contato.unidade@enel.com",
      operationAreas: ["OM"],
    },
    activity: {
      description:
        "Substituição de poste de concreto 11/300.\nInstalação de chave fusível.\nPoda de árvore em conflito com a rede.",
      workPlan: "PT-2026-004512",
      liveWorkAuthorization: "AT-2026-000987",
      preApr: "APR-88123",
      emergencyAuthorization: "",
    },
    location: {
      installationDescription: "Ramal de distribuição urbano, trecho residencial com carga concentrada.",
      feeder: "MUR02",
      address: "Rua das Palmeiras, 145 - Centro",
      coordX: "-44.318920",
      coordY: "-22.973410",
      blockedElements: "CH-4471, CH-4472",
      cutElements: "CD-1188",
    },
    voltageLevels: ["MT", "BT"],
    interference: {
      present: true,
      voltageLevels: ["AT"],
      proximityDescription: "Linha de transmissão 138 kV paralela ao trecho, afastamento aproximado de 9 metros.",
    },
    schedule: {
      startDate: "2026-09-14",
      startTime: "07:30:00",
      endDate: "2026-09-14",
      endTime: "17:00:00",
      secondaryDate: null,
      secondaryStartTime: null,
    },
    trafficInstructions:
      "Bloqueio parcial da via com cones a cada 5 metros.\nSinalização a 50 metros nos dois sentidos.\nApoio de bandeirinha durante o içamento.",
    emergencyPlan:
      "1. Interromper a atividade e isolar a área.\n2. Acionar o SAMU (192) e a supervisão.\n3. Registrar a ocorrência no sistema em até 2 horas.",
    responsibles: {
      supervisor: "JOÃO PEREIRA DA SILVA",
      supervisorAlternate: "CARLOS EDUARDO RAMOS",
      foreman: "JOSÉ ANTÔNIO NUNES",
      foremanAlternate: "MARCOS VINÍCIUS LIMA",
    },
    executionSteps: [1, 2, 3, 4, 5].map(demoStep),
    observations: "Documento gerado para conferência visual do template. Não vale como PI emitida.",
    preparedAt: { date: "2026-09-10", time: "13:02:00" },
    validatedAt: { date: "2026-09-11", time: "09:45:00" },
  };

  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Carga do template
// ---------------------------------------------------------------------------

async function loadTemplateFromStorage() {
  const require = createRequire(join(repoRoot, "package.json"));
  const { createClient } = require("@supabase/supabase-js");

  const envPath = join(repoRoot, ".env");
  if (!existsSync(envPath)) throw new Error("Modo --storage exige .env com SUPABASE_SERVICE_ROLE_KEY.");

  const env = Object.fromEntries(
    readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      }),
  );

  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const client = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const listing = await client.storage.from("pi-templates").list("", { limit: 100 });
  if (listing.error) throw new Error(`Falha ao listar o bucket: ${listing.error.message}`);

  const entry = (listing.data ?? []).find((item) => item.name.toLowerCase().endsWith(".docx"));
  if (!entry) throw new Error("Nenhum .docx encontrado na raiz do bucket pi-templates.");

  const download = await client.storage.from("pi-templates").download(entry.name);
  if (download.error) throw new Error(`Falha ao baixar o template: ${download.error.message}`);

  return { buffer: Buffer.from(await download.data.arrayBuffer()), origin: `storage:pi-templates/${entry.name}` };
}

function loadTemplateFromDisk() {
  const path = join(repoRoot, "public", "Modelo_PI_Template_Tags.docx");
  if (!existsSync(path)) throw new Error(`Template nao encontrado em ${path}.`);
  return { buffer: readFileSync(path), origin: "disco:public/Modelo_PI_Template_Tags.docx" };
}

// ---------------------------------------------------------------------------
// Casos
// ---------------------------------------------------------------------------

function unwrap(result, label) {
  if (!result.ok) {
    check(label, false, `${result.error.code}: ${result.error.details.join(" | ") || result.error.message}`);
    return null;
  }
  return result.value;
}

/** Renderiza e devolve o buffer, ja checando que nao sobrou tag. */
function renderAndSweep(templateBuffer, data, label) {
  const mapped = buildPiTemplateData(data);

  const gaps = findPiTemplateDataGaps(mapped);
  check(`${label}: mapper cobre o contrato`, gaps.missing.length === 0, `faltando: ${gaps.missing.join(", ")}`);
  check(`${label}: mapper nao inventa chave`, gaps.extra.length === 0, `sobrando: ${gaps.extra.join(", ")}`);

  const rendered = unwrap(renderDocxTemplate(templateBuffer, mapped), `${label}: renderiza`);
  if (!rendered) return null;
  check(`${label}: renderiza`, true);

  const leftovers = unwrap(findUnresolvedDocxTags(rendered), `${label}: varredura pos-render`);
  if (leftovers === null) return null;
  check(`${label}: nenhuma tag sobrou`, leftovers.length === 0, leftovers.join(", "));

  return rendered;
}

async function main() {
  const args = process.argv.slice(2);
  const useStorage = args.includes("--storage");
  const outIndex = args.indexOf("--out");
  const outDir = outIndex >= 0 && args[outIndex + 1] ? resolvePath(args[outIndex + 1]) : join(repoRoot, ".tmp", "pi-docx");

  const { buffer: template, origin } = useStorage ? await loadTemplateFromStorage() : loadTemplateFromDisk();
  console.log(`Template: ${origin} (${template.length} bytes)`);
  mkdirSync(outDir, { recursive: true });

  // -------------------------------------------------------------------------
  section("Contrato de tags do template");
  const found = unwrap(listDocxTemplateTags(template), "le as tags do template");
  if (!found) return;

  const report = buildPiTemplateTagReport(found);
  check(`contrato declara ${PI_TEMPLATE_TAGS.length} tags`, PI_TEMPLATE_TAGS.length === 129, String(PI_TEMPLATE_TAGS.length));
  check("nenhuma obrigatoria faltando", report.missingRequired.length === 0, report.missingRequired.join(", "));
  check("nenhuma tag desconhecida", report.unknown.length === 0, report.unknown.join(", "));
  check("nenhuma tag do contrato faltando", report.missing.length === 0, report.missing.join(", "));
  check("template ativavel", isPiTemplateActivatable(report));
  check(
    "tags do plano de execucao completas",
    PI_TEMPLATE_TAGS.filter((tag) => /^(z|eq|at)\d{2}$/.test(tag)).length === PI_EXECUTION_PLAN_SLOTS * 3,
  );

  // -------------------------------------------------------------------------
  section("Caso completo (acentuacao, multilinha, todas as caixas)");
  const full = renderAndSweep(template, buildDemoData(), "completo");
  if (full) {
    const path = join(outDir, "pi-demo-completo.docx");
    writeFileSync(path, full);
    console.log(`  arquivo: ${path}`);
  }

  // -------------------------------------------------------------------------
  section("Plano de execucao: 1 etapa, 23 etapas, limpeza dos slots vazios");
  const oneStep = renderAndSweep(template, buildDemoData({ executionSteps: [demoStep(1)] }), "1 etapa");
  if (oneStep) writeFileSync(join(outDir, "pi-demo-1-etapa.docx"), oneStep);

  const maxSteps = Array.from({ length: PI_EXECUTION_PLAN_SLOTS }, (_, index) => demoStep(index + 1));
  const full23 = renderAndSweep(template, buildDemoData({ executionSteps: maxSteps }), "23 etapas");
  if (full23) writeFileSync(join(outDir, "pi-demo-23-etapas.docx"), full23);

  // -------------------------------------------------------------------------
  section("Plano de execucao: estouro deve falhar, nunca truncar");
  const overflowSteps = Array.from({ length: PI_EXECUTION_PLAN_SLOTS + 1 }, (_, index) => demoStep(index + 1));
  const overflowIssues = validatePiDocumentData(buildDemoData({ executionSteps: overflowSteps }));
  check(
    "24 etapas produzem erro EXECUTION_PLAN_OVERFLOW",
    overflowIssues.some((issue) => issue.code === "EXECUTION_PLAN_OVERFLOW" && issue.severity === "ERROR"),
    JSON.stringify(overflowIssues),
  );

  let threw = false;
  try {
    buildPiTemplateData(buildDemoData({ executionSteps: overflowSteps }));
  } catch {
    threw = true;
  }
  check("mapper recusa 24 etapas em vez de truncar", threw);

  // -------------------------------------------------------------------------
  section("Campos nulos e vazios");
  const empty = buildDemoData({
    executionSteps: [demoStep(1)],
    operationAreas: [],
    voltageLevels: [],
    interference: { present: null, voltageLevels: [], proximityDescription: null },
    observations: null,
    trafficInstructions: null,
    emergencyPlan: null,
    schedule: {
      startDate: null,
      startTime: null,
      endDate: null,
      endTime: null,
      secondaryDate: null,
      secondaryStartTime: null,
    },
    responsibles: { supervisor: null, supervisorAlternate: null, foreman: null, foremanAlternate: null },
  });
  const mappedEmpty = buildPiTemplateData(empty);
  check("nulo vira string vazia, nunca 'undefined'", !Object.values(mappedEmpty).some((value) => value.includes("undefined")));
  check("nulo nao vira traco", mappedEmpty.start_date === "" && mappedEmpty.observations === "");
  check("interferente sem resposta deixa as duas caixas vazias", mappedEmpty.int_yes === "☐" && mappedEmpty.int_no === "☐");
  const emptyDoc = renderAndSweep(template, empty, "campos vazios");
  if (emptyDoc) writeFileSync(join(outDir, "pi-demo-vazio.docx"), emptyDoc);

  // -------------------------------------------------------------------------
  section("Caixas e formatacao");
  const mapped = buildPiTemplateData(buildDemoData());
  check("area marcada usa caixa com X", mapped.a_pm === "☒" && mapped.a_ce === "☒");
  check("area nao marcada usa caixa vazia", mapped.a_om === "☐" && mapped.a_ut_at === "☐");
  check("area do contato e independente da area da PI", mapped.e_om === "☒" && mapped.e_pm === "☐");
  check("tensao marcada", mapped.v_mt === "☒" && mapped.v_bt === "☒" && mapped.v_at === "☐");
  check("nivel do interferente e independente da tensao da PI", mapped.iv_at === "☒" && mapped.iv_mt === "☐");
  check("interferente Sim marcado e Nao vazio", mapped.int_yes === "☒" && mapped.int_no === "☐");
  check("data em DD/MM/AAAA", mapped.start_date === "14/09/2026", mapped.start_date);
  check("hora em HH:mm sem segundos", mapped.start_time === "07:30", mapped.start_time);
  check("nenhum booleano cru chegou ao Word", !Object.values(mapped).some((value) => value === "true" || value === "false"));

  // -------------------------------------------------------------------------
  section("Tag repetida no cabecalho");
  if (full) {
    const zip = new (createRequire(join(repoRoot, "package.json"))("pizzip"))(full);
    const headerNames = Object.keys(zip.files).filter((name) => /^word\/header\d*\.xml$/.test(name));
    check("template tem 3 cabecalhos", headerNames.length === 3, headerNames.join(", "));
    const headerHits = headerNames.filter((name) => zip.file(name).asText().includes("PI-RJ-MT-PM-INDICA-0001"));
    check("codigo da PI preenchido nos 3 cabecalhos", headerHits.length === 3, headerHits.join(", "));
  }

  // -------------------------------------------------------------------------
  section("Template invalido");
  const notZip = Buffer.from("isto nao e um docx");
  check("buffer que nao e ZIP e recusado", listDocxTemplateTags(notZip).ok === false);
  check("render em buffer invalido e recusado", renderDocxTemplate(notZip, {}).ok === false);

  // -------------------------------------------------------------------------
  console.log(`\n${failures.length === 0 ? "TUDO OK" : "FALHOU"} — ${checks - failures.length}/${checks} verificacoes`);
  if (failures.length > 0) {
    console.log(`Falhas: ${failures.join(" | ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nDOCX de conferencia em: ${outDir}`);
  console.log("Abra no Word e confira o glifo das caixas e o layout de 8 paginas.");
}

await main();
