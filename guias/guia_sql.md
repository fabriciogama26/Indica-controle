# Guia de SQL / Banco (Postgres + PL/pgSQL)

## 1. Escopo

Obrigatório sempre que a tarefa cria ou altera: migration, função PL/pgSQL, trigger, policy RLS, índice, constraint, ou qualquer RPC `SECURITY DEFINER`. Para regras de acesso ao banco a partir do Node (paginação, cache, `Promise.all`), ver [`guia_backend.md`](guia_backend.md). Para CLI/deploy do Supabase, ver [`guia_supabase.md`](guia_supabase.md).

## 2. Fontes de verdade

- `supabase/migrations/*` — histórico real aplicado (numeração sequencial).
- `docs/arquitetura/plpgsql-null-boolean-armadilha.md` — este guia resume a regra; o arquivo mantém o incidente completo (migrations 279-282) e o script de diagnóstico.
- `scripts/check-security-definer.ps1` / `npm run db:security-check` — validação de grants de RPC `SECURITY DEFINER`.

## 3. Regras obrigatórias

### Migrations
1. Toda alteração de schema tem migration versionada, considera impacto em RLS/índices/performance, e inclui fallback/backfill quando necessário.
2. Nunca editar retroativamente uma migration já aplicada — migration aplicada é histórico do banco.
3. Não criar tabela duplicada quando uma tabela genérica já atende com contrato claro. Antes de criar tabela nova, mapear: tabela principal, itens/filhos, histórico, catálogos, lote/importação, idempotência, auditoria de tentativa/resultado.
4. Se uma tabela esperada estiver vazia em produção, investigar regra/persistência/backfill antes de concluir que ela é desnecessária.
5. Confirmar que o projeto ligado pelo Supabase CLI corresponde ao ambiente auditado antes de aplicar qualquer migration (`npm run db:check-link`). Nunca aplicar migration, repair, reset ou link automaticamente em projeto divergente.

### Constraints, índices e concorrência
6. Verificação `SELECT` antes de `INSERT` para checar unicidade nunca é suficiente sozinha — usar `UNIQUE constraint` ou `EXCLUSION constraint` no banco.
7. Toda tabela de negócio do tenant tem no mínimo índice em `tenant_id`; se filtrada por status/ativo, índice composto `(tenant_id, status)`/`(tenant_id, ativo)`; se filtrada por data operacional, `(tenant_id, data_coluna DESC)`; se consultada por FK frequente, `(tenant_id, foreign_key_id)`.
8. Toda coluna nova usada como filtro frequente exige migration com índice antes do PR.
9. Não remover índice apenas porque um advisor marcou como "unused" — verificar janela de observação, workload sazonal (fechamentos mensais), suporte a FK, e exigir `EXPLAIN (ANALYZE, BUFFERS)` antes de remover.
10. Prevenção de sobreposição/duplicidade concorrente usa `UNIQUE`/`EXCLUSION constraint` ou `advisory lock`/`SELECT FOR UPDATE` — nunca apenas checagem otimista no Node.

### Multi-tenant e RLS
11. Toda entidade de negócio nova carrega `tenant_id` (ou `account_owner_id` equivalente) e RLS de leitura por `user_can_access_tenant`.
12. Relação entre tabelas de negócio usa `UNIQUE (tenant_id, id)` na entidade pai e FK composta `(tenant_id, parent_id) -> parent(tenant_id, id)` — FK apenas por `id` não é suficiente quando a tabela filha tem tenant próprio. Toda migration nova testa insert/update com parent de outro tenant.
13. Tabela operacional crítica não aceita `INSERT`/`UPDATE` direto de `authenticated` quando a regra exige API/RPC.
14. RLS continua obrigatória para `SELECT` mesmo quando a escrita passa por RPC — é defesa em camadas, não substituível uma pela outra.

