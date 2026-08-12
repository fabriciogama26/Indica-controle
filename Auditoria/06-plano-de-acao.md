# Plano de ação

Achados priorizados. Nada aqui foi aplicado ao código — esta auditoria é somente leitura.

---

## Regra de sequenciamento

```
Fase 0 (sem risco)  →  Fase 1 (medir)  →  Fase 2 (índices)  →  Fase 3 (arquitetura)
```

**Não pular a Fase 1.** Criar os 4 índices propostos sem medir custa escrita permanente em 4 tabelas quentes para acelerar consultas cuja frequência real é desconhecida. A Fase 0 existe justamente porque é o único conjunto que dispensa medição.

---

## Fase 0 — aplicar sem medir

Ganho pequeno, risco zero, nenhuma dependência do Nível B.

| # | Ação | Severidade | Onde | Validação |
|---|---|---|---|---|
| 0.1 | `drop index public.idx_project_tenant_priority_uuid` | MÉDIO | migration nova | duplicata exata de `idx_project_tenant_priority`; nenhuma consulta perde caminho de acesso |
| 0.2 | `drop index public.idx_project_tenant_city_uuid` | MÉDIO | migration nova | duplicata exata de `idx_project_tenant_city` |

Uma migration só, com comentário explicando a origem (a `038` recriou com sufixo `_uuid` e não dropou os originais da `029`).

```sql
-- 362_drop_duplicate_project_indexes.sql
-- A migration 038 converteu project.priority e project.city para UUID e recriou
-- os indices com sufixo _uuid, mas nao dropou os originais da 029. Sao pares
-- exatamente identicos (mesmas colunas, mesmo predicado): o planner nunca usa os
-- dois, e ambos sao mantidos em toda escrita na tabela project (17 indices).
drop index if exists public.idx_project_tenant_priority_uuid;
drop index if exists public.idx_project_tenant_city_uuid;
```

