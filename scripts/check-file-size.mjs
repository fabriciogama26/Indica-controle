#!/usr/bin/env node
/**
 * Ratchet de tamanho de arquivo.
 *
 * Aplica os limites da secao 5 do CLAUDE.md sem exigir refatoracao imediata dos
 * arquivos legados: cada arquivo que ja passava do teto entra em
 * `file-size-baseline.json` com o tamanho daquele momento e, a partir dai, so pode
 * encolher.
 *
 * Modos:
 *   node scripts/check-file-size.mjs                 -> verifica (exit 1 em qualquer violacao)
 *   node scripts/check-file-size.mjs --update        -> SO afrouxa o baseline para baixo
 *   node scripts/check-file-size.mjs --accept <path> -> aceita crescimento de arquivos nomeados
 *   node scripts/check-file-size.mjs --init          -> cria o baseline inicial (implantacao)
 *
 * A separacao entre `--update` e `--accept` e deliberada: `--update` nunca aumenta um
 * baseline, entao rodar o comando depois de varias alteracoes jamais pode abencoar em
 * lote um crescimento nao intencional. Aumento so acontece com o caminho do arquivo
 * escrito a mao na linha de comando, um por um.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(ROOT, "file-size-baseline.json");
const BASELINE_NAME = "file-size-baseline.json";
const SCAN_DIRS = ["src"];
const EXTENSIONS = [".ts", ".tsx"];
const IGNORED_DIRS = new Set(["node_modules", ".next", "dist", "build"]);

const BASELINE_DESCRIPTION = [
  "Baseline do ratchet de tamanho de arquivo (scripts/check-file-size.mjs).",
  "Cada entrada e um arquivo que ja estava acima do limite da secao 5 do CLAUDE.md.",
  "Arquivo legado so pode encolher: o valor aqui e o teto dele.",
  "REDUCOES (arquivo encolheu, foi removido ou voltou ao limite normal):",
  "rodar `npm run lint:size:update`, que nunca aumenta um baseline.",
  "AUMENTO EXCEPCIONAL: rodar `npm run lint:size:accept -- caminho/do/arquivo.tsx`,",
  "informando explicitamente cada arquivo; nao existe aceite em lote.",
  "Nao editar este arquivo a mao.",
].join(" ");

// Limites da secao 5 do CLAUDE.md. A primeira regra que casar vence; a ultima e o padrao.
const LIMIT_RULES = [
  { category: "route", limit: 1500, matches: (path) => /(^|\/)route\.ts$/.test(path) },
  {
    category: "controller",
    limit: 1500,
    matches: (path) => /(^|\/)(controller|handlers)\.ts$/.test(path),
  },
  { category: "modulo", limit: 1000, matches: () => true },
];

function limitRuleFor(path) {
  return LIMIT_RULES.find((rule) => rule.matches(path));
}

function toPosix(path) {
  return path.split("\\").join("/");
}

function countLines(absolutePath) {
  const content = readFileSync(absolutePath, "utf8");
  if (content === "") return 0;
  const lines = content.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

function listSourceFiles(absoluteDir, acc = []) {
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    const full = join(absoluteDir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      listSourceFiles(full, acc);
      continue;
    }
    if (EXTENSIONS.some((extension) => entry.name.endsWith(extension))) acc.push(full);
  }
  return acc;
}

function collectCurrentSizes() {
  const sizes = new Map();
  for (const dir of SCAN_DIRS) {
    const absoluteDir = join(ROOT, dir);
    if (!existsSync(absoluteDir)) continue;
    for (const file of listSourceFiles(absoluteDir)) {
      sizes.set(toPosix(relative(ROOT, file)), countLines(file));
    }
  }
  return sizes;
}

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  return parsed.files ?? {};
}

function writeBaseline(files) {
  const sorted = {};
  for (const path of Object.keys(files).sort()) sorted[path] = files[path];

  const payload = { description: BASELINE_DESCRIPTION, files: sorted };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return Object.keys(sorted).length;
}

function classify(currentSizes, baseline) {
  const growth = [];
  const newOverLimit = [];
  const shrunk = [];
  const graduated = [];
  const obsolete = [];

  for (const [path, lines] of currentSizes) {
    const rule = limitRuleFor(path);
    const baselineLines = baseline[path];

    if (baselineLines === undefined) {
      if (lines > rule.limit) newOverLimit.push({ path, lines, rule });
      continue;
    }

    if (lines > baselineLines) growth.push({ path, lines, baselineLines, rule });
    else if (lines <= rule.limit) graduated.push({ path, lines, baselineLines, rule });
    else if (lines < baselineLines) shrunk.push({ path, lines, baselineLines, rule });
  }

  for (const path of Object.keys(baseline)) {
    if (!currentSizes.has(path)) obsolete.push({ path, baselineLines: baseline[path] });
  }

  return { growth, newOverLimit, shrunk, graduated, obsolete };
}

function runCheck(currentSizes, baseline) {
  const result = classify(currentSizes, baseline);
  const { growth, newOverLimit, shrunk, graduated, obsolete } = result;

  if (growth.length) {
    console.error(`\nARQUIVO LEGADO CRESCEU ACIMA DO BASELINE (${growth.length}):`);
    for (const item of growth) {
      console.error(`  ${item.path}`);
      console.error(`    baseline ${item.baselineLines} -> atual ${item.lines} (+${item.lines - item.baselineLines})`);
    }
    console.error("  Reduza o arquivo, ou aceite o aumento arquivo por arquivo com");
    console.error("  `npm run lint:size:accept -- <caminho>` e justifique na descricao do PR.");
  }

  if (newOverLimit.length) {
    console.error(`\nARQUIVO NOVO JA NASCEU ACIMA DO LIMITE (${newOverLimit.length}):`);
    for (const item of newOverLimit) {
      console.error(`  ${item.path}`);
      console.error(`    limite ${item.rule.category} = ${item.rule.limit} linhas -> atual ${item.lines}`);
    }
    console.error("  Divida o arquivo antes de seguir (CLAUDE.md secao 5).");
  }

  if (shrunk.length) {
    console.error(`\nBASELINE DESATUALIZADO - ARQUIVO ENCOLHEU (${shrunk.length}):`);
    for (const item of shrunk) {
      console.error(`  ${item.path}`);
      console.error(`    baseline ${item.baselineLines} -> atual ${item.lines} (-${item.baselineLines - item.lines})`);
    }
    console.error("  Rode `npm run lint:size:update` para travar o novo teto e impedir regressao.");
  }

  if (graduated.length) {
    console.error(`\nBASELINE DESATUALIZADO - ARQUIVO VOLTOU AO LIMITE (${graduated.length}):`);
    for (const item of graduated) {
      console.error(`  ${item.path}`);
      console.error(`    atual ${item.lines} <= limite ${item.rule.category} (${item.rule.limit})`);
    }
    console.error("  Rode `npm run lint:size:update` para tirar o arquivo do baseline.");
  }

  if (obsolete.length) {
    console.error(`\nBASELINE OBSOLETO - ARQUIVO NAO EXISTE MAIS (${obsolete.length}):`);
    for (const item of obsolete) console.error(`  ${item.path} (baseline ${item.baselineLines})`);
    console.error("  Arquivo removido ou renomeado. Rode `npm run lint:size:update`.");
  }

  const failures =
    growth.length + newOverLimit.length + shrunk.length + graduated.length + obsolete.length;

  if (!failures) {
    console.log(
      `Tamanho de arquivo OK: ${currentSizes.size} analisado(s), ` +
        `${Object.keys(baseline).length} legado(s) dentro do baseline.`,
    );
    return 0;
  }

  console.error(`\n${failures} problema(s) de tamanho de arquivo.`);
  return 1;
}

/**
 * `--update` so afrouxa o baseline PARA BAIXO. Se existir qualquer crescimento
 * pendente, recusa sem escrever nada: aceitar aumento e sempre um ato explicito,
 * arquivo por arquivo, via `--accept`.
 */
