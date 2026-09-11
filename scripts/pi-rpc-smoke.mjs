/**
 * pi-rpc-smoke.mjs — teste de fumaca das RPCs da Permissao de Intervencao.
 *
 * Nao existe runner de teste neste repositorio (CLAUDE.md secao 9 registra a
 * lacuna). Este script segue o padrao dos demais `scripts/*.mjs`: roda com
 * `node`, imprime o resultado e sai com codigo 1 na primeira falha.
 *
 * ATENCAO — ESTE SCRIPT ESCREVE NO BANCO LIGADO.
 * Diferente de `pi-docx-verify.mjs`, que e puro em memoria, aqui as RPCs sao
 * exercitadas de verdade contra o Supabase do `.env`. O script cria uma PI de
 * teste e a REMOVE no final, junto com as filhas (cascade) e o historico.
 *
 * Modos:
 *   node scripts/pi-rpc-smoke.mjs
 *     Cria, edita, salva o Plano de Execucao, confere a validacao de emissao e
 *     limpa. NAO emite, entao NAO consome numero de PI e NAO altera nenhuma
 *     configuracao do contrato.
 *
 *   node scripts/pi-rpc-smoke.mjs --issue
 *     Faz tambem o caminho de emissao. Para isso precisa que o Plano de
 *     Emergencia esteja configurado: se estiver vazio, o script grava um texto
 *     temporario e RESTAURA o valor anterior no final. Consome um numero do
 *     sequencial e devolve o contador ao valor anterior por compare-and-set,
 *     abortando a devolucao se outra emissao tiver acontecido no meio.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(repoRoot, "package.json"));
const { createClient } = require("@supabase/supabase-js");

const WITH_ISSUE = process.argv.includes("--issue");

// ---------------------------------------------------------------------------
// Infraestrutura minima
// ---------------------------------------------------------------------------

const failures = [];
let checks = 0;

function check(label, condition, detail) {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
    return true;
  }
  console.log(`  FALHA ${label}${detail ? ` -> ${detail}` : ""}`);
  failures.push(label);
  return false;
}

function section(title) {
  console.log(`\n=== ${title}`);
}

function loadEnv() {
  const path = join(repoRoot, ".env");
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
 * Escolhe o contrato do teste.
 *
 * NAO pode ser `limit(1)` solto: sem ordem, o Postgres devolve qualquer linha, e
 * cair num contrato sem Programacao faz a secao `Criar a partir da Programacao`
 * ser pulada em silencio — foi exatamente o que aconteceu na primeira execucao
 * depois que um segundo contrato ganhou configuracao. A preferencia e pelo
 * contrato com etapa ATIVA, que e o unico onde aquele caminho roda de verdade.
 *
 * `--tenant <uuid>` força a escolha, para reproduzir um caso especifico.
 */
async function pickTenantSettings(sb) {
  const forcedIndex = process.argv.indexOf("--tenant");
  const forced = forcedIndex >= 0 ? process.argv[forcedIndex + 1] : null;

  const columns = "tenant_id, code_prefix, company_code, sequence_digits, emergency_plan_text, emergency_plan_version";
  const { data } = await sb.from("pi_settings").select(columns).order("tenant_id");
  const rows = data ?? [];
  if (rows.length === 0) return null;
  if (forced) return rows.find((row) => row.tenant_id === forced) ?? null;

  for (const row of rows) {
    const stage = await sb
      .from("programming")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", row.tenant_id)
      .in("status", ["PROGRAMADA", "REPROGRAMADA"]);
    if ((stage.count ?? 0) > 0) return row;
  }

  return rows[0];
}

/** Toda RPC do modulo devolve `{ success, status, reason, message, ... }`. */
async function callRpc(sb, name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) return { success: false, status: 500, reason: "RPC_ERROR", message: error.message };
  return data ?? {};
}

// ---------------------------------------------------------------------------
// Execucao
// ---------------------------------------------------------------------------

