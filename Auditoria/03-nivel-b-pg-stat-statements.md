# Nível B — Queries reais do PostgreSQL

Fonte da verdade da auditoria. O Nível A diz onde o I/O **provavelmente** está; este nível diz para onde ele **foi**.

---

## 0. O projeto já tem a ferramenta

**Não escrever script novo antes de ler este parágrafo.** O repositório já possui coleta de I/O pronta e mantida:

| Arquivo | O que faz |
|---|---|
| [`scripts/supabase-monitoring-readonly.sql`](../scripts/supabase-monitoring-readonly.sql) | 493 linhas, 18 blocos. Cobre Disk I/O por database e por tabela, pressão de CPU/memória, cache hit rate, top queries por tempo total, top queries por leitura de disco, tabelas por tamanho, índices não usados, `Seq Scan` por tabela, locks e conexões. |
| [`scripts/supabase-report-indica-controle-saude-io-performance.txt`](../scripts/supabase-report-indica-controle-saude-io-performance.txt) | Versão do mesmo conteúdo para colar no Supabase Reports |
| [`scripts/supabase-log-explorer-monitoring.sql`](../scripts/supabase-log-explorer-monitoring.sql) | Consultas para o Logs Explorer (PostgREST / Edge Functions) |

Como rodar:

```bash
npm run db:check-link
npx supabase db query --file scripts/supabase-monitoring-readonly.sql --linked
```

O bloco `04_top_expensive_queries` já devolve exatamente as 8 métricas exigidas por esta auditoria: `calls`, `total_exec_time`, `mean_exec_time`, `rows`, `shared_blks_hit`, `shared_blks_read`, `temp_blks_read`, `temp_blks_written` — ordenado por `total_exec_time desc`, que é o critério correto (custo acumulado, não pico isolado).

**Este documento não substitui aquele script.** Ele: (a) explica como ler a saída à luz das 3 causas raiz; (b) acrescenta as 3 consultas que faltam para fechar a checklist.

---

## 1. Pré-requisito — `pg_stat_statements`

Nenhuma migration do projeto cria a extensão. O script de monitoramento já trata a ausência com elegância (devolve linha de aviso e segue), mas **sem a extensão o Nível B não existe**.

Verificar:

```sql
select
  e.extname,
  e.extversion,
  n.nspname as schema
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
where e.extname = 'pg_stat_statements';
```

Se não retornar linha, habilitar pelo **Dashboard do Supabase → Database → Extensions → `pg_stat_statements`**. Em projetos Supabase ela normalmente já vem ativa no schema `extensions`; se não estiver visível pela sessão, é `search_path`:

```sql
select * from extensions.pg_stat_statements limit 1;
```

> Não habilitar via migration versionada sem alinhar com `guias/guia_supabase.md` — extensão é objeto de plataforma, e o Supabase gerencia `shared_preload_libraries`.

**Quando os contadores zeraram:**

```sql
select stats_reset from pg_stat_database where datname = current_database();
```

Contador acumulado desde o reset. Uma janela de 2 horas não representa o fechamento de mês. Idealmente: coletar em dia útil de pico e novamente em dia de fechamento.

---

## 2. Como ler a saída — mapa métrica → causa raiz

### Causa #1 — memória alta fazendo swap para disco

```sql
select
  round(total_exec_time::numeric, 0)                    as total_ms,
  calls,
  round(mean_exec_time::numeric, 1)                     as avg_ms,
  temp_blks_read,
  temp_blks_written,
  pg_size_pretty((temp_blks_written * 8192)::bigint)    as temp_escrito,
  left(query, 160)                                      as query
from extensions.pg_stat_statements
where temp_blks_written > 0
order by temp_blks_written desc
limit 25;
```

**Qualquer linha com `temp_blks_written > 0` é achado.** Significa que a query estourou `work_mem` e ordenou/agrupou/fez hash em disco. É a causa #1 medida diretamente.

Complemento no nível do banco:

```sql
select temp_files, pg_size_pretty(temp_bytes) as temp_total, stats_reset
from pg_stat_database
where datname = current_database();
```

Correlacionar com o `ORDER BY sob` sobre `project_with_labels` (10 `LEFT JOIN`) e com o `ORDER BY entry_date, id` de `dash-estoque` — os dois candidatos identificados no Nível A.

