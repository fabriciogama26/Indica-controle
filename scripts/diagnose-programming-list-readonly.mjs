// diagnose-programming-list-readonly.mjs
// Diagnostico SOMENTE-LEITURA da listagem da Programacao Normalizada quando a
// tela mostra "0 etapas". Nao faz INSERT/UPDATE/DELETE.
//
// Existe porque o hook da tela trata FALHA e VAZIO do mesmo jeito
// (`catch { setItems([]); setTotal(0); }`), entao um erro de API aparece na tela
// exatamente como "Nenhuma etapa encontrada" — sem diferenciar as duas coisas.
//
// Reproduz, na ordem, os dois passos que a rota faz:
//   1. RPC programming_list_project_page (pagina os projetos)
//   2. select das etapas dos projetos da pagina
// e ainda confere se as migrations 336/337 estao aplicadas.
//
// Rodar (raiz do repo): node scripts/diagnose-programming-list-readonly.mjs

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

const TENANT = "7e65b733-1fe1-4137-93af-ee41f0ffc242";
const DATE_FROM = "2026-07-01";
const DATE_TO = "2026-09-29";

function ok(cond) {
  return cond ? "OK  " : "FALHA";
}

async function main() {
  console.log("=== Diagnostico da listagem — Programacao Normalizada (somente leitura) ===");
  console.log(`Tenant: ${TENANT} | Janela: ${DATE_FROM} a ${DATE_TO}\n`);

  // ---------------------------------------------------------------------------
  // 0) O dado existe?
  // ---------------------------------------------------------------------------
  const { count: totalStages, error: countError } = await supabase
    .from("programming")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT);
  console.log(`${ok(!countError)} programming (total do tenant): ${countError ? countError.message : totalStages}`);

  const { count: inWindow, error: windowError } = await supabase
    .from("programming")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT)
    .gte("execution_date", DATE_FROM)
    .lte("execution_date", DATE_TO);
  console.log(`${ok(!windowError)} programming dentro da janela: ${windowError ? windowError.message : inWindow}`);

  // ---------------------------------------------------------------------------
  // 1) Migrations 336/337 aplicadas? (presenca das colunas de snapshot)
  // ---------------------------------------------------------------------------
  const { error: snapshotError } = await supabase
    .from("programming")
    .select("id, classification_snapshot_at")
    .eq("tenant_id", TENANT)
    .limit(1);
  console.log(
    `${ok(!snapshotError)} migration 337 (colunas de snapshot): ${snapshotError ? `AUSENTES — ${snapshotError.message}` : "presentes"}`,
  );

  // ---------------------------------------------------------------------------
  // 2) RPC exatamente como o backend chama (10 argumentos, por nome)
  // ---------------------------------------------------------------------------
  const rpcArgs = {
    p_tenant_id: TENANT,
    p_date_from: DATE_FROM,
    p_date_to: DATE_TO,
    p_project_ids: null,
    p_stage_ids: null,
    p_status_chip: "TODAS",
    p_today: new Date().toISOString().slice(0, 10),
    p_page: 1,
    p_page_size: 50,
    p_work_completion_status: null,
  };

  const { data: page10, error: error10 } = await supabase.rpc("programming_list_project_page", rpcArgs);
  if (error10) {
    console.log(`FALHA RPC com 10 argumentos: [${error10.code ?? "?"}] ${error10.message}`);
    if (error10.details) console.log(`      details: ${error10.details}`);
    if (error10.hint) console.log(`      hint: ${error10.hint}`);
  } else {
    console.log(`OK   RPC com 10 argumentos: ${page10?.length ?? 0} projeto(s) | total=${page10?.[0]?.total_count ?? 0}`);
  }

  // ---------------------------------------------------------------------------
  // 3) RPC no formato ANTIGO (9 argumentos) — detecta ambiguidade de sobrecarga
  // ---------------------------------------------------------------------------
  const rpcArgs9 = { ...rpcArgs };
  delete rpcArgs9.p_work_completion_status;
  const { data: page9, error: error9 } = await supabase.rpc("programming_list_project_page", rpcArgs9);
  if (error9) {
    console.log(`INFO RPC com 9 argumentos: [${error9.code ?? "?"}] ${error9.message}`);
    if (error9.code === "PGRST203" || /not unique|ambiguous/i.test(error9.message)) {
      console.log("      -> SOBRECARGA AMBIGUA: existem duas versoes da funcao e o PostgREST nao");
      console.log("         consegue escolher. Precisa dropar a assinatura antiga de 9 parametros.");
    }
  } else {
    console.log(`INFO RPC com 9 argumentos: ${page9?.length ?? 0} projeto(s) (assinatura antiga ainda resolve)`);
  }

  // ---------------------------------------------------------------------------
  // 4) Passo 2 da rota: etapas dos projetos da pagina
  // ---------------------------------------------------------------------------
  const projectIds = (page10 ?? []).map((row) => row.project_id);
  if (projectIds.length) {
    const { data: rows, error: rowsError } = await supabase
      .from("programming")
      .select("id, project_id, execution_date, status")
      .eq("tenant_id", TENANT)
      .in("project_id", projectIds)
      .gte("execution_date", DATE_FROM)
      .lte("execution_date", DATE_TO);
    console.log(`${ok(!rowsError)} passo 2 (etapas da pagina): ${rowsError ? rowsError.message : `${rows.length} etapa(s)`}`);
  } else {
    console.log("INFO passo 2 nao executado: o passo 1 nao devolveu projeto.");
  }

  // ---------------------------------------------------------------------------
  // 5) O SELECT completo da rota (com as colunas novas e os embeds)
  // ---------------------------------------------------------------------------
  const selectWithChildren = `
    id, project_id, execution_date, etapa_number, etapa_unica, etapa_final, status, work_completion_status, is_pendencia,
    classification_snapshot_number, classification_snapshot_unica, classification_snapshot_final,
    classification_snapshot_execution_date, classification_snapshot_at,
    programming_team ( id, team_id, status ),
    programming_activity ( id, service_activity_id, quantity, is_active ),
    programming_document ( id, document_type, number )
  `;
  const { data: full, error: fullError } = await supabase
    .from("programming")
    .select(selectWithChildren)
    .eq("tenant_id", TENANT)
    .limit(2);
  console.log(
    `${ok(!fullError)} SELECT completo da rota: ${fullError ? `[${fullError.code ?? "?"}] ${fullError.message}` : `${full.length} linha(s)`}`,
  );

  // ---------------------------------------------------------------------------
  // 6) A pagina existe no registro de paginas? (permissao da tela)
  // ---------------------------------------------------------------------------
  const { data: pages, error: pagesError } = await supabase
    .from("app_pages")
    .select("page_key, default_user_access")
    .eq("page_key", "programacao-normalizada");
  if (pagesError) {
    console.log(`INFO app_pages: ${pagesError.message}`);
  } else {
    console.log(`OK   app_pages: ${pages.length ? JSON.stringify(pages[0]) : "PAGINA NAO REGISTRADA"}`);
  }
}

main();
