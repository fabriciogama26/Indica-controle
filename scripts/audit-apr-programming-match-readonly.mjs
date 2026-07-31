// audit-apr-programming-match-readonly.mjs
// Auditoria SOMENTE-LEITURA para a Fase 5a do corte (Controle APR): mede, com
// dado real de producao, se remapear `project_apr_controls.programming_id` da
// tabela legada (`project_programming`) para a normalizada (`programming`, via
// `programming_legacy_map`, migration 342) muda o resultado do vinculo, e se o
// novo criterio de match (por projeto+equipe+data, equipe resolvida em
// `programming_team`, desempate "status ativo vence" como a migration 347 ja
// fez para o Cronograma) concorda com o valor gravado hoje.
//
// NAO ESCREVE NADA. So select.
//
// Rodar (raiz do repo): node scripts/audit-apr-programming-match-readonly.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(path.join(REPO, ".env"), "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  let v = t.slice(eq + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[t.slice(0, eq).trim()] = v;
}
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function selectAll(table, columns, orderColumn = "id") {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).order(orderColumn).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all;
}

const pct = (n, total) => (total ? `${((n / total) * 100).toFixed(1)}%` : "-");

console.log("Lendo producao (somente leitura)...\n");

const [aprRows, legacyMap, stages, teamRows] = await Promise.all([
  selectAll("project_apr_controls", "id, tenant_id, apr_id, project_id, team_id, programming_id, service_date, status, programming_status_snapshot"),
  selectAll("programming_legacy_map", "legacy_programming_id, tenant_id, programming_id, legacy_team_id, programming_team_id", "legacy_programming_id"),
  selectAll("programming", "id, tenant_id, project_id, execution_date, status, updated_at"),
  selectAll("programming_team", "id, tenant_id, programming_id, team_id, status"),
]);

const legacyMapById = new Map(legacyMap.map((m) => [m.legacy_programming_id, m]));
const stageById = new Map(stages.map((s) => [s.id, s]));

// NOVO match: mesma chave (tenant, projeto, data), equipe resolvida via
// programming_team (status ATIVA), status <> CANCELADA, desempate "ativo
// vence" (padrao da migration 347) e depois updated_at desc.
const stagesByProjectDate = new Map();
for (const s of stages) {
  if (!s.execution_date || s.status === "CANCELADA") continue;
  const k = `${s.tenant_id}|${s.project_id}|${s.execution_date}`;
  const list = stagesByProjectDate.get(k) ?? [];
  list.push(s);
  stagesByProjectDate.set(k, list);
}
const activeTeamRowsByStage = new Map();
for (const t of teamRows) {
  if (t.status !== "ATIVA") continue;
  const list = activeTeamRowsByStage.get(t.programming_id) ?? [];
  list.push(t);
  activeTeamRowsByStage.set(t.programming_id, list);
}

function computeNewMatch(row) {
  const k = `${row.tenant_id}|${row.project_id}|${row.service_date}`;
  const candidates = (stagesByProjectDate.get(k) ?? []).filter((s) => {
    const teams = activeTeamRowsByStage.get(s.id) ?? [];
    return teams.some((t) => t.team_id === row.team_id);
  });
  if (!candidates.length) return null;
  candidates.sort((left, right) => {
    const leftActive = left.status === "PROGRAMADA" || left.status === "REPROGRAMADA" ? 0 : 1;
    const rightActive = right.status === "PROGRAMADA" || right.status === "REPROGRAMADA" ? 0 : 1;
    if (leftActive !== rightActive) return leftActive - rightActive;
    return String(right.updated_at).localeCompare(String(left.updated_at));
  });
  return candidates[0];
}

console.log("=== Controle APR — volume geral ===");
console.log(`linhas de project_apr_controls .......... ${aprRows.length}`);
const comFk = aprRows.filter((r) => r.programming_id);
const semFk = aprRows.length - comFk.length;
console.log(`com programming_id preenchido ........... ${comFk.length} (${pct(comFk.length, aprRows.length)})`);
console.log(`sem programming_id (nunca vinculada) .... ${semFk}`);

