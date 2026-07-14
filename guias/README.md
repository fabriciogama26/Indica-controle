# Índice de guias

Guias de domínio referenciados pela seção 7 do [`CLAUDE.md`](../CLAUDE.md) (gatilhos por tipo de tarefa). Cada guia segue o formato: Escopo, Fontes de verdade, Regras obrigatórias, Fluxo recomendado, Exemplos, Guardrails, Validação.

| Guia | Quando usar |
|---|---|
| [`guia_backend.md`](guia_backend.md) | API Routes, módulos server-side, transação/concorrência, performance de banco/API, tratamento de erros e auditoria |
| [`guia_frontend.md`](guia_frontend.md) | PageView, hooks, componentes, filtros, listagem, sessão no client (frontend e UI fundidos) |
| [`guia_sql.md`](guia_sql.md) | Migrations, RLS, constraints/índices, funções `SECURITY DEFINER`, triggers PL/pgSQL |
| [`guia_supabase.md`](guia_supabase.md) | Auth/sessão, `service_role`, Edge Functions, CLI do Supabase, Realtime |
| [`guia_documentacao.md`](guia_documentacao.md) | README, docs TXT por tela, `TASKS.md`, rotina de dependências |
| [`guia_git.md`](guia_git.md) | Como propor commits, quando (não) executar comandos git |
| [`guia_validacao.md`](guia_validacao.md) | Protocolo pré-PR: mapa de "o que ler" + checklist consolidado |
| [`runbook_deploy_edge_functions.md`](runbook_deploy_edge_functions.md) | Passo a passo e troubleshooting de deploy de Edge Functions (Docker/API) |

Guias não criados por falta de escopo real no projeto hoje: `guia_nextjs.md` (conteúdo cabe em backend/frontend), `guia_testes.md` (não há suíte automatizada — ver TODO em `guia_validacao.md`).