function runUpdate(currentSizes, baseline) {
  const { growth, newOverLimit, shrunk, graduated, obsolete } = classify(currentSizes, baseline);

  if (growth.length || newOverLimit.length) {
    console.error("\n`--update` NAO aceita aumento de baseline. Nada foi escrito.");

    if (growth.length) {
      console.error(`\nCrescimento pendente (${growth.length}):`);
      for (const item of growth) {
        console.error(
          `  ${item.path}: baseline ${item.baselineLines} -> atual ${item.lines} (+${item.lines - item.baselineLines})`,
        );
      }
    }

    if (newOverLimit.length) {
      console.error(`\nArquivo novo acima do limite (${newOverLimit.length}):`);
      for (const item of newOverLimit) {
        console.error(`  ${item.path}: limite ${item.rule.limit} -> atual ${item.lines}`);
      }
    }

    console.error("\nReduza o arquivo, ou aceite cada um explicitamente:");
    console.error("  npm run lint:size:accept -- <caminho>");
    return 1;
  }

  const next = { ...baseline };
  for (const item of shrunk) next[item.path] = item.lines;
  for (const item of graduated) delete next[item.path];
  for (const item of obsolete) delete next[item.path];

  const total = writeBaseline(next);

  console.log("Baseline atualizado (somente reducoes):");
  console.log(`  ${shrunk.length} teto(s) reduzido(s)`);
  console.log(`  ${graduated.length} arquivo(s) de volta ao limite, removido(s) do baseline`);
  console.log(`  ${obsolete.length} entrada(s) obsoleta(s) removida(s)`);
  console.log(`  ${total} entrada(s) restante(s). Confira o diff de ${BASELINE_NAME}.`);
  return 0;
}

