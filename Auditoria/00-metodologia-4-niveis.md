# Metodologia — Auditoria de Disk I/O em 4 níveis

Procedimento reutilizável. Serve tanto para a auditoria completa quanto para reexecuções focadas num módulo.

---

## As 3 causas raiz que a Supabase aponta para High Disk I/O

Toda a auditoria existe para responder **qual das três** está causando o pico. Não misturar as três — cada uma tem sintoma, medição e correção diferentes.

| # | Causa | Sintoma no Supabase | Como medir | Correção típica |
|---|---|---|---|---|
| 1 | **Memória alta → swap para disco** | Disk IOPS alto junto com Memory alto; latência que piora sob concorrência | `Reports → Memory`; `temp_blks_read/written` em `pg_stat_statements`; `Sort Method: external merge` no `EXPLAIN` | Reduzir rows por query, `work_mem`, upgrade de instância, eliminar `ORDER BY` sem índice sobre grande volume |
| 2 | **Cache hit ratio baixo** | Disk read constante mesmo em consultas repetidas | `shared_blks_read` vs `shared_blks_hit`; alvo ≥ **99%** para tabelas quentes | Índice que reduza blocos lidos; menos colunas no `SELECT`; upgrade de RAM |
| 3 | **Queries lentas** | Picos de I/O correlacionados a rotas específicas | `mean_exec_time` — a documentação chama atenção especificamente para **> ~1 segundo** | Índice composto alinhado ao filtro real, agregação no banco, reescrita da query |

**Regra de ouro do alvo:** o alvo não é a query mais lenta, é o **custo acumulado**.

```
2.000 ms ×     10 execuções =    20 s de I/O
  150 ms × 100.000 execuções = 15.000 s de I/O   ← este é o alvo
```

Ordenar sempre por `total_exec_time`, nunca só por `mean_exec_time`.

---

## Nível A — análise estática do repositório

Sem tocar em produção. Escopo:

```
src/
  app/api/**/route.ts        API Routes
  server/modules/**          controllers, handlers, queries
  lib/server/**              helpers com acesso a banco
  modules/dashboard/**       PageViews, hooks, refetch
supabase/
  migrations/                índices, RLS, funções, views
  functions/                 Edge Functions
```

### Produto obrigatório: o mapa

Para cada tela relevante:

```
MinimumFactorAnalysisPage
  ↓
/api/apuracao-fator-minimo
  ↓
project_measurement_orders
  filters:
    tenant_id
    is_active
    measurement_kind
    execution_date  [range]
    project_id      [in]

Index atual:
  (tenant_id, measurement_kind, is_active, status)      ← sem execution_date
  (tenant_id, project_id, team_id, execution_date)      ← team_id no meio

Recomendado:
  (tenant_id, measurement_kind, is_active, status, execution_date)

Risco: ALTO
Motivo:
consulta frequente + intervalo de data + tenant + IN de projeto,
paginada em páginas de 1000 e agregada em JavaScript
```

### Checklist de verificação obrigatória do Nível A

Todos os itens abaixo são **obrigatórios** — marcar cada um como encontrado / não encontrado / não aplicável.

1. Todas as consultas feitas por páginas, APIs, Server Actions, RPCs e Edge Functions
2. `.select('*')` desnecessário
3. Consultas que carregam milhares de registros para filtrar/agrupar em JavaScript
4. `COUNT`, `SUM`, `AVG`, `GROUP BY`, `ORDER BY`, `DISTINCT` e joins em tabelas grandes
5. Múltiplas consultas na mesma tabela para formar cards diferentes
6. N+1 queries
7. Paginação feita no frontend em vez do banco
8. Filtros sem índice compatível
9. Índices simples que deveriam ser compostos
10. Índices duplicados / inúteis
11. Foreign keys sem índice útil
12. Índices apropriados para `tenant_id`
13. Consultas que usam `tenant_id` + `project_id`, `team_id`, datas, status e outros filtros recorrentes
14. Políticas RLS que executam subqueries ou funções repetidamente
15. Funções SQL/RPC que varrem tabelas completas
16. Views com agregação cara a cada acesso
17. Dashboards que recalculam históricos inteiros
18. Polling / refetch excessivo no frontend
19. Chamadas duplicadas provocadas por React/Next
20. Imports que fazem `INSERT`/`UPDATE` registro a registro em vez de lote
21. Migrations que criam estruturas que pioram performance

### Regra da ordem de colunas em índice composto

A ordem não é estética. Regra fixa:

```
(igualdades…, range/ORDER BY por último)
```

`tenant_id` primeiro sempre (é a igualdade mais seletiva num SaaS multi-tenant). Um índice `(tenant_id, execution_date, status)` **não** serve para `tenant_id = X AND status = Y AND execution_date BETWEEN …` — o range no meio corta o uso do que vem depois. O correto é `(tenant_id, status, execution_date)`.

---

## Nível B — queries reais do PostgreSQL

Fonte da verdade. Requer `pg_stat_statements`.

