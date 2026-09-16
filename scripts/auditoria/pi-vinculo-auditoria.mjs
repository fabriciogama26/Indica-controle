/**
 * pi-vinculo-auditoria.mjs — auditoria SOMENTE LEITURA do vinculo PI x Programacao.
 *
 * NAO ESCREVE NADA. Nenhum insert, update, delete ou RPC de escrita.
 *
 * Levanta o passivo que a migration do vinculo automatico vai encontrar, e
 * responde a pergunta que decide se o indice unico parcial por etapa pode ser
 * criado. Rodar ANTES de aplicar a migration, e de novo imediatamente antes de
 * aplicar em producao.
 *
 * As cinco verificacoes:
 *   1. Etapa com 2+ PIs vivas            -> BLOQUEIA o UNIQUE INDEX novo
 *   2. PI DRAFT/READY sem etapa + etapa ativa na mesma chave -> reconciliavel
 *   3. PI ISSUED sem etapa + etapa ativa na mesma chave      -> so exibir
 *   4. PI vinculada a etapa que saiu do plano ou mudou       -> vira ATTENTION
 *   5. Etapa com PI viva cuja chave atual tem outra PI pendente -> revisao humana
 *
 * A chave de negocio e SEMPRE tenant_id + project_id + work_date. Etapa nao
 * entra nela. Etapa ativa e apenas PROGRAMADA ou REPROGRAMADA (migration 346).
 *
 * Uso:
 *   node scripts/auditoria/pi-vinculo-auditoria.mjs
 *   node scripts/auditoria/pi-vinculo-auditoria.mjs --detalhe   (lista as linhas)
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(repoRoot, "package.json"));
const { createClient } = require("@supabase/supabase-js");

const SHOW_ROWS = process.argv.includes("--detalhe");
const ACTIVE_STAGE = new Set(["PROGRAMADA", "REPROGRAMADA"]);
const LIVE_PI = (pi) => pi.status !== "CANCELLED";
const PAGE = 1000;

function loadEnv() {
  const path = join(repoRoot, ".env");
  if (!existsSync(path)) throw new Error("`.env` nao encontrado na raiz do repositorio.");
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      }),
  );
}

/**
 * Leitura completa por `range` em laco.
 *
 * O PostgREST corta em 1.000 linhas por resposta e NAO sinaliza o corte, entao
 * uma consulta unica devolveria resultado incompleto com status 200 — numero
 * errado, nao erro. Mesma regra do `loadAllRows` de src/lib/server/apiHelpers.ts.
 */
async function readAll(build) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