/**
 * `--accept` altera SOMENTE os caminhos informados na linha de comando. Nao existe
 * modo "aceitar tudo": e essa ausencia que impede o aceite em lote acidental.
 */
function runAccept(currentSizes, baseline, requestedPaths) {
  if (!requestedPaths.length) {
    console.error("Informe ao menos um caminho:");
    console.error("  npm run lint:size:accept -- src/modules/dashboard/<tela>/<Arquivo>.tsx");
    return 1;
  }

  const accepted = [];

  for (const raw of requestedPaths) {
    const path = toPosix(relative(ROOT, resolve(ROOT, raw)));
    const lines = currentSizes.get(path);

    if (lines === undefined) {
      console.error(`Arquivo fora do escopo do ratchet ou inexistente: ${raw}`);
      console.error(`  Esperado um .ts/.tsx dentro de ${SCAN_DIRS.join(", ")}/`);
      return 1;
    }

    const rule = limitRuleFor(path);
    const baselineLines = baseline[path];

    if (lines <= rule.limit) {
      console.error(`Arquivo dentro do limite, nao precisa de aceite: ${path}`);
      console.error(`  atual ${lines} <= limite ${rule.category} (${rule.limit})`);
      if (baselineLines !== undefined) console.error("  Rode `npm run lint:size:update`.");
      return 1;
    }

    if (baselineLines !== undefined && lines <= baselineLines) {
      console.error(`Sem crescimento para aceitar em: ${path}`);
      console.error(`  baseline ${baselineLines} -> atual ${lines}`);
      console.error("  Rode `npm run lint:size:update`.");
      return 1;
    }

    accepted.push({ path, lines, baselineLines, rule });
  }

  console.log(`\nACEITE EXPLICITO DE CRESCIMENTO (${accepted.length}):`);
  for (const item of accepted) {
    const previous = item.baselineLines === undefined ? "(sem baseline)" : String(item.baselineLines);
    const delta = item.baselineLines === undefined ? item.lines - item.rule.limit : item.lines - item.baselineLines;
    const deltaLabel =
      item.baselineLines === undefined ? `+${delta} linhas acima do limite` : `+${delta} linhas`;

    console.log(`  arquivo aceito   : ${item.path}`);
    console.log(`  baseline anterior: ${previous}`);
    console.log(`  tamanho atual    : ${item.lines}`);
    console.log(`  aumento          : ${deltaLabel}`);
    console.log(`  limite ${item.rule.category}: ${item.rule.limit}`);
    console.log("");
  }

  const next = { ...baseline };
  for (const item of accepted) next[item.path] = item.lines;
  writeBaseline(next);

  console.log(`Baseline atualizado somente para o(s) arquivo(s) acima.`);
  console.log(`Justifique o aumento na descricao do PR; o diff de ${BASELINE_NAME} e a evidencia.`);
  return 0;
}

function runInit(currentSizes) {
  if (existsSync(BASELINE_PATH)) {
    console.error(`${BASELINE_NAME} ja existe. \`--init\` e so para a implantacao inicial.`);
    console.error("  Reducoes: `npm run lint:size:update`");
    console.error("  Aumento excepcional: `npm run lint:size:accept -- <caminho>`");
    return 1;
  }

  const files = {};
  for (const [path, lines] of currentSizes) {
    if (lines > limitRuleFor(path).limit) files[path] = lines;
  }

  const total = writeBaseline(files);
  console.log(`Baseline inicial criado: ${total} arquivo(s) acima do limite em ${currentSizes.size} analisado(s).`);
  return 0;
}

function main() {
  const args = process.argv.slice(2);
  const currentSizes = collectCurrentSizes();

  if (args.includes("--init")) return runInit(currentSizes);

  const baseline = readBaseline();
  if (baseline === null) {
    console.error(`${BASELINE_NAME} nao encontrado. Rode \`node scripts/check-file-size.mjs --init\`.`);
    return 1;
  }

  if (args.includes("--accept")) {
    return runAccept(
      currentSizes,
      baseline,
      args.filter((arg) => arg !== "--accept" && !arg.startsWith("--")),
    );
  }

  if (args.includes("--update")) return runUpdate(currentSizes, baseline);

  return runCheck(currentSizes, baseline);
}

process.exit(main());