Validação: `npm run db:migration-list`, depois a consulta de duplicatas de [`03` §5](03-nivel-b-pg-stat-statements.md#5-inventário-real-de-índices) deve voltar vazia.

---

## Fase 1 — medir (bloqueia tudo abaixo)

| # | Ação | Dependência |
|---|---|---|
| 1.1 | Confirmar/habilitar `pg_stat_statements` | Dashboard Supabase → Extensions |
| 1.2 | Rodar `scripts/supabase-monitoring-readonly.sql` em dia útil de pico | `npm run db:check-link` |
| 1.3 | Rodar de novo em dia de fechamento de mês | — |
| 1.4 | Preencher a tabela de cruzamento de [`03` §3](03-nivel-b-pg-stat-statements.md#3-cruzamento-obrigatório-com-o-nível-a) | 1.2, 1.3 |
| 1.5 | Rodar as 3 consultas complementares ([`03` §6, §7, §8](03-nivel-b-pg-stat-statements.md)) — seletividade de booleanos, FK sem índice, bloat | 1.1 |

**Critério de saída:** existir uma lista ordenada por `total_exec_time` com `pct_do_tempo_total`, e a coluna `rows/call` preenchida para as 6 rotas de risco. Sem isso, a Fase 2 é chute.

**O que a Fase 1 pode derrubar:** se `rows/call` das rotas de dashboard for baixo (dezenas, não milhares), o achado estrutural do Nível D perde força e a Fase 3 desce de prioridade. É um resultado possível e legítimo — a auditoria estática superestima quando o volume real de dados ainda é pequeno.

---

## Fase 2 — índices (depois de medir, um por vez)

Cada item exige `EXPLAIN` antes/depois conforme [`04`](04-nivel-c-explain.md). Índice que não muda o plano deve ser **revertido**, não mantido "por garantia".

| # | Índice | Resolve | Prioridade | Pré-requisito |
|---|---|---|---|---|
| 2.1 | `project_measurement_orders (tenant_id, measurement_kind, is_active, status, execution_date)` | 6 consultas em 4 rotas — o padrão de filtro mais repetido do repositório | **ALTA** | C-1 confirmar `Rows Removed by Filter` alto |
| 2.2 | `programming (tenant_id, project_id, status, execution_date)` | 4 consultas em `medicao` + `programacao-normalizada` | **ALTA** | C-4 |
| 2.3 | `project (tenant_id, is_active, is_test, is_third_party, sob)` | elimina `Sort` do `ORDER BY sob` em 11 usos de `project_with_labels` | MÉDIA | C-2 confirmar `external merge` |
| 2.4 | `project_billing_orders (tenant_id, updated_at desc)` | listagem sem filtro de status | BAIXA | C confirmar `Sort` relevante |

Sempre:

```sql
create index concurrently if not exists <nome>
  on public.<tabela> (<colunas>);
analyze public.<tabela>;
```

`CONCURRENTLY` fica **fora** de bloco transacional — ver `guias/guia_sql.md`.

### Remoções condicionadas ao `idx_scan` real

Só depois de uma janela de coleta representativa (≥ 30 dias, incluindo um fechamento).

| # | Índice | Coberto por |
|---|---|---|
| 2.5 | `idx_project_programming_tenant_date_team` | `idx_project_programming_tenant_date_team_active` |
| 2.6 | `idx_programming_tenant_work_completion_status` | `programming_tenant_work_completion_idx` |
| 2.7 | `idx_teams_tenant_stock_center` | `idx_teams_unique_stock_center` (unique global) |

**Nunca** remover índice `UNIQUE` por `idx_scan = 0` — ele existe para a constraint, não para leitura.

### Booleanos de `project` → parciais

Condicionado à seletividade medida em [`03` §6](03-nivel-b-pg-stat-statements.md#6-seletividade-real-das-colunas-booleanas). Se `most_common_freqs` do valor filtrado > 0,20, o índice não é usado e deve sair ou virar parcial:

```sql
create index concurrently idx_project_tenant_is_test_partial
  on public.project (tenant_id) where is_test = true;
drop index concurrently public.idx_project_tenant_is_test;
```

Aplica-se a `is_test`, `is_withdrawn`, `is_third_party`, `has_locacao`, `fob`. **Não** a `is_active` — a maioria das linhas é `true`, então o índice parcial não filtraria nada; ali o caminho é o composto 2.3.

---

## Fase 3 — arquitetura (maior ganho, maior esforço)

| # | Tela | Ação | Severidade | Esforço |
|---|---|---|---|---|
| 3.1 | `dash-operacional-faturamento` | RPC única de agregação; 40 consultas → 1–2 | **CRÍTICO** | Alto |
| 3.2 | `dash-estoque` | RPC de agregação; remove o teto silencioso de 20.000 linhas | **ALTO** | Alto |
| 3.3 | `apuracao-fator-minimo` | RPC agregada; elimina o aninhamento chunk × página | **ALTO** | Médio |
| 3.4 | `dashboard-medicao` | RPC de resumo do ciclo | **ALTO** | Alto |
| 3.5 | `stock-transfers/import` | RPC em lote `jsonb`, mantendo `results[]` por linha | **ALTO** | Médio |
| 3.6 | `team-stock-operations/import` | idem | **ALTO** | Médio |
| 3.7 | `dash-estoque` | keyset pagination no lugar de `OFFSET` | MÉDIO | Baixo |
| 3.8 | 5 telas com `slice()` no frontend | paginação real de banco — **só depois** da RPC correspondente | MÉDIO | Baixo |

Todas seguem padrão já existente e validado no projeto (`dashboard_portfolio_*`, `*_batch_partial`) — ver [`05` §2](05-nivel-d-arquitetura.md#2-o-projeto-já-resolveu-isso-uma-vez--e-funcionou). É convergência para uma arquitetura estabelecida, não introdução de arquitetura nova.

**3.2 tem um componente de correção, não só de performance:** o teto de `DASH_TRANSFERS_MAX_ROWS = 20000` faz o dashboard exibir números errados sem avisar quando o período ultrapassa o limite. Vale tratar mesmo que a Fase 1 despriorize o resto.

Ordem sugerida: **3.5 e 3.6 primeiro** (esforço médio, padrão já pronto no repositório, ganho imediato em WAL) → **3.3** (esforço médio) → **3.1** (maior ganho) → 3.2 → 3.4 → 3.7 → 3.8.

---

## Fase 4 — condicional

| # | Item | Gatilho |
|---|---|---|
| 4.1 | Corrigir `auth.uid()` → `(select auth.uid())` nas 65 ocorrências restantes | Só se/quando alguma rota passar a usar o cliente autenticado do usuário em vez de `service_role`. Hoje é INFORMATIVO — ver [`02` §7](02-nivel-a-indices.md#7-rls--por-que-não-é-o-gargalo-aqui). |
| 4.2 | Índice `pg_trgm` GIN para `sob ilike '%…%'` | Só se o Nível B mostrar essa busca com custo acumulado relevante |
| 4.3 | Materialized view de saldo de estoque | Só se 3.2 não resolver sozinha |
| 4.4 | Cache de `requirePageAction` junto ao cache de auth de 45 s | Ganho de latência (até 3 round-trips/request), não de I/O. Baixa prioridade. |
| 4.5 | Auditoria de isolamento multi-tenant | Fora do escopo desta auditoria. Ver [`05` §8](05-nivel-d-arquitetura.md#8-observação-fora-de-escopo-de-performance). |

---

## Resumo

| Severidade | Qtd | Itens |
|---|---|---|
| **CRÍTICO** | 1 | 3.1 |
| **ALTO** | 7 | 2.1, 2.2, 3.2, 3.3, 3.4, 3.5, 3.6 |
| **MÉDIO** | 6 | 0.1, 0.2, 2.3, 3.7, 3.8, booleanos de `project` |
| **BAIXO** | 4 | 2.4, 2.5, 2.6, 2.7 |
| **INFORMATIVO** | 5 | Fase 4 |

**O que já está certo e não deve ser mexido:**

- Zero `.select('*')` em 989 consultas — disciplina consistente de projeção
- 232 dos 258 índices começando por `tenant_id`; os 26 restantes justificados um a um
- React Query configurado sem polling e sem refetch em foco
- `dashboard-portfolio` já migrado para RPCs de agregação — é o modelo a seguir
- Nenhuma chamada Supabase direta do cliente; todo acesso passa pela camada de API
- Chunking de `IN (...)` implementado corretamente (não é N+1)
- Já existe `scripts/supabase-monitoring-readonly.sql` cobrindo o Nível B

---

## Validação de qualquer mudança derivada deste plano

Conforme `CLAUDE.md` §9 — não existe script `test` no projeto:

```bash
npx tsc --noEmit
npm run lint
npm run build          # se afetar rota/build
npm run db:check-link
npm run db:migration-list
npm run db:lint
```

Front/UI é validação manual: caminho feliz + estado vazio + estado de erro. Para toda mudança de dashboard, conferir que os **números dos cards batem** com os da versão anterior antes e depois — uma RPC de agregação que muda um total é regressão de negócio, não otimização.

Registrar em `/docs/<Tela>.txt` toda alteração de comportamento de tela, e apresentar o texto do commit em 6 seções conforme `guias/guia_git.md` antes de encerrar.