### Causa #2 — cache hit ratio baixo

Por banco (alvo ≥ **99%**):

```sql
select
  round(100.0 * blks_hit / nullif(blks_hit + blks_read, 0), 2) as cache_hit_pct
from pg_stat_database
where datname = current_database();
```

**Por query** — não está no script existente, e é o corte mais útil:

```sql
select
  round(total_exec_time::numeric, 0)                                   as total_ms,
  calls,
  shared_blks_hit,
  shared_blks_read,
  round(100.0 * shared_blks_hit
        / nullif(shared_blks_hit + shared_blks_read, 0), 2)            as cache_hit_pct,
  pg_size_pretty((shared_blks_read * 8192)::bigint)                    as lido_do_disco,
  left(query, 160)                                                     as query
from extensions.pg_stat_statements
where shared_blks_read + shared_blks_hit > 0
order by shared_blks_read desc
limit 30;
```

Ler assim:

| `cache_hit_pct` | `shared_blks_read` | Interpretação |
|---|---|---|
| ≥ 99% | qualquer | saudável — os blocos vêm da RAM |
| 90–99% | alto | tabela maior que o cache útil, **ou** falta índice que reduziria os blocos tocados |
| < 90% | alto | **achado ALTO** — é aqui que o Disk I/O está |
| < 90% | baixo | query rara; ignorar (custo acumulado baixo) |

### Causa #3 — queries lentas (> ~1 s)

```sql
select
  round(mean_exec_time::numeric, 1)     as avg_ms,
  calls,
  round(total_exec_time::numeric, 0)    as total_ms,
  round(rows::numeric / nullif(calls,0), 1) as rows_por_call,
  left(query, 200)                      as query
from extensions.pg_stat_statements
where mean_exec_time > 1000        -- limiar citado pela documentação Supabase
order by total_exec_time desc;
```

E o corte que realmente prioriza — **custo acumulado**, independente de ser lenta:

```sql
select
  round(total_exec_time::numeric, 0)                        as total_ms,
  round(100.0 * total_exec_time
        / sum(total_exec_time) over (), 2)                  as pct_do_tempo_total,
  calls,
  round(mean_exec_time::numeric, 1)                         as avg_ms,
  round(rows::numeric / nullif(calls, 0), 1)                as rows_por_call,
  shared_blks_read,
  temp_blks_written,
  left(query, 200)                                          as query
from extensions.pg_stat_statements
order by total_exec_time desc
limit 30;
```

A coluna `pct_do_tempo_total` é a mais importante da auditoria inteira. Se uma query sozinha responde por 30% do tempo de execução do banco, ela é a auditoria.

---

## 3. Cruzamento obrigatório com o Nível A

Para cada rota de risco ALTO de [`01-nivel-a-mapa-consultas.md`](01-nivel-a-mapa-consultas.md), localizar a query correspondente. Como o PostgREST normaliza a query, buscar pelo nome da tabela:

```sql
select
  round(total_exec_time::numeric, 0)  as total_ms,
  calls,
  round(mean_exec_time::numeric, 1)   as avg_ms,
  round(rows::numeric / nullif(calls,0), 1) as rows_por_call,
  shared_blks_read,
  temp_blks_written,
  left(query, 300)                    as query
from extensions.pg_stat_statements
where query ilike '%project_measurement_orders%'
   or query ilike '%project_with_labels%'
   or query ilike '%stock_transfers%'
   or query ilike '%project_programming%'
   or query like  '%from programming %'
order by total_exec_time desc
limit 40;
```

**Preencher esta tabela e anexar ao relatório:**

| Rota (Nível A) | Tabela | `total_ms` | `calls` | `avg_ms` | `blks_total/call` | `blks_read` | `temp_written` | Confirma o risco? |
|---|---|---|---|---|---|---|---|---|
| `/api/apuracao-fator-minimo` | `project_measurement_orders` | | | | | | | |
| `/api/dashboard-medicao` | `project_measurement_orders` | | | | | | | |
| `/api/dash-operacional-faturamento` | `project_with_labels` | | | | | | | |
| `/api/dash-estoque` | `stock_transfers` | | | | | | | |
| `/api/medicao` | `programming` | | | | | | | |
| `/api/faturamento` | `project_billing_orders` | | | | | | | |

