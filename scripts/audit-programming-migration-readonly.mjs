// audit-programming-migration-readonly.mjs
// Auditoria somente-leitura de project_programming, via service_role (mesma
// credencial que o app usa em src/lib/server/*). Nao faz INSERT/UPDATE/DELETE.
// Existe porque `npx supabase db query --linked` 403 para o token de CLI atual
// (falta de privilegio na Management API, nao relacionado ao acesso ao banco).
//
// Rodar (a partir da raiz do repo): node scripts/audit-programming-migration-readonly.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

const env = loadEnv(path.join(__dirname, "..", ".env"));
const url = env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente no .env");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

function distinctCount(rows, key) {
  return new Set(rows.map((r) => JSON.stringify(r[key] ?? null))).size;
}

async function main() {
  const { data: rows, error } = await supabase
    .from("project_programming")
    .select(
      "id, tenant_id, project_id, team_id, programming_group_id, execution_date, status, work_completion_status, " +
        "etapa_number, etapa_unica, etapa_final, service_description, period, start_time, end_time, feeder, " +
        "campo_eletrico, rede_qty, poste_qty, estrutura_qty, trafo_qty, sgd_number, pi_number, pep_number, " +
        "anticipated_by_programming_id, copied_from_programming_id, copy_batch_id",
    );

  if (error) {
    console.error("Erro ao consultar project_programming:", error.message);
    process.exit(1);
  }

  console.log("=== 1) Volume geral ===");
  console.log("total_rows:", rows.length, "| total_grupos:", distinctCount(rows, "programming_group_id"));

  console.log("\n=== 2) Status ===");
  const byStatus = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  console.table(byStatus);

  console.log("\n=== 3) Estado Trabalho ===");
  const byWorkStatus = {};
  for (const r of rows) {
    const key = r.work_completion_status ?? "(em branco)";
    byWorkStatus[key] = (byWorkStatus[key] ?? 0) + 1;
  }
  console.table(byWorkStatus);

  const activeRows = rows.filter((r) => r.status === "PROGRAMADA" || r.status === "REPROGRAMADA");

  console.log("\n=== 4) D1 - projeto+data com mais de uma etapa (grupo) ativa ===");
  const byProjectDate = new Map();
  for (const r of activeRows) {
    const key = `${r.project_id}|${r.execution_date}`;
    if (!byProjectDate.has(key)) byProjectDate.set(key, new Set());
    byProjectDate.get(key).add(r.programming_group_id);
  }
  const d1Cases = [...byProjectDate.entries()].filter(([, groups]) => groups.size > 1);
  console.log("casos D1:", d1Cases.length);
  for (const [key, groups] of d1Cases) {
    console.log(" -", key, "grupos:", [...groups]);
  }

  console.log("\n=== 5) Equipe repetida no mesmo grupo (ativo) ===");
  const byGroupTeam = new Map();
  for (const r of activeRows) {
    const key = `${r.programming_group_id}|${r.team_id}`;
    byGroupTeam.set(key, (byGroupTeam.get(key) ?? 0) + 1);
  }
  const repeatedTeam = [...byGroupTeam.entries()].filter(([, count]) => count > 1);
  console.log("casos:", repeatedTeam.length, repeatedTeam);

  console.log("\n=== 6) Grupos ativos com campo divergente entre equipes-irmas ===");
  const byGroup = new Map();
  for (const r of activeRows) {
    if (!byGroup.has(r.programming_group_id)) byGroup.set(r.programming_group_id, []);
    byGroup.get(r.programming_group_id).push(r);
  }
  const fieldsToCheck = ["service_description", "period", "start_time", "end_time", "feeder", "campo_eletrico", "rede_qty", "poste_qty", "estrutura_qty", "trafo_qty"];
  const divergentGroups = [];
  for (const [groupId, groupRows] of byGroup.entries()) {
    if (groupRows.length < 2) continue;
    const variantFields = fieldsToCheck.filter((field) => distinctCount(groupRows, field) > 1);
    if (variantFields.length) {
      divergentGroups.push({ groupId, linhas: groupRows.length, variantFields });
    }
  }
  console.log("grupos divergentes:", divergentGroups.length);
  for (const g of divergentGroups) {
    console.log(" -", g.groupId, "linhas:", g.linhas, "campos:", g.variantFields.join(", "));
  }

  console.log("\n=== 7) Multiplos CONCLUIDO ativo no mesmo projeto (por GRUPO/etapa, nao por linha-equipe) ===");
  const concludedGroupsByProject = new Map();
  for (const r of activeRows) {
    if (r.work_completion_status !== "CONCLUIDO") continue;
    if (!concludedGroupsByProject.has(r.project_id)) concludedGroupsByProject.set(r.project_id, new Set());
    concludedGroupsByProject.get(r.project_id).add(r.programming_group_id);
  }
  const multiConcluded = [...concludedGroupsByProject.entries()].filter(([, groups]) => groups.size > 1);
  console.log("casos (grupos distintos concluidos no mesmo projeto):", multiConcluded.length);
  for (const [projectId, groups] of multiConcluded) {
    console.log(" -", projectId, "grupos:", [...groups]);
  }

  console.log("\n=== 8) Conflito de agenda ja gravado (mesma equipe/data/tenant, horario sobreposto) ===");
  const byTenantTeamDate = new Map();
  for (const r of activeRows) {
    if (!r.start_time || !r.end_time) continue;
    const key = `${r.tenant_id}|${r.team_id}|${r.execution_date}`;
    if (!byTenantTeamDate.has(key)) byTenantTeamDate.set(key, []);
    byTenantTeamDate.get(key).push(r);
  }
  let conflictCount = 0;
  const conflictSamples = [];
  for (const [key, groupRows] of byTenantTeamDate.entries()) {
    if (groupRows.length < 2) continue;
    for (let i = 0; i < groupRows.length; i++) {
      for (let j = i + 1; j < groupRows.length; j++) {
        const a = groupRows[i];
        const b = groupRows[j];
        if (a.start_time < b.end_time && b.start_time < a.end_time) {
          conflictCount++;
          if (conflictSamples.length < 20) conflictSamples.push({ key, a: a.id, b: b.id });
        }
      }
    }
  }
  console.log("casos:", conflictCount, conflictSamples);

  console.log("\n=== 9) Classificacao invalida (ativa, sem unica/final/numero) ===");
  const invalidClassification = activeRows.filter((r) => !r.etapa_unica && !r.etapa_final && r.etapa_number === null);
  console.log("invalidas_ativas:", invalidClassification.length, invalidClassification.map((r) => r.id));

  console.log("\n=== 10) Documentos SGD/PI/PEP preenchidos ===");
  const withDocs = rows.filter((r) => (r.sgd_number ?? "").trim() || (r.pi_number ?? "").trim() || (r.pep_number ?? "").trim());
  console.log("linhas:", withDocs.length);

  console.log("\n=== 11) Atividades (project_programming_activities) ===");
  const { count: activitiesCount, error: activitiesError } = await supabase
    .from("project_programming_activities")
    .select("id", { count: "exact", head: true });
  console.log("linhas:", activitiesError ? `erro: ${activitiesError.message}` : activitiesCount);

  console.log("\n=== 12) Vinculos a repontar ===");
  console.log("anticipated_by:", rows.filter((r) => r.anticipated_by_programming_id).length);
  console.log("copied_from:", rows.filter((r) => r.copied_from_programming_id).length);
  console.log("copy_batch:", rows.filter((r) => r.copy_batch_id).length);

  console.log("\n=== 13) Historico ===");
  const { count: historyCount, error: historyError } = await supabase
    .from("project_programming_history")
    .select("id", { count: "exact", head: true });
  console.log("linhas:", historyError ? `erro: ${historyError.message}` : historyCount);
}

main();
