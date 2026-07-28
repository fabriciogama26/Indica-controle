// audit-programming-delta-readonly.mjs
// Auditoria SOMENTE-LEITURA do delta entre a fonte legada (project_programming,
// usada pela tela programacao-simples) e o destino normalizado
// (programming / programming_team / programming_document).
//
// Existe porque a migration 315 congelou uma foto de 2026-07-19: tudo que a tela
// legada gravou/alterou depois disso NAO esta no modelo novo. Este script mede
// esse delta antes de gerar qualquer migration — nao faz INSERT/UPDATE/DELETE.
//
// Le via service_role (mesma credencial de src/lib/server/*), porque
// `npx supabase db query --linked` 403 para o token de CLI atual.
//
// Rodar (raiz do repo): node scripts/audit-programming-delta-readonly.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

function loadEnv(filePath) {
  const text = readFileSync(filePath, "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const env = loadEnv(path.join(REPO_ROOT, ".env"));
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente no .env");
  process.exit(1);
}
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// PostgREST corta em 1000 linhas por padrao. project_programming ja passa disso,
// entao toda leitura aqui e paginada — sem isso a auditoria mente por omissao.
const PAGE_SIZE = 1000;

async function selectAll(table, columns) {
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error(`Erro ao ler ${table}:`, error.message);
      process.exit(1);
    }
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

function stageKey(tenantId, projectId, executionDate) {
  return `${tenantId}|${projectId}|${executionDate ?? "SEM_DATA"}`;
}

// Remapeamentos conhecidos legado -> normalizado (migrations 310/318).
const WORK_COMPLETION_REMAP = {
  PARCIAL_PLANEJADO_BENFICIO_ATINGIDO: "BENEFICIO_ATINGIDO",
};

// numeric(14,2) volta como string do PostgREST ("5.00") e time como "08:00:00";
// comparar cru geraria falso positivo contra o mesmo valor gravado do outro lado.
function normalizeForCompare(campo, value) {
  if (value === null || value === undefined || value === "") return null;
  if (["poste_qty", "estrutura_qty", "trafo_qty", "rede_qty", "expected_minutes", "affected_customers"].includes(campo)) {
    return Number(value);
  }
  if (["start_time", "end_time", "outage_start_time", "outage_end_time"].includes(campo)) {
    return String(value).slice(0, 8);
  }
  if (campo === "work_completion_status") {
    return WORK_COMPLETION_REMAP[String(value)] ?? String(value);
  }
  return value;
}

// Divergencia esperada pelo desenho do modelo novo (nao e edicao na legada).
function isExplainableDivergence(campo, legado, destino, target) {
  if (campo === "work_completion_status") {
    // 'PENDENCIA' saiu do Estado do Trabalho na 318 e virou a flag is_pendencia.
    if (legado === "PENDENCIA" && !destino && target.is_pendencia) return "PENDENCIA -> is_pendencia (318)";
  }
  if (campo === "status") {
    // Idem: status 'PENDENCIA' da 317 foi revertido para a agenda por baixo.
    if (legado === "PENDENCIA" && target.is_pendencia) return "status PENDENCIA -> is_pendencia (318)";
  }
  return null;
}

function counter(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function printCounter(title, map) {
  console.log(`\n${title}`);
  if (map.size === 0) {
    console.log("  (nenhum)");
    return;
  }
  for (const [key, count] of [...map.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key}: ${count}`);
  }
}

async function main() {
  const legacyRows = await selectAll("project_programming", "*");
  const projects = await selectAll("project", "id, sob");
  const targetStages = await selectAll(
    "programming",
    "id, tenant_id, project_id, execution_date, status, work_completion_status, is_pendencia, created_at, updated_at",
  );
  const targetTeams = await selectAll("programming_team", "id, tenant_id, programming_id, team_id, status");
  const targetDocuments = await selectAll("programming_document", "id, programming_id, document_type, number");
  const workCatalog = await selectAll("programming_work_completion_catalog", "tenant_id, code, is_active");

  const sobByProjectId = new Map(projects.map((p) => [p.id, p.sob]));
  const catalogByTenant = new Map();
  for (const row of workCatalog) {
    if (!catalogByTenant.has(row.tenant_id)) catalogByTenant.set(row.tenant_id, new Set());
    catalogByTenant.get(row.tenant_id).add(row.code);
  }

  const targetByKey = new Map();
  for (const stage of targetStages) {
    targetByKey.set(stageKey(stage.tenant_id, stage.project_id, stage.execution_date), stage);
  }

  const teamsByProgrammingId = new Map();
  for (const team of targetTeams) {
    if (!teamsByProgrammingId.has(team.programming_id)) teamsByProgrammingId.set(team.programming_id, new Set());
    teamsByProgrammingId.get(team.programming_id).add(team.team_id);
  }

  const documentsByProgrammingId = new Map();
  for (const doc of targetDocuments) {
    if (!documentsByProgrammingId.has(doc.programming_id)) documentsByProgrammingId.set(doc.programming_id, new Set());
    documentsByProgrammingId.get(doc.programming_id).add(doc.document_type);
  }

  // Agrupa a fonte pela MESMA chave que o destino torna unica (tenant, projeto,
  // data) — igual ao gerador da 315, para que colisoes de grupo legado no mesmo
  // projeto+data continuem contadas como UMA etapa.
  const legacyByKey = new Map();
  for (const row of legacyRows) {
    const key = stageKey(row.tenant_id, row.project_id, row.execution_date);
    if (!legacyByKey.has(key)) legacyByKey.set(key, []);
    legacyByKey.get(key).push(row);
  }

  const novos = [];
  const jaMigrados = [];
  const editadosDepois = [];
  const equipesFaltando = [];
  const documentosFaltando = [];
  const semData = [];
  const statusDelta = new Map();
  const workStatusDelta = new Map();
  const workStatusForaDoCatalogo = new Map();
  const colisoesDeGrupo = [];
  const divergenciaEntreIrmas = [];

  const CAMPOS_COMPARADOS = [
    "status",
    "work_completion_status",
    "service_description",
    "period",
    "start_time",
    "end_time",
    "expected_minutes",
    "outage_start_time",
    "outage_end_time",
    "feeder",
    "campo_eletrico",
    "affected_customers",
    "sgd_type_id",
    "electrical_eq_catalog_id",
    "support",
    "support_item_id",
    "poste_qty",
    "estrutura_qty",
    "trafo_qty",
    "rede_qty",
    "note",
  ];

  for (const [key, members] of legacyByKey.entries()) {
    const first = members[0];
    const sob = sobByProjectId.get(first.project_id) ?? first.project_id;
    const groupIds = [...new Set(members.map((m) => m.programming_group_id))];
    const winner = [...members].sort((a, b) => {
      const diff = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    }).at(-1);

    if (!first.execution_date) semData.push({ sob, groupIds });
    if (groupIds.length > 1) colisoesDeGrupo.push({ sob, date: first.execution_date, groupIds });

    for (const campo of CAMPOS_COMPARADOS) {
      const valores = new Set(members.map((m) => JSON.stringify(m[campo] ?? null)));
      if (valores.size > 1) {
        divergenciaEntreIrmas.push({ sob, date: first.execution_date, campo });
      }
    }

    const target = targetByKey.get(key);

    if (!target) {
      novos.push({ sob, date: first.execution_date, groupIds, equipes: members.length, winner });
      counter(statusDelta, winner.status ?? "(null)");
      counter(workStatusDelta, winner.work_completion_status ?? "(em branco)");
      const catalog = catalogByTenant.get(first.tenant_id) ?? new Set();
      if (winner.work_completion_status && !catalog.has(winner.work_completion_status)) {
        counter(workStatusForaDoCatalogo, winner.work_completion_status);
      }
      continue;
    }

    jaMigrados.push({ sob, date: first.execution_date });

    // Divergencia REAL entre os dois lados. Comparar updated_at nao serve: a 315
    // copiou o created_at/updated_at legados para o destino, entao praticamente
    // toda linha pareceria "editada depois". O que vale e o valor do campo.
    // So os campos que existem nas DUAS tabelas entram na comparacao.
    const camposDiferentes = CAMPOS_COMPARADOS.filter((campo) => {
      if (!(campo in target)) return false;
      const legado = normalizeForCompare(campo, winner[campo]);
      const destino = normalizeForCompare(campo, target[campo]);
      return JSON.stringify(legado) !== JSON.stringify(destino);
    }).map((campo) => ({
      campo,
      legado: winner[campo] ?? null,
      destino: target[campo] ?? null,
      explicavel: isExplainableDivergence(campo, winner[campo], target[campo], target),
    }));

    if (camposDiferentes.length) {
      editadosDepois.push({
        sob,
        date: first.execution_date,
        legacyUpdatedAt: winner.updated_at,
        targetUpdatedAt: target.updated_at,
        camposDiferentes,
      });
    }

    const teamsNoDestino = teamsByProgrammingId.get(target.id) ?? new Set();
    const faltando = [...new Set(members.map((m) => m.team_id))].filter((teamId) => !teamsNoDestino.has(teamId));
    if (faltando.length) equipesFaltando.push({ sob, date: first.execution_date, teamIds: faltando });

    const docsNoDestino = documentsByProgrammingId.get(target.id) ?? new Set();
    for (const [type, numberField, includedField, deliveredField] of [
      ["SGD", "sgd_number", "sgd_included_at", "sgd_delivered_at"],
      ["PI", "pi_number", "pi_included_at", "pi_delivered_at"],
      ["PEP", "pep_number", "pep_included_at", "pep_delivered_at"],
    ]) {
      const number = (winner[numberField] ?? "").toString().trim();
      const temAlgo = number || winner[includedField] || winner[deliveredField];
      if (temAlgo && !docsNoDestino.has(type)) {
        documentosFaltando.push({ sob, date: first.execution_date, type, number: number || null });
      }
    }
  }

  console.log("=== AUDITORIA DELTA — programacao-simples -> programacao-normalizada (somente leitura) ===");
  console.log(`Executado em: ${new Date().toISOString()}`);
  console.log("\n--- Volumes ---");
  console.log(`  project_programming (linhas por equipe): ${legacyRows.length}`);
  console.log(`  project_programming (etapas = tenant+projeto+data): ${legacyByKey.size}`);
  console.log(`  programming (etapas no destino): ${targetStages.length}`);
  console.log(`  programming_team: ${targetTeams.length}`);
  console.log(`  programming_document: ${targetDocuments.length}`);

  console.log("\n--- Delta a migrar ---");
  console.log(`  Etapas NOVAS (existem na legada, nao existem no destino): ${novos.length}`);
  console.log(`  Etapas ja migradas (mesma chave nos dois lados): ${jaMigrados.length}`);
  console.log(`  Etapas ja migradas com edicao POSTERIOR na legada: ${editadosDepois.length}`);
  console.log(`  Etapas ja migradas com equipe faltando no destino: ${equipesFaltando.length}`);
  console.log(`  Etapas ja migradas com documento faltando no destino: ${documentosFaltando.length}`);

  printCounter("--- Delta por status de agenda (legado) ---", statusDelta);
  printCounter("--- Delta por Estado do Trabalho (legado) ---", workStatusDelta);
  printCounter("--- Estado do Trabalho FORA do catalogo do tenant (quebraria a FK) ---", workStatusForaDoCatalogo);

  console.log("\n--- Etapas legadas sem execution_date ---");
  console.log(`  ${semData.length}`);

  console.log("\n--- Colisoes de grupo legado no mesmo projeto+data (serao fundidas) ---");
  if (colisoesDeGrupo.length === 0) console.log("  (nenhuma)");
  for (const item of colisoesDeGrupo.slice(0, 30)) {
    console.log(`  SOB ${item.sob} | ${item.date} | grupos: ${item.groupIds.join(", ")}`);
  }
  if (colisoesDeGrupo.length > 30) console.log(`  ... e mais ${colisoesDeGrupo.length - 30}`);

  console.log("\n--- Campos divergentes entre equipes-irmas do mesmo grupo (vence updated_at mais recente) ---");
  if (divergenciaEntreIrmas.length === 0) console.log("  (nenhum)");
  const divergenciaPorCampo = new Map();
  for (const item of divergenciaEntreIrmas) counter(divergenciaPorCampo, item.campo);
  for (const [campo, count] of [...divergenciaPorCampo.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${campo}: ${count} etapa(s)`);
  }

  console.log("\n--- Amostra das etapas NOVAS (ate 40) ---");
  for (const item of novos.slice(0, 40)) {
    console.log(
      `  SOB ${item.sob} | ${item.date} | ${item.equipes} equipe(s) | status ${item.winner.status} | estado ${item.winner.work_completion_status ?? "-"}`,
    );
  }
  if (novos.length > 40) console.log(`  ... e mais ${novos.length - 40}`);

  console.log("\n--- Etapas ja migradas com VALOR divergente entre legada e destino ---");
  if (editadosDepois.length === 0) console.log("  (nenhuma)");
  const divergenciaPorCampoDestino = new Map();
  for (const item of editadosDepois) {
    for (const diff of item.camposDiferentes) {
      counter(divergenciaPorCampoDestino, diff.explicavel ? `${diff.campo} [explicavel: ${diff.explicavel}]` : diff.campo);
    }
  }
  for (const [campo, count] of [...divergenciaPorCampoDestino.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${campo}: ${count} etapa(s)`);
  }

  console.log("\n--- Detalhe das divergencias (ate 40 etapas) ---");
  for (const item of editadosDepois.slice(0, 40)) {
    console.log(`  SOB ${item.sob} | ${item.date} | legada updated_at ${item.legacyUpdatedAt} | destino updated_at ${item.targetUpdatedAt}`);
    for (const diff of item.camposDiferentes) {
      const nota = diff.explicavel ? `  <- explicavel: ${diff.explicavel}` : "";
      console.log(`      ${diff.campo}: legada=${JSON.stringify(diff.legado)} | destino=${JSON.stringify(diff.destino)}${nota}`);
    }
  }
  if (editadosDepois.length > 40) console.log(`  ... e mais ${editadosDepois.length - 40}`);

  // BLOQUEIO DURO: indice unico parcial programming_one_active_completion_per_project
  // (migration 321) — no maximo UM CONCLUIDO ativo nao-pendencia por projeto.
  // Um insert do delta que caia nessa condicao num projeto que ja tem CONCLUIDO
  // ativo derruba a migration inteira.
  const ATIVO = new Set(["PROGRAMADA", "REPROGRAMADA"]);
  const concluidoAtivoPorProjeto = new Map();
  for (const stage of targetStages) {
    if (ATIVO.has(stage.status) && stage.work_completion_status === "CONCLUIDO" && !stage.is_pendencia) {
      const chave = `${stage.tenant_id}|${stage.project_id}`;
      if (!concluidoAtivoPorProjeto.has(chave)) concluidoAtivoPorProjeto.set(chave, []);
      concluidoAtivoPorProjeto.get(chave).push(stage);
    }
  }

  const conflitosConcluido = [];
  const concluidoNoDelta = new Map();
  for (const item of novos) {
    const w = item.winner;
    const estado = WORK_COMPLETION_REMAP[w.work_completion_status] ?? w.work_completion_status;
    if (!ATIVO.has(w.status) || estado !== "CONCLUIDO") continue;
    const chave = `${w.tenant_id}|${w.project_id}`;
    const jaExiste = concluidoAtivoPorProjeto.get(chave) ?? [];
    if (!concluidoNoDelta.has(chave)) concluidoNoDelta.set(chave, []);
    concluidoNoDelta.get(chave).push(item);
    if (jaExiste.length > 0) {
      conflitosConcluido.push({
        sob: item.sob,
        date: item.date,
        motivo: `projeto ja tem CONCLUIDO ativo no destino em ${jaExiste.map((s) => s.execution_date).join(", ")}`,
      });
    }
  }
  for (const [chave, itens] of concluidoNoDelta.entries()) {
    if (itens.length > 1) {
      conflitosConcluido.push({
        sob: itens[0].sob,
        date: itens.map((i) => i.date).join(", "),
        motivo: `${itens.length} etapas CONCLUIDO ativas para o MESMO projeto dentro do proprio delta (chave ${chave})`,
      });
    }
  }

  console.log("\n--- BLOQUEIO 321: conflito de CONCLUIDO ativo unico por projeto ---");
  if (conflitosConcluido.length === 0) console.log("  (nenhum — o delta nao fura o indice unico)");
  for (const item of conflitosConcluido) {
    console.log(`  SOB ${item.sob} | ${item.date} | ${item.motivo}`);
  }

  // Etapas que so existem no modelo novo (cadastradas direto na tela nova).
  const legacyKeys = new Set(legacyByKey.keys());
  const somenteNoDestino = targetStages.filter(
    (s) => !legacyKeys.has(stageKey(s.tenant_id, s.project_id, s.execution_date)),
  );
  console.log("\n--- Etapas que existem SO no destino (nascidas na tela nova) ---");
  console.log(`  ${somenteNoDestino.length}`);
  for (const stage of somenteNoDestino.slice(0, 20)) {
    console.log(
      `  SOB ${sobByProjectId.get(stage.project_id) ?? stage.project_id} | ${stage.execution_date ?? "(em espera)"} | status ${stage.status}`,
    );
  }

  console.log("\n--- Equipes faltando em etapas ja migradas (ate 40) ---");
  if (equipesFaltando.length === 0) console.log("  (nenhuma)");
  for (const item of equipesFaltando.slice(0, 40)) {
    console.log(`  SOB ${item.sob} | ${item.date} | equipes: ${item.teamIds.join(", ")}`);
  }
  if (equipesFaltando.length > 40) console.log(`  ... e mais ${equipesFaltando.length - 40}`);

  console.log("\n--- Documentos faltando em etapas ja migradas (ate 40) ---");
  if (documentosFaltando.length === 0) console.log("  (nenhum)");
  for (const item of documentosFaltando.slice(0, 40)) {
    console.log(`  SOB ${item.sob} | ${item.date} | ${item.type} ${item.number ?? "(sem numero)"}`);
  }
  if (documentosFaltando.length > 40) console.log(`  ... e mais ${documentosFaltando.length - 40}`);
}

main();
