# Nível C — EXPLAIN (ANALYZE, BUFFERS)

Só para as candidatas que o Nível B elegeu. Rodar `EXPLAIN` em query que o banco executa 3 vezes por dia é desperdício de análise.

---

## 1. Forma correta do comando

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT) <query>;
```

| Opção | Por quê |
|---|---|
| `ANALYZE` | executa de verdade e mede tempo e linhas reais — sem ele, só há estimativa |
| `BUFFERS` | **obrigatório nesta auditoria** — é a única opção que mostra blocos lidos do disco |
| `VERBOSE` | mostra as colunas devolvidas; revela `SELECT` largo demais |

⚠️ `ANALYZE` **executa** a query. Para `INSERT`/`UPDATE`/`DELETE`, sempre dentro de transação com rollback:

```sql
begin;
explain (analyze, buffers) update public.project set updated_at = now() where id = '...';
rollback;
```

Rodar duas vezes: a primeira aquece o cache, a segunda mostra o estado de regime. Comparar as duas dá a medida real do custo de cache frio.

---

## 2. O que procurar — e quando é problema

| Sinal no plano | Significa | É problema quando |
|---|---|---|
| `Seq Scan on <tabela>` | varredura completa | a tabela é **grande** e a consulta é **seletiva**. Em catálogo pequeno é o plano ótimo — **não corrigir**. |
| `Rows Removed by Filter: N` | o nó trouxe linhas que o filtro descartou | `N` é da mesma ordem das linhas devolvidas, ou maior. Índice desalinhado com o filtro. |
| `Sort Method: quicksort  Memory: NkB` | ordenou em RAM | nunca — é o caminho saudável |
| `Sort Method: external merge  Disk: NkB` | **estourou `work_mem`, ordenou em disco** | **sempre** — causa raiz #1 diretamente medida |
| `Buffers: shared read=N` | N blocos vieram do disco | `N` alto — é o Disk I/O sendo medido, em blocos de 8 kB |
| `Buffers: shared hit=N` com `read=0` | veio tudo do cache | nunca — é o alvo |
| `Buffers: temp read=N written=M` | spill de hash/sort para disco | sempre |
| `Nested Loop … loops=N` com N alto | o nó interno rodou N vezes | quando `N × custo_interno` domina. É o N+1 dentro do próprio plano. |
| `Hash Join` com `Batches: >1` | hash não coube em memória | sempre |
| `actual rows` ≫ `rows` (estimado) | estatística desatualizada | sempre — rodar `ANALYZE <tabela>` |
| `Index Scan` seguido de `Filter:` pesado | índice usado só parcialmente | quando `Rows Removed by Filter` é alto — falta coluna no índice |

**Repetindo o ponto mais importante:** `Seq Scan` **não é** automaticamente um problema. Numa tabela de dezenas de linhas — `programming_reason_catalog`, `app_pages`, `job_levels`, `measurement_score_targets` — o planner escolhe `Seq Scan` porque ler 2 páginas é mais barato que descer um índice. Corrigir isso é piorar. O problema é `Seq Scan` em tabela grande para consulta altamente seletiva.

Regra prática: antes de chamar um `Seq Scan` de achado, confirmar `n_live_tup` da tabela em `pg_stat_user_tables`.

---

## 3. Candidatas identificadas pelo Nível A

Rodar estas na ordem. As consultas estão traduzidas do PostgREST para SQL; substituir `:tenant`, `:inicio`, `:fim` pelos valores reais de um tenant de volume representativo.

### C-1 · `project_measurement_orders` — filtro dominante

Origem: [`01` §5.1](01-nivel-a-mapa-consultas.md#51-minimumfactoranalysispage--risco-alto). 6 consultas em 4 rotas.

```sql
explain (analyze, buffers)
select id, order_number, project_id, team_id, execution_date, status,
       project_code_snapshot, team_name_snapshot, foreman_name_snapshot
