// verify-migration-335-delta-readonly.mjs
// Verificacao SOMENTE-LEITURA da migration 335 gerada: le o SQL produzido e
// confere contra o banco se ele faz exatamente o que deveria fazer.
//
// Existe porque 335 escreve dado real em producao e nao ha suite automatizada:
// esta e a barreira antes de aplicar. Checa contagem (etapas/equipes esperadas),
// integridade referencial interna, colisao de UUID/chave e — o mais importante —
// se TODO update carrega a guarda de valor esperado e o filtro de tenant_id.
//
// IMPORTANTE: rodar SEMPRE logo depois de reexecutar o gerador e imediatamente
// antes de aplicar. A tela Simples continua em producao, entao o delta muda de
// tamanho sozinho (confirmado: duas execucoes com minutos de diferenca deram 37 e
// 38 etapas). Uma migration gerada "ontem" ja nasce desatualizada.
//
// Rodar (raiz do repo): node scripts/verify-migration-335-delta-readonly.mjs

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

async function selectAll(table, columns) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).order("id").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all;
}

const sql = readFileSync(path.join(REPO, "supabase", "migrations", "335_migrate_legacy_programming_delta.sql"), "utf8");

// Conta linhas de VALUES por bloco de insert e os updates.
function blocoDe(marcador, proximoMarcador) {
  const i = sql.indexOf(marcador);
  if (i === -1) return "";
  const j = proximoMarcador ? sql.indexOf(proximoMarcador, i) : sql.length;
  return sql.slice(i, j === -1 ? sql.length : j);
}

const blocoEtapas = blocoDe("-- ===== 1)", "-- ===== 2)");
const blocoEquipes = blocoDe("-- ===== 2)", "-- ===== 3)") || blocoDe("-- ===== 2)", "-- ===== 4)");
const blocoDocs = blocoDe("-- ===== 3)", "-- ===== 4)");