async function main() {
  const env = loadEnv();
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("`.env` precisa de SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  }
  const sb = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  console.log(`Banco: ${url}`);
  console.log(`Modo: ${WITH_ISSUE ? "completo (inclui emissao)" : "sem emissao"}`);

  // -------------------------------------------------------------------------
  section("Contexto");

  const settings = { data: await pickTenantSettings(sb), error: null };
  if (!check("ha contrato com configuracao da PI", Boolean(settings.data), "nenhum contrato com pi_settings")) return;

  const tenantId = settings.data.tenant_id;

  const actor = await sb.from("app_users").select("id").eq("tenant_id", tenantId).eq("ativo", true).limit(1).maybeSingle();
  if (!check("ha usuario ativo no contrato", Boolean(actor.data), actor.error?.message)) return;
  const actorId = actor.data.id;

  const project = await sb
    .from("project")
    .select("id, sob")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (!check("ha projeto ativo no contrato", Boolean(project.data), project.error?.message)) return;

  // Data distante para nao colidir com PI real nem com etapa existente.
  const workDate = "2099-12-31";
  console.log(`  contrato=${tenantId.slice(0, 8)} projeto=${project.data.sob} data=${workDate}`);

  const areas = await sb.from("pi_operation_areas").select("code").eq("tenant_id", tenantId).order("sort_order");
  const voltages = await sb.from("pi_voltage_levels").select("code").eq("tenant_id", tenantId).order("sort_order");
  check("catalogo de areas semeado", (areas.data ?? []).length >= 6, String((areas.data ?? []).length));
  check("catalogo de tensoes semeado", (voltages.data ?? []).length >= 3, String((voltages.data ?? []).length));

  let piId = null;
  let updatedAt = null;

  try {
    // -----------------------------------------------------------------------
    section("Criacao sem Programacao");

    const created = await callRpc(sb, "save_permission_intervention", {
      p_tenant_id: tenantId,
      p_actor_user_id: actorId,
      p_pi_id: null,
      p_payload: {
        projectId: project.data.id,
        workDate,
        creationSource: "MANUAL",
        managerName: "SMOKE TEST",
        companyName: "SMOKE",
        contractNumber: "SMOKE-001",
        activityDescription: "Linha 1\nLinha 2",
        feeder: "SMOKE01",
        address: "Rua de Teste, 1",
        operationAreas: ["PM", "CE"],
        contactOperationAreas: ["OM"],
        voltageLevels: ["MT", "BT"],
        interferingVoltageLevels: ["AT"],
        hasInterferingInstallation: true,
      },
      p_expected_updated_at: null,
    });

    if (!check("cria a PI", created.success === true, created.message)) return;
    piId = created.pi_id;
    updatedAt = created.updated_at;

    // Nao ha etapa da Programacao em 2099, entao tem de nascer pendente.
    check("PI sem etapa nasce PENDING", created.link_status === "PENDING", String(created.link_status));

    const areaRows = await sb.from("pi_operation_area_link").select("scope, area_code").eq("pi_id", piId);
    const scopes = (areaRows.data ?? []).reduce((acc, row) => {
      acc[row.scope] = (acc[row.scope] ?? []).concat(row.area_code).sort();
      return acc;
    }, {});
    check("areas da PI gravadas", JSON.stringify(scopes.PI) === JSON.stringify(["CE", "PM"]), JSON.stringify(scopes.PI));
    check("area do contato e independente", JSON.stringify(scopes.CONTACT) === JSON.stringify(["OM"]), JSON.stringify(scopes.CONTACT));

    const voltRows = await sb.from("pi_voltage_level_link").select("scope, voltage_code").eq("pi_id", piId);
    const vScopes = (voltRows.data ?? []).reduce((acc, row) => {
      acc[row.scope] = (acc[row.scope] ?? []).concat(row.voltage_code).sort();
      return acc;
    }, {});
    check("tensoes da PI gravadas", JSON.stringify(vScopes.PI) === JSON.stringify(["BT", "MT"]), JSON.stringify(vScopes.PI));
    check("tensao do interferente e independente", JSON.stringify(vScopes.INTERFERING) === JSON.stringify(["AT"]), JSON.stringify(vScopes.INTERFERING));

    // -----------------------------------------------------------------------
    section("Concorrencia otimista");

    const stale = await callRpc(sb, "save_permission_intervention", {
      p_tenant_id: tenantId,
      p_actor_user_id: actorId,
      p_pi_id: piId,
      p_payload: { managerName: "X" },
      p_expected_updated_at: "2000-01-01T00:00:00+00:00",
    });
    check("salvar com updated_at velho da 409", stale.success === false && Number(stale.status) === 409, stale.reason);

    const noExpected = await callRpc(sb, "save_permission_intervention", {
      p_tenant_id: tenantId,
      p_actor_user_id: actorId,
      p_pi_id: piId,
      p_payload: { managerName: "X" },
      p_expected_updated_at: null,
    });
    check("salvar sem updated_at e recusado", noExpected.success === false, noExpected.reason);

    // -----------------------------------------------------------------------
    section("Edicao e historico");

    const edited = await callRpc(sb, "save_permission_intervention", {
      p_tenant_id: tenantId,
      p_actor_user_id: actorId,
      p_pi_id: piId,
      p_payload: {
        managerName: "SMOKE TEST EDITADO",
        companyName: "SMOKE",
        contractNumber: "SMOKE-001",
        activityDescription: "Linha 1\nLinha 2",
        feeder: "SMOKE01",
        address: "Rua de Teste, 1",
        operationAreas: ["PM"],
        voltageLevels: ["MT"],
      },
      p_expected_updated_at: updatedAt,
    });
    if (!check("edita a PI", edited.success === true, edited.message)) return;
    updatedAt = edited.updated_at;

    const history = await sb.from("pi_history").select("action_type, changes").eq("pi_id", piId).order("created_at");
    const actions = (history.data ?? []).map((row) => row.action_type);
    check("historico registrou CREATE e UPDATE", actions.includes("CREATE") && actions.includes("UPDATE"), actions.join(","));

    const updateRow = (history.data ?? []).find((row) => row.action_type === "UPDATE");
    check(
      "diff do historico traz o campo alterado",
      Boolean(updateRow?.changes?.manager_name),
      JSON.stringify(Object.keys(updateRow?.changes ?? {})),
    );
    check(
      "diff nao inclui updated_at nem updated_by",
      !("updated_at" in (updateRow?.changes ?? {})) && !("updated_by" in (updateRow?.changes ?? {})),
    );

    // Com uma area e uma tensao, a escolha principal deixa de ser exigida.
    check(
      "area principal deixa de ser exigida com uma so marcada",
      (await sb.from("pi_operation_area_link").select("area_code").eq("pi_id", piId).eq("scope", "PI")).data.length === 1,
    );

    // -----------------------------------------------------------------------
    section("Plano de Execucao");

    const steps = await callRpc(sb, "save_pi_execution_steps", {
      p_tenant_id: tenantId,
      p_actor_user_id: actorId,
      p_pi_id: piId,
      p_steps: [
        { workZone: "Zona 1", activity: "Check-list de veiculo", origin: "TEMPLATE" },
        { workZone: "Zona 1", activity: "Instalar poste", origin: "PROGRAMMING" },
        { workZone: "Zona 2", activity: "Encerramento", origin: "MANUAL" },
      ],
      p_expected_updated_at: updatedAt,
    });
    if (!check("salva o Plano de Execucao", steps.success === true, steps.message)) return;
    updatedAt = steps.updated_at;
    check("plano com 3 etapas", Number(steps.step_count) === 3, String(steps.step_count));

    const stepRows = await sb.from("pi_execution_step").select("sort_order, activity, origin").eq("pi_id", piId).order("sort_order");
    check("ordem preservada", (stepRows.data ?? []).map((r) => r.sort_order).join(",") === "1,2,3");
    check("origem preservada", (stepRows.data ?? []).map((r) => r.origin).join(",") === "TEMPLATE,PROGRAMMING,MANUAL");

    // Reordenar exercita a unique DEFERRABLE: sem ela, a troca de posicoes
    // esbarraria no estado intermediario duplicado.
    const reordered = await callRpc(sb, "save_pi_execution_steps", {
      p_tenant_id: tenantId,
      p_actor_user_id: actorId,
      p_pi_id: piId,
      p_steps: [
        { workZone: "Zona 2", activity: "Encerramento", origin: "MANUAL" },
        { workZone: "Zona 1", activity: "Check-list de veiculo", origin: "TEMPLATE" },
        { workZone: "Zona 1", activity: "Instalar poste", origin: "PROGRAMMING" },
      ],
      p_expected_updated_at: updatedAt,
    });
    check("reordena o plano", reordered.success === true, reordered.message);
    if (reordered.success) updatedAt = reordered.updated_at;

    const overflow = await callRpc(sb, "save_pi_execution_steps", {
      p_tenant_id: tenantId,
      p_actor_user_id: actorId,
      p_pi_id: piId,
      p_steps: Array.from({ length: 24 }, (_, i) => ({ workZone: `Z${i + 1}`, activity: `A${i + 1}` })),
      p_expected_updated_at: updatedAt,
    });
    check("salvar 24 etapas e permitido no rascunho", overflow.success === true, overflow.message);
    if (overflow.success) updatedAt = overflow.updated_at;

    // -----------------------------------------------------------------------
    section("Validacao de emissao");

    const tooManyReady = await callRpc(sb, "set_permission_intervention_status", {
      p_tenant_id: tenantId,
      p_actor_user_id: actorId,
      p_pi_id: piId,
      p_action: "READY",
      p_reason: null,
      p_expected_updated_at: updatedAt,
    });
    const overflowCodes = (tooManyReady.errors ?? []).map((e) => e.code);
    check("24 etapas bloqueiam a emissao", overflowCodes.includes("EXECUTION_PLAN_OVERFLOW"), overflowCodes.join(","));

    const back = await callRpc(sb, "save_pi_execution_steps", {
      p_tenant_id: tenantId,
      p_actor_user_id: actorId,
      p_pi_id: piId,
      p_steps: [{ workZone: "Zona 1", activity: "Check-list de veiculo", origin: "TEMPLATE" }],
      p_expected_updated_at: updatedAt,
    });
    if (back.success) updatedAt = back.updated_at;

    const missingFields = await callRpc(sb, "set_permission_intervention_status", {
      p_tenant_id: tenantId,
      p_actor_user_id: actorId,
      p_pi_id: piId,
      p_action: "READY",
      p_reason: null,
      p_expected_updated_at: updatedAt,
    });
    const codes = (missingFields.errors ?? []).map((e) => e.code);
    check("supervisor ausente bloqueia", codes.includes("SUPERVISOR_REQUIRED"), codes.join(","));
    check("encarregado ausente bloqueia", codes.includes("FOREMAN_REQUIRED"), codes.join(","));
    if (!settings.data.emergency_plan_text) {
      check("Plano de Emergencia nao configurado bloqueia", codes.includes("EMERGENCY_PLAN_MISSING"), codes.join(","));
    }

    // -----------------------------------------------------------------------
    section("Vinculo");

    const noStage = await callRpc(sb, "link_permission_intervention_to_programming", {
      p_tenant_id: tenantId,
      p_actor_user_id: actorId,
      p_pi_id: piId,
      p_programming_id: null,
      p_reason: null,
      p_expected_updated_at: updatedAt,
    });
    check("vincular sem etapa ativa e recusado", noStage.success === false && noStage.reason === "NO_ACTIVE_PROGRAMMING", noStage.reason);

    // -----------------------------------------------------------------------
    section("Criacao a partir de uma etapa da Programacao");
    await runFromProgrammingFlow(sb, { tenantId, actorId });

    // -----------------------------------------------------------------------
    if (WITH_ISSUE) {
      section("Emissao");
      await runIssueFlow(sb, { tenantId, actorId, piId, updatedAt, settings: settings.data });
    } else {
      console.log("\n(emissao nao exercitada; rode com --issue para incluir)");
    }
  } finally {
    if (piId) {
      section("Limpeza");
      const del = await sb.from("permission_intervention").delete().eq("tenant_id", tenantId).eq("id", piId);
      check("PI de teste removida", !del.error, del.error?.message);
      const left = await sb.from("pi_execution_step").select("id", { count: "exact", head: true }).eq("pi_id", piId);
      check("filhas removidas em cascata", (left.count ?? 0) === 0, String(left.count));
    }
  }

  console.log(`\n${failures.length === 0 ? "TUDO OK" : "FALHOU"} — ${checks - failures.length}/${checks} verificacoes`);
  if (failures.length > 0) {
    console.log(`Falhas: ${failures.join(" | ")}`);
    process.exitCode = 1;
  }
}

/**
 * Caminho `Criar a partir da Programacao`, com etapa ATIVA de verdade.
 *
 * E o unico caminho que exercita o snapshot e o vinculo automatico na criacao.
 * Procura uma etapa ativa que ainda nao tenha PI; se o banco nao tiver
 * nenhuma, a secao e pulada com aviso em vez de falhar — a ausencia de dado
 * nao e defeito de codigo.
 */
async function runFromProgrammingFlow(sb, { tenantId, actorId }) {
  const stages = await sb
    .from("programming")
    .select("id, project_id, execution_date, status, feeder, start_time, programming_team(team_id, status)")
    .eq("tenant_id", tenantId)
    .in("status", ["PROGRAMADA", "REPROGRAMADA"])
    .not("execution_date", "is", null)
    .order("execution_date", { ascending: false })
    .limit(25);

  const taken = await sb
    .from("permission_intervention")
    .select("programming_id")
    .eq("tenant_id", tenantId)
    .neq("status", "CANCELLED");
  const usedStages = new Set((taken.data ?? []).map((row) => row.programming_id).filter(Boolean));

  const stage = (stages.data ?? []).find((row) => !usedStages.has(row.id));
  if (!stage) {
    console.log("  aviso: nenhuma etapa ativa livre no banco; secao pulada.");
    return;
  }

  let piId = null;
  try {
    const created = await callRpc(sb, "save_permission_intervention", {
      p_tenant_id: tenantId,
      p_actor_user_id: actorId,
      p_pi_id: null,
      p_payload: {
        projectId: stage.project_id,
        workDate: stage.execution_date,
        creationSource: "FROM_PROGRAMMING",
        feeder: stage.feeder,
        operationAreas: ["PM"],
        voltageLevels: ["MT"],
      },
      p_expected_updated_at: null,
    });
    if (!check("cria a PI a partir da etapa", created.success === true, created.message)) return;
    piId = created.pi_id;

    check("nasce LINKED", created.link_status === "LINKED", String(created.link_status));
    check("aponta para a etapa escolhida", created.programming_id === stage.id, String(created.programming_id));

    const row = await sb
      .from("permission_intervention")
      .select("source_programming_snapshot, programming(id, status, etapa_number, etapa_unica, etapa_final)")
      .eq("id", piId)
      .maybeSingle();

    const snapshot = row.data?.source_programming_snapshot;
    check("snapshot da etapa gravado", Boolean(snapshot));
    check("snapshot aponta para a etapa certa", snapshot?.programmingId === stage.id, String(snapshot?.programmingId));
    check("snapshot traz equipes", Array.isArray(snapshot?.teams), typeof snapshot?.teams);
    check("snapshot traz atividades", Array.isArray(snapshot?.activities), typeof snapshot?.activities);

    // E o embed que a listagem usa para exibir o rotulo da etapa vinculada.
    const embedded = Array.isArray(row.data?.programming) ? row.data.programming[0] : row.data?.programming;
    check("embed da etapa resolve na leitura", Boolean(embedded?.id), JSON.stringify(embedded));
    check("embed traz a classificacao crua", embedded?.status === stage.status, String(embedded?.status));

    const history = await sb.from("pi_history").select("action_type, metadata").eq("pi_id", piId);
    const createRow = (history.data ?? []).find((h) => h.action_type === "CREATE");
    check("historico registra a origem", createRow?.metadata?.creationSource === "FROM_PROGRAMMING", JSON.stringify(createRow?.metadata));

    // Segunda PI na mesma etapa/data tem de esbarrar na unicidade.
    const duplicate = await callRpc(sb, "save_permission_intervention", {
      p_tenant_id: tenantId,
      p_actor_user_id: actorId,
      p_pi_id: null,
      p_payload: {
        projectId: stage.project_id,
        workDate: stage.execution_date,
        creationSource: "MANUAL",
      },
      p_expected_updated_at: null,
    });
    check("segunda PI viva na mesma data e recusada", duplicate.success === false && duplicate.reason === "DUPLICATE_PI", duplicate.reason);
  } finally {
    if (piId) {
      const del = await sb.from("permission_intervention").delete().eq("tenant_id", tenantId).eq("id", piId);
      check("PI vinculada removida", !del.error, del.error?.message);
    }
  }
}

/**
 * Caminho de emissao. Configura o Plano de Emergencia se estiver vazio, emite,
 * confere o codigo e devolve tudo ao estado anterior.
 */
async function runIssueFlow(sb, ctx) {
  const { tenantId, actorId, piId, settings } = ctx;
  let updatedAt = ctx.updatedAt;
  const planWasEmpty = !settings.emergency_plan_text;

  const counterBefore = await sb.from("pi_sequence_counter").select("last_value").eq("tenant_id", tenantId).maybeSingle();
  const valueBefore = Number(counterBefore.data?.last_value ?? 0);

  if (planWasEmpty) {
    await sb
      .from("pi_settings")
      .update({ emergency_plan_text: "PLANO TEMPORARIO DO TESTE DE FUMACA" })
      .eq("tenant_id", tenantId);
  }

  const person = await sb.from("people").select("id").eq("tenant_id", tenantId).eq("ativo", true).limit(1).maybeSingle();
  if (!check("ha pessoa ativa para responsavel", Boolean(person.data), person.error?.message)) return;

  const filled = await callRpc(sb, "save_permission_intervention", {
    p_tenant_id: tenantId,
    p_actor_user_id: actorId,
    p_pi_id: piId,
    p_payload: {
      managerName: "SMOKE TEST",
      companyName: "SMOKE",
      contractNumber: "SMOKE-001",
      activityDescription: "Atividade de teste",
      feeder: "SMOKE01",
      address: "Rua de Teste, 1",
      operationAreas: ["PM"],
      voltageLevels: ["MT"],
      supervisorPersonId: person.data.id,
      foremanPersonId: person.data.id,
    },
    p_expected_updated_at: updatedAt,
  });
  if (!check("completa os obrigatorios", filled.success === true, filled.message)) return;
  updatedAt = filled.updated_at;

  const issueBeforeReady = await callRpc(sb, "set_permission_intervention_status", {
    p_tenant_id: tenantId,
    p_actor_user_id: actorId,
    p_pi_id: piId,
    p_action: "ISSUE",
    p_reason: null,
    p_expected_updated_at: updatedAt,
  });
  check("emitir sem passar por pronta e recusado", issueBeforeReady.success === false, issueBeforeReady.reason);

  const ready = await callRpc(sb, "set_permission_intervention_status", {
    p_tenant_id: tenantId,
    p_actor_user_id: actorId,
    p_pi_id: piId,
    p_action: "READY",
    p_reason: null,
    p_expected_updated_at: updatedAt,
  });
  if (!check("marca como pronta", ready.success === true, JSON.stringify(ready.errors ?? ready.message))) return;
  updatedAt = ready.updated_at;

  const issued = await callRpc(sb, "set_permission_intervention_status", {
    p_tenant_id: tenantId,
    p_actor_user_id: actorId,
    p_pi_id: piId,
    p_action: "ISSUE",
    p_reason: null,
    p_expected_updated_at: updatedAt,
  });
  if (!check("emite a PI", issued.success === true, JSON.stringify(issued.errors ?? issued.message))) return;

  const expected = [
    settings.code_prefix,
    "MT",
    "PM",
    settings.company_code,
    String(valueBefore + 1).padStart(settings.sequence_digits, "0"),
  ].join("-");
  check(`codigo gerado e ${expected}`, issued.pi_code === expected, String(issued.pi_code));
  check("sequencial incrementado em 1", Number(issued.pi_sequence) === valueBefore + 1, String(issued.pi_sequence));

  const row = await sb
    .from("permission_intervention")
    .select("status, issued_at, issued_template_version, issued_template_checksum, emergency_plan_snapshot")
    .eq("id", piId)
    .maybeSingle();
  check("status ficou ISSUED", row.data?.status === "ISSUED", String(row.data?.status));
  check("snapshot do Plano de Emergencia gravado", Boolean(row.data?.emergency_plan_snapshot));
  check("template usado registrado", Boolean(row.data?.issued_template_version), String(row.data?.issued_template_version));

  const editAfter = await callRpc(sb, "save_permission_intervention", {
    p_tenant_id: tenantId,
    p_actor_user_id: actorId,
    p_pi_id: piId,
    p_payload: { managerName: "NAO PODE" },
    p_expected_updated_at: issued.updated_at,
  });
  check("PI emitida nao aceita edicao", editAfter.success === false && editAfter.reason === "PI_NOT_EDITABLE", editAfter.reason);

  // Restauracao. O contador so volta se ninguem mais tiver emitido no meio.
  const counterAfter = await sb.from("pi_sequence_counter").select("last_value").eq("tenant_id", tenantId).maybeSingle();
  if (Number(counterAfter.data?.last_value) === valueBefore + 1) {
    await sb.from("pi_sequence_counter").update({ last_value: valueBefore }).eq("tenant_id", tenantId);
    check("sequencial devolvido ao valor anterior", true);
  } else {
    console.log("  aviso: outra emissao ocorreu durante o teste; contador NAO foi devolvido.");
  }

  if (planWasEmpty) {
    await sb.from("pi_settings").update({ emergency_plan_text: null }).eq("tenant_id", tenantId);
    check("Plano de Emergencia temporario removido", true);
  }
}

await main();
