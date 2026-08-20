#!/usr/bin/env node
/**
 * Ratchet do teto de linhas do PostgREST.
 *
 * O PostgREST deste projeto entrega no maximo 1.000 linhas por resposta (`db-max-rows`) e NAO
 * sinaliza o corte: devolve 200 com menos linhas do que o SQL produziu. Consequencia: `.limit(n)`
 * com n acima de 1.000 nunca cumpre o que promete, e o codigo que le o resultado nao tem como
 * saber que ele veio incompleto. O sintoma nao e erro nem tela vazia — e numero errado
 * apresentado como certo.
 *
 * Esta classe de bug ja foi cometida de forma independente pelo menos cinco vezes:
 *   - Dashboard Estoque, `loadTransfers` com teto de 5 mil (corrigido);
 *   - listagem de `/saida`, janela implicita de 1.000 (commit 98783c9);
 *   - exportacao de `/saida`, laco que parava comparando com o limite pedido;
 *   - classificacao de estorno em `/entrada`, que marcava movimentacao estornada como ativa;
 *   - `/estornos`, onde o proprio aviso de "resultado parcial" era codigo morto porque comparava
 *     com um valor que a resposta nunca podia atingir.
 * Revisao humana ja provou nao pegar. Por isso a trava e automatica.
 *
 * REGRA: nenhum `.limit()` em `src/` pode pedir mais que MAX_ROWS.
 *
 * Nao ha heuristica de "esta dentro de um laco de `.range()`": pedir mais de 1.000 numa unica
 * chamada e sempre inutil, inclusive dentro de um laco bem escrito, onde o bloco pedido nunca
 * deveria passar do teto. Isso torna a regra exata, sem falso negativo por proximidade de linhas.
 *
 * Leitura completa se faz com `loadAllRows` de `src/lib/server/apiHelpers.ts`.
 *
 * Modos:
 *   node scripts/check-row-limit.mjs           -> verifica (exit 1 em qualquer violacao nova)
 *   node scripts/check-row-limit.mjs --update  -> SO reduz o baseline
 *   node scripts/check-row-limit.mjs --init    -> cria o baseline inicial (implantacao)
 *
 * Nao existe `--accept`. Um `.limit()` novo acima do teto nao tem justificativa possivel: o
 * servidor nao vai entregar. Se a intencao e um teto proposital, use `loadAllRows(..., { maxRows })`,
 * que aplica o teto de verdade e deixa o chamador detectar que bateu nele.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(ROOT, "row-limit-baseline.json");
const SCAN_DIRS = ["src"];
const EXTENSIONS = [".ts", ".tsx"];
const IGNORED_DIRS = new Set(["node_modules", ".next", "dist", "build"]);
const MAX_ROWS = 1000;

const BASELINE_DESCRIPTION = [
  "Baseline do ratchet de teto de linhas do PostgREST (scripts/check-row-limit.mjs).",
  `Cada entrada e a quantidade de chamadas .limit() acima de ${MAX_ROWS} que o arquivo ja tinha.`,
  "O numero so pode diminuir. Arquivo novo com violacao falha o lint direto.",
  "REDUCOES: rodar `npm run lint:rowlimit:update`, que nunca aumenta um baseline.",
  "Nao existe aceite de aumento: pedir mais que o teto nunca funciona, o servidor nao entrega.",
  "Para leitura completa use `loadAllRows` de src/lib/server/apiHelpers.ts.",
  "Nao editar este arquivo a mao.",
].join(" ");

function toPosix(path) {
  return path.split("\\").join("/");
}

/**
 * Remove comentarios e conteudo de string/template, preservando o tamanho do texto para que os
 * numeros de linha continuem batendo com o arquivo original.
 *
 * Comentario precisa sair porque comentario que EXPLICA o bug antigo cita o codigo antigo — isso
 * aconteceu duas vezes durante a correcao que originou este script e apareceu como falso positivo.
 * String precisa sair para que uma URL como "http://..." nao seja lida como inicio de comentario.
 */
