# Plano de ação

Achados priorizados. Nada aqui foi aplicado ao código — esta auditoria é somente leitura.

---

## Regra de sequenciamento

```
P0 correção   →  P1 medição   →  P2 arquitetura   →  P3 índices
(bug de KPI)     (pg_stat_       (agregação no       (só depois
                  statements)     banco)              de medir)
```

Duas regras que governam a ordem:

**1. Bug de correção vem antes de qualquer benchmark.** O teto silencioso de 20.000 linhas do `dash-estoque` não é problema de performance — é KPI potencialmente errado entregue sem aviso. Não espera medição, não espera refactor.

**2. Índice não se cria por análise estática.** Cada índice adicional cobra custo permanente em `INSERT`, `UPDATE`, `VACUUM`, cache e armazenamento. Análise estática gera **candidato**; produção decide se vale. Por isso P3 vem depois de P1, e não junto.

**A exceção deliberada é P2:** agregação em JavaScript não precisa de `pg_stat_statements` para ser diagnosticada. O problema é estrutural e visível no próprio código —

```
hoje:      DB → milhares de linhas → rede → Node → agregação JS
deveria:   DB → agregação → poucas linhas/um objeto → Node
```

— e a correção usa um padrão **já aprovado dentro do projeto** (`dashboard-portfolio`), o que reduz o risco de agir antes da medição.

---

## P0 — correção imediata (bug de KPI)

| # | Ação | Severidade | Onde | Status |
|---|---|---|---|---|
| P0.1 | Eliminar o truncamento **silencioso** de `DASH_TRANSFERS_MAX_ROWS = 20000` | **CRÍTICO** | [`dash-estoque/route.ts`](../src/app/api/dash-estoque/route.ts) | ✅ **CORRIGIDO** em 2026-08-12 |

**O bug:** `loadTransfers` paginava em blocos de 1.000 até o teto de 20.000 e parava. Se o período tivesse mais movimentações que isso, o laço encerrava sem sinal algum — e **todos** os indicadores derivados (`movementCount`, `totalMovementQuantity`, `summaryByUnit`, evolução, ABC, sem giro, dispersão) eram calculados sobre um recorte parcial, apresentados como se fossem o total.

Agrava que este é o **segundo** teto silencioso da mesma função: a correção de 2026-07-03 resolveu o corte de 1.000 linhas do PostgREST paginando via `.range()`, mas deixou o teto de 20.000 igualmente mudo.

**Por que foi P0 e não parte do refactor:** um número errado sem aviso é pior que um dashboard que falha. Quem lê o card não tem como saber que faltam dados. A correção do teto não dependia da RPC e não devia esperar por ela.

**O que foi feito:** quando o teto é atingido, `loadTransfers` faz uma sondagem exata de 1 linha em `.range(20000, 20000)` — que distingue "existem exatamente 20.000" (carga válida) de "existem mais de 20.000" (recusa). Havendo excedente, a rota devolve **HTTP 422** com `code: "DASH_ESTOQUE_PERIODO_EXCEDE_LIMITE"`, `limit` e mensagem acionável. Nenhum KPI parcial é renderizado. O frontend não precisou mudar — `hooks.ts` já propaga `payload.message` de qualquer resposta não-ok.

Decisão de produto tomada com o usuário: **recusar e pedir período menor**, em vez de renderizar com aviso de dados parciais. Número parcial rotulado continua sendo número que alguém printa fora de contexto.

**Correção definitiva ainda pendente:** o teto continua existindo — o que mudou é que parou de mentir. A agregação no banco (P2.1) o faz desaparecer, porque agregação não precisa de teto de linhas, e leva junto a sondagem e o 422.

### Higiene de índices, sem dependência de medição

Único conjunto de índices que dispensa o Nível B, porque duplicata exata nunca é o único caminho de acesso de nenhuma consulta.

| # | Ação | Severidade | Validação |
|---|---|---|---|
| P0.2 | `drop index public.idx_project_tenant_priority_uuid` | MÉDIO | duplicata exata de `idx_project_tenant_priority` |
| P0.3 | `drop index public.idx_project_tenant_city_uuid` | MÉDIO | duplicata exata de `idx_project_tenant_city` |

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

## P1 — habilitar a medição real do banco

