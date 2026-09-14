// diagnose-audit-error-logs-readonly.mjs
// Diagnostico SOMENTE-LEITURA: por que a aba "Erros" da tela /auditoria mostra
// "Total: 0" para o tenant ativo, mesmo sem filtro de data. Nao faz
// INSERT/UPDATE/DELETE.
//
// Confere, nesta ordem:
//   1. Quantas linhas existem em app_error_logs no total, por tenant_id e com
//      tenant_id NULL (a coluna e nullable, diferente de login_audit/
//      app_entity_history) — se as linhas existirem mas com tenant_id != do
//      tenant ativo (ou NULL), o filtro .eq("tenant_id", ...) da tela exclui
//      tudo silenciosamente, sem erro.
//   2. O mesmo total para login_audit e app_entity_history, para saber se e
//      so a aba Erros que esta vazia ou se e o tenant inteiro sem dado.
//
// Rodar (raiz do repo): node scripts/diagnosticos/diagnose-audit-error-logs-readonly.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
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

const TENANT = "7e65b733-1fe1-4137-93af-ee41f0ffc242"; // INDICA SERVICO - ANGRA

async function countTable(table, tenantColumn = "tenant_id") {
  const { count: total } = await supabase.from(table).select("*", { count: "exact", head: true });
  const { count: forTenant } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(tenantColumn, TENANT);
  const { count: nullTenant } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .is(tenantColumn, null);
  return { total, forTenant, nullTenant };
}

async function main() {
  console.log("=== Diagnostico read-only: por que a aba Erros mostra Total: 0 ===");
  console.log(`Tenant ativo: ${TENANT} (INDICA SERVICO - ANGRA)\n`);

  for (const table of ["app_error_logs", "login_audit", "app_entity_history"]) {
    const { total, forTenant, nullTenant } = await countTable(table);
    console.log(`${table}:`);
    console.log(`  total (todos os tenants) .... ${total}`);
    console.log(`  tenant_id = tenant ativo ..... ${forTenant}`);
    console.log(`  tenant_id IS NULL ............ ${nullTenant}`);
    console.log("");
  }

  const { data: sample } = await supabase
    .from("app_error_logs")
    .select("id, tenant_id, source, severity, screen, message, created_at")
    .order("created_at", { ascending: false })
    .limit(5);
  console.log("Amostra das 5 linhas mais recentes de app_error_logs (qualquer tenant):");
  console.log(JSON.stringify(sample, null, 2));
}

main().catch((error) => {
  console.error("Falha no diagnostico:", error);
  process.exit(1);
});