### Funções `SECURITY DEFINER`
15. RPC `SECURITY DEFINER` só é executável por `service_role`, OU valida internamente `auth.uid()`, usuário ativo, tenant permitido e page/action.
16. Toda migration que recria ou adiciona `SECURITY DEFINER` revoga `public`/`anon`/`authenticated` explicitamente e concede `EXECUTE` apenas a `service_role` (ou ao papel estritamente necessário).
17. Toda migration posterior a um hardening de grants repete/verifica o padrão — não reabrir `EXECUTE` de `authenticated` sem justificativa e teste.

### PL/pgSQL — armadilha de boolean NULL
18. Em Postgres, qualquer comparação envolvendo `NULL` retorna `NULL`, não `FALSE` (`NULL IN (...)`, `NULL LIKE ...`, `NULL OR NULL`). Em PL/pgSQL, `IF <expressão>` só executa quando a expressão é `TRUE` — `NULL` não dispara o bloco e não gera erro, causando bugs silenciosos (early-return que "não dispara" e deixa o fluxo continuar).
19. Toda variável `boolean` que recebe expressão composta usa `COALESCE(..., false)`, ou guards `IS NOT NULL` antes de cada comparação:
    ```sql
    -- Correto:
    v_is_completed := coalesce(
      v_status in ('CONCLUIDO', 'COMPLETO') or v_status like 'CONCLUIDO%',
      false
    );
    ```
20. Todo `IF <variavel_booleana> THEN` onde a variável pode ser `NULL` usa `IF COALESCE(var, false) THEN` ou `IF var = TRUE THEN`.
21. Expressões booleanas dependentes de valor obtido por `SELECT INTO` (que pode retornar `NULL` por `NOT FOUND`) são protegidas pela mesma regra.
22. Checklist obrigatório antes de merge de função de trigger: (a) toda variável booleana composta tem `COALESCE`/guard; (b) todo `IF` sobre variável nulável usa `COALESCE`/`= TRUE`; (c) valores vindos de `SELECT INTO` estão protegidos; (d) existe ao menos um caso de teste com todos os campos nuláveis como `NULL`.

## 4. Fluxo recomendado

1. Antes de criar tabela/coluna, mapear entidades relacionadas (regra 3) e confirmar `tenant_id`/RLS (regra 11-12).
2. Escrever a migration com constraint/índice já incluído (não como etapa separada depois).
3. Se a migration cria função `SECURITY DEFINER`, aplicar revoke/grant explícito (regra 16) e rodar `npm run db:security-check`.
4. Se a migration cria/altera trigger, aplicar o checklist de NULL boolean (regra 22).
5. Rodar `npm run db:check-link` antes de qualquer `db:migration-list`/`db:lint`/deploy.

## 5. Exemplos

**Pedido:** "Cria uma trigger que bloqueia conclusão duplicada de uma etapa quando o status já é CONCLUIDO em outra linha do grupo."
**Comportamento esperado:** a variável booleana que decide o early-return usa `COALESCE(..., false)` desde a primeira versão — não esperar um incidente em produção (como o de `enforce_completed_work_status_group_integrity`, migrations 279→282) para adicionar o guard.

**Pedido:** "Adiciona uma tabela nova de histórico para o módulo de Requisição."
**Comportamento esperado:** `tenant_id` com FK composta para o pai, RLS de leitura via `user_can_access_tenant`, índice em `(tenant_id, created_at DESC)`, sem aceitar `tenant_id` do payload do cliente.

## 6. Guardrails

Nunca:
- Editar uma migration já aplicada em vez de criar uma nova.
- Deixar uma função `SECURITY DEFINER` nova sem revoke explícito de `public`/`anon`/`authenticated`.
- Atribuir uma expressão booleana composta a uma variável PL/pgSQL sem `COALESCE`/guard `IS NOT NULL`.
- Remover um índice só porque o advisor do Supabase o marcou como "unused", sem checar workload sazonal.
- Criar FK simples por `id` quando a tabela filha tem `tenant_id` próprio.

## 7. Validação

- `npm run db:check-link` antes de qualquer comando linked.
- `npm run db:migration-list` / `npm run db:lint` (somente com o link confirmado).
- `npm run db:security-check` (estático) e, quando aplicável, `npm run db:security-check-live`.
- Teste manual de insert/update com tenant/parent divergente para toda FK composta nova.
