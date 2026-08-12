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

**A exceção deliberada é P2:** agregação em JavaScript não precisa de `pg_stat_statements` para ser diagnosticada. O problema é estrutural e visível no próprio código — e a correção usa um padrão **já aprovado dentro do projeto** (`dashboard-portfolio`), o que reduz o risco de agir antes da medição.

> ⚠️ **A primeira medição real (2026-08-12) corrigiu o enunciado do P2** — ver [`08-nivel-b-resultado.md`](08-nivel-b-resultado.md). O padrão medido **não** é "milhares de linhas por chamada": nenhuma consulta passa de 152 blocos por chamada, e quase todas ficam abaixo de 5. O que existe é **volume de chamadas** — 71 mil no `app_users`, 53 mil × 2 em `stock_transfer_item_reversals`, 28 mil em `stock_transfer_items`.
>
> ```
> escrito antes:  DB → milhares de linhas → rede → Node → agregação JS
> medido:         DB → dezenas de milhares de chamadas pequenas → Node → agregação JS
> alvo:           DB → agregação → um objeto → Node
> ```
>
> A RPC continua sendo a correção certa — ela colapsa N chamadas em 1 —, mas o **critério de aceite muda**: o que prova o ganho é **chamadas por carregamento**, não blocos por chamada.

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

## P1 — medição, em quatro perguntas distintas

Runbook completo em [`07-baseline-p1.md`](07-baseline-p1.md). Resultado parcial em [`08-nivel-b-resultado.md`](08-nivel-b-resultado.md).

"Medição" era nome grosso demais. A primeira coleta mostrou que **`calls` e `cost` contam histórias diferentes** — o bloco `08` (frequência) elegeu `programacao (legado)`, e ainda não existe o ranking por custo. Otimizar com só um dos dois é otimizar o módulo errado. Daí a divisão:

| # | Pergunta | Bloco | Status |
|---|---|---|---|
| **P1.1** | **Validade temporal** — desde quando os contadores acumulam? | `00` (`contadores_desde`) + `02_veredito` | ❌ falta |
| **P1.2** | **Ranking por custo** — onde o tempo realmente foi? | `04` + `03_tempo_por_origem` | ❌ falta |
| **P1.3** | **Ranking por frequência** — onde está o fan-out? | `08_muitas_chamadas` | ✅ obtido |
| **P1.4** | **Correlação query → rota → módulo** | `05` + análise de [`09-telas-em-uso.md`](09-telas-em-uso.md) | 🟡 parcial |

### P1.1 é pré-requisito de tudo, não formalidade

O caso `project_programming_history` mostra por quê: **912 s podem pertencer a uma consulta que hoje nem existe no caminho ativo.** Tratar isso como gargalo atual seria erro metodológico, não imprecisão.

Se `stats_reset` for anterior ao cutover da Programação Normalizada, os cumulativos não servem para decidir prioridade atual. As saídas, em ordem de preferência:

```
Preferida — delta entre snapshots, sem reset:
   snapshot T0  →  intervalo conhecido  →  snapshot T1
   delta_calls, delta_total_exec_time, delta_shared_blks_read

Alternativa — reset controlado (pg_stat_statements_reset), só se aceitável
   cegar os outros observadores do projeto.
```

O **delta** vale mais que o cumulativo para priorizar, e não exige reset. É o caminho recomendado.

### Passos operacionais

| # | Ação | Dependência |
|---|---|---|
| P1.0a | Confirmar/habilitar `pg_stat_statements` | Dashboard Supabase → Extensions |
| P1.0b | `npm run db:link` (interativo, pede a senha) + `npm run db:check-link` | credencial |
| P1.0c | Capturar `T0-pico` e `T0-fechamento` com `scripts/perf-baseline-capture.sql` | P1.0a, P1.0b |
| P1.0d | **Anotar o denominador**: contagem de `GET /api/dash-estoque` no log da hospedagem — **não sai do `pg_stat_statements`** | P1.0c |
| P1.0e | Rodar as 3 consultas complementares ([`03` §6, §7, §8](03-nivel-b-pg-stat-statements.md)) — seletividade de booleanos, FK sem índice, bloat | P1.0a |

**P1.5 não é detalhe.** Depois do P2.1 o `queryid` das consultas antigas desaparece e um novo aparece no lugar — não existe diff linha a linha. A única comparação honesta é **custo por carregamento do dashboard**, e sem o denominador capturado em `T0` ela não pode ser feita depois.

