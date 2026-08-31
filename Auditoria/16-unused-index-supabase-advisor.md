# 16 - Supabase Advisor: unused_index pos-399

Data: 2026-08-31
Fonte: export do Supabase Database Linter observado em 2026-08-31T11:28:32.449Z.
Escopo: alertas `unused_index` remanescentes depois da aplicacao da migration 399.

## Resultado da rodada

Depois da migration `399_create_missing_foreign_key_indexes_post_301.sql`, a familia
`unindexed_foreign_keys` saiu do relatorio. O arquivo enviado apos a aplicacao da 399
tem somente alertas INFO de performance:

| Alerta | Quantidade | Veredito |
|---|---:|---|
| `unindexed_foreign_keys` | 0 | Resolvido pela 399 |
| `unused_index` | 438 | Nao remover automaticamente |

Dos 438 `unused_index`, 366 sao indices com prefixo `idx_fk_`, criados para cobrir
foreign keys. Isso e esperado logo apos uma migration de cobertura de FK: os indices
acabaram de nascer, ainda nao tiveram janela real de uso e podem ser acionados somente
em fluxos raros de `DELETE`/`UPDATE` na tabela pai.

## Veredito

Nao criar migration de `DROP INDEX` agora.

`unused_index` sozinho nao prova redundancia. Ele so diz que `idx_scan = 0` na janela
atual de estatisticas. Essa janela pode ser curta, ter sido reiniciada por deploy,
restore, manutencao ou simplesmente nao ter exercitado fluxos raros como estorno,
auditoria, fechamento mensal, importacao, cancelamento e historicos.

Remover agora seria especialmente arriscado porque a maioria dos alertas atuais e de
indice defensivo de FK. Esses indices nao existem para acelerar a tela comum; eles
evitam `Seq Scan` na tabela filha quando a tabela pai sofre `DELETE` ou `UPDATE` em
colunas referenciadas.

## Maiores concentracoes

Top tabelas por quantidade de `unused_index` no relatorio pos-399:

| Tabela | Alertas |
|---|---:|
| `project` | 14 |
| `teams` | 12 |
| `stock_transfer_item_reversals` | 10 |
| `materials` | 10 |
| `programming` | 10 |
| `project_programming` | 9 |
| `cronograma_solicitacoes` | 8 |
| `trafo_instances` | 8 |
| `project_programming_copy_batch_items` | 8 |
| `programming_team` | 7 |
| `stock_reversal_request_items` | 7 |

Essa distribuicao reforca o diagnostico: boa parte esta em tabelas relacionais,
historicas, reversao/estorno ou dominios com uso sazonal.

## Quando reabrir esta auditoria

Reavaliar somente quando todas as condicoes abaixo forem verdadeiras:

| Condicao | Criterio minimo |
|---|---|
| Janela de estatisticas conhecida | `stats_reset` anotado e com pelo menos 30 dias de uso real, idealmente incluindo fechamento/medicao/estorno/importacao |
| Workload representativo | Rotas principais, rotas raras e rotinas administrativas exercitadas |
| Banco estavel | Sem migration grande de indices imediatamente antes da captura |
| Evidencia de tamanho | Tamanho de indice e tabela coletado em `pg_relation_size` |
| Evidencia de contrato | Confirmado que o indice nao sustenta constraint, FK, unicidade, ordenacao critica ou fluxo raro |

Sem isso, manter os indices.

## Consultas para a proxima rodada

### 1. Janela de estatisticas

```sql
select stats_reset
from pg_stat_database
where datname = current_database();
```

### 2. Indices sem uso, com tamanho

```sql
select
  schemaname,
  relname as table_name,
  indexrelname as index_name,
  idx_scan,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
  pg_relation_size(indexrelid) as index_size_bytes
from pg_stat_user_indexes
where schemaname = 'public'
  and idx_scan = 0
order by pg_relation_size(indexrelid) desc, relname, indexrelname;
```

### 3. Se o indice sustenta constraint

```sql
select
  n.nspname as schema_name,
  t.relname as table_name,
  i.relname as index_name,
  c.conname as constraint_name,
  c.contype as constraint_type
from pg_index ix
join pg_class i on i.oid = ix.indexrelid
join pg_class t on t.oid = ix.indrelid
join pg_namespace n on n.oid = t.relnamespace
left join pg_constraint c on c.conindid = ix.indexrelid
where n.nspname = 'public'
order by t.relname, i.relname;
```

### 4. FKs cobertas por cada indice

```sql
with fk_columns as (
  select
    c.oid as constraint_oid,
    n.nspname as schema_name,
    t.relname as table_name,
    c.conname as constraint_name,
    c.conrelid,
    c.conkey
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where c.contype = 'f'
    and n.nspname = 'public'
)
select
  fk.schema_name,
  fk.table_name,
  fk.constraint_name,
  idx.relname as covering_index
from fk_columns fk
join pg_index i
  on i.indrelid = fk.conrelid
 and i.indisvalid = true
 and i.indisready = true
 and i.indpred is null
 and array(
   select indexed_attnum
   from unnest((i.indkey::int2[])[0:array_length(fk.conkey, 1) - 1]) as indexed(indexed_attnum)
 ) = fk.conkey
join pg_class idx on idx.oid = i.indexrelid
order by fk.table_name, fk.constraint_name, idx.relname;
```

## Regras para uma futura migration de drop

Um indice so pode entrar numa migration de remocao quando cumprir todos os itens:

- `idx_scan = 0` numa janela confiavel.
- Nao e `unique`, `primary key` nem indice de constraint.
- Nao cobre nenhuma FK como unico indice valido.
- Nao aparece em query real, RPC, view, trigger ou fluxo administrativo raro.
- Nao cobre ordenacao/paginacao estavel de listagem ou exportacao.
- Existe indice mais amplo que cobre o mesmo prefixo, com mesmo predicado, ou o indice e comprovadamente inutil por seletividade/tamanho.
- A migration de drop inclui validacao defensiva que aborta se a premissa de redundancia nao for verdadeira no banco alvo.

## Candidatos para olhar primeiro no futuro

Priorizar indices grandes e nao-`idx_fk_`. Os `idx_fk_` devem ser analisados por ultimo,
e geralmente preservados.

Categorias de maior chance de remocao segura:

- duplicatas exatas;
- prefixos redundantes com mesmo predicado;
- indices sobre booleanos pouco seletivos quando existe composto melhor;
- indices criados para telas ou modulos comprovadamente mortos;
- indices antigos de tabelas legadas apos o cutover estar fechado e medido.

Categorias para preservar por padrao:

- indices `idx_fk_*`;
- historicos e auditoria;
- estorno/reversao;
- importacao e reconciliacao;
- constraints de negocio, unicidade parcial e guards transacionais;
- indices tenant-first que sustentam isolamento, paginacao ou exportacao.

## Estado final

Nenhuma acao de banco agora. A acao correta e guardar esta auditoria, aguardar uma
janela de estatisticas representativa e repetir a analise com tamanho, constraints,
FKs e queries reais antes de qualquer `DROP INDEX`.