const contaValues = (bloco) => (bloco.match(/^ {2}\('/gm) ?? []).length;
const insEtapas = contaValues(blocoEtapas);
const insEquipes = contaValues(blocoEquipes);
const insDocs = contaValues(blocoDocs);
const updEstado = (sql.match(/^update public\.programming set work_completion_status/gm) ?? []).length;
const updStatus = (sql.match(/^update public\.programming set status/gm) ?? []).length;
const updPend = (sql.match(/^update public\.programming set is_pendencia/gm) ?? []).length;
const reclassify = (sql.match(/^select public\.reclassify_project_programming_stages/gm) ?? []).length;

// IDs de programming gerados no bloco 1.
const idsEtapasNovas = new Set([...blocoEtapas.matchAll(/^ {2}\('([0-9a-f-]{36})'/gm)].map((m) => m[1]));
// programming_id referenciado por cada equipe (2o uuid da tupla).
const progIdsEquipes = [...blocoEquipes.matchAll(/^ {2}\('[0-9a-f-]{36}', '([0-9a-f-]{36})'/gm)].map((m) => m[1]);

const legacy = await selectAll("project_programming", "tenant_id, project_id, execution_date, team_id");
const target = await selectAll("programming", "id, tenant_id, project_id, execution_date");
const targetTeams = await selectAll("programming_team", "programming_id, team_id");

const key = (t, p, d) => `${t}|${p}|${d ?? "SEM_DATA"}`;
const targetKeys = new Map(target.map((s) => [key(s.tenant_id, s.project_id, s.execution_date), s.id]));

const legacyStages = new Map();
for (const r of legacy) {
  const k = key(r.tenant_id, r.project_id, r.execution_date);
  if (!legacyStages.has(k)) legacyStages.set(k, new Set());
  legacyStages.get(k).add(r.team_id);
}

let esperadoEtapas = 0;
let esperadoEquipesNovas = 0;
let esperadoEquipesFaltantes = 0;
const teamsPorProgId = new Map();
for (const t of targetTeams) {
  if (!teamsPorProgId.has(t.programming_id)) teamsPorProgId.set(t.programming_id, new Set());
  teamsPorProgId.get(t.programming_id).add(t.team_id);
}
for (const [k, teams] of legacyStages.entries()) {
  const id = targetKeys.get(k);
  if (!id) {
    esperadoEtapas += 1;
    esperadoEquipesNovas += teams.size;
  } else {
    const noDestino = teamsPorProgId.get(id) ?? new Set();
    esperadoEquipesFaltantes += [...teams].filter((x) => !noDestino.has(x)).length;
  }
}

const ok = (cond) => (cond ? "OK " : "FALHA");
console.log("=== Verificacao independente da migration 335 ===");
console.log(`${ok(insEtapas === esperadoEtapas)} etapas inseridas: SQL=${insEtapas} | banco espera=${esperadoEtapas}`);
console.log(
  `${ok(insEquipes === esperadoEquipesNovas + esperadoEquipesFaltantes)} equipes inseridas: SQL=${insEquipes} | banco espera=${esperadoEquipesNovas + esperadoEquipesFaltantes} (${esperadoEquipesNovas} de etapas novas + ${esperadoEquipesFaltantes} faltantes)`,
);
console.log(`     documentos inseridos: SQL=${insDocs}`);
console.log(`     updates: estado=${updEstado} status=${updStatus} pendencia=${updPend}`);
console.log(`     reclassify: ${reclassify} projeto(s)`);

// Integridade referencial interna: toda equipe aponta para uma etapa nova deste
// arquivo OU para uma etapa que ja existe no destino.
const idsDestino = new Set(target.map((s) => s.id));
const orfas = progIdsEquipes.filter((id) => !idsEtapasNovas.has(id) && !idsDestino.has(id));
console.log(`${ok(orfas.length === 0)} equipes orfas (programming_id inexistente): ${orfas.length}`);

// Nenhum id de etapa nova pode colidir com id ja existente no destino.
const colisoes = [...idsEtapasNovas].filter((id) => idsDestino.has(id));
console.log(`${ok(colisoes.length === 0)} colisao de UUID com o destino: ${colisoes.length}`);

// Toda etapa nova precisa de chave (tenant, projeto, data) inedita no destino.
const chavesNovas = [...blocoEtapas.matchAll(/^ {2}\('[0-9a-f-]{36}', '([0-9a-f-]{36})', '([0-9a-f-]{36})', '(\d{4}-\d{2}-\d{2})'/gm)].map(
  (m) => key(m[1], m[2], m[3]),
);
const jaExistem = chavesNovas.filter((k) => targetKeys.has(k));
console.log(`${ok(jaExistem.length === 0)} etapas novas que ja existem no destino: ${jaExistem.length}`);
console.log(`${ok(new Set(chavesNovas).size === chavesNovas.length)} chaves duplicadas dentro do proprio insert: ${chavesNovas.length - new Set(chavesNovas).size}`);

// Guardas obrigatorias nos updates.
const updSemGuardaEstado = (sql.match(/^update public\.programming set work_completion_status.*$/gm) ?? []).filter(
  (l) => !l.includes("and work_completion_status is null"),
).length;
const updSemGuardaStatus = (sql.match(/^update public\.programming set status.*$/gm) ?? []).filter(
  (l) => !l.includes("and status = 'PROGRAMADA'"),
).length;
console.log(`${ok(updSemGuardaEstado === 0)} updates de estado sem guarda: ${updSemGuardaEstado}`);
console.log(`${ok(updSemGuardaStatus === 0)} updates de agenda sem guarda: ${updSemGuardaStatus}`);

// Todo update precisa filtrar tenant_id (multi-tenant).
const updSemTenant = (sql.match(/^update public\.programming .*$/gm) ?? []).filter((l) => !l.includes("tenant_id =")).length;
console.log(`${ok(updSemTenant === 0)} updates sem filtro de tenant_id: ${updSemTenant}`);

// Alvo do ON CONFLICT do bloco de etapas. A migration 318 substituiu a UNIQUE
// constraint por um INDICE UNICO PARCIAL (`where execution_date is not null`), e o
// Postgres so infere indice parcial quando o predicado aparece no alvo. Sem ele a
// migration morre inteira com 42P10 na primeira linha — foi o que aconteceu na
// primeira tentativa de aplicar a 335.
const alvoCorreto = "on conflict (tenant_id, project_id, execution_date) where execution_date is not null do nothing;";
const alvoSemPredicado = /on conflict \(tenant_id, project_id, execution_date\) do nothing;/.test(sql);
const temAlvoCorreto = sql.includes(alvoCorreto);
console.log(
  `${ok(insEtapas === 0 || (temAlvoCorreto && !alvoSemPredicado))} ON CONFLICT de programming com o predicado do indice parcial da 318: ${
    temAlvoCorreto ? "presente" : alvoSemPredicado ? "AUSENTE (vai falhar com 42P10)" : "bloco ausente"
  }`,
);