| # | Ação | Dependência |
|---|---|---|
| 1.1 | Confirmar/habilitar `pg_stat_statements` | Dashboard Supabase → Extensions |
| 1.2 | Rodar `scripts/supabase-monitoring-readonly.sql` em dia útil de pico | `npm run db:check-link` |
| 1.3 | Rodar de novo em dia de fechamento de mês | — |
| 1.4 | Preencher a tabela de cruzamento de [`03` §3](03-nivel-b-pg-stat-statements.md#3-cruzamento-obrigatório-com-o-nível-a) | 1.2, 1.3 |
| 1.5 | Rodar as 3 consultas complementares ([`03` §6, §7, §8](03-nivel-b-pg-stat-statements.md)) — seletividade de booleanos, FK sem índice, bloat | 1.1 |

**Critério de saída:** existir uma lista ordenada por `total_exec_time` com `pct_do_tempo_total`, e a coluna `rows/call` preenchida para as 6 rotas de risco. Sem isso, P3 é chute.

**O que P1 pode derrubar:** se `rows/call` das rotas de dashboard for baixo (dezenas, não milhares), o achado estrutural do Nível D perde força e P2 desce de prioridade. É um resultado possível e legítimo — a auditoria estática superestima quando o volume real de dados ainda é pequeno.

---

## P2 — eliminar as agregações em JavaScript

Único bloco de arquitetura que **não** espera o Nível B. O diagnóstico não precisa de medição porque o problema está no formato do código, não no tempo de execução:

```
hoje:      DB → milhares de linhas → rede → Node → agregação JS
deveria:   DB → agregação → poucas linhas/um objeto → Node
```

**Padrão a seguir: `dashboard-portfolio`.** Não inventar camada nova — ver [`05` §2](05-nivel-d-arquitetura.md#2-o-projeto-já-resolveu-isso-uma-vez--e-funcionou). Já existe implementação aprovada dentro do projeto (`dashboard_portfolio_asbuilt_factor`, `dashboard_portfolio_forecast_gap_summary`, `project_billing_orders_summary`, `list_unmeasured_team_composition_ids`) e, para os imports, a família `*_batch_partial`. Isso reduz o risco de agir antes da medição: é convergência para arquitetura estabelecida, não aposta.

### Ordem de ataque

| # | Tela | Ação | Evidência | Esforço |
|---|---|---|---|---|
| **P2.1** | `dash-estoque` | RPC de agregação; **faz o teto de 20k desaparecer** (agregação não precisa de teto) | 29 consultas, 12 tabelas, até 20.000 linhas em memória | Alto |
| **P2.2** | `dash-operacional-faturamento` | RPC única; 40 consultas → 1–2 | 2.398 linhas; `project_measurement_orders` lida **3×**; `service_activities` lida **2×** | Alto |
| **P2.3** | `apuracao-fator-minimo` | RPC agregada; elimina o aninhamento chunk × página | laço duplo: nº de consultas cresce com projetos × ordens | Médio |
| **P2.4** | `dashboard-medicao` | RPC de resumo do ciclo | 38 consultas, 12 tabelas; `project_measurement_orders` em 4 pontos | Alto |
| **P2.5** | `stock-transfers/import` | RPC em lote `jsonb`, mantendo `results[]` por linha | N transações, N commits, N gravações de WAL | Médio |
| **P2.6** | `team-stock-operations/import` | idem | idem | Médio |
| **P2.7** | `dash-estoque` | keyset pagination no lugar de `OFFSET` | absorvido por P2.1 se a RPC eliminar a paginação | Baixo |
| **P2.8** | 5 telas com `slice()` no frontend | paginação real de banco — **só depois** da RPC correspondente | — | Baixo |

**P2.1 vem primeiro** porque fecha o bug de P0 de forma definitiva: com agregação no banco, não existe teto de linhas a estourar.

**P2.8 depende de P2.1–P2.4.** Paginar no banco uma consulta que ainda carrega tudo para agregar em JS não resolve nada e ainda quebra os totais dos cards.

---

## P3 — índices (`CANDIDATE`, depois de medir, um por vez)

> Todos os quatro estão marcados **`CANDIDATE — awaiting pg_stat_statements / EXPLAIN`**, não "missing index". Ver [`02` §8](02-nivel-a-indices.md#8-índices--candidatos-não-faltantes). Cada índice adicional cobra custo permanente em `INSERT`, `UPDATE`, `VACUUM`, cache e armazenamento — a análise estática levanta o candidato, produção decide se ele se paga.

Cada item exige `EXPLAIN` antes/depois conforme [`04`](04-nivel-c-explain.md). Índice que não muda o plano deve ser **revertido**, não mantido "por garantia".

| # | Índice candidato | Evidência estática | Promove para `APPLY` se |
|---|---|---|---|
| P3.1 | `project_measurement_orders (tenant_id, measurement_kind, is_active, status, execution_date)` | 6 consultas em 4 rotas — a mais forte das quatro | B mostrar custo acumulado relevante **e** C-1 mostrar `Rows Removed by Filter` alto que some depois |
| P3.2 | `programming (tenant_id, project_id, status, execution_date)` | 4 consultas em 2 módulos | B + C-4 |
| P3.3 | `project (tenant_id, is_active, is_test, is_third_party, sob)` | 11 usos com `ORDER BY sob` sem índice | B + C-2 confirmar `external merge` |
| P3.4 | `project_billing_orders (tenant_id, updated_at desc)` | 1 consulta — evidência fraca | só se B destacar espontaneamente |

Nota: **P2 pode reduzir ou eliminar a necessidade de P3.1 e P3.2.** Se as consultas hoje repetidas virarem uma CTE dentro de uma RPC, o padrão de acesso muda e o candidato precisa ser reavaliado contra a nova query — não contra a antiga. Ordem importa aqui.

Sempre, quando promovido:

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
| P3.5 | `idx_project_programming_tenant_date_team` | `idx_project_programming_tenant_date_team_active` |
| P3.6 | `idx_programming_tenant_work_completion_status` | `programming_tenant_work_completion_idx` |
| P3.7 | `idx_teams_tenant_stock_center` | `idx_teams_unique_stock_center` (unique global) |

**Nunca** remover índice `UNIQUE` por `idx_scan = 0` — ele existe para a constraint, não para leitura.

### Booleanos de `project` → parciais

Condicionado à seletividade medida em [`03` §6](03-nivel-b-pg-stat-statements.md#6-seletividade-real-das-colunas-booleanas). Se `most_common_freqs` do valor filtrado > 0,20, o índice não é usado e deve sair ou virar parcial:

```sql
create index concurrently idx_project_tenant_is_test_partial
  on public.project (tenant_id) where is_test = true;
drop index concurrently public.idx_project_tenant_is_test;
```

Aplica-se a `is_test`, `is_withdrawn`, `is_third_party`, `has_locacao`, `fob`. **Não** a `is_active` — a maioria das linhas é `true`, então o índice parcial não filtraria nada; ali o caminho é o composto P3.3.

---

## P4 — condicional

| # | Item | Gatilho |
|---|---|---|
| P4.1 | Corrigir `auth.uid()` → `(select auth.uid())` nas 65 ocorrências restantes | Só se/quando alguma rota passar a usar o cliente autenticado do usuário em vez de `service_role`. Hoje é INFORMATIVO — ver [`02` §7](02-nivel-a-indices.md#7-rls--por-que-não-é-o-gargalo-aqui). |
| P4.2 | Índice `pg_trgm` GIN para `sob ilike '%…%'` | Só se o Nível B mostrar essa busca com custo acumulado relevante |
| P4.3 | Materialized view de saldo de estoque | Só se P2.1 não resolver sozinha |
| P4.4 | Cache de `requirePageAction` junto ao cache de auth de 45 s | Ganho de latência (até 3 round-trips/request), não de I/O. Baixa prioridade. |
| P4.5 | Auditoria de isolamento multi-tenant | Fora do escopo desta auditoria. Ver [`05` §8](05-nivel-d-arquitetura.md#8-observação-fora-de-escopo-de-performance). |

---

## Resumo

| Severidade | Qtd | Itens |
|---|---|---|
| **CRÍTICO** | 2 | P0.1 (bug de KPI), P2.2 |
| **ALTO** | 5 | P2.1, P2.3, P2.4, P2.5, P2.6 |
| **MÉDIO** | 5 | P0.2, P0.3, P2.7, P2.8, booleanos de `project` |
| **BAIXO** | 3 | P3.5, P3.6, P3.7 |
| **CANDIDATE** | 4 | P3.1, P3.2, P3.3, P3.4 — aguardam medição, não são "índices faltantes" |
| **INFORMATIVO** | 5 | P4 |

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
