// audit-medicao-programming-match-readonly.mjs
// Auditoria SOMENTE-LEITURA para a Fase 5b do corte (Medicao): mede, com dado
// real de producao, se remapear `project_measurement_orders.programming_id` da
// tabela legada (`project_programming`) para a normalizada (`programming`, via
// `programming_legacy_map`, migration 342) muda o resultado do vinculo, e se a
// nova validacao de equipe (a etapa precisa ter a equipe da ordem ATIVA em
// `programming_team`) rejeitaria algum vinculo que hoje e valido.
//
// NAO ESCREVE NADA. So select.
//
// Rodar (raiz do repo): node scripts/audit-medicao-programming-match-readonly.mjs

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

const [orders, legacyMap, stages, teamRows] = await Promise.all([
  selectAll("project_measurement_orders", "id, tenant_id, project_id, team_id, programming_id, execution_date, status"),
  selectAll("programming_legacy_map", "legacy_programming_id, tenant_id, programming_id, legacy_team_id, programming_team_id", "legacy_programming_id"),
  selectAll("programming", "id, tenant_id, project_id, execution_date, status, updated_at"),
  selectAll("programming_team", "id, tenant_id, programming_id, team_id, status"),
]);

const legacyMapById = new Map(legacyMap.map((m) => [m.legacy_programming_id, m]));
const stageById = new Map(stages.map((s) => [s.id, s]));

// Mesma prioridade de status usada hoje pelas RPCs de Medicao (127/123):
// PROGRAMADA(0) > REPROGRAMADA(1) > ADIADA(2) > CANCELADA(3) > outro(4).
// Diferente de APR/Cronograma: CANCELADA fica elegivel (so em ultimo caso),
// nao e excluida.
const STATUS_PRIORITY = { PROGRAMADA: 0, REPROGRAMADA: 1, ADIADA: 2, CANCELADA: 3 };
function statusRank(status) {
  return STATUS_PRIORITY[status] ?? 4;
}

const stagesByProjectDate = new Map();
for (const s of stages) {
  if (!s.execution_date) continue;
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
  const k = `${row.tenant_id}|${row.project_id}|${row.execution_date}`;
  const candidates = (stagesByProjectDate.get(k) ?? []).filter((s) => {
    const teams = activeTeamRowsByStage.get(s.id) ?? [];
    return teams.some((t) => t.team_id === row.team_id);
  });
  if (!candidates.length) return null;
  candidates.sort((left, right) => {
    const byStatus = statusRank(left.status) - statusRank(right.status);
    if (byStatus !== 0) return byStatus;
    return String(right.updated_at).localeCompare(String(left.updated_at));
  });
  return candidates[0];
}

console.log("=== Medicao — volume geral ===");
console.log(`linhas de project_measurement_orders ..... ${orders.length}`);
const comFk = orders.filter((r) => r.programming_id);
console.log(`com programming_id preenchido ............ ${comFk.length} (${pct(comFk.length, orders.length)})`);
console.log(`sem programming_id (nunca vinculada) ..... ${orders.length - comFk.length}`);

console.log("\n=== Pre-condicao: orfaos no de/para (esperado 0) ===");
const semPar = comFk.filter((r) => !legacyMapById.has(r.programming_id));
console.log(`sem par em programming_legacy_map ......... ${semPar.length}`);
if (semPar.length) {
  console.log("  amostra (ate 10):", semPar.slice(0, 10).map((r) => `ordem=${r.id} tenant=${r.tenant_id}`).join(" | "));
}

console.log("\n=== Remap via legacy_map x recalculo do NOVO match ===");
let concordam = 0;
let divergemStage = 0;
let novoSemMatch = 0;
let semEquipeNaEtapaMapeada = 0;
const amostraDivergencia = [];
for (const row of comFk) {
  const mapped = legacyMapById.get(row.programming_id);
  if (!mapped) continue;

  const mappedStage = stageById.get(mapped.programming_id) ?? null;
  const recomputed = computeNewMatch(row);

  if (!recomputed) {
    novoSemMatch += 1;
    if (mappedStage) {
      const teams = activeTeamRowsByStage.get(mappedStage.id) ?? [];
      if (!teams.some((t) => t.team_id === row.team_id)) semEquipeNaEtapaMapeada += 1;
    }
    if (amostraDivergencia.length < 10) {
      amostraDivergencia.push(`ordem=${row.id} mapeado_para=${mapped.programming_id} (${mappedStage?.status ?? "?"}) novo_match=NENHUM`);
    }
    continue;
  }

  if (recomputed.id === mapped.programming_id) {
    concordam += 1;
  } else {
    divergemStage += 1;
    if (amostraDivergencia.length < 10) {
      amostraDivergencia.push(`ordem=${row.id} mapeado_para=${mapped.programming_id} (${mappedStage?.status ?? "?"}) novo_match=${recomputed.id} (${recomputed.status})`);
    }
  }
}
console.log(`concordam (remap simples = recalculo) .... ${concordam} (${pct(concordam, comFk.length)})`);
console.log(`divergem (recalculo aponta OUTRA etapa) .. ${divergemStage}`);
console.log(`recalculo nao encontra NENHUMA etapa ...... ${novoSemMatch} (dos quais sem equipe ATIVA na etapa mapeada: ${semEquipeNaEtapaMapeada})`);
if (amostraDivergencia.length) {
  console.log("\namostra de divergencias/sem-match (ate 10):");
  for (const line of amostraDivergencia) console.log(`  ${line}`);
}

console.log("\n=== Validacao NOVA da RPC (exists equipe ATIVA na etapa): rejeitaria algum vinculo hoje valido? ===");
// Simula exatamente o "if not exists (...) then reason PROGRAMMING_NOT_FOUND" que
// vai entrar nas RPCs reescritas, aplicado a cada ordem JA vinculada apos o
// remap (etapa = mapeada, equipe = a da propria ordem).
let seriaRejeitado = 0;
const amostraRejeicao = [];
for (const row of comFk) {
  const mapped = legacyMapById.get(row.programming_id);
  if (!mapped) continue;
  const teams = activeTeamRowsByStage.get(mapped.programming_id) ?? [];
  const ok = teams.some((t) => t.team_id === row.team_id);
  if (!ok) {
    seriaRejeitado += 1;
    if (amostraRejeicao.length < 10) amostraRejeicao.push(`ordem=${row.id} etapa=${mapped.programming_id} equipe=${row.team_id}`);
  }
}
console.log(`ordens cuja equipe NAO esta ATIVA na etapa mapeada ....... ${seriaRejeitado} (${pct(seriaRejeitado, comFk.length)})`);
if (amostraRejeicao.length) {
  console.log("  amostra (ate 10):", amostraRejeicao.join(" | "));
}
console.log("(nota: essa validacao so afeta ESCRITAS futuras pela RPC — nao bloqueia nem altera vinculo ja gravado por esta migration)");

console.log("\nOK — nada foi escrito.");
