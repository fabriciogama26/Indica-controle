// generate-migration-335-programming-delta.mjs
// Gera supabase/migrations/335_migrate_legacy_programming_delta.sql — a carga de
// CORTE (cutover) da tela programacao-simples (project_programming) para o modelo
// normalizado (programming/programming_team/programming_document).
//
// CONTEXTO
// ---------------------------------------------------------------------------
// A migration 315 ja migrou uma foto de 2026-07-19 e esta APLICADA em producao.
// As duas telas seguiram em producao em paralelo desde entao, entao existem tres
// situacoes distintas — e elas NAO tem o mesmo tratamento:
//   a) etapa so na legada  -> INSERT (nunca migrada).
//   b) etapa nos dois lados, valores iguais -> nada a fazer.
//   c) etapa nos dois lados, valores diferentes -> as duas telas avancaram em
//      casos diferentes. Copiar a legada por cima apagaria trabalho feito na
//      tela nova (inclusive reverter conclusoes).
//
// POLITICA DE CONFLITO (decidida com o usuario, 2026-07-28): MERGE CONSERVADOR
// ---------------------------------------------------------------------------
// Nunca regride, nunca sobrescreve decisao tomada na tela nova. So preenche o
// que o destino ainda nao decidiu:
//   - work_completion_status: atualiza SO se o destino esta null (em branco) e a
//     legada tem valor. Destino preenchido vence sempre (ex.: etapa concluida na
//     tela nova continua CONCLUIDO mesmo com a legada em PARCIAL_*).
//   - status: 'PROGRAMADA' no destino e o default de quem nunca mexeu na agenda,
//     e status nunca e nulo — entao o equivalente a "em branco" aqui e
//     status='PROGRAMADA'. Atualiza SO nesse caso, quando a legada registrou uma
//     decisao (REPROGRAMADA/ADIADA/CANCELADA). Destino ja em REPROGRAMADA/ADIADA/
//     CANCELADA/ANTECIPADA = decisao da tela nova: NAO toca, entra no relatorio
//     de revisao manual.
//   - equipe/documento presentes na legada e ausentes no destino: INSERT (aditivo,
//     nunca remove o que so existe no destino).
//
// REMAPEAMENTOS DE MODELO (nao sao edicao, sao desenho)
//   - PARCIAL_PLANEJADO_BENFICIO_ATINGIDO (typo legado) -> BENEFICIO_ATINGIDO (310).
//   - work_completion_status/status 'PENDENCIA' -> flag is_pendencia (318). No
//     modelo novo 'PENDENCIA' nao existe em nenhum dos dois eixos.
//
// NAO MIGRADO (igual a 315)
//   - historico legado (project_programming_history): o historico novo comeca vazio.
//   - lineage copied_from_id/copy_batch_id/anticipated_by_id: FK para linha legada
//     (nivel equipe, nao etapa); remapear exigiria 2 passadas e nao afeta
//     reclassify/agendamento.
//   - classificacao (etapa_number/etapa_unica/etapa_final): nasce null/false/false
//     e e recalculada por reclassify_project_programming_stages no fim do arquivo.
//
// SEGURANCA DA MIGRATION GERADA
//   - todo UPDATE carrega a guarda do valor esperado no WHERE (ex.: `and
//     work_completion_status is null`). Se o dado mudar entre gerar e aplicar, o
//     UPDATE simplesmente nao acha a linha em vez de sobrescrever um valor novo.
//     Isso tambem torna o arquivo re-executavel sem estrago.
//   - INSERTs usam ON CONFLICT DO NOTHING nas mesmas chaves da 315.
//   - project_programming (fonte) NAO e alterado nem apagado — so leitura.
//
// Rodar: node scripts/generate-migration-335-programming-delta.mjs
// Saida: supabase/migrations/335_migrate_legacy_programming_delta.sql (nao aplica nada)
//        docs/planejamento/Revisao_Delta_Programacao_335.txt (conflitos manuais)

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
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente no .env");
  process.exit(1);
}
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// PostgREST corta em 1000 linhas por padrao e project_programming ja passa disso.
// Sem paginacao o gerador produziria uma migration silenciosamente incompleta.
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

const WORK_COMPLETION_REMAP = {
  PARCIAL_PLANEJADO_BENFICIO_ATINGIDO: "BENEFICIO_ATINGIDO",
};

const STATUS_AGENDA_ATIVA = new Set(["PROGRAMADA", "REPROGRAMADA"]);
const STATUS_DESTINO_VALIDO = new Set(["PROGRAMADA", "REPROGRAMADA", "ADIADA", "CANCELADA", "ANTECIPADA"]);

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