**`blks_total/call`** — `(shared_blks_hit + shared_blks_read) / calls`, blocos de 8 kB — é a coluna que confirma ou derruba o achado estrutural do Nível A. Acima de ~1.000 blocos (~8 MB) por chamada, a varredura ampla para agregar em JavaScript está confirmada. Abaixo de ~100, o Nível A superestimou e a prioridade cai.

> **Não usar `rows/call` para isso.** Medido na captura de 2026-08-12: em tráfego PostgREST ela é **sempre `1,00`**, porque o `json_agg()` do PostgREST devolve todo o resultado empacotado numa única linha. Detalhe em [`07` §3.1](07-baseline-p1.md#31-tabela-de-cruzamento-do-nível-a).

---

## 4. Diagnóstico de tabela — onde o I/O se concentra

```sql
select
  s.relname                                              as tabela,
  pg_size_pretty(pg_total_relation_size(c.oid))          as tamanho_total,
  pg_size_pretty(pg_indexes_size(c.oid))                 as tamanho_indices,
  s.heap_blks_read,
  s.idx_blks_read,
  round(100.0 * (s.heap_blks_hit + s.idx_blks_hit)
        / nullif(s.heap_blks_hit + s.heap_blks_read
               + s.idx_blks_hit + s.idx_blks_read, 0), 2) as cache_hit_pct,
  t.seq_scan,
  t.seq_tup_read,
  case when t.seq_scan > 0
       then round(t.seq_tup_read::numeric / t.seq_scan, 0)
  end                                                     as linhas_por_seq_scan,
  t.idx_scan,
  t.n_live_tup
from pg_statio_user_tables s
join pg_class c        on c.oid = s.relid
join pg_stat_user_tables t on t.relid = s.relid
order by (s.heap_blks_read + s.idx_blks_read) desc
limit 25;
```

Leitura:

- **`linhas_por_seq_scan` alto + `n_live_tup` alto** = `Seq Scan` em tabela grande. Achado.
- **`seq_scan` alto + `n_live_tup` baixo** = catálogo pequeno. Correto, não mexer.
- **`tamanho_indices` > `tamanho_total / 2`** = write amplification. Cruzar com [`02` §4](02-nivel-a-indices.md#4-write-amplification) — `project_programming` (19 índices) e `project` (17) são os suspeitos previstos.

---

## 5. Inventário real de índices

Reconcilia o estado do banco com o que as migrations dizem ([`02`](02-nivel-a-indices.md)).

```sql
select
  t.relname                                     as tabela,
  i.relname                                     as indice,
  pg_size_pretty(pg_relation_size(i.oid))       as tamanho,
  s.idx_scan                                    as vezes_usado,
  s.idx_tup_read,
  s.idx_tup_fetch,
  ix.indisunique                                as e_unique,
  pg_get_indexdef(i.oid)                        as definicao
from pg_index ix
join pg_class i on i.oid = ix.indexrelid
join pg_class t on t.oid = ix.indrelid
join pg_namespace n on n.oid = t.relnamespace
left join pg_stat_user_indexes s on s.indexrelid = i.oid
where n.nspname = 'public'
order by s.idx_scan asc nulls first, pg_relation_size(i.oid) desc;
```

**`idx_scan = 0`** após uma janela representativa = candidato a remoção. Duas ressalvas que valem regra:

1. **Nunca remover um índice `UNIQUE`** por estar com `idx_scan = 0` — ele existe para garantir a constraint, não para acelerar leitura. Ex.: `ux_project_apr_controls_apr_id_global`, `uq_programming_team_active_per_stage`.
2. **Nunca remover com base numa janela curta.** Um índice de fechamento de mês fica com `idx_scan = 0` durante 28 dias.

Detecção de duplicatas no banco real:

```sql
select
  indrelid::regclass                                   as tabela,
  array_agg(indexrelid::regclass)                      as indices_identicos,
  pg_size_pretty(sum(pg_relation_size(indexrelid)))    as espaco_desperdicado
from pg_index
group by indrelid, indkey, indclass, indexprs, indpred
having count(*) > 1;
```

Deve retornar os dois pares de `project` já previstos no Nível A (`priority`/`priority_uuid` e `city`/`city_uuid`). Se retornar mais, o banco divergiu das migrations — **reportar a divergência antes de agir**, conforme a seção 12 de `CLAUDE.md`.

---

## 6. Seletividade real das colunas booleanas

Fecha o achado de write amplification em `project` ([`02` §4](02-nivel-a-indices.md#4-write-amplification)).

```sql
select
  attname                                   as coluna,
  n_distinct,
  round(100.0 * (1 - null_frac)::numeric, 1) as pct_nao_nulo,
  most_common_vals,
  most_common_freqs
from pg_stats
where schemaname = 'public'
  and tablename  = 'project'
  and attname in ('is_active','is_test','is_withdrawn',
                  'is_third_party','has_locacao','fob');
```

Regra de decisão:

| `most_common_freqs` do valor filtrado | Ação |
|---|---|
| > 0,20 (mais de 20% das linhas) | índice B-tree não ajuda — o planner escolherá `Seq Scan`. **Remover ou tornar parcial.** |
| 0,01 – 0,20 | índice parcial `WHERE coluna = <valor raro>` é a forma certa |
| < 0,01 | índice parcial, claramente vantajoso |

---

## 7. Foreign keys sem índice

Item 11 da checklist, não determinável estaticamente. O PostgreSQL não indexa a coluna que referencia — sem índice, todo `DELETE`/`UPDATE` no pai faz `Seq Scan` na filha.

```sql
select
  c.conrelid::regclass                                   as tabela_filha,
  a.attname                                              as coluna_fk,
  c.confrelid::regclass                                  as tabela_pai,
  pg_size_pretty(pg_relation_size(c.conrelid))           as tamanho_filha,
  c.conname                                              as constraint_name
from pg_constraint c
join lateral unnest(c.conkey) with ordinality as k(attnum, ord) on true
join pg_attribute a
  on a.attrelid = c.conrelid and a.attnum = k.attnum
where c.contype = 'f'
  and not exists (
    select 1
    from pg_index i
    where i.indrelid = c.conrelid
      and (i.indkey::smallint[])[0] = k.attnum
      and k.ord = 1
  )
order by pg_relation_size(c.conrelid) desc;
```

Retorna FKs cuja coluna **não** é a primeira de nenhum índice. Priorizar por `tamanho_filha`.

> Nota: no padrão deste projeto, os índices começam por `tenant_id`, então uma FK `project_id` indexada como `(tenant_id, project_id)` **aparecerá** nesta lista. Isso é aceitável — o `DELETE` em `project` filtrado por tenant usa o índice. Avaliar caso a caso; não criar índice single-column só para silenciar a consulta.

---

## 8. Higiene: bloat, autovacuum e conexões

```sql
select
  relname                          as tabela,
  n_live_tup,
  n_dead_tup,
  round(100.0 * n_dead_tup
        / nullif(n_live_tup + n_dead_tup, 0), 1) as pct_morto,
  last_autovacuum,
  last_autoanalyze,
  autovacuum_count
from pg_stat_user_tables
where n_dead_tup > 1000
order by n_dead_tup desc
limit 20;
```

`pct_morto` acima de ~20% significa que o Postgres lê páginas cheias de tuplas mortas — **I/O puro desperdiçado**, e uma das causas de Disk I/O alto que não aparece em nenhuma query específica. Tabelas com muito `UPDATE` (`project_programming`, `project_measurement_orders`, `programming`) são as candidatas.

Estatísticas desatualizadas produzem plano ruim mesmo com índice certo:

```sql
analyze verbose public.project_measurement_orders;
```

---

## 9. Saída esperada deste nível

Anexar ao relatório final:

1. Tabela do §3 preenchida.
2. Top 10 por `total_exec_time` com `pct_do_tempo_total`.
3. Toda query com `temp_blks_written > 0`.
4. Toda query com `cache_hit_pct < 90` e `shared_blks_read` alto.
5. Lista de índices com `idx_scan = 0`, já filtrada de uniques.
6. Lista de FKs sem índice, ordenada por tamanho.
7. `pct_morto` das 5 tabelas mais escritas.

Com isso, o Nível C ganha uma lista curta e defensável de queries para `EXPLAIN` — e o plano de ação para de ser hipótese.
