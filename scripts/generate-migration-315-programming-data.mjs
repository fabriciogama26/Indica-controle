// generate-migration-315-programming-data.mjs
// Gera supabase/migrations/315_migrate_legacy_programming_data.sql a partir dos
// dados reais de project_programming (leitura via service_role — mesmo motivo
// de sempre: `supabase db query --linked` 403 nesse token).
//
// Regras (confirmadas com o usuario nesta conversa):
// - 1 (tenant_id, project_id, execution_date) => 1 linha em programming (etapa).
//   Normalmente isso coincide com 1 programming_group_id, mas quando 2+ grupos
//   legados colidem na mesma data do mesmo projeto (ex.: caso D1 do projeto
//   RC0323603632/2026-07-24, 3 grupos duplicados) eles sao fundidos em uma unica
//   etapa com a uniao das equipes; classificacao ("Final"/"Etapa N") fica a
//   cargo do reclassify, nao e fixada aqui. Agrupar direto por essa chave (em vez
//   de por programming_group_id) generaliza a fusao para qualquer colisao, nao
//   so a D1 — a tabela programming tem unique(tenant_id, project_id, execution_date),
//   entao qualquer colisao nao fundida aqui quebraria a FK do programming_team
//   (linha de programming descartada por ON CONFLICT DO NOTHING, mas ainda
//   referenciada pela equipe).
// - Campo divergente entre linhas-irmas do mesmo grupo: vale o valor da linha
//   com updated_at mais recente ("mais recente vence").
// - work_completion_status: PARCIAL_PLANEJADO_BENFICIO_ATINGIDO (typo legado)
//   vira BENEFICIO_ATINGIDO (codigo novo, correto, migration 310). Os demais
//   codigos (PARCIAL_PLANEJADO, PARCIAL_NAO_PLANEJADO, CONCLUIDO, PENDENCIA,
//   RETIRADO) passam direto — ja existem no catalogo programming_work_completion_catalog
//   deste tenant.
// - Lineage (copied_from_id/copy_batch_id/anticipated_by_id) NAO migrada: sao
//   FK para outra linha de project_programming (nivel de linha/equipe, nao de
//   etapa) e remapear exigiria 2 passadas; nao afeta reclassify/agendamento
//   (funcional), so historico de "veio de qual copia". previous_work_completion_status/
//   previous_operational_status SAO migrados (sao snapshot escalar, nao FK).
// - classificacao (etapa_number/etapa_unica/etapa_final) NAO copiada da legada
//   — nasce null/false/false e e recalculada por reclassify_project_programming_stages
//   ao final, por projeto (etapas inativas ficam null/false mesmo).
// - Historico (project_programming_history) NAO migrado — o novo historico
//   comeca vazio a partir da migracao.
//
// Rodar: node scripts/generate-migration-315-programming-data.mjs
// Saida: supabase/migrations/315_migrate_legacy_programming_data.sql (NAO aplica nada)

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
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
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const WORK_COMPLETION_REMAP = {
  PARCIAL_PLANEJADO_BENFICIO_ATINGIDO: "BENEFICIO_ATINGIDO",
};