E o denominador **não é derivável do banco**: `stock_centers` é lida por 8 rotas com filtros quase idênticos, e `loadTransfers` roda `⌈N/1000⌉` vezes por carregamento. Tem que vir do log da hospedagem, anotado junto com a captura — o log tem retenção limitada e a janela do `T0` não volta. Ver [`07` §1](07-baseline-p1.md#1-a-armadilha-que-invalida-quase-toda-comparação-antesdepois).

**Critério de saída:** P1.1 respondida (janela válida, ou delta entre dois snapshots no lugar do cumulativo), P1.2 com o ranking por `total_exec_time`, e o denominador de carregamentos anotado.

**Estado hoje:** com apenas **~9,3%** do tempo do banco explicado ([`08` §2](08-nivel-b-resultado.md#2-o-que-ainda-falta-para-fechar-o-nível-b)), **qualquer lista definitiva de prioridades seria enviesada pela amostra.** Por isso a ordem abaixo está parcialmente congelada.

---

## P2 — eliminar as agregações em JavaScript

Único bloco de arquitetura que **não** espera o Nível B. O diagnóstico não precisa de medição porque o problema está no formato do código, não no tempo de execução:

```
hoje:      DB → milhares de linhas → rede → Node → agregação JS
deveria:   DB → agregação → poucas linhas/um objeto → Node
```

**Padrão a seguir: `dashboard-portfolio`.** Não inventar camada nova — ver [`05` §2](05-nivel-d-arquitetura.md#2-o-projeto-já-resolveu-isso-uma-vez--e-funcionou). Já existe implementação aprovada dentro do projeto (`dashboard_portfolio_asbuilt_factor`, `dashboard_portfolio_forecast_gap_summary`, `project_billing_orders_summary`, `list_unmeasured_team_composition_ids`) e, para os imports, a família `*_batch_partial`. Isso reduz o risco de agir antes da medição: é convergência para arquitetura estabelecida, não aposta.

### Estado da priorização (congelado até P1.1 + P1.2)

| Estado | Item | Motivo |
|---|---|---|
| ✅ **CONFIRMADO — concluído** | P0 | bug de KPI corrigido |
| ✅ **CONFIRMADO PARA P2** | `dash-estoque` / `loadReversalSets` | **fan-out medido**: 53.232×2 + 30.585×2 chamadas, assinatura inequívoca de 2 consultas por chunk. Evidência suficiente **independente do ranking global**. |
| ⏸ **PENDENTE DE PRIORIZAÇÃO** | `programacao (legado)`, `dash-operacional-faturamento`, demais RPCs candidatas | aguarda o ranking por custo (P1.2) |
| ⏸ **PENDENTE DE VALIDAÇÃO TEMPORAL** | `project_programming_history` | 912 s podem ser tráfego pré-cutover — aguarda P1.1 |
| ⬆️ **ELEVADO** | P4.4 `resolveAuthenticatedAppUser` | ≈240 mil chamadas, não é I/O — tratamento separado, ver P4 |
| 🚫 **BLOQUEANTE PARA RANKING FINAL** | blocos `00` + `02` + `03` + `04` | ~90% do tempo ainda não atribuído |

> Nota de [`09-telas-em-uso.md`](09-telas-em-uso.md): `programacao (legado)` **não é tráfego residual** — `/programacao` redireciona para `/programacao-simples`, e o menu expõe a tela congelada com o nome principal "Programacao". O custo só cai quando o cutover terminar. Isso eleva a prioridade do cutover, mas **não** promove `project_programming_history` a gargalo atual: tela viva não implica consulta viva.

### P2.0 — concluir o corte da Programação Normalizada

Ver [`10-cutover-programacao.md`](10-cutover-programacao.md). **Entra antes de P2.2** por três razões, nenhuma delas dependente do ranking por custo:

1. Elimina o maior consumidor medido (≈96.500 chamadas, ≈1.297 s) **apagando código já marcado para morrer** — não é otimização, é remoção.
2. Risco menor que escrever RPC de agregação nova: nenhum número de card muda, porque a tela inteira sai.
3. Resolve `project_programming_history` nos dois cenários possíveis — se for tráfego vivo, zera; se for pré-cutover, decai sozinho. Ou seja, **não precisa esperar P1.1** para este item.

O corte está mais adiantado do que o menu sugere: 5 das 6 fases feitas, escrita já congelada (`PROGRAMMING_SIMPLES_READ_ONLY = true`), e o modelo legado isolado num único caminho (`programacao-simples` → `/api/programacao` → `server/modules/programacao`). Restam 6 passos, dos quais **apenas um é implementação de verdade** (modo consulta na Normalizada); o resto é mover 5 símbolos de deadline para o `mapa-programacao`, repontar rotas/menu e ajustar `page_key`.

### Ordem de ataque

| # | Tela | Ação | Evidência | Esforço |
|---|---|---|---|---|
| **P2.1** | `dash-estoque` | RPC de agregação; **faz o teto de 20k desaparecer** (agregação não precisa de teto) | **medido:** ≈266 mil chamadas, ≈438 s; `loadReversalSets` sozinho dispara 2 consultas por chunk (53.232 × 2 + 30.585 × 2) | Alto |
| **P2.2** | `dash-operacional-faturamento` | RPC única; 40 consultas → 1–2 | 2.398 linhas; `project_measurement_orders` lida **3×**; `service_activities` lida **2×** | Alto |
| **P2.3** | `apuracao-fator-minimo` | RPC agregada; elimina o aninhamento chunk × página | laço duplo: nº de consultas cresce com projetos × ordens | Médio |
| **P2.4** | `dashboard-medicao` | RPC de resumo do ciclo | 38 consultas, 12 tabelas; `project_measurement_orders` em 4 pontos | Alto |
| **P2.5** | `stock-transfers/import` | RPC em lote `jsonb`, mantendo `results[]` por linha | N transações, N commits, N gravações de WAL | Médio |
| **P2.6** | `team-stock-operations/import` | idem | idem | Médio |
| **P2.7** | `dash-estoque` | keyset pagination no lugar de `OFFSET` | absorvido por P2.1 se a RPC eliminar a paginação | Baixo |
| **P2.8** | 5 telas com `slice()` no frontend | paginação real de banco — **só depois** da RPC correspondente | — | Baixo |

**P2.1 vem primeiro** porque fecha o bug de P0 de forma definitiva: com agregação no banco, não existe teto de linhas a estourar. E porque é o único item com **evidência de fan-out medida**, que não depende do ranking global.

#### Critério de aceite do P2.1

```
ANTES
dashboard load:
  N chunks × 2 queries de reversão
  + demais queries do carregamento

DEPOIS
  1 RPC agregada
  ou número constante pequeno de queries
```

| Aceite | Como medir |
|---|---|
| **KPIs idênticos** | conferir card a card antes/depois — RPC que muda um total é regressão de negócio |
| **Chamadas por carregamento drasticamente menores** | `calls` da família ÷ denominador de carregamentos ([`07` §1](07-baseline-p1.md#1-a-armadilha-que-invalida-quase-toda-comparação-antesdepois)) |
| **Nenhuma truncagem** | o teto de 20k e o 422 do P0.1 deixam de existir |
| **`total_exec_time` acumulado menor em carga equivalente** | comparar por carga equivalente, não em valor bruto |

**Não exigir redução grande de `shared_blks_read` por chamada.** A medição mostrou que esse nunca foi o problema dominante — a maioria das consultas já está abaixo de 5 blocos por chamada, servida de cache. Cobrar essa métrica levaria a rejeitar uma RPC que fez exatamente o que devia.

KPIs principais do P2, na ordem: `calls_per_dashboard_load`, `queries_per_chunk`, `total_exec_time`, `calls`.

**Capturar `T0` antes de começar P2.1** ([`07`](07-baseline-p1.md)). P2 está justificado independentemente da medição — o diagnóstico está no formato do código —, mas depois que a RPC entrar o estado anterior deixa de existir para ser medido, e com ele a possibilidade de demonstrar o ganho.

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
| P4.4 | Cache de `requirePageAction` junto ao cache de auth de 45 s | **Subiu com a medição:** ≈240 mil chamadas de overhead fixo (`app_users` 71.182, `app_roles` 71.166, `app_user_tenants` 70.973, `app_user_page_permissions` 26.818), ≈272 s. Continua sendo latência e não Disk I/O (1–3 blocos/chamada), mas é a maior contagem de chamadas do sistema. Investigar junto por que o cache de 45 s aparenta baixo aproveitamento — ver [`08` §1.4](08-nivel-b-resultado.md#14-o-custo-fixo-de-authpermissão-é-maior-em-volume-do-que-o-nível-a-estimou). |
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