from public.project_measurement_orders
where tenant_id        = :tenant
  and is_active        = true
  and measurement_kind = 'COM_PRODUCAO'
  and execution_date  >= :inicio
  and execution_date  <= :fim
order by execution_date asc, team_name_snapshot asc
limit 1000;
```

**Hipótese:** o planner usa `idx_project_measurement_orders_tenant_kind_active_status` (que não tem `execution_date`) e descarta o range no filtro → `Rows Removed by Filter` alto; ou usa `..._tenant_exec_status` e paga filtro em `measurement_kind`/`is_active`. Em ambos, `ORDER BY … team_name_snapshot` gera `Sort` separado.

**Verificação da correção:**

```sql
create index concurrently if not exists idx_pmo_kind_active_status_exec
  on public.project_measurement_orders
  (tenant_id, measurement_kind, is_active, status, execution_date);

analyze public.project_measurement_orders;
-- rodar o mesmo EXPLAIN e comparar
```

Aceite: `shared read` cai; `Rows Removed by Filter` cai para próximo de zero; nó vira `Index Scan` sobre o índice novo. Se não cair, **dropar o índice** — índice que não muda plano é só custo de escrita.

---

### C-2 · `project_with_labels` — join de 11 tabelas com `ORDER BY sob`

Origem: [`01` §9](01-nivel-a-mapa-consultas.md#9-view-project_with_labels). 11 usos com esse `ORDER BY`.

```sql
explain (analyze, buffers)
select id, sob, service_center_text, service_type, service_type_text,
       is_active, is_test, is_withdrawn, is_third_party
from public.project_with_labels
where tenant_id = :tenant
  and is_active = true
  and is_test   = false
  and is_third_party = false
order by sob asc
limit 1000 offset 0;
```

**Procurar especificamente:**
- `Sort Method: external merge  Disk:` — se aparecer, é a causa #1 confirmada.
- Se os 10 `LEFT JOIN` são executados **antes** do `LIMIT` (o normal) — significa que 11 tabelas são joinadas para devolver 1.000 linhas.
- Repetir com `offset 5000` e comparar `Buffers`. Se `shared read` cresce proporcionalmente ao offset, a paginação por `OFFSET` está confirmada como amplificador de I/O.

**Duas correções possíveis, testar as duas:**

```sql
-- (a) índice que cobre filtro + ordenação, eliminando o Sort
create index concurrently if not exists idx_project_tenant_active_test_third_sob
  on public.project (tenant_id, is_active, is_test, is_third_party, sob);
```

```sql
-- (b) keyset pagination — elimina o custo crescente do OFFSET
select ... from public.project_with_labels
where tenant_id = :tenant and is_active = true
  and sob > :ultimo_sob_da_pagina_anterior
order by sob asc
limit 1000;
```

(a) e (b) são complementares, não alternativas.

---

### C-3 · `stock_transfers` — paginação por `OFFSET` até 20.000

Origem: [`01` §5.4](01-nivel-a-mapa-consultas.md#54-dashestoquepage--risco-alto).

```sql
-- primeira página
explain (analyze, buffers)
select id, movement_type, from_stock_center_id, to_stock_center_id,
       project_id, entry_date, updated_at, created_at, operation_event_id
from public.stock_transfers
where tenant_id  = :tenant
  and entry_date >= :inicio
  and entry_date <= :fim
order by entry_date asc, id asc
limit 1000 offset 0;

-- última página do laço
explain (analyze, buffers)
select ... -- mesma query
limit 1000 offset 19000;
```

**Comparar `Buffers: shared read` das duas.** A diferença é o custo puro do `OFFSET` — blocos lidos do disco só para serem descartados. É a demonstração numérica que justifica trocar por keyset:

```sql
-- keyset: custo constante por página
where tenant_id = :tenant
  and entry_date >= :inicio and entry_date <= :fim
  and (entry_date, id) > (:ultima_data, :ultimo_id)
