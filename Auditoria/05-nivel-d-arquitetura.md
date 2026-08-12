# Nível D — Arquitetura

Aqui não se olha a query, olha-se a tela inteira. É o nível que produz os maiores ganhos de Disk I/O deste projeto — e o único cujos achados não dependem de acesso a produção.

---

## 1. O achado estrutural

**Nenhuma agregação acontece no PostgreSQL.** Verificado: zero `count: 'exact'` em todo o `src/`; nenhuma rota usa `SUM`, `AVG`, `GROUP BY` ou `DISTINCT` do banco. O padrão universal do projeto é:

```
API busca N páginas de 1.000 linhas
  → junta tudo em array no Node
    → reduce/map/filter em JavaScript
      → devolve os cards prontos
```

Isso troca o recurso mais barato (CPU do Postgres agregando sobre páginas já em cache) pelos três mais caros: **Disk I/O** (ler todas as linhas), **rede** (trafegar todas as linhas do banco até o runtime) e **RAM do Node** (materializar tudo).

Para uma tabela de 200 mil linhas, `SUM(total_value)` no Postgres lê as páginas uma vez e devolve 8 bytes. O mesmo cálculo em JavaScript lê as mesmas páginas, serializa em JSON, trafega alguns MB e aloca centenas de milhares de objetos. **O I/O de disco é o mesmo ou pior; todo o resto é desperdício puro.**

---

## 2. O projeto já resolveu isso uma vez — e funcionou

**Este não é um padrão novo a introduzir.** O módulo `dashboard-portfolio` já foi migrado para agregação no banco:

| RPC | Migration | Substitui |
|---|---|---|
| `dashboard_portfolio_forecast_values` | — | varredura de `project_activity_forecast` |
| `dashboard_portfolio_goal_coverage` | — | cálculo de meta em JS |
| `dashboard_portfolio_asbuilt_factor` | `357` | leitura direta das tabelas de Medição As Built |
| `dashboard_portfolio_forecast_gap_summary` | `358` | varredura para descobrir projetos sem atividade prevista |
| `dashboard_portfolio_forecast_gaps` | `358` | lista sob demanda (só quando o modal abre) |
| `project_billing_orders_summary` | `360` | totais de faturamento |
| `list_unmeasured_team_composition_ids` | `361` | filtro de composições não medidas |
| `get_programming_week_summary` | — | resumo semanal de programação |
| `calculate_measurement_minimum_billing_guarantee` | — | garantia de faturamento mínimo |

