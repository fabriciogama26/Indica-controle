# Guia de Supabase (Auth, Edge Functions, CLI)

## 1. Escopo

Obrigatório sempre que a tarefa envolve: sessão/autenticação (`resolveAuthenticatedAppUser`, `AuthContext`), Edge Function (`supabase/functions/*`), CLI do Supabase (link, migration, deploy), ou `service_role`. Para regras de RLS/constraint/PL-pgSQL, ver [`guia_sql.md`](guia_sql.md). Para o passo a passo de deploy/diagnóstico de Docker, ver [`runbook_deploy_edge_functions.md`](runbook_deploy_edge_functions.md).

## 2. Fontes de verdade

- Projeto Supabase: `indicadatesupabase`, project ref `lcusxnhhrjosxqgiphgp`.
- `verificacao/crc/auth.md` — estado real do módulo de auth (68 rotas dependem de `resolveAuthenticatedAppUser`, 4-5 queries por request).
- `verificacao/crc/edge_functions.md` — Edge Functions de importação XLSX (fluxo de auth, RPCs, atomicidade por projeto).
- `scripts/supabase-check-link.ps1`, `scripts/check-security-definer.ps1`.

## 3. Regras obrigatórias

### Sessão e resolução de usuário/tenant
1. Toda rota autenticada usa `resolveAuthenticatedAppUser` (ou equivalente central) — nunca reimplementar a resolução de usuário/tenant numa rota específica.
2. Fluxo obrigatório: identidade autenticada → tenant solicitado → vínculo usuário/tenant validado no servidor → permissão validada → operação executada → RLS valida novamente.
3. `resolveAuthenticatedAppUser` usa cache por token com TTL máximo de 60s (ver [`guia_backend.md`](guia_backend.md) regra 30) — hoje é o maior ponto de risco de performance do projeto por rodar em todas as rotas autenticadas.
4. Header como `x-tenant-id` (ou futuro `x-contract-id`) pode transportar contexto solicitado, mas nunca é prova de autorização — sempre confirmar o vínculo usuário/tenant no servidor antes de usar o valor numa query.

### Service role
5. `SUPABASE_SERVICE_ROLE_KEY` nunca é exposta ao client, nunca tem prefixo `NEXT_PUBLIC_`, nunca aparece em log ou resposta.
6. `service_role` é usado apenas em backend controlado, nunca para operação comum quando o cliente do usuário com RLS resolve.

### Edge Functions
7. Edge Functions reutilizam `_shared` para auth, CORS, tenant, parser e erros — não duplicar essa infraestrutura por função.
8. Deploy de Edge Function segue [`runbook_deploy_edge_functions.md`](runbook_deploy_edge_functions.md): confirmar `npm run db:check-link` antes de qualquer deploy; nunca aplicar deploy em projeto Supabase divergente do esperado (`lcusxnhhrjosxqgiphgp`).
9. Preferir `--use-api` quando o objetivo é publicar rapidamente sem depender do Docker Desktop local — é o modo padrão recomendado neste projeto.

### CLI e ambiente
10. `npm run db:check-link` confirma o projeto correto antes de qualquer comando `linked` (`db:migration-list`, `db:lint`, deploy). Se o `project-ref` divergir de `lcusxnhhrjosxqgiphgp`, parar antes de continuar.
11. Nunca compartilhar token da Supabase CLI, links de login temporários ou valores de `.env`.

### Realtime (quando aplicável)
12. Realtime compensa quando: mudança precisa aparecer imediatamente para múltiplos usuários colaborando, e polling causaria custo real. Não compensa quando o dado muda raramente, refresh manual basta, ou não há cleanup de subscription.
13. Toda subscription tem cleanup explícito e filtro por tenant no evento — payload de evento nunca ultrapassa o necessário para a UI.

## 4. Fluxo recomendado

1. Antes de tocar em auth/tenant, ler `verificacao/crc/auth.md` para entender o estado atual (queries por request, cache existente).
2. Antes de deploy de Edge Function, rodar `npm run db:check-link` e seguir o runbook.
3. Antes de expor um dado novo por header (`x-tenant-id`/`x-contract-id`), desenhar o fluxo completo de validação de vínculo — não usar o header como atalho de autorização.

## 5. Exemplos

**Pedido:** "Cria uma rota que retorna dados filtrados pelo tenant informado no header `x-tenant-id`."
**Comportamento esperado:** a rota lê o header como contexto solicitado, mas resolve o tenant real via `resolveAuthenticatedAppUser` + verificação de vínculo em `app_user_tenants`; a query nunca usa o valor do header diretamente sem essa validação, e a RLS continua ativa como última barreira.

**Pedido:** "Preciso publicar a Edge Function `import_project_forecast` com uma correção urgente."
**Comportamento esperado:** seguir `runbook_deploy_edge_functions.md` — `db:check-link`, `--use-api`, teste funcional pequeno, conferência de logs no Dashboard.

## 6. Guardrails

Nunca:
- Usar `x-tenant-id`/`x-contract-id` como prova de autorização sem validar o vínculo no servidor.
- Expor `service_role` no client ou em log.
- Fazer deploy de Edge Function sem confirmar o `project-ref` primeiro.
- Deixar uma subscription Realtime aberta sem cleanup ou sem filtro de tenant.

## 7. Validação

- `npm run db:check-link` antes de qualquer ação ligada ao projeto remoto.
- Teste funcional pequeno após deploy de Edge Function (poucos registros, conferir duplicidade e logs).
- `npx supabase functions list --project-ref lcusxnhhrjosxqgiphgp` para confirmar versão publicada.
