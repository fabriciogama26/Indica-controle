// audit-programming-legacy-map-readonly.mjs
// Auditoria SOMENTE-LEITURA que antecipa, sem tocar no banco, os numeros que a
// migration 342 (`programming_legacy_map`) vai reportar, e levanta o que a Fase 2
// (migration 343, historico legado -> `programming_history`) precisa decidir.
//
// Por que existe: a migration 342 so imprime os numeros DEPOIS de aplicada, e o
// de/para do historico nao pode ser escrito sem antes conhecer os `action_type`
// reais da tabela legada — inventar o mapeamento a partir do que a tela exibe
// (`HISTORY_ALLOWED_ACTIONS`) daria um de/para incompleto.
//
// NAO ESCREVE NADA. Só select.
//
// Rodar (raiz do repo): node scripts/audit-programming-legacy-map-readonly.mjs

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

const stageKey = (r) => `${r.tenant_id}|${r.project_id}|${r.execution_date}`;
const pct = (n, total) => (total ? `${((n / total) * 100).toFixed(1)}%` : "-");

console.log("Lendo producao (somente leitura)...\n");

const [legacy, stages, teams, history, projects] = await Promise.all([
  selectAll("project_programming", "id, tenant_id, project_id, team_id, execution_date, status"),
  selectAll("programming", "id, tenant_id, project_id, execution_date"),
  selectAll("programming_team", "id, tenant_id, programming_id, team_id, status"),
  selectAll("project_programming_history", "id, tenant_id, programming_id, team_id, action_type, created_at, created_by, reason"),
  selectAll("project", "id, sob"),
]);

const sobById = new Map(projects.map((p) => [p.id, p.sob]));
const stageByKey = new Map(stages.map((s) => [stageKey(s), s.id]));

// ---------------------------------------------------------------------------
// 1) O que a migration 342 vai reportar
// ---------------------------------------------------------------------------
const teamByStageAndTeam = new Map();
const rank = (s) => (s === "ATIVA" ? 0 : s === "TRANSFERIDA" ? 1 : 2);
for (const t of teams) {
  const k = `${t.programming_id}|${t.team_id}`;
  const cur = teamByStageAndTeam.get(k);
  if (!cur || rank(t.status) < rank(cur.status)) teamByStageAndTeam.set(k, t);
}

const legacyToStage = new Map();
let semEtapa = 0;
let semEquipe = 0;
const amostraSemEtapa = [];
for (const row of legacy) {
  const stageId = stageByKey.get(stageKey(row));
  if (!stageId) {
    semEtapa += 1;
    if (amostraSemEtapa.length < 10) amostraSemEtapa.push(`${sobById.get(row.project_id) ?? row.project_id} @ ${row.execution_date} (${row.status})`);
    continue;
  }
  const teamRow = teamByStageAndTeam.get(`${stageId}|${row.team_id}`) ?? null;
  if (!teamRow) semEquipe += 1;
  legacyToStage.set(row.id, { stageId, teamRowId: teamRow?.id ?? null });
}

console.log("=== 342 — mapeamento do ID legado ===");
console.log(`linhas legadas .................. ${legacy.length}`);
console.log(`etapas no modelo novo ........... ${stages.length}`);
console.log(`mapeadas ........................ ${legacyToStage.size} (${pct(legacyToStage.size, legacy.length)})`);
console.log(`sem etapa correspondente ........ ${semEtapa}`);
if (amostraSemEtapa.length) console.log(`  amostra: ${amostraSemEtapa.join(" | ")}`);
console.log(`sem equipe resolvida ............ ${semEquipe}`);

// ---------------------------------------------------------------------------
// 2) As tres FKs que a Fase 5 precisa remapear
// ---------------------------------------------------------------------------
console.log("\n=== 342 — FKs consumidoras (esperado 0 sem par) ===");
for (const [label, table, column] of [
  ["Medicao", "project_measurement_orders", "programming_id"],
  ["Controle APR", "project_apr_controls", "programming_id"],
  ["Cronograma", "cronograma_solicitacoes", "programacao_id"],
]) {
  const rows = await selectAll(table, `id, ${column}`);
  const comFk = rows.filter((r) => r[column]);
  const semPar = comFk.filter((r) => !legacyToStage.has(r[column]));
  console.log(`${label.padEnd(14)} linhas com FK=${String(comFk.length).padStart(5)} | sem par no mapa=${semPar.length}`);
}

// ---------------------------------------------------------------------------
// 3) Fase 2 — o que o de/para do historico precisa cobrir
// ---------------------------------------------------------------------------
console.log("\n=== 343 — historico legado ===");
console.log(`linhas de historico ............. ${history.length}`);

const porAcao = new Map();
for (const h of history) {
  const a = (h.action_type ?? "").trim().toUpperCase() || "(vazio)";
  porAcao.set(a, (porAcao.get(a) ?? 0) + 1);
}
console.log("\naction_type reais (o de/para precisa cobrir TODOS):");
for (const [acao, n] of [...porAcao.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${acao.padEnd(34)} ${String(n).padStart(5)}  ${pct(n, history.length)}`);
}

const semPar = history.filter((h) => !legacyToStage.has(h.programming_id));
console.log(`\nsem etapa correspondente (nao migravel): ${semPar.length} (${pct(semPar.length, history.length)})`);
const semParPorAcao = new Map();
for (const h of semPar) {
  const a = (h.action_type ?? "").trim().toUpperCase() || "(vazio)";
  semParPorAcao.set(a, (semParPorAcao.get(a) ?? 0) + 1);
}
for (const [acao, n] of [...semParPorAcao.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${acao.padEnd(34)} ${String(n).padStart(5)}`);
}

// Dedupe: linhas irmas geradas pela mesma acao de grupo (mesma etapa destino,
// mesma acao, mesmo instante, mesmo autor) colapsam em uma so.
const migravel = history.filter((h) => legacyToStage.has(h.programming_id));
const grupos = new Map();
for (const h of migravel) {
  const { stageId } = legacyToStage.get(h.programming_id);
  const k = [stageId, (h.action_type ?? "").trim().toUpperCase(), h.created_at, h.created_by ?? "", h.reason ?? ""].join("|");
  grupos.set(k, (grupos.get(k) ?? 0) + 1);
}
const colapsadas = migravel.length - grupos.size;
console.log(`\nmigraveis ....................... ${migravel.length}`);
console.log(`apos dedupe de linhas irmas ..... ${grupos.size}`);
console.log(`colapsadas ...................... ${colapsadas} (${pct(colapsadas, migravel.length)})`);

const maiores = [...grupos.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 5);
if (maiores.length) {
  console.log("\nmaiores grupos de duplicacao (etapa|acao|instante -> quantas linhas irmas):");
  for (const [k, n] of maiores) console.log(`  ${n}x  ${k.split("|").slice(1, 3).join(" @ ")}`);
}

console.log("\nOK — nada foi escrito.");