order by entry_date asc, id asc
limit 1000;
```

O índice `idx_stock_transfers_tenant_entry_date (tenant_id, entry_date desc, created_at desc)` está em `desc` enquanto a query ordena `asc`. O Postgres consegue percorrer um B-tree ao contrário sem custo extra, então isso **não** é problema — mas `id` não está no índice, o que gera ordenação residual dentro de cada `entry_date`. Verificar se aparece `Incremental Sort` no plano.

---

### C-4 · `programming` — filtro por projeto + status

Origem: [`01` §5.5](01-nivel-a-mapa-consultas.md#55-programming-programação-normalizada--risco-médio-alto).

```sql
explain (analyze, buffers)
select id, project_id, execution_date, status, work_completion_status, updated_at
from public.programming
where tenant_id  = :tenant
  and status     = 'PROGRAMADA'
  and project_id = any(:lista_de_100_projetos)
  and execution_date >= :inicio
  and execution_date <= :fim
order by project_id, execution_date, updated_at;
```

**Hipótese:** usa `idx_programming_tenant_status_date (tenant_id, status, execution_date desc)` e depois filtra `project_id` linha a linha → `Rows Removed by Filter` alto quando o range de data é largo.

```sql
create index concurrently if not exists idx_programming_tenant_project_status_exec
  on public.programming (tenant_id, project_id, status, execution_date);
```

---

### C-5 · Custo de escrita em `project_programming`

Origem: [`02` §4](02-nivel-a-indices.md#4-write-amplification). 19 índices, 2 com chamada de função no predicado.

```sql
begin;
explain (analyze, buffers)
update public.project_programming
set work_completion_status = work_completion_status,
    updated_at = now()
where tenant_id = :tenant and id = :id_existente;
rollback;
```

Procurar em `Buffers` os blocos `dirtied`/`written` — cada índice afetado gera escrita. Comparar com o mesmo `UPDATE` numa tabela de poucos índices (`cronograma_solicitacoes`, 5 índices) para dimensionar a diferença.

Confirmar também a volatilidade da função usada nos predicados parciais:

```sql
select proname,
       case provolatile when 'i' then 'IMMUTABLE'
                        when 's' then 'STABLE'
                        when 'v' then 'VOLATILE' end as volatilidade
from pg_proc
where proname = 'normalize_programming_work_completion_code';
```

Precisa ser `IMMUTABLE` para o índice ser válido. Se for, o custo por escrita é a avaliação da função — não desprezível, mas o índice é constraint de negócio e **não deve ser removido**.

---

### C-6 · Import registro a registro

Origem: [`01` §11](01-nivel-a-mapa-consultas.md#11-imports-registro-a-registro).

Aqui `EXPLAIN` de uma linha diz pouco — o custo é `N` transações, não o plano. Medir empiricamente:

```sql
select now();  -- antes
-- executar a importação de uma planilha de teste com ~500 linhas
select now();  -- depois

-- e o efeito no WAL:
select pg_size_pretty(pg_current_wal_lsn() - :lsn_antes) as wal_gerado;
```

Comparar com a mesma carga via RPC em lote (`save_team_stock_operation_batch_full` é o precedente no projeto).

---

## 4. Registro dos resultados

Para cada candidata, anexar ao relatório:

```
### C-N · <tabela> — <descrição>

Antes:
  Plano:            <nó raiz, ex. Seq Scan / Index Scan usando X>
  Tempo:            <actual time total>
  Buffers:          shared hit=N read=M   temp read=X written=Y
  Rows Removed:     <N>
  Sort Method:      <quicksort Memory / external merge Disk>

Correção aplicada:
  <SQL exato>

Depois:
  Plano:            <...>
  Tempo:            <...>
  Buffers:          <...>

Ganho:      -N% tempo, -M blocos lidos do disco
Veredito:   MANTER / REVERTER
```

**Veredito `REVERTER` é resultado legítimo e deve ser registrado.** Um índice que não mudou o plano é custo de escrita permanente sem contrapartida — dropar e documentar por quê, para que ninguém proponha o mesmo índice em seis meses.