function stageKey(tenantId, projectId, executionDate) {
  return `${tenantId}|${projectId}|${executionDate ?? "SEM_DATA"}`;
}

function pickWinningRow(rows) {
  return [...rows]
    .sort((a, b) => {
      const diff = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    })
    .at(-1);
}

// Traduz o Estado do Trabalho legado para o modelo novo. Retorna tambem a flag
// de pendencia, porque 'PENDENCIA' deixou de ser Estado do Trabalho na 318.
function traduzEstadoLegado(row) {
  const bruto = row.work_completion_status ?? null;
  if (!bruto) return { workCompletionStatus: null, isPendencia: false };
  if (bruto === "PENDENCIA") return { workCompletionStatus: null, isPendencia: true };
  return { workCompletionStatus: WORK_COMPLETION_REMAP[bruto] ?? bruto, isPendencia: false };
}

// Status de agenda legado -> modelo novo. 'PENDENCIA' como status (modelo 317,
// revertido pela 318) volta para a agenda por baixo.
function traduzStatusLegado(row) {
  if (row.status === "PENDENCIA") {
    return { status: row.previous_operational_status ?? "PROGRAMADA", isPendencia: true };
  }
  return { status: row.status, isPendencia: false };
}

async function main() {
  const legacyRows = await selectAll("project_programming", "*");
  const projects = await selectAll("project", "id, sob");
  const targetStages = await selectAll(
    "programming",
    "id, tenant_id, project_id, execution_date, status, work_completion_status, is_pendencia, " +
      "cancellation_reason, canceled_at, canceled_by, created_at, updated_at",
  );
  const targetTeams = await selectAll("programming_team", "id, tenant_id, programming_id, team_id, status");
  const targetDocuments = await selectAll("programming_document", "id, programming_id, document_type");
  const workCatalog = await selectAll("programming_work_completion_catalog", "tenant_id, code");

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

  // Estado do indice unico da 321 (um CONCLUIDO ativo nao-pendencia por projeto),
  // simulado ao longo da geracao: cada CONCLUIDO que este arquivo for inserir ou
  // preencher OCUPA a vaga do projeto. Sem isso a migration poderia gerar duas
  // conclusoes no mesmo projeto e falhar inteira na aplicacao.
  const vagaConcluidoOcupada = new Set();
  for (const stage of targetStages) {
    if (STATUS_AGENDA_ATIVA.has(stage.status) && stage.work_completion_status === "CONCLUIDO" && !stage.is_pendencia) {
      vagaConcluidoOcupada.add(`${stage.tenant_id}|${stage.project_id}`);
    }
  }

  const legacyByKey = new Map();
  for (const row of legacyRows) {
    const key = stageKey(row.tenant_id, row.project_id, row.execution_date);
    if (!legacyByKey.has(key)) legacyByKey.set(key, []);
    legacyByKey.get(key).push(row);
  }

  const programmingRows = [];
  const teamRows = [];
  const documentRows = [];
  const updatesEstado = [];
  const updatesStatus = [];
  const updatesPendencia = [];
  const projectsTouched = new Map();
  const warnings = [];
  const revisaoManual = [];

  // Ordem estavel por SOB + data: o arquivo gerado nao muda de ordem entre
  // execucoes so porque o PostgREST devolveu as linhas em outra sequencia.
  const chavesOrdenadas = [...legacyByKey.keys()].sort((a, b) => {
    const ra = legacyByKey.get(a)[0];
    const rb = legacyByKey.get(b)[0];
    const sa = `${sobByProjectId.get(ra.project_id) ?? ra.project_id}|${ra.execution_date ?? ""}`;
    const sb = `${sobByProjectId.get(rb.project_id) ?? rb.project_id}|${rb.execution_date ?? ""}`;
    return sa.localeCompare(sb);
  });

  for (const key of chavesOrdenadas) {
    const members = legacyByKey.get(key);
    const tenantId = members[0].tenant_id;
    const projectId = members[0].project_id;
    const executionDate = members[0].execution_date;
    const sob = sobByProjectId.get(projectId) ?? projectId;
    const groupIds = [...new Set(members.map((m) => m.programming_group_id))];
    const groupLabel = groupIds.join(", ");
    const winner = pickWinningRow(members);
    const target = targetByKey.get(key);

    const estadoLegado = traduzEstadoLegado(winner);
    const statusLegado = traduzStatusLegado(winner);
    const isPendenciaLegado = estadoLegado.isPendencia || statusLegado.isPendencia;

    const catalog = catalogByTenant.get(tenantId) ?? new Set();
    if (estadoLegado.workCompletionStatus && !catalog.has(estadoLegado.workCompletionStatus)) {
      warnings.push(
        `SOB ${sob} | ${executionDate}: Estado do Trabalho '${estadoLegado.workCompletionStatus}' nao existe no catalogo do tenant — etapa IGNORADA (quebraria a FK).`,
      );
      continue;
    }
    if (!STATUS_DESTINO_VALIDO.has(statusLegado.status)) {
      warnings.push(
        `SOB ${sob} | ${executionDate}: status legado '${statusLegado.status}' nao e valido no modelo novo — etapa IGNORADA.`,
      );
      continue;
    }

    // ---------------------------------------------------------------------
    // (a) Etapa que nunca chegou ao modelo novo -> INSERT completo.
    // ---------------------------------------------------------------------
    if (!target) {
      if (groupIds.length > 1) {
        warnings.push(
          `SOB ${sob} | ${executionDate}: grupos legados ${groupLabel} colidem no mesmo projeto+data — fundidos em 1 etapa so, equipes somadas.`,
        );
      }

      let workCompletionStatus = estadoLegado.workCompletionStatus;
      const chaveProjeto = `${tenantId}|${projectId}`;
      if (
        workCompletionStatus === "CONCLUIDO" &&
        STATUS_AGENDA_ATIVA.has(statusLegado.status) &&
        !isPendenciaLegado
      ) {
        if (vagaConcluidoOcupada.has(chaveProjeto)) {
          warnings.push(
            `SOB ${sob} | ${executionDate}: projeto ja tem CONCLUIDO ativo no destino — etapa inserida SEM o Estado do Trabalho (o indice unico da 321 so admite um). Revisar manualmente.`,
          );
          revisaoManual.push({
            tipo: "CONCLUIDO_DUPLICADO",
            sob,
            date: executionDate,
            detalhe: "etapa inserida com Estado do Trabalho em branco; a conclusao precisa ser decidida na tela nova",
          });
          workCompletionStatus = null;
        } else {
          vagaConcluidoOcupada.add(chaveProjeto);
        }
      }

      const newProgrammingId = randomUUID();
      programmingRows.push({
        id: newProgrammingId,
        tenant_id: tenantId,
        project_id: projectId,
        execution_date: executionDate,
        status: statusLegado.status,
        work_completion_status: workCompletionStatus,
        is_pendencia: isPendenciaLegado,
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
        previous_operational_status: statusLegado.isPendencia ? null : winner.previous_operational_status,
        cancellation_reason: winner.cancellation_reason,
        canceled_at: winner.canceled_at,
        canceled_by: winner.canceled_by,
        created_by: winner.created_by,
        updated_by: winner.updated_by,
        created_at: winner.created_at,
        updated_at: winner.updated_at,
        _sob: sob,
        _sourceGroups: groupIds,
      });

      projectsTouched.set(`${tenantId}|${projectId}`, { tenantId, projectId, sob });

      const seenTeamIds = new Set();
      for (const member of [...members].sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at))) {
        if (seenTeamIds.has(member.team_id)) {
          warnings.push(
            `SOB ${sob} | ${executionDate}: equipe ${member.team_id} duplicada entre linhas legadas — mantida so a mais recente.`,
          );
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
          _sob: sob,
          _date: executionDate,
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
          _sob: sob,
          _date: executionDate,
        });
      }

      continue;
    }

    // ---------------------------------------------------------------------
    // (b)/(c) Etapa ja existe no destino -> merge conservador.
    // ---------------------------------------------------------------------
    let tocouProjeto = false;

    // Estado do Trabalho: so preenche o que esta em branco no destino.
    if (estadoLegado.workCompletionStatus && target.work_completion_status === null) {
      const chaveProjeto = `${tenantId}|${projectId}`;
      const viraConcluidoAtivo =
        estadoLegado.workCompletionStatus === "CONCLUIDO" &&
        STATUS_AGENDA_ATIVA.has(target.status) &&
        !target.is_pendencia;

      if (viraConcluidoAtivo && vagaConcluidoOcupada.has(chaveProjeto)) {
        warnings.push(
          `SOB ${sob} | ${executionDate}: legada marca CONCLUIDO mas o projeto ja tem CONCLUIDO ativo no destino — NAO aplicado (indice unico da 321).`,
        );
        revisaoManual.push({
          tipo: "CONCLUIDO_DUPLICADO",
          sob,
          date: executionDate,
          detalhe: `legada=CONCLUIDO | destino=em branco | projeto ja tem outra etapa CONCLUIDO ativa`,
        });
      } else {
        if (viraConcluidoAtivo) vagaConcluidoOcupada.add(chaveProjeto);
        updatesEstado.push({
          id: target.id,
          tenantId,
          valor: estadoLegado.workCompletionStatus,
          updatedBy: winner.updated_by,
          _sob: sob,
          _date: executionDate,
        });
        tocouProjeto = true;
      }
    } else if (
      estadoLegado.workCompletionStatus &&
      target.work_completion_status !== null &&
      estadoLegado.workCompletionStatus !== target.work_completion_status
    ) {
      revisaoManual.push({
        tipo: "ESTADO_DIVERGENTE",
        sob,
        date: executionDate,
        detalhe: `legada=${estadoLegado.workCompletionStatus} | destino=${target.work_completion_status} (destino preenchido vence — nao alterado)`,
      });
    }

    // Agenda: 'PROGRAMADA' no destino = ninguem decidiu nada la; qualquer outro
    // valor e decisao da tela nova e nao pode ser regredida.
    if (statusLegado.status !== target.status) {
      if (target.status === "PROGRAMADA" && statusLegado.status !== "PROGRAMADA") {
        updatesStatus.push({
          id: target.id,
          tenantId,
          valor: statusLegado.status,
          cancellationReason: statusLegado.status === "CANCELADA" ? winner.cancellation_reason : null,
          canceledAt: statusLegado.status === "CANCELADA" ? winner.canceled_at : null,
          canceledBy: statusLegado.status === "CANCELADA" ? winner.canceled_by : null,
          updatedBy: winner.updated_by,
          _sob: sob,
          _date: executionDate,
        });
        tocouProjeto = true;
      } else if (statusLegado.status !== "PROGRAMADA") {
        // So e perda de dado quando a LEGADA registrou uma decisao. Legada em
        // 'PROGRAMADA' contra um destino ja decidido nao tem nada a trazer —
        // reportar isso so encheria a lista de revisao de ruido.
        revisaoManual.push({
          tipo: "AGENDA_DIVERGENTE",
          sob,
          date: executionDate,
          detalhe: `legada=${statusLegado.status} | destino=${target.status} (destino ja decidiu a agenda — nao alterado)`,
        });
      }
    }

    // Pendencia: aditiva. Ligar a flag e o que a 318 faria; desligar seria
    // regressao, entao nunca desliga.
    if (isPendenciaLegado && !target.is_pendencia) {
      updatesPendencia.push({
        id: target.id,
        tenantId,
        updatedBy: winner.updated_by,
        _sob: sob,
        _date: executionDate,
      });
      tocouProjeto = true;
    }

    // Equipes presentes na legada e ausentes no destino (aditivo).
    const teamsNoDestino = teamsByProgrammingId.get(target.id) ?? new Set();
    const seenTeamIds = new Set();
    for (const member of [...members].sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at))) {
      if (seenTeamIds.has(member.team_id) || teamsNoDestino.has(member.team_id)) continue;
      seenTeamIds.add(member.team_id);
      teamRows.push({
        id: randomUUID(),
        programming_id: target.id,
        tenant_id: tenantId,
        team_id: member.team_id,
        created_by: member.created_by,
        updated_by: member.updated_by,
        created_at: member.created_at,
        updated_at: member.updated_at,
        _sob: sob,
        _date: executionDate,
      });
      tocouProjeto = true;
    }

    // Documentos presentes na legada e ausentes no destino (aditivo).
    const docsNoDestino = documentsByProgrammingId.get(target.id) ?? new Set();
    for (const [type, numberField, includedField, deliveredField] of [
      ["SGD", "sgd_number", "sgd_included_at", "sgd_delivered_at"],
      ["PI", "pi_number", "pi_included_at", "pi_delivered_at"],
      ["PEP", "pep_number", "pep_included_at", "pep_delivered_at"],
    ]) {
      const number = (winner[numberField] ?? "").toString().trim();
      const includedAt = winner[includedField];
      const deliveredAt = winner[deliveredField];
      if (!number && !includedAt && !deliveredAt) continue;
      if (docsNoDestino.has(type)) continue;
      documentRows.push({
        id: randomUUID(),
        programming_id: target.id,
        tenant_id: tenantId,
        document_type: type,
        number: number || null,
        included_at: includedAt,
        delivered_at: deliveredAt,
        created_by: winner.created_by,
        updated_by: winner.updated_by,
        _sob: sob,
        _date: executionDate,
      });
      tocouProjeto = true;
    }

    if (tocouProjeto) projectsTouched.set(`${tenantId}|${projectId}`, { tenantId, projectId, sob });
  }

  // ===========================================================================
  // Pre-voo: valida FK e CHECK antes de escrever o arquivo
  // ===========================================================================
  // A migration roda como um bloco so: uma unica linha invalida derruba tudo e
  // custa outra tentativa. Estas checagens rodam contra o banco real e ABORTAM a
  // geracao em vez de produzir um SQL que morre na aplicacao.
  const erros = [];

  const sgdTypes = await selectAll("programming_sgd_types", "id, tenant_id");
  const eqCatalog = await selectAll("programming_eq_catalog", "id, tenant_id");
  const supportItems = await selectAll("programming_support_items", "id, tenant_id");
  const teams = await selectAll("teams", "id, tenant_id");
  const appUsers = await selectAll("app_users", "id");

  const chaveComposta = (rows) => new Set(rows.map((r) => `${r.tenant_id}|${r.id}`));
  const sgdValidos = chaveComposta(sgdTypes);
  const eqValidos = chaveComposta(eqCatalog);
  const supportValidos = chaveComposta(supportItems);
  const teamsValidos = chaveComposta(teams);
  const usuariosValidos = new Set(appUsers.map((u) => u.id));

  const checaFk = (valor, conjunto, tenantId, rotulo, contexto) => {
    if (!valor) return;
    if (!conjunto.has(`${tenantId}|${valor}`)) {
      erros.push(`${contexto}: ${rotulo} '${valor}' nao existe para o tenant — quebraria a FK.`);
    }
  };
  const checaUsuario = (valor, rotulo, contexto) => {
    if (!valor) return;
    if (!usuariosValidos.has(valor)) {
      erros.push(`${contexto}: ${rotulo} '${valor}' nao existe em app_users — quebraria a FK.`);
    }
  };
  const checaNaoNegativo = (valor, rotulo, contexto) => {
    if (valor === null || valor === undefined) return;
    if (Number(valor) < 0) {
      erros.push(`${contexto}: ${rotulo} = ${valor} e negativo — violaria o CHECK da 325.`);
    }
  };

  for (const r of programmingRows) {
    const ctx = `SOB ${r._sob} | ${r.execution_date}`;
    checaFk(r.sgd_type_id, sgdValidos, r.tenant_id, "sgd_type_id", ctx);
    checaFk(r.electrical_eq_catalog_id, eqValidos, r.tenant_id, "electrical_eq_catalog_id", ctx);
    checaFk(r.support_item_id, supportValidos, r.tenant_id, "support_item_id", ctx);
    checaUsuario(r.created_by, "created_by", ctx);
    checaUsuario(r.updated_by, "updated_by", ctx);
    checaUsuario(r.canceled_by, "canceled_by", ctx);
    for (const campo of ["poste_qty", "estrutura_qty", "trafo_qty", "rede_qty", "expected_minutes", "affected_customers"]) {
      checaNaoNegativo(r[campo], campo, ctx);
    }
    if (r.period && !["INTEGRAL", "PARCIAL"].includes(r.period)) {
      erros.push(`${ctx}: period '${r.period}' viola o CHECK (so INTEGRAL/PARCIAL).`);
    }
    if (r.status === "CANCELADA" && !r.cancellation_reason) {
      warnings.push(`${ctx}: etapa CANCELADA sem motivo de cancelamento na legada — migrada assim mesmo.`);
    }
  }

  for (const r of teamRows) {
    const ctx = `SOB ${r._sob} | ${r._date} (equipe)`;
    checaFk(r.team_id, teamsValidos, r.tenant_id, "team_id", ctx);
    checaUsuario(r.created_by, "created_by", ctx);
    checaUsuario(r.updated_by, "updated_by", ctx);
  }

  for (const u of [...updatesEstado, ...updatesStatus, ...updatesPendencia]) {
    checaUsuario(u.updatedBy, "updated_by", `SOB ${u._sob} | ${u._date} (update)`);
  }

  if (erros.length) {
    console.error(`\nPRE-VOO FALHOU — ${erros.length} problema(s) que fariam a migration abortar na aplicacao:`);
    for (const erro of erros) console.error(`  ${erro}`);
    console.error("\nNenhum arquivo foi escrito. Corrigir a origem do dado e reexecutar.");
    process.exit(1);
  }

  // ===========================================================================
  // Montagem do SQL
  // ===========================================================================
  const lines = [];
  lines.push("-- 335_migrate_legacy_programming_delta.sql");
  lines.push("-- Carga de CORTE da tela programacao-simples (project_programming) para o modelo");
  lines.push("-- normalizado (programming/programming_team/programming_document). Complementa a");
  lines.push("-- migration 315, que migrou a foto de 2026-07-19 e ja esta aplicada em producao.");
  lines.push("-- Gerado por scripts/generate-migration-335-programming-delta.mjs a partir do banco");
  lines.push("-- em producao — NAO editar valores a mao aqui; reexecutar o gerador se a fonte mudar.");
  lines.push("--");
  lines.push(`-- Gerado em: ${new Date().toISOString()}`);
  lines.push(
    `-- Etapas inseridas: ${programmingRows.length} | equipes: ${teamRows.length} | documentos: ${documentRows.length}`,
  );
  lines.push(
    `-- Updates de Estado do Trabalho: ${updatesEstado.length} | de agenda: ${updatesStatus.length} | de pendencia: ${updatesPendencia.length}`,
  );
  lines.push(`-- Casos deixados para revisao manual: ${revisaoManual.length} (ver docs/planejamento/Revisao_Delta_Programacao_335.txt)`);
  lines.push("--");
  lines.push("-- POLITICA DE CONFLITO: MERGE CONSERVADOR (decidido com o usuario em 2026-07-28)");
  lines.push("-- - Etapa ausente no destino: inserida integralmente.");
  lines.push("-- - Etapa presente nos dois lados: so PREENCHE o que o destino nao decidiu.");
  lines.push("--   * work_completion_status: atualizado so quando o destino esta em branco (null).");
  lines.push("--   * status: atualizado so quando o destino ainda esta em 'PROGRAMADA' (default de");
  lines.push("--     quem nunca mexeu na agenda) e a legada registrou decisao. Destino ja em");
  lines.push("--     REPROGRAMADA/ADIADA/CANCELADA = decisao da tela nova, NAO e sobrescrita.");
  lines.push("--   * equipes/documentos: apenas os que faltam no destino (aditivo, nada e removido).");
  lines.push("-- - Nenhum valor ja preenchido na tela nova e regredido. Divergencias reais que");
  lines.push("--   sobraram estao listadas no TXT de revisao, nao aplicadas aqui.");
  lines.push("--");
  lines.push("-- REMAPEAMENTOS (desenho do modelo, nao edicao):");
  lines.push("-- - PARCIAL_PLANEJADO_BENFICIO_ATINGIDO (typo legado) -> BENEFICIO_ATINGIDO (310).");
  lines.push("-- - 'PENDENCIA' (status ou Estado do Trabalho legado) -> flag is_pendencia (318).");
  lines.push("--");
  lines.push("-- GUARDAS: todo UPDATE carrega no WHERE o valor que se espera encontrar. Se o dado");
  lines.push("-- mudar entre a geracao e a aplicacao, o UPDATE nao encontra a linha em vez de");
  lines.push("-- sobrescrever a alteracao mais nova. O arquivo e re-executavel sem estrago.");
  lines.push("--");
  lines.push("-- NAO MIGRADO (igual a 315): historico legado, lineage (copied_from_id/copy_batch_id/");
  lines.push("-- anticipated_by_id) e classificacao (resolvida pelo reclassify no fim do arquivo).");
  lines.push("-- project_programming (fonte) NAO e alterado nem apagado — so leitura.");
  lines.push("");

  if (warnings.length) {
    lines.push("-- ===== Avisos do gerador (revisar antes de aplicar) =====");
    for (const warning of warnings) lines.push(`-- ${warning}`);
    lines.push("");
  }

  const programmingColumns = [
    "id", "tenant_id", "project_id", "execution_date", "status", "work_completion_status", "is_pendencia",
    "service_description", "period", "start_time", "end_time", "expected_minutes",
    "outage_start_time", "outage_end_time", "feeder", "campo_eletrico", "affected_customers",
    "sgd_type_id", "electrical_eq_catalog_id", "support", "support_item_id",
    "poste_qty", "estrutura_qty", "trafo_qty", "rede_qty", "note",
    "previous_work_completion_status", "previous_operational_status",
    "cancellation_reason", "canceled_at", "canceled_by", "created_by", "updated_by",
    "created_at", "updated_at",
  ];

  if (programmingRows.length) {
    lines.push("-- ===== 1) Etapas que nunca chegaram ao modelo novo =====");
    lines.push(`insert into public.programming (${programmingColumns.join(", ")})`);
    lines.push("values");
    lines.push(
      ...programmingRows.map((r, index) => {
        const values = [
          sqlLiteral(r.id), sqlLiteral(r.tenant_id), sqlLiteral(r.project_id), sqlLiteral(r.execution_date),
          sqlLiteral(r.status), sqlLiteral(r.work_completion_status), sqlBool(r.is_pendencia),
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
        const suffix = index === programmingRows.length - 1 ? "" : ",";
        return `  (${values.join(", ")})${suffix} -- SOB ${r._sob} | ${r.execution_date} | grupo(s) legado(s): ${r._sourceGroups.join(", ")}`;
      }),
    );
    // A migration 318 trocou a UNIQUE constraint por um INDICE UNICO PARCIAL
    // (`where execution_date is not null`, para permitir varias etapas "em espera"
    // sem data no mesmo projeto). O Postgres so consegue inferir um indice parcial
    // se o predicado aparecer no alvo do ON CONFLICT — sem ele o erro e
    // 42P10 "there is no unique or exclusion constraint matching the ON CONFLICT
    // specification". A 315 usava a forma sem predicado porque foi aplicada ANTES
    // da 318, quando ainda existia a constraint.
    lines.push(
      "on conflict (tenant_id, project_id, execution_date) where execution_date is not null do nothing;",
    );
    lines.push("");
  }

  const teamColumns = ["id", "programming_id", "tenant_id", "team_id", "status", "created_by", "updated_by", "created_at", "updated_at"];
  if (teamRows.length) {
    lines.push("-- ===== 2) Equipes (das etapas novas + as que faltavam em etapas ja migradas) =====");
    lines.push(`insert into public.programming_team (${teamColumns.join(", ")})`);
    lines.push("values");
    lines.push(
      ...teamRows.map((r, index) => {
        const values = [
          sqlLiteral(r.id), sqlLiteral(r.programming_id), sqlLiteral(r.tenant_id), sqlLiteral(r.team_id), sqlLiteral("ATIVA"),
          sqlLiteral(r.created_by), sqlLiteral(r.updated_by), sqlLiteral(r.created_at), sqlLiteral(r.updated_at),
        ];
        const suffix = index === teamRows.length - 1 ? "" : ",";
        return `  (${values.join(", ")})${suffix} -- SOB ${r._sob} | ${r._date}`;
      }),
    );
    lines.push("on conflict do nothing;");
    lines.push("");
  }

  const documentColumns = ["id", "programming_id", "tenant_id", "document_type", "number", "included_at", "delivered_at", "created_by", "updated_by"];
  if (documentRows.length) {
    lines.push("-- ===== 3) Documentos SGD/PI/PEP =====");
    lines.push(`insert into public.programming_document (${documentColumns.join(", ")})`);
    lines.push("values");
    lines.push(
      ...documentRows.map((r, index) => {
        const values = [
          sqlLiteral(r.id), sqlLiteral(r.programming_id), sqlLiteral(r.tenant_id), sqlLiteral(r.document_type),
          sqlLiteral(r.number), sqlLiteral(r.included_at), sqlLiteral(r.delivered_at),
          sqlLiteral(r.created_by), sqlLiteral(r.updated_by),
        ];
        const suffix = index === documentRows.length - 1 ? "" : ",";
        return `  (${values.join(", ")})${suffix} -- SOB ${r._sob} | ${r._date}`;
      }),
    );
    lines.push("on conflict (programming_id, document_type) do nothing;");
    lines.push("");
  }

  if (updatesEstado.length) {
    lines.push("-- ===== 4) Estado do Trabalho: preenche SO o que esta em branco no destino =====");
    lines.push("-- A guarda `and work_completion_status is null` garante que nada preenchido na");
    lines.push("-- tela nova entre a geracao e a aplicacao seja sobrescrito.");
    for (const u of updatesEstado) {
      lines.push(
        `update public.programming set work_completion_status = ${sqlLiteral(u.valor)}, updated_by = ${sqlLiteral(u.updatedBy)} ` +
          `where id = ${sqlLiteral(u.id)} and tenant_id = ${sqlLiteral(u.tenantId)} and work_completion_status is null; -- SOB ${u._sob} | ${u._date}`,
      );
    }
    lines.push("");
  }

  if (updatesStatus.length) {
    lines.push("-- ===== 5) Agenda: so quando o destino ainda esta em 'PROGRAMADA' =====");
    lines.push("-- A guarda `and status = 'PROGRAMADA'` impede regredir uma agenda que a tela nova");
    lines.push("-- ja decidiu (adiar/cancelar/reprogramar).");
    for (const u of updatesStatus) {
      const extras =
        u.valor === "CANCELADA"
          ? `, cancellation_reason = ${sqlLiteral(u.cancellationReason)}, canceled_at = ${sqlLiteral(u.canceledAt)}, canceled_by = ${sqlLiteral(u.canceledBy)}`
          : "";
      lines.push(
        `update public.programming set status = ${sqlLiteral(u.valor)}${extras}, updated_by = ${sqlLiteral(u.updatedBy)} ` +
          `where id = ${sqlLiteral(u.id)} and tenant_id = ${sqlLiteral(u.tenantId)} and status = 'PROGRAMADA'; -- SOB ${u._sob} | ${u._date}`,
      );
    }
    lines.push("");
  }

  if (updatesPendencia.length) {
    lines.push("-- ===== 6) Flag is_pendencia (aditiva: liga o que a legada marcou, nunca desliga) =====");
    for (const u of updatesPendencia) {
      lines.push(
        `update public.programming set is_pendencia = true, updated_by = ${sqlLiteral(u.updatedBy)} ` +
          `where id = ${sqlLiteral(u.id)} and tenant_id = ${sqlLiteral(u.tenantId)} and is_pendencia = false; -- SOB ${u._sob} | ${u._date}`,
      );
    }
    lines.push("");
  }

  const projectEntries = [...projectsTouched.values()].sort((a, b) => a.sob.localeCompare(b.sob));
  if (projectEntries.length) {
    lines.push("-- ===== 7) Reclassificacao =====");
    lines.push("-- Classificacao Unica/Etapa N/Final e derivada da posicao por data entre as etapas");
    lines.push("-- ATIVAS — nunca gravada a mao acima. actor null = sistema/migracao.");
    for (const entry of projectEntries) {
      lines.push(
        `select public.reclassify_project_programming_stages(${sqlLiteral(entry.tenantId)}, ${sqlLiteral(entry.projectId)}, null); -- SOB ${entry.sob}`,
      );
    }
    lines.push("");
  }

  const outputPath = path.join(REPO_ROOT, "supabase", "migrations", "335_migrate_legacy_programming_delta.sql");
  writeFileSync(outputPath, lines.join("\n"), "utf8");

  // ===========================================================================
  // Relatorio de revisao manual
  // ===========================================================================
  const reportLines = [];
  reportLines.push("Revisao manual — delta Programacao Simples -> Programacao Normalizada (migration 335)");
  reportLines.push("=".repeat(90));
  reportLines.push(`Gerado em: ${new Date().toISOString()}`);
  reportLines.push("");
  reportLines.push("Estes casos NAO foram aplicados pela migration 335. O merge conservador nao");
  reportLines.push("sobrescreve valor ja decidido na tela nova, entao cada linha abaixo precisa de");
  reportLines.push("decisao humana — e como o corte congela a tela Simples, nao havera nova chance");
  reportLines.push("de trazer esse dado automaticamente.");
  reportLines.push("");

  const porTipo = new Map();
  for (const item of revisaoManual) {
    if (!porTipo.has(item.tipo)) porTipo.set(item.tipo, []);
    porTipo.get(item.tipo).push(item);
  }
  const descricaoTipo = {
    AGENDA_DIVERGENTE:
      "As duas telas decidiram a agenda de formas diferentes. O destino ja saiu de PROGRAMADA, entao a decisao da tela nova prevaleceu. Conferir qual das duas e a real e ajustar na tela nova (Adiar / Cancelar / Corrigir data).",
    ESTADO_DIVERGENTE:
      "As duas telas lancaram Estado do Trabalho diferente para a mesma etapa. O destino estava preenchido e venceu. Conferir e, se a legada estiver certa, ajustar na tela nova.",
    CONCLUIDO_DUPLICADO:
      "A legada marca CONCLUIDO mas o projeto ja tem outra etapa CONCLUIDO ativa no destino. O indice unico da migration 321 admite so uma — resolver qual e a conclusao correta na tela nova.",
  };

  for (const [tipo, itens] of porTipo.entries()) {
    reportLines.push("-".repeat(90));
    reportLines.push(`${tipo} (${itens.length})`);
    reportLines.push(descricaoTipo[tipo] ?? "");
    reportLines.push("-".repeat(90));
    for (const item of itens.sort((a, b) => `${a.sob}${a.date}`.localeCompare(`${b.sob}${b.date}`))) {
      reportLines.push(`  SOB ${item.sob} | ${item.date} | ${item.detalhe}`);
    }
    reportLines.push("");
  }

  if (revisaoManual.length === 0) {
    reportLines.push("(nenhum caso pendente de revisao)");
    reportLines.push("");
  }

  if (warnings.length) {
    reportLines.push("-".repeat(90));
    reportLines.push(`Avisos do gerador (${warnings.length})`);
    reportLines.push("-".repeat(90));
    for (const warning of warnings) reportLines.push(`  ${warning}`);
    reportLines.push("");
  }

  const reportPath = path.join(REPO_ROOT, "docs", "planejamento", "Revisao_Delta_Programacao_335.txt");
  writeFileSync(reportPath, reportLines.join("\n"), "utf8");

  console.log(`Gerado: ${outputPath}`);
  console.log(`Gerado: ${reportPath}`);
  console.log(
    `Etapas inseridas: ${programmingRows.length} | Equipes: ${teamRows.length} | Documentos: ${documentRows.length}`,
  );
  console.log(
    `Updates — Estado do Trabalho: ${updatesEstado.length} | Agenda: ${updatesStatus.length} | Pendencia: ${updatesPendencia.length}`,
  );
  console.log(`Projetos reclassificados: ${projectEntries.length}`);
  console.log(`Revisao manual: ${revisaoManual.length} | Avisos: ${warnings.length}`);
}

main();