function blankNonCode(source) {
  const out = source.split("");
  const n = source.length;
  let i = 0;

  const blankUntil = (end) => {
    for (let k = i; k < end && k < n; k += 1) {
      if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
    }
  };

  while (i < n) {
    const two = source.slice(i, i + 2);

    if (two === "//") {
      let end = source.indexOf("\n", i);
      if (end === -1) end = n;
      blankUntil(end);
      i = end;
      continue;
    }

    if (two === "/*") {
      let end = source.indexOf("*/", i + 2);
      end = end === -1 ? n : end + 2;
      blankUntil(end);
      i = end;
      continue;
    }

    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < n) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === ch) break;
        j += 1;
      }
      const end = Math.min(j + 1, n);
      i += 1;
      blankUntil(end - 1);
      i = end;
      continue;
    }

    i += 1;
  }

  return out.join("");
}

function parseNumericLiteral(raw) {
  const cleaned = raw.trim().replace(/_/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** `const NOME = 1234;` / `export const NOME = 1234;` declarados no proprio arquivo. */
function collectLocalConstants(code) {
  const constants = new Map();
  const pattern = /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::\s*number\s*)?=\s*([\d_]+)\s*;/g;
  let match;
  while ((match = pattern.exec(code)) !== null) {
    const value = parseNumericLiteral(match[2]);
    if (value !== null) constants.set(match[1], value);
  }
  return constants;
}

function listSourceFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      listSourceFiles(join(dir, entry.name), acc);
      continue;
    }
    if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      acc.push(join(dir, entry.name));
    }
  }
  return acc;
}

function lineOf(code, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (code[i] === "\n") line += 1;
  }
  return line;
}

function scan() {
  const files = SCAN_DIRS.flatMap((dir) => listSourceFiles(join(ROOT, dir)));

  // Constantes exportadas de qualquer arquivo, para resolver `.limit(CONST_IMPORTADA)`.
  // Sem isto a varredura enxerga so literais — foi exatamente esse ponto cego que escondeu
  // `/estornos` (`.limit(REVERSAL_QUERY_LIMIT)`) de uma contagem manual anterior.
  const exportedConstants = new Map();
  const codeByFile = new Map();

  for (const absolute of files) {
    const code = blankNonCode(readFileSync(absolute, "utf8"));
    codeByFile.set(absolute, code);
    const pattern = /(?:^|\n)\s*export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::\s*number\s*)?=\s*([\d_]+)\s*;/g;
    let match;
    while ((match = pattern.exec(code)) !== null) {
      const value = parseNumericLiteral(match[2]);
      if (value !== null) exportedConstants.set(match[1], value);
    }
  }

  const violationsByFile = new Map();
  const dynamic = [];

  for (const absolute of files) {
    const code = codeByFile.get(absolute);
    const relativePath = toPosix(relative(ROOT, absolute));
    const localConstants = collectLocalConstants(code);
    const pattern = /\.limit\(\s*([^)]*?)\s*\)/g;
    let match;

    while ((match = pattern.exec(code)) !== null) {
      const argument = match[1].trim();
      if (!argument) continue;

      let value = parseNumericLiteral(argument);
      if (value === null && /^[A-Za-z_$][\w$]*$/.test(argument)) {
        value = localConstants.get(argument) ?? exportedConstants.get(argument) ?? null;
      }

      if (value === null) {
        dynamic.push({ file: relativePath, line: lineOf(code, match.index), argument });
        continue;
      }

      if (value > MAX_ROWS) {
        const found = violationsByFile.get(relativePath) ?? [];
        found.push({ line: lineOf(code, match.index), value });
        violationsByFile.set(relativePath, found);
      }
    }
  }

  return { violationsByFile, dynamic, fileCount: files.length };
}

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return { description: BASELINE_DESCRIPTION, files: {} };
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
}