function sqlLiteral(value) {
  if (value === null || value === undefined || value === "") return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNumber(value) {
  if (value === null || value === undefined) return "null";
  return String(value);
}

function sqlBool(value) {
  return value ? "true" : "false";
}

function pickWinningRow(rows) {
  return [...rows].sort((a, b) => {
    const diff = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  }).at(-1);
}

async function main() {
  const { data: rows, error } = await supabase.from("project_programming").select("*");
  if (error) {
    console.error("Erro ao ler project_programming:", error.message);
    process.exit(1);
  }

  const { data: projects, error: projectsError } = await supabase.from("project").select("id, sob");
  if (projectsError) {
    console.error("Erro ao ler project:", projectsError.message);
    process.exit(1);
  }
  const sobByProjectId = new Map(projects.map((p) => [p.id, p.sob]));

  const { data: existingProgramming, error: existingError } = await supabase
    .from("programming")
    .select("tenant_id, project_id, execution_date");
  if (existingError) {
    console.error("Erro ao ler programming (destino) — migration 310 aplicada?", existingError.message);
    process.exit(1);
  }
  const existingKeys = new Set(existingProgramming.map((r) => `${r.tenant_id}|${r.project_id}|${r.execution_date}`));

  // Agrupa direto pela chave que a tabela destino torna unica. Isso funde
  // automaticamente qualquer conjunto de programming_group_id legados que
  // colidam no mesmo projeto+data (generaliza o caso D1 sem hardcode).
  const byStageKey = new Map();
  for (const row of rows) {
    const key = `${row.tenant_id}|${row.project_id}|${row.execution_date}`;
    if (!byStageKey.has(key)) byStageKey.set(key, []);
    byStageKey.get(key).push(row);
  }

  const programmingRows = [];
  const teamRows = [];
  const documentRows = [];
  const projectsTouched = new Map(); // `${tenant}|${project}` -> {tenant, project}
  const warnings = [];
  let skippedExisting = 0;

  for (const [key, members] of byStageKey.entries()) {
    const groupIds = [...new Set(members.map((m) => m.programming_group_id))];
    const groupLabel = groupIds.join(", ");
    const tenantId = members[0].tenant_id;
    const projectId = members[0].project_id;
    const executionDate = members[0].execution_date;

    if (groupIds.length > 1) {
      warnings.push(`Grupos ${groupLabel} (SOB ${sobByProjectId.get(projectId) ?? projectId}, ${executionDate}): colidem no mesmo projeto+data — fundidos em 1 etapa so, equipes somadas.`);
    }

    if (existingKeys.has(key)) {
      skippedExisting += 1;
      warnings.push(`Grupo(s) ${groupLabel} (SOB ${sobByProjectId.get(projectId) ?? projectId}, ${executionDate}): ja existe etapa em programming para esse projeto+data — pulado (evita violar unique).`);
      continue;
    }

    const winner = pickWinningRow(members);
    const newProgrammingId = randomUUID();

    const workCompletionStatus = winner.work_completion_status
      ? (WORK_COMPLETION_REMAP[winner.work_completion_status] ?? winner.work_completion_status)
      : null;

    programmingRows.push({
      id: newProgrammingId,
      tenant_id: tenantId,
      project_id: projectId,
      execution_date: executionDate,
      status: winner.status,
      work_completion_status: workCompletionStatus,
      service_description: winner.service_description,
      period: winner.period,
      start_time: winner.start_time,
      end_time: winner.end_time,
      expected_minutes: winner.expected_minutes,
      outage_start_time: winner.outage_start_time,
      outage_end_time: winner.outage_end_time,
      feeder: winner.feeder,
      campo_eletrico: winner.campo_eletrico,
      affected_customers: winner.affected_customers,
      sgd_type_id: winner.sgd_type_id,
      electrical_eq_catalog_id: winner.electrical_eq_catalog_id,
      support: winner.support,
      support_item_id: winner.support_item_id,
      poste_qty: winner.poste_qty,
      estrutura_qty: winner.estrutura_qty,
      trafo_qty: winner.trafo_qty,
      rede_qty: winner.rede_qty,
      note: winner.note,
      previous_work_completion_status: winner.previous_work_completion_status,
      previous_operational_status: winner.previous_operational_status,
      cancellation_reason: winner.cancellation_reason,
      canceled_at: winner.canceled_at,
      canceled_by: winner.canceled_by,
      created_by: winner.created_by,
      updated_by: winner.updated_by,
      created_at: winner.created_at,
      updated_at: winner.updated_at,
      _sob: sobByProjectId.get(projectId) ?? projectId,
      _sourceGroups: [...new Set(members.map((m) => m.programming_group_id))],
    });

    projectsTouched.set(`${tenantId}|${projectId}`, { tenantId, projectId, sob: sobByProjectId.get(projectId) ?? projectId });

    const seenTeamIds = new Set();
    for (const member of [...members].sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at))) {
      if (seenTeamIds.has(member.team_id)) {
        warnings.push(`Grupo(s) ${groupLabel}: equipe ${member.team_id} duplicada entre membros — mantida so a linha ${member.id} (updated_at mais recente).`);
        continue;
      }
      seenTeamIds.add(member.team_id);
      teamRows.push({
        id: randomUUID(),
        programming_id: newProgrammingId,
        tenant_id: tenantId,
        team_id: member.team_id,
        created_by: member.created_by,
        updated_by: member.updated_by,
        created_at: member.created_at,
        updated_at: member.updated_at,
      });
    }

    for (const [type, numberField, includedField, deliveredField] of [
      ["SGD", "sgd_number", "sgd_included_at", "sgd_delivered_at"],
      ["PI", "pi_number", "pi_included_at", "pi_delivered_at"],
      ["PEP", "pep_number", "pep_included_at", "pep_delivered_at"],
    ]) {
      const number = (winner[numberField] ?? "").toString().trim();
      const includedAt = winner[includedField];
      const deliveredAt = winner[deliveredField];
      if (!number && !includedAt && !deliveredAt) continue;
      documentRows.push({
        id: randomUUID(),
        programming_id: newProgrammingId,
        tenant_id: tenantId,
        document_type: type,
        number: number || null,
        included_at: includedAt,
        delivered_at: deliveredAt,
        created_by: winner.created_by,
        updated_by: winner.updated_by,
      });
    }
  }

  const lines = [];
  lines.push("-- 315_migrate_legacy_programming_data.sql");
  lines.push("-- Migra dados reais de project_programming (modelo antigo, flat/por-equipe) para");
  lines.push("-- programming/programming_team/programming_document (modelo normalizado). Gerado por");
  lines.push("-- scripts/generate-migration-315-programming-data.mjs a partir do banco em producao —");
  lines.push("-- NAO editar valores a mao aqui; reexecutar o gerador se os dados de origem mudarem.");
  lines.push("--");
  lines.push(`-- Gerado em: ${new Date().toISOString()}`);
  lines.push(`-- Grupos migrados: ${programmingRows.length} | equipes: ${teamRows.length} | documentos: ${documentRows.length}`);
  lines.push(`-- Grupos pulados (etapa ja existe em programming para o projeto+data): ${skippedExisting}`);
  lines.push("--");
  lines.push("-- Decisoes aplicadas (confirmadas com o usuario):");
  lines.push("-- - Grupos legados que colidem no mesmo projeto+data (ex.: caso D1, SOB RC0323603632,");
  lines.push("--   2026-07-24: 3 grupos fdc45307/27030c60/5d2810f6) sao fundidos em 1 etapa so, com a");
  lines.push("--   uniao das equipes. Classificacao final (Final/Etapa N) e resolvida pelo reclassify no");
  lines.push("--   fim deste arquivo, nao fixada aqui. Ver avisos abaixo para a lista completa de fusoes.");
  lines.push("-- - 13 grupos com campo divergente entre equipes-irmas: vale o valor da linha com");
  lines.push("--   updated_at mais recente.");
  lines.push("-- - project_programming (fonte) NAO e alterado nem apagado por esta migration — so leitura.");
  lines.push("-- - Historico legado (project_programming_history) NAO migrado; historico novo comeca vazio.");
  lines.push("-- - copied_from_id/copy_batch_id/anticipated_by_id NAO migrados (ver cabecalho do gerador).");
  lines.push("");

  if (warnings.length) {
    lines.push("-- ===== Avisos do gerador (revisar antes de aplicar) =====");
    for (const warning of warnings) lines.push(`-- ${warning}`);
    lines.push("");
  }

  const programmingColumns = [
    "id", "tenant_id", "project_id", "execution_date", "status", "work_completion_status",
    "service_description", "period", "start_time", "end_time", "expected_minutes",
    "outage_start_time", "outage_end_time", "feeder", "campo_eletrico", "affected_customers",
    "sgd_type_id", "electrical_eq_catalog_id", "support", "support_item_id",
    "poste_qty", "estrutura_qty", "trafo_qty", "rede_qty", "note",
    "previous_work_completion_status", "previous_operational_status",
    "cancellation_reason", "canceled_at", "canceled_by", "created_by", "updated_by",
    "created_at", "updated_at",
  ];

  if (programmingRows.length) {
    lines.push(`insert into public.programming (${programmingColumns.join(", ")})`);
    lines.push("values");
    const valueLines = programmingRows.map((r, index) => {
      const values = [
        sqlLiteral(r.id), sqlLiteral(r.tenant_id), sqlLiteral(r.project_id), sqlLiteral(r.execution_date),
        sqlLiteral(r.status), sqlLiteral(r.work_completion_status),
        sqlLiteral(r.service_description), sqlLiteral(r.period), sqlLiteral(r.start_time), sqlLiteral(r.end_time),
        sqlNumber(r.expected_minutes),
        sqlLiteral(r.outage_start_time), sqlLiteral(r.outage_end_time), sqlLiteral(r.feeder), sqlLiteral(r.campo_eletrico),
        sqlNumber(r.affected_customers),
        sqlLiteral(r.sgd_type_id), sqlLiteral(r.electrical_eq_catalog_id), sqlLiteral(r.support), sqlLiteral(r.support_item_id),
        sqlNumber(r.poste_qty), sqlNumber(r.estrutura_qty), sqlNumber(r.trafo_qty), sqlNumber(r.rede_qty),
        sqlLiteral(r.note),
        sqlLiteral(r.previous_work_completion_status), sqlLiteral(r.previous_operational_status),
        sqlLiteral(r.cancellation_reason), sqlLiteral(r.canceled_at), sqlLiteral(r.canceled_by),
        sqlLiteral(r.created_by), sqlLiteral(r.updated_by), sqlLiteral(r.created_at), sqlLiteral(r.updated_at),
      ];
      const comment = `SOB ${r._sob} | ${r.execution_date} | grupo(s) legado(s): ${r._sourceGroups.join(", ")}`;
      const suffix = index === programmingRows.length - 1 ? "" : ",";
      return `  (${values.join(", ")})${suffix} -- ${comment}`;
    });
    lines.push(...valueLines);
    lines.push("on conflict (tenant_id, project_id, execution_date) do nothing;");
    lines.push("");
  }

  const teamColumns = ["id", "programming_id", "tenant_id", "team_id", "status", "created_by", "updated_by", "created_at", "updated_at"];
  if (teamRows.length) {
    lines.push(`insert into public.programming_team (${teamColumns.join(", ")})`);
    lines.push("values");
    const valueLines = teamRows.map((r, index) => {
      const values = [
        sqlLiteral(r.id), sqlLiteral(r.programming_id), sqlLiteral(r.tenant_id), sqlLiteral(r.team_id), sqlLiteral("ATIVA"),
        sqlLiteral(r.created_by), sqlLiteral(r.updated_by), sqlLiteral(r.created_at), sqlLiteral(r.updated_at),
      ];
      const suffix = index === teamRows.length - 1 ? "" : ",";
      return `  (${values.join(", ")})${suffix}`;
    });
    lines.push(...valueLines);
    lines.push("on conflict do nothing;");
    lines.push("");
  }

  const documentColumns = ["id", "programming_id", "tenant_id", "document_type", "number", "included_at", "delivered_at", "created_by", "updated_by"];
  if (documentRows.length) {
    lines.push(`insert into public.programming_document (${documentColumns.join(", ")})`);
    lines.push("values");
    const valueLines = documentRows.map((r, index) => {
      const values = [
        sqlLiteral(r.id), sqlLiteral(r.programming_id), sqlLiteral(r.tenant_id), sqlLiteral(r.document_type),
        sqlLiteral(r.number), sqlLiteral(r.included_at), sqlLiteral(r.delivered_at),
        sqlLiteral(r.created_by), sqlLiteral(r.updated_by),
      ];
      const suffix = index === documentRows.length - 1 ? "" : ",";
      return `  (${values.join(", ")})${suffix}`;
    });
    lines.push(...valueLines);
    lines.push("on conflict (programming_id, document_type) do nothing;");
    lines.push("");
  }

  lines.push("-- Reclassifica cada projeto tocado (classificacao Unica/Etapa N/Final por posicao de");
  lines.push("-- data entre as etapas ATIVAS — nunca gravada a mao acima). actor null = sistema/migracao.");
  const projectEntries = [...projectsTouched.values()].sort((a, b) => a.sob.localeCompare(b.sob));
  for (const entry of projectEntries) {
    lines.push(`select public.reclassify_project_programming_stages(${sqlLiteral(entry.tenantId)}, ${sqlLiteral(entry.projectId)}, null); -- SOB ${entry.sob}`);
  }
  lines.push("");

  const outputPath = path.join(REPO_ROOT, "supabase", "migrations", "315_migrate_legacy_programming_data.sql");
  writeFileSync(outputPath, lines.join("\n"), "utf8");

  console.log(`Gerado: ${outputPath}`);
  console.log(`Etapas: ${programmingRows.length} | Equipes: ${teamRows.length} | Documentos: ${documentRows.length} | Projetos: ${projectEntries.length}`);
  console.log(`Pulados (ja existiam): ${skippedExisting}`);
  if (warnings.length) console.log(`Avisos: ${warnings.length} (ver cabecalho do arquivo gerado)`);
}

main();