O comentário em [`dashboard-portfolio/controller.ts:398`](../src/server/modules/dashboard-portfolio/controller.ts#L398) explicita a intenção arquitetural:

> *"Fator historico de realizacao As Built, via contrato explicito (RPC 357). A Carteira nao le as tabelas da Medicao As Built diretamente."*

E em [`:411`](../src/server/modules/dashboard-portfolio/controller.ts#L411):

> *"O resumo sobe no payload principal; a lista fica sob demanda no modal, para nao carregar linha nenhuma em quem nunca abrir o cartao."*

Esse é exatamente o padrão certo, já validado neste repositório, já compatível com a regra de fronteira entre features do `CLAUDE.md` §5 (comunicação por contrato explícito, não import de regra de feature irmã).

**A recomendação deste nível é apenas: estender o padrão que já existe às três telas que ficaram para trás.** Isso reduz drasticamente o risco — não é arquitetura nova, é convergência.

---

## 3. `dash-operacional-faturamento` — **CRÍTICO**

[`src/app/api/dash-operacional-faturamento/route.ts`](../src/app/api/dash-operacional-faturamento/route.ts) — **2.398 linhas, 40 consultas, 9 tabelas**.

### Os loaders, um por card

```
loadProjects                            → project_with_labels
loadOrderIds                            → project_measurement_orders
loadOrderProjectRows                    → project_measurement_orders
loadClosedAsbuiltOrderRows              → project_asbuilt_measurement_orders
loadMeasurementItems                    → project_measurement_order_items
loadMeasurementOrderRows                → project_measurement_orders     ← 3ª vez
loadCommercialItems                     → project_billing_order_items
loadActivityStatusMap                   → service_activities
loadActivityCategoryMap                 → service_activities             ← 2ª vez
loadAsbuiltCoverageDateOptions          → project_asbuilt_measurement_orders
loadWorkCompletionCatalog               → programming_work_completion_catalog
loadLatestWorkCompletionByProject       → programming
loadCommercialOrderMetrics              → project_billing_orders
buildOperationalMeasurementCategoryCards
buildOperationalMeasurementCategoryDetailRows
buildOperationalAsbuiltCategoryDetailRows
buildOperationalBillingCategoryDetailRows
buildAsbuiltBreakdownRows
buildProjectValueRows
buildChartItems
buildChartProjectDetailRows
```

Este é literalmente o caso descrito no escopo da auditoria:

```
query 1 → total faturado
query 2 → total medido
query 3 → total por equipe
query 4 → total por projeto
query 5 → total do ciclo
query 6 → concluídos
query 7 → pendentes
query 8 → novos
query 9 → herdados
```

`project_measurement_orders` é percorrida **3 vezes** com filtros quase idênticos. `service_activities`, **2 vezes**. Cada passagem é `⌈N/1000⌉` consultas paginadas.

### Alvo

```
1 RPC  dashboard_operacional_faturamento_summary(
         p_tenant_id, p_inicio, p_fim, p_service_center, p_status)
     ↓
   uma agregação  (CTEs encadeadas, uma passada por tabela)
     ↓
   retorna todos os indicadores
```

Esqueleto:

```sql
create or replace function public.dashboard_operacional_faturamento_summary(
  p_tenant_id uuid,
  p_inicio    date,
  p_fim       date,
  p_service_center uuid default null
)
returns table (
  total_medido         numeric,
  total_faturado       numeric,
  total_asbuilt        numeric,
  qtd_concluidos       bigint,
  qtd_pendentes        bigint,
  ...
)
language sql
stable
security invoker
as $$
  with ordens as (
    select o.id, o.project_id, o.status, o.execution_date
    from public.project_measurement_orders o
    where o.tenant_id        = p_tenant_id
      and o.is_active        = true
      and o.measurement_kind = 'COM_PRODUCAO'
      and o.execution_date between p_inicio and p_fim
  ),
  itens as (
    select i.measurement_order_id, sum(i.total_value) as valor
    from public.project_measurement_order_items i
    join ordens o on o.id = i.measurement_order_id
    where i.tenant_id = p_tenant_id and i.is_active = true
    group by i.measurement_order_id
  )
  select
    (select coalesce(sum(valor), 0) from itens)                    as total_medido,
    ...
$$;
```

`ordens` é avaliada **uma vez** e reutilizada por todos os cards. As tabelas são percorridas uma vez cada, não três.

### Ganho esperado

| Métrica | Hoje | Depois |
|---|---|---|
| Round-trips por carregamento | ~40 (× páginas) | 1–2 |
| Linhas trafegadas | milhares | dezenas |
| Agregação | Node/JS | PostgreSQL |
| Paginação da tabela de projetos | `slice()` em memória no frontend | `LIMIT/OFFSET` real |

> **Severidade: CRÍTICO / Confiança: Alta.** Prioridade 1 do Nível D. Confirmar com o `rows/call` do Nível B antes de investir o esforço de reescrita.

---

## 4. `dashboard-medicao` — **ALTO**

[`src/server/modules/dashboard-measurement/controller.ts`](../src/server/modules/dashboard-measurement/controller.ts) — **1.701 linhas, 38 consultas, 12 tabelas**.

`project_measurement_orders` é consultada em 4 pontos (`:609`, `:678`, `:719`, `:1116`) com variações do mesmo filtro. Itens vêm em chunks de 200. Metas, tipos de equipe, histórico de tipo de equipe, dias úteis do ciclo — cada um uma consulta.

**Caminho:** RPC `dashboard_medicao_summary(p_tenant_id, p_cycle_start, p_cycle_end, p_team_type, p_service_center)`, seguindo `dashboard_portfolio_goal_coverage` como modelo — que já resolve problema estruturalmente idêntico (meta × produzido × potencial restante).

Ganho colateral: o índice C-1 ([`04`](04-nivel-c-explain.md#c-1--project_measurement_orders--filtro-dominante)) deixa de ser necessário para 4 consultas separadas e passa a servir 1 CTE.

---

## 5. `dash-estoque` — **ALTO**

[`src/app/api/dash-estoque/route.ts`](../src/app/api/dash-estoque/route.ts) — **1.126 linhas, 29 consultas, 12 tabelas**.

Carrega até **20.000 movimentações** (`DASH_TRANSFERS_MAX_ROWS`), depois busca itens, materiais, equipes, projetos, operações de equipe e dois conjuntos de estorno — tudo em chunks — para agregar saldo e movimento em JavaScript.

Aqui havia um agravante que os outros dois não têm: o teto de 20.000 era **silencioso**. Passando disso, o dashboard mostrava números errados sem avisar ninguém — bug de correção, não de performance.

> ✅ **Corrigido em 2026-08-12** (P0.1). O truncamento agora é detectado e vira **HTTP 422** com mensagem acionável, em vez de KPI parcial. O teto em si **continua existindo** — a remoção definitiva é esta seção (P2.1): agregação no banco não precisa de teto de linhas.

**Caminho:** RPC `dash_estoque_summary(p_tenant_id, p_inicio, p_fim, p_stock_center, p_material_type)` que faz `GROUP BY` no banco. O teto desaparece junto — agregação não precisa de teto de linhas.

**Alternativa complementar:** este é o único caso desta auditoria em que uma **materialized view** se justifica. Saldo de estoque por centro/material é histórico fechado, recalculado a cada acesso, e tolera defasagem de minutos:

```sql
create materialized view public.mv_dash_estoque_saldo_diario as
select tenant_id, entry_date, stock_center_id, material_id,
       sum(quantity) filter (where movement_type = 'ENTRADA') as entradas,
       sum(quantity) filter (where movement_type = 'SAIDA')   as saidas
from ...
group by 1,2,3,4;

create unique index on public.mv_dash_estoque_saldo_diario
  (tenant_id, entry_date, stock_center_id, material_id);   -- exigido por CONCURRENTLY

refresh materialized view concurrently public.mv_dash_estoque_saldo_diario;
```

**Critério de decisão entre RPC e matview:**

| Situação | Solução |
|---|---|
| Indicadores precisam ser do instante da consulta | RPC |
| Filtro do usuário varia muito (datas livres, equipe, material) | RPC — matview não serve |
| Histórico fechado, recalculado a cada acesso, tolera defasagem | matview + `REFRESH CONCURRENTLY` agendado |

Para `dash-estoque`, o corte é por **período livre escolhido pelo usuário** → começar por **RPC**. Matview só se o Nível B mostrar que o custo persiste depois da RPC.

> Se adotar matview: `REFRESH` precisa de agendamento (pg_cron ou Edge Function), a view não tem RLS própria (o `tenant_id` precisa estar na chave e ser filtrado por quem lê), e ela entra no ciclo de migrations como qualquer objeto. Não adotar sem alinhar com `guias/guia_sql.md`.

---

## 6. `apuracao-fator-minimo` — **ALTO**

[`src/app/api/apuracao-fator-minimo/route.ts`](../src/app/api/apuracao-fator-minimo/route.ts) — **879 linhas, 28 consultas, 13 tabelas**.

O agravante único desta rota é o **aninhamento duplo de laços**:

```
para cada chunk de 100 projetos          (loadProjects → chunks)
   para cada página de 1.000 ordens      (.range em laço)
       consulta project_measurement_orders
para cada chunk de ordens
   para cada página de 1.000 itens
       consulta project_measurement_order_items
```

O número de consultas cresce com **projetos × ordens**, não com um dos dois. Com 500 projetos e 20.000 ordens no período: 5 chunks × ~20 páginas = ~100 consultas só na primeira etapa.

E o frontend ainda pagina o resultado em memória ([`MinimumFactorAnalysisPageView.tsx:243`](../src/modules/dashboard/apuracao-fator-minimo/MinimumFactorAnalysisPageView.tsx#L243)) — o backend carrega tudo para o frontend mostrar 50 linhas.

**Caminho:** RPC que recebe os filtros e devolve as linhas já agregadas por equipe/ciclo, com `LIMIT`/`OFFSET` reais. Precedente direto: `calculate_measurement_minimum_billing_guarantee` já existe e faz cálculo de garantia mínima no banco — é a mesma família de problema.

---

## 7. Imports registro a registro

| Rota | Comportamento | Custo |
|---|---|---|
| [`stock-transfers/import/route.ts:188`](../src/app/api/stock-transfers/import/route.ts#L188) | `for` sobre linhas, uma transação por linha | N round-trips + N commits + N gravações de WAL |
| [`team-stock-operations/import/route.ts:360`](../src/app/api/team-stock-operations/import/route.ts#L360) | idem | idem |

Ambos precisam devolver `results[]` com sucesso/erro **por linha** — requisito legítimo de UX que não deve ser sacrificado.

**Caminho, já disponível no projeto:** RPC que recebe o lote como `jsonb`, processa numa transação e devolve o array de resultados por linha. Precedentes funcionando:

- `save_project_billing_order_batch_partial`
- `save_project_measurement_order_batch_partial`
- `save_project_asbuilt_measurement_order_batch_partial`
- `save_team_stock_operation_batch_full`

O sufixo `_partial` desses nomes indica que o padrão "alguns itens falham, outros passam, devolve o detalhe por item" **já está resolvido** neste repositório. Falta aplicá-lo aos dois imports.

Contraexemplo correto no próprio projeto: [`projects/activity-forecast/import/route.ts:371`](../src/app/api/projects/activity-forecast/import/route.ts#L371) usa `insert(rowsToInsert)` em lote por projeto.

> **Severidade: ALTO / Confiança: Alta.**

---

## 8. Observação fora de escopo de performance

Registrada por honestidade de auditoria, **não** como achado de I/O:

Todas as 90 rotas usam `service_role`, que faz bypass de RLS. O isolamento entre tenants depende **inteiramente** de cada `.eq("tenant_id", …)` escrito à mão em 989 chamadas. Uma omissão em qualquer uma delas vaza dados entre clientes, e as 308 policies não impedem — elas não são avaliadas nesse caminho.

Isso não afeta Disk I/O e não pertence a esta auditoria. Pertence a uma auditoria de segurança multi-tenant — `prompts/auditoria-lixo.md` já classifica "vazamento entre tenants" e "bypass de RLS" como **CRÍTICO**. As 3 consultas suspeitas identificadas em [`01` §12](01-nivel-a-mapa-consultas.md#12-consultas-sem-tenant_id-no-filtro) são o ponto de partida natural.

---

## 9. Frontend — nada a corrigir

Conferido e aprovado ([`01` §10](01-nivel-a-mapa-consultas.md#10-frontend--refetch-e-chamadas-duplicadas)):

- `staleTime: 30_000` — evita refetch imediato
- `refetchOnWindowFocus: false` — evita a causa mais comum de refetch excessivo
- Nenhum `refetchInterval` em todo o `src/` — sem polling
- Nenhuma chamada duplicada por React/Next detectada

O único ajuste sugerido é consequência das RPCs acima: quando o backend passar a devolver dezenas de linhas em vez de milhares, os cinco `slice()` de paginação em memória ([`01` §8](01-nivel-a-mapa-consultas.md#8-paginação-feita-no-frontend)) deixam de ser problema — ou viram paginação real de banco junto com a RPC.

**Ordem importa:** não trocar `slice()` por paginação de banco antes da RPC existir. Paginar no banco uma consulta que ainda carrega tudo para agregar em JS não resolve nada e ainda quebra os totais dos cards.