console.log("\n=== Pre-condicao: orfaos no de/para (esperado 0) ===");
const semPar = comFk.filter((r) => !legacyMapById.has(r.programming_id));
console.log(`sem par em programming_legacy_map ....... ${semPar.length}`);
if (semPar.length) {
  console.log("  amostra (ate 10):", semPar.slice(0, 10).map((r) => `apr=${r.apr_id} tenant=${r.tenant_id}`).join(" | "));
}

console.log("\n=== Remap via legacy_map x recalculo do NOVO match ===");
let concordam = 0;
let divergemStage = 0;
let novoSemMatch = 0;
let semEquipeNaEtapaMapeada = 0;
const amostraDivergencia = [];
for (const row of comFk) {
  const mapped = legacyMapById.get(row.programming_id);
  if (!mapped) continue; // ja contado acima

  const mappedStage = stageById.get(mapped.programming_id) ?? null;
  const recomputed = computeNewMatch(row);

  if (!recomputed) {
    novoSemMatch += 1;
    if (mappedStage) {
      const teams = activeTeamRowsByStage.get(mappedStage.id) ?? [];
      if (!teams.some((t) => t.team_id === row.team_id)) semEquipeNaEtapaMapeada += 1;
    }
    if (amostraDivergencia.length < 10) {
      amostraDivergencia.push(`apr=${row.apr_id} mapeado_para=${mapped.programming_id} (${mappedStage?.status ?? "?"}) novo_match=NENHUM`);
    }
    continue;
  }

  if (recomputed.id === mapped.programming_id) {
    concordam += 1;
  } else {
    divergemStage += 1;
    if (amostraDivergencia.length < 10) {
      amostraDivergencia.push(`apr=${row.apr_id} mapeado_para=${mapped.programming_id} (${mappedStage?.status ?? "?"}) novo_match=${recomputed.id} (${recomputed.status})`);
    }
  }
}
console.log(`concordam (remap simples = recalculo) ... ${concordam} (${pct(concordam, comFk.length)})`);
console.log(`divergem (recalculo aponta OUTRA etapa) . ${divergemStage}`);
console.log(`recalculo nao encontra NENHUMA etapa ..... ${novoSemMatch} (dos quais sem equipe ATIVA na etapa mapeada: ${semEquipeNaEtapaMapeada})`);
if (amostraDivergencia.length) {
  console.log("\namostra de divergencias/sem-match (ate 10):");
  for (const line of amostraDivergencia) console.log(`  ${line}`);
}

console.log("\n=== Colisao de data (cenario 346/347): a etapa mapeada tem \"irmas\" na mesma (projeto,data)? ===");
let comColisao = 0;
for (const row of comFk) {
  const mapped = legacyMapById.get(row.programming_id);
  if (!mapped) continue;
  const mappedStage = stageById.get(mapped.programming_id);
  if (!mappedStage) continue;
  const k = `${mappedStage.tenant_id}|${mappedStage.project_id}|${mappedStage.execution_date}`;
  const siblings = (stagesByProjectDate.get(k) ?? []).filter((s) => s.id !== mappedStage.id);
  if (siblings.length) comColisao += 1;
}
console.log(`APRs cuja etapa vinculada tem outra etapa na mesma data . ${comColisao} (o desempate "ativo vence" so importa nestes casos)`);

console.log("\n=== Assimetria de unicidade: quantas APRs ativas compartilham a mesma etapa? ===");
const aprAtivasPorEtapa = new Map();
for (const row of aprRows) {
  if (!row.programming_id || row.status === "CANCELADO") continue;
  aprAtivasPorEtapa.set(row.programming_id, (aprAtivasPorEtapa.get(row.programming_id) ?? 0) + 1);
}
const etapasComMaisDeUma = [...aprAtivasPorEtapa.entries()].filter(([, n]) => n > 1);
console.log(`etapas (legado) com mais de 1 APR ativa vinculada ....... ${etapasComMaisDeUma.length}`);
if (etapasComMaisDeUma.length) {
  console.log("  amostra (ate 10):", etapasComMaisDeUma.slice(0, 10).map(([id, n]) => `${id}=${n}`).join(" | "));
}

console.log("\nOK — nada foi escrito.");