Métricas a coletar por query:

| Métrica | Lê o quê |
|---|---|
| `total_exec_time` | **custo acumulado** — ordenar por esta |
| `mean_exec_time` | alerta acima de ~1 s (limiar citado pela Supabase) |
| `calls` | frequência; revela o "rápido porém constante" |
| `rows` | volume trafegado; `rows/calls` alto = carregando demais |
| `shared_blks_hit` | blocos servidos pelo cache |
| `shared_blks_read` | **blocos lidos do disco** — o número que define Disk I/O |
| `temp_blks_read` / `temp_blks_written` | spill para disco = `work_mem` estourado (causa #1) |

Cache hit por query: `shared_blks_hit / (shared_blks_hit + shared_blks_read)`. Abaixo de **0,99** numa tabela quente é achado.

Scripts prontos: [`03-nivel-b-pg-stat-statements.md`](03-nivel-b-pg-stat-statements.md).

---

## Nível C — EXPLAIN

Só para as candidatas que o Nível B elegeu (ou, sem Nível B, para as de risco ALTO do Nível A).

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) <query>;
```

O que procurar:

| Sinal | Significa | Quando é problema |
|---|---|---|
| `Seq Scan` | varredura completa | **só** em tabela grande com consulta seletiva. Em tabela pequena é o plano correto — não corrigir. |
| `Rows Removed by Filter` alto | índice trouxe linhas demais e o filtro descartou | sempre — índice não está alinhado ao filtro |
| `Sort Method: external merge  Disk: NkB` | ordenação estourou `work_mem` e foi pro disco | sempre — causa #1 direta |
| `temp read` / `temp written` | mesma coisa, medido em blocos | sempre |
| `Nested Loop` com `loops=` muito alto | N+1 dentro do próprio plano | quando `loops` × custo interno domina o tempo |
| `Buffers: shared read=N` alto | N blocos vieram do disco | sempre — é o Disk I/O medido |
| `Buffers: shared hit=N` alto e `read=0` | veio tudo do cache | saudável |

**`Seq Scan` não é automaticamente problema.** Numa tabela de catálogo com dezenas de linhas, o planner escolhe `Seq Scan` porque é mais barato que o índice. O problema é `Seq Scan` em tabela grande para consulta altamente seletiva.

---

## Nível D — arquitetura

Olhar a tela inteira, não a query isolada.

Sintoma clássico:

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

Nove consultas percorrendo praticamente as mesmas tabelas. Alvo:

```
1 RPC
     ↓
uma agregação
     ↓
retorna todos os indicadores
```

ou, quando o dado tolera defasagem:

```
materialized view + REFRESH agendado
```

Critério para escolher:

| Situação | Solução |
|---|---|
| Indicadores precisam ser do instante da consulta | RPC única com CTEs, uma passada por tabela |
| Histórico fechado, recalculado a cada acesso | Materialized view com `REFRESH CONCURRENTLY` agendado |
| Filtro do usuário muda muito (datas, equipe, projeto) | RPC com parâmetros — matview não serve |
| Cards são do mesmo período e das mesmas tabelas | RPC única, sempre |

Verificar também no frontend: `staleTime`, `refetchInterval`, `refetchOnWindowFocus`, e chamadas duplicadas por React Strict Mode / re-render.

---

## Ordem de execução e regra de parada

```
A → B → C → D → plano de ação
```

**Não aplicar índice em lote com base só no Nível A.** Cada índice novo custa escrita e espaço em todo `INSERT`/`UPDATE` da tabela. Sem o Nível B não há como saber se a query que ele acelera é frequente. A sequência segura:

1. Nível A produz candidatos e o mapa.
2. Nível B ordena os candidatos por custo acumulado real.
3. Nível C confirma que o plano melhora com o índice proposto (`EXPLAIN` antes/depois).
4. Só então a migration entra.

Exceção: remoção de índice **exatamente duplicado** e correção de `.select('*')` podem ir antes do Nível B — são ganho sem risco de plano.

---

## Severidade

| Nível | Critério |
|---|---|
| **CRÍTICO** | I/O que já derruba ou degrada produção; query > 1 s em rota de uso diário; spill para disco recorrente |
| **ALTO** | Consulta frequente sem índice compatível; dashboard que carrega milhares de linhas para agregar em JS; N+1 em rota quente |
| **MÉDIO** | Índice redundante; `ORDER BY` sem índice em volume moderado; paginação por `OFFSET` profundo |
| **BAIXO** | Colunas a mais no `SELECT`; índice inútil em tabela pequena |
| **INFORMATIVO** | Suspeita que exige Nível B para confirmar |

**Confiança:** Alta (evidência direta e reproduzível) / Média (forte indicação) / Baixa (hipótese). Nunca recomendar `DROP INDEX` definitivo com confiança baixa, e nunca com base apenas no rótulo "unused" de um advisor — um índice pode existir para garantir unicidade ou atender uma rota sazonal (fechamento de mês, importação anual).