function chunk(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

const key = (tenantId, projectId, workDate) => `${tenantId}|${projectId}|${workDate}`;

function tally(rows, field) {
  const counts = new Map();
  for (const row of rows) counts.set(row[field], (counts.get(row[field]) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function report(title, rows, note) {
  console.log(`\n${title}`);
  console.log(`  linhas: ${rows.length}${note ? `  (${note})` : ""}`);
  if (!SHOW_ROWS || rows.length === 0) return;
  for (const row of rows.slice(0, 50)) console.log(`    ${row}`);
  if (rows.length > 50) console.log(`    ... e mais ${rows.length - 50}`);
}

async function main() {
  const env = loadEnv();
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("`.env` precisa de SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  }
  const sb = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  console.log(`Banco: ${url}`);
  console.log("Modo: SOMENTE LEITURA");

  // ---------------------------------------------------------------------------
  // Carga
  // ---------------------------------------------------------------------------
  const pis = await readAll((from, to) =>
    sb
      .from("permission_intervention")
      .select("id, tenant_id, project_id, work_date, programming_id, link_status, status, pi_code, creation_source, source_programming_snapshot")
      .order("created_at", { ascending: true })
      .range(from, to),
  );

  console.log(`\n=== Contexto`);
  console.log(`  PIs no banco: ${pis.length}`);
  if (pis.length === 0) {
    console.log("\nNenhuma PI cadastrada. Passivo zero em todas as cinco verificacoes.");
    console.log("O indice unico parcial por etapa pode ser criado sem risco.");
    return;
  }
  console.log(`  por status: ${tally(pis, "status").map(([k, n]) => `${k}=${n}`).join(", ")}`);
  console.log(`  por link_status: ${tally(pis, "link_status").map(([k, n]) => `${k}=${n}`).join(", ")}`);
  console.log(`  com fotografia de origem: ${pis.filter((pi) => pi.source_programming_snapshot).length}`);

  // Etapas: as dos projetos que tem PI, mais as que estao vinculadas (o
  // projeto da etapa pode ter mudado e sair do primeiro filtro).
  const byTenant = new Map();
  for (const pi of pis) {
    if (!byTenant.has(pi.tenant_id)) byTenant.set(pi.tenant_id, new Set());
    byTenant.get(pi.tenant_id).add(pi.project_id);
  }

  const stages = new Map();
  for (const [tenantId, projectIds] of byTenant) {
    for (const group of chunk([...projectIds], 50)) {
      const rows = await readAll((from, to) =>
        sb
          .from("programming")
          .select("id, tenant_id, project_id, execution_date, status")
          .eq("tenant_id", tenantId)
          .in("project_id", group)
          .range(from, to),
      );
      for (const row of rows) stages.set(row.id, row);
    }
  }

  const linkedMissing = [...new Set(pis.map((pi) => pi.programming_id).filter(Boolean))].filter(
    (id) => !stages.has(id),
  );
  for (const group of chunk(linkedMissing, 50)) {
    const rows = await readAll((from, to) =>
      sb
        .from("programming")
        .select("id, tenant_id, project_id, execution_date, status")
        .in("id", group)
        .range(from, to),
    );
    for (const row of rows) stages.set(row.id, row);
  }
  console.log(`  etapas lidas: ${stages.size}`);

  // Indices auxiliares.
  const activeStageByKey = new Map();
  for (const stage of stages.values()) {
    if (!ACTIVE_STAGE.has(stage.status) || !stage.execution_date) continue;
    const k = key(stage.tenant_id, stage.project_id, stage.execution_date);
    if (!activeStageByKey.has(k)) activeStageByKey.set(k, []);
    activeStageByKey.get(k).push(stage);
  }

  const livePiByKey = new Map();
  for (const pi of pis.filter(LIVE_PI)) livePiByKey.set(key(pi.tenant_id, pi.project_id, pi.work_date), pi);

  const label = (pi) => `PI ${pi.pi_code ?? pi.id.slice(0, 8)} [${pi.status}/${pi.link_status}] projeto ${pi.project_id.slice(0, 8)} data ${pi.work_date}`;

  // ---------------------------------------------------------------------------
  // 1) Etapa com 2+ PIs vivas — bloqueia o UNIQUE INDEX novo
  // ---------------------------------------------------------------------------
  const piByStage = new Map();
  for (const pi of pis.filter(LIVE_PI)) {
    if (!pi.programming_id) continue;
    if (!piByStage.has(pi.programming_id)) piByStage.set(pi.programming_id, []);
    piByStage.get(pi.programming_id).push(pi);
  }
  const duplicated = [...piByStage.entries()].filter(([, list]) => list.length > 1);
  report(
    "=== 1) Etapa com 2+ PIs vivas (bloqueia o indice unico novo)",
    duplicated.map(([stageId, list]) => `etapa ${stageId.slice(0, 8)} -> ${list.map(label).join(" | ")}`),
    duplicated.length === 0 ? "indice unico pode ser criado" : "resolver por decisao de negocio antes da migration",
  );

  // ---------------------------------------------------------------------------
  // 2) PI editavel sem etapa, com etapa ativa na mesma chave — reconciliavel
  // ---------------------------------------------------------------------------
  const reconcilable = [];
  const ambiguous = [];
  for (const pi of pis) {
    if (pi.programming_id || !["DRAFT", "READY"].includes(pi.status)) continue;
    const candidates = activeStageByKey.get(key(pi.tenant_id, pi.project_id, pi.work_date)) ?? [];
    if (candidates.length === 0) continue;
    const free = candidates.filter((stage) => !piByStage.has(stage.id));
    if (candidates.length === 1 && free.length === 1) {
      reconcilable.push(`${label(pi)} -> etapa ${candidates[0].id.slice(0, 8)} [${candidates[0].status}]`);
    } else {
      ambiguous.push(`${label(pi)} -> ${candidates.length} etapas, ${free.length} livres`);
    }
  }
  report("=== 2) PI DRAFT/READY sem etapa, com etapa ativa correspondente (reconciliavel)", reconcilable);
  report("=== 2b) Mesmo caso, mas ambiguo ou com etapa ja tomada (NAO reconciliar)", ambiguous);

  // ---------------------------------------------------------------------------
  // 3) PI emitida sem etapa, com etapa ativa na mesma chave — so exibir
  // ---------------------------------------------------------------------------
  const issuedPending = pis
    .filter((pi) => !pi.programming_id && pi.status === "ISSUED")
    .filter((pi) => (activeStageByKey.get(key(pi.tenant_id, pi.project_id, pi.work_date)) ?? []).length > 0)
    .map(label);
  report("=== 3) PI EMITIDA sem etapa, com etapa ativa correspondente (pendencia so exibida)", issuedPending);

  // ---------------------------------------------------------------------------
  // 4) PI vinculada cuja etapa saiu do plano ou mudou de chave — vira ATTENTION
  // ---------------------------------------------------------------------------
  const attention = [];
  const orphanLink = [];
  for (const pi of pis.filter(LIVE_PI)) {
    if (!pi.programming_id) continue;
    const stage = stages.get(pi.programming_id);
    if (!stage) {
      orphanLink.push(`${label(pi)} -> etapa ${pi.programming_id.slice(0, 8)} nao encontrada`);
      continue;
    }
    const reasons = [];
    if (!ACTIVE_STAGE.has(stage.status)) reasons.push(`etapa ${stage.status}`);
    if (stage.project_id !== pi.project_id) reasons.push("projeto divergente");
    if (stage.execution_date !== pi.work_date) reasons.push(`data da etapa ${stage.execution_date ?? "em espera"}`);
    if (reasons.length === 0) continue;
    if (pi.link_status === "ATTENTION") continue;
    attention.push(`${label(pi)} -> ${reasons.join(", ")}`);
  }
  report("=== 4) PI vinculada a etapa fora do plano ou de outra chave (deve virar ATTENTION)", attention);
  report("=== 4b) PI apontando para etapa inexistente (investigar antes)", orphanLink);

  // ---------------------------------------------------------------------------
  // 5) Etapa com PI viva cuja chave atual ja tem outra PI — cenario da reprogramacao
  // ---------------------------------------------------------------------------
  const collisions = [];
  for (const [stageId, list] of piByStage) {
    const stage = stages.get(stageId);
    if (!stage || !stage.execution_date) continue;
    const owner = list[0];
    if (stage.project_id === owner.project_id && stage.execution_date === owner.work_date) continue;
    const other = livePiByKey.get(key(stage.tenant_id, stage.project_id, stage.execution_date));
    if (!other || other.id === owner.id) continue;
    collisions.push(
      `etapa ${stageId.slice(0, 8)} [${stage.status}, hoje em ${stage.execution_date}] pertence a ${label(owner)} e a chave atual ja tem ${label(other)}`,
    );
  }
  report("=== 5) Etapa reprogramada cuja chave atual ja tem outra PI (revisao humana, nunca reconciliar)", collisions);

  // ---------------------------------------------------------------------------
  // Veredito
  // ---------------------------------------------------------------------------
  console.log("\n=== Veredito");
  console.log(`  indice unico parcial por etapa: ${duplicated.length === 0 ? "PODE ser criado" : "BLOQUEADO"}`);
  console.log(`  passivo reconciliavel automaticamente: ${reconcilable.length}`);
  console.log(`  passivo que exige decisao humana: ${ambiguous.length + duplicated.length + collisions.length + orphanLink.length}`);
  console.log(`  pendencia administrativa (emitidas): ${issuedPending.length}`);
  console.log(`  vinculos a marcar como ATTENTION: ${attention.length}`);
  if (!SHOW_ROWS) console.log("\n  use --detalhe para listar as linhas de cada verificacao.");
}

main().catch((error) => {
  console.error(`\nFALHA: ${error.message}`);
  process.exit(1);
});