function writeBaseline(files) {
  const ordered = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify({ description: BASELINE_DESCRIPTION, files: ordered }, null, 2)}\n`,
    "utf8",
  );
}

function reportDynamic(dynamic) {
  if (!dynamic.length) return;
  console.log("");
  console.log(`AVISO: ${dynamic.length} chamada(s) .limit() com valor dinamico, nao verificaveis aqui.`);
  console.log("Confira a mao que nenhuma delas pode passar de " + MAX_ROWS + " em runtime:");
  for (const item of dynamic) {
    console.log(`  ${item.file}:${item.line} -> .limit(${item.argument})`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const mode = args.includes("--init") ? "init" : args.includes("--update") ? "update" : "check";
  const { violationsByFile, dynamic, fileCount } = scan();

  const currentCounts = {};
  for (const [file, items] of violationsByFile) currentCounts[file] = items.length;

  if (mode === "init") {
    writeBaseline(currentCounts);
    const total = Object.values(currentCounts).reduce((sum, n) => sum + n, 0);
    console.log(`Baseline criado com ${Object.keys(currentCounts).length} arquivo(s) e ${total} violacao(oes).`);
    reportDynamic(dynamic);
    return;
  }

  const baseline = readBaseline();
  const baselineFiles = baseline.files ?? {};

  if (mode === "update") {
    const next = {};
    let reduced = 0;
    let removed = 0;
    for (const [file, count] of Object.entries(baselineFiles)) {
      const current = currentCounts[file] ?? 0;
      if (current === 0) {
        removed += 1;
        continue;
      }
      if (current < count) reduced += 1;
      next[file] = Math.min(count, current);
    }

    const grew = Object.entries(currentCounts).filter(
      ([file, count]) => count > (baselineFiles[file] ?? 0),
    );
    if (grew.length) {
      console.error("");
      console.error("RECUSADO: ha violacao NOVA pendente. `--update` so reduz baseline.");
      for (const [file, count] of grew) {
        console.error(`  ${file}: baseline ${baselineFiles[file] ?? 0} -> atual ${count}`);
      }
      console.error("");
      console.error("Corrija com `loadAllRows` (src/lib/server/apiHelpers.ts) antes de atualizar o baseline.");
      process.exit(1);
    }

    writeBaseline(next);
    console.log(`Baseline atualizado (somente reducoes): ${reduced} arquivo(s) reduzido(s), ${removed} removido(s).`);
    reportDynamic(dynamic);
    return;
  }

  const problems = [];
  for (const [file, items] of violationsByFile) {
    const allowed = baselineFiles[file] ?? 0;
    if (items.length > allowed) {
      problems.push({ file, allowed, items });
    }
  }

  const stale = Object.entries(baselineFiles).filter(
    ([file, count]) => (currentCounts[file] ?? 0) < count,
  );

  if (problems.length) {
    console.error("");
    console.error(`.limit() ACIMA DO TETO DE ${MAX_ROWS} LINHAS (${problems.length} arquivo(s)):`);
    for (const problem of problems) {
      console.error(`  ${problem.file}  (baseline permite ${problem.allowed}, achei ${problem.items.length})`);
      for (const item of problem.items) {
        console.error(`    linha ${item.line}: .limit(${item.value})`);
      }
    }
    console.error("");
    console.error(`O PostgREST entrega no maximo ${MAX_ROWS} linhas por resposta e NAO avisa o corte.`);
    console.error("Pedir mais devolve resultado incompleto com status 200 — dado errado, nao erro.");
    console.error("Use `loadAllRows` de src/lib/server/apiHelpers.ts:");
    console.error("  - sem opcoes, le tudo paginando por .range();");
    console.error("  - com { maxRows }, aplica um teto proposital que o chamador consegue detectar.");
    reportDynamic(dynamic);
    process.exit(1);
  }

  const totalPending = Object.values(currentCounts).reduce((sum, n) => sum + n, 0);
  console.log(
    `Teto de linhas OK: ${fileCount} analisado(s), ${totalPending} violacao(oes) legada(s) dentro do baseline.`,
  );

  if (stale.length) {
    console.log("");
    console.log(`BASELINE DESATUALIZADO - ${stale.length} arquivo(s) melhoraram:`);
    for (const [file, count] of stale) {
      console.log(`  ${file}: baseline ${count} -> atual ${currentCounts[file] ?? 0}`);
    }
    console.log("Rode `npm run lint:rowlimit:update` para travar o novo teto.");
  }

  reportDynamic(dynamic);
}

main();
